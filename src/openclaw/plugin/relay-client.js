import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { resolveClaworldRuntimeConfig } from './config-schema.js';
import { buildRuntimeAuthHeaders } from './account-identity.js';
import { buildClaworldRelayClientVersion } from '../plugin-version.js';
import { createRelayEventProtocol } from '../protocol/relay-event-protocol.js';
import { createInboundSessionRouter } from '../runtime/inbound-session-router.js';
import { createOutboundSessionBridge } from '../runtime/outbound-session-bridge.js';
import { normalizeChatRequestInput } from '../../lib/chat-request.js';
import {
  buildPublicErrorPayload,
  createRuntimeBoundaryError,
  logRuntimeBoundary,
} from '../../lib/runtime-errors.js';
import {
  buildAcceptedAckTimeoutError,
  buildInboundEnvelope,
  buildKeepSilentAckTimeoutError,
  buildKeepSilentFallbackError,
  buildReplyAckTimeoutError,
  buildReplyFallbackError,
  DEFAULT_REPLY_ACK_TIMEOUT_MS,
  DUPLICATE_CONNECTION_CLOSE_CODE,
  isDeliveryKeptSilentAlreadyApplied,
  isReplyAlreadyApplied,
  normalizeOptionalText,
  normalizeRelayWebSocketUrl,
  requireClientMessageId,
  STALE_CONNECTION_CLOSE_CODE,
  TERMINAL_CLOSE_REASONS,
} from './relay-client-shared.js';

const DELIVERY_VISIBILITY_RETRY_ATTEMPTS = 20;
const DELIVERY_VISIBILITY_RETRY_DELAY_MS = 10;
const DEFAULT_RELAY_AUTH_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 60_000;
const DEFAULT_RECONNECT_JITTER_RATIO = 0.2;

function isDeliveryVisibilityMiss(result = {}) {
  return Number(result?.status) === 404
    && normalizeOptionalText(result?.body?.error) === 'delivery_not_found';
}

async function waitForDeliveryVisibilityRetry() {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, DELIVERY_VISIBILITY_RETRY_DELAY_MS);
    if (typeof timer?.unref === 'function') timer.unref();
  });
}

export class ClaworldRelayClient extends EventEmitter {
  constructor({
    logger = console,
    inbound = createInboundSessionRouter(),
    outbound = createOutboundSessionBridge(),
    protocol = createRelayEventProtocol(),
    wsFactory = (url) => new WebSocket(url),
    httpFetch = globalThis.fetch,
    authTimeoutMs = DEFAULT_RELAY_AUTH_TIMEOUT_MS,
    reconnectBaseDelayMs = DEFAULT_RECONNECT_BASE_DELAY_MS,
    reconnectMaxDelayMs = DEFAULT_RECONNECT_MAX_DELAY_MS,
    reconnectJitterRatio = DEFAULT_RECONNECT_JITTER_RATIO,
    random = Math.random,
  } = {}) {
    super();
    this.logger = logger;
    this.inbound = inbound;
    this.outbound = outbound;
    this.protocol = protocol;
    this.wsFactory = wsFactory;
    this.httpFetch = httpFetch;
    this.authTimeoutMs = Math.max(1, Math.floor(Number(authTimeoutMs) || DEFAULT_RELAY_AUTH_TIMEOUT_MS));
    this.reconnectBaseDelayMs = Math.max(1, Math.floor(Number(reconnectBaseDelayMs) || DEFAULT_RECONNECT_BASE_DELAY_MS));
    this.reconnectMaxDelayMs = Math.max(this.reconnectBaseDelayMs, Math.floor(Number(reconnectMaxDelayMs) || DEFAULT_RECONNECT_MAX_DELAY_MS));
    this.reconnectJitterRatio = Math.max(0, Math.min(1, Number(reconnectJitterRatio) || 0));
    this.random = typeof random === 'function' ? random : Math.random;
    this.ws = null;
    this.events = [];
    this.heartbeatTimer = null;
    this.connectionState = 'idle';
    this.runtimeConfig = null;
    this.boundAgentId = null;
    this.serverUrl = null;
    this.connectionParams = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this.lastDisconnectInfo = null;
    this.acceptedChatRequests = new Map();
  }

  buildBoundaryContext(extra = null) {
    return {
      accountId: this.runtimeConfig?.accountId || null,
      agentId: this.boundAgentId,
      ...(extra && typeof extra === 'object' ? extra : {}),
    };
  }

  buildDisconnectInfo(code = null, reason = null, source = 'socket') {
    const reasonText = String(reason || '').trim() || null;
    return {
      code: Number.isInteger(code) ? code : null,
      reason: reasonText,
      source,
      recoverable: !(
        code === DUPLICATE_CONNECTION_CLOSE_CODE
        || code === STALE_CONNECTION_CLOSE_CODE
        || TERMINAL_CLOSE_REASONS.has(reasonText)
      ),
    };
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  resolveReconnectDelayMs(attempt = this.reconnectAttempts + 1) {
    const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
    const exponent = Math.min(normalizedAttempt - 1, 10);
    const baseDelayMs = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectBaseDelayMs * (2 ** exponent),
    );
    const jitterWindowMs = Math.floor(baseDelayMs * this.reconnectJitterRatio);
    if (jitterWindowMs <= 0) return baseDelayMs;
    const jitterMs = Math.floor(Math.max(0, Math.min(1, Number(this.random()) || 0)) * jitterWindowMs);
    return Math.min(this.reconnectMaxDelayMs, baseDelayMs + jitterMs);
  }

  shouldAutoReconnect(disconnectInfo = null) {
    if (this.manualClose) return false;
    if (this.runtimeConfig?.reconnect === false) return false;
    return disconnectInfo?.recoverable !== false;
  }

  emitRelayMessage(message, { sessionTarget, fallbackTarget }) {
    this.events.push(message);
    this.emit('event', message);
    if (message.event === 'error') {
      this.emit('relay_error', message);
      this.emit('relay.error', message);
    } else {
      this.emit(message.event, message);
    }

    const inboundEnvelope = buildInboundEnvelope(message);
    if (!inboundEnvelope) return;
    const described = this.protocol.describeEvent(inboundEnvelope);
    const route = this.inbound.routeInboundEvent(inboundEnvelope, {
      sessionTarget: sessionTarget || this.runtimeConfig.routing.sessionTarget,
      fallbackTarget: fallbackTarget || this.runtimeConfig.routing.fallbackTarget,
    });
    const runtimeEvent = {
      eventType: inboundEnvelope.eventType,
      protocol: described,
      delivery: inboundEnvelope,
      route,
      raw: message,
    };
    this.emit('runtime_event', runtimeEvent);
  }

  emitBoundaryError(
    label,
    error,
    {
      code = 'relay_runtime_error',
      category = 'runtime',
      publicMessage = 'relay runtime error',
      recoverable = true,
      context = null,
      errorType = 'relay_runtime_error',
      fallbackMessage = null,
      includeStack = false,
    } = {},
  ) {
    const normalized = logRuntimeBoundary(this.logger, label, error, this.buildBoundaryContext(context), {
      includeStack,
      fallback: {
        code,
        category,
        publicMessage,
        recoverable,
      },
    });
    const payload = {
      event: 'error',
      data: buildPublicErrorPayload(normalized, {
        errorType,
        fallbackMessage: fallbackMessage || publicMessage,
        exposeMessage: true,
      }),
    };
    this.events.push(payload);
    this.emit('event', payload);
    this.emit('relay_error', payload);
    this.emit('relay.error', payload);
    return normalized;
  }

  buildDisconnectInfoFromError(error, source = 'reconnect') {
    if (error?.close) return error.close;
    return this.buildDisconnectInfo(null, error?.reason || error?.code || error?.message || 'reconnect_failed', source);
  }

  createClosedBeforeAuthError(disconnectInfo, cause = null) {
    const normalized = createRuntimeBoundaryError({
      code: 'relay_ws_closed_before_auth',
      category: 'transport',
      status: 502,
      message: `relay websocket closed before authentication (code=${disconnectInfo?.code ?? 'unknown'}, reason=${disconnectInfo?.reason || ''})`,
      publicMessage: 'relay websocket closed before authentication',
      recoverable: disconnectInfo?.recoverable !== false,
      context: this.buildBoundaryContext({
        stage: 'pre_auth_close',
        closeCode: disconnectInfo?.code ?? null,
        closeReason: disconnectInfo?.reason || null,
      }),
      cause,
    });
    normalized.reason = disconnectInfo?.reason || normalized.code;
    normalized.close = disconnectInfo;
    normalized.fatal = disconnectInfo?.recoverable === false;
    return normalized;
  }

  async requestJson(pathName, init = {}, fallback = {}) {
    if (!this.serverUrl) {
      throw createRuntimeBoundaryError({
        code: 'relay_client_not_connected',
        category: 'runtime',
        status: 409,
        message: 'client not connected',
        publicMessage: 'relay client is not connected',
        recoverable: true,
      });
    }

    const url = `${this.serverUrl}${pathName}`;
    let response;
    try {
      response = await this.httpFetch(url, init);
    } catch (error) {
      throw createRuntimeBoundaryError({
        code: fallback.code || 'relay_fetch_failed',
        category: 'transport',
        status: 502,
        message: `${fallback.message || 'relay request failed'}: ${error?.message || String(error)}`,
        publicMessage: fallback.publicMessage || 'relay request failed',
        recoverable: true,
        context: {
          url,
          method: init?.method || 'GET',
        },
        cause: error,
      });
    }

    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      throw createRuntimeBoundaryError({
        code: 'relay_response_invalid',
        category: 'transport',
        status: 502,
        message: `relay response was not valid JSON: ${error?.message || String(error)}`,
        publicMessage: 'relay response was not valid JSON',
        recoverable: true,
        context: {
          url,
          method: init?.method || 'GET',
          status: response.status,
        },
        cause: error,
      });
    }

    return { status: response.status, body };
  }

  async requestJsonWithDeliveryVisibilityRetry(pathName, init = {}, fallback = {}) {
    let attempt = 0;
    while (true) {
      const result = await this.requestJson(pathName, init, fallback);
      if (!isDeliveryVisibilityMiss(result) || attempt >= DELIVERY_VISIBILITY_RETRY_ATTEMPTS - 1) {
        return result;
      }
      attempt += 1;
      await waitForDeliveryVisibilityRetry();
    }
  }

  async openSocket({
    wsUrl,
    agentId,
    credential,
    clientVersion,
    sessionTarget,
    fallbackTarget,
  }) {
    this.connectionState = this.connectionState === 'reconnecting' ? 'reconnecting' : 'connecting';

    return await new Promise((resolve, reject) => {
      let settled = false;
      let suppressCloseHandler = false;
      let authTimer = null;
      const ws = this.wsFactory(wsUrl);
      this.ws = ws;

      const clearAuthTimer = () => {
        if (authTimer) clearTimeout(authTimer);
        authTimer = null;
      };

      const closeSocketAfterFailedAuth = (reason = 'auth_failed') => {
        try {
          if (this.ws === ws) this.ws = null;
          if (ws.readyState !== 3) ws.close(1008, reason);
        } catch {
          // No-op.
        }
      };

      const settleAuthResolve = (message) => {
        if (settled) return;
        settled = true;
        clearAuthTimer();
        resolve(message);
      };

      const settleAuthReject = (error, { suppressClose = false, closeReason = null } = {}) => {
        if (settled) return;
        settled = true;
        clearAuthTimer();
        if (suppressClose) suppressCloseHandler = true;
        this.connectionState = 'error';
        if (closeReason) closeSocketAfterFailedAuth(closeReason);
        reject(error);
      };

      authTimer = setTimeout(() => {
        const timeoutError = createRuntimeBoundaryError({
          code: 'relay_auth_timeout',
          category: 'transport',
          status: 504,
          message: `timed out waiting for relay authentication after ${this.authTimeoutMs}ms`,
          publicMessage: 'relay authentication timed out',
          recoverable: true,
          context: this.buildBoundaryContext({
            stage: 'auth',
            timeoutMs: this.authTimeoutMs,
          }),
        });
        timeoutError.reason = 'auth_timeout';
        timeoutError.close = this.buildDisconnectInfo(null, 'auth_timeout', 'auth');
        settleAuthReject(timeoutError, { suppressClose: true, closeReason: 'auth_timeout' });
      }, this.authTimeoutMs);

      ws.on('open', () => {
        this.logger.info?.('[claworld:relay-client] websocket open, sending auth', {
          accountId: this.runtimeConfig.accountId,
          agentId,
          clientVersion,
          bridgeProtocol: this.protocol.version,
        });
        try {
          this.send({
            type: 'auth',
            agentId,
            credential,
            clientVersion,
            bridgeProtocol: this.protocol.version,
          });
        } catch (error) {
          settleAuthReject(error, { suppressClose: true, closeReason: 'auth_send_failed' });
        }
      });

      ws.on('message', (buf) => {
        let message;
        try {
          message = JSON.parse(String(buf));
        } catch (error) {
          const normalized = this.emitBoundaryError('[claworld:relay-client] invalid relay message', error, {
            code: 'relay_ws_message_invalid',
            category: 'transport',
            publicMessage: 'relay websocket delivered invalid JSON',
            context: { stage: 'message_parse' },
          });
          if (!settled) {
            settleAuthReject(normalized, { suppressClose: true, closeReason: 'message_parse_failed' });
          }
          return;
        }

        try {
          this.emitRelayMessage(message, { sessionTarget, fallbackTarget });

          if (message.event === 'auth.ok' && !settled) {
            this.connectionState = 'authenticated';
            this.reconnectAttempts = 0;
            this.logger.info?.('[claworld:relay-client] auth ok', {
              accountId: this.runtimeConfig.accountId,
              agentId,
            });
            this.startHeartbeatLoop();
            settleAuthResolve(message);
          }

          if (message.event === 'error' && !settled && message.data?.code === 'unauthorized') {
            const authReason = message.data?.reason || message.data?.error || 'unauthorized';
            const authError = createRuntimeBoundaryError({
              code: message.data?.code || 'unauthorized',
              category: 'auth',
              status: 401,
              message: authReason,
              publicMessage: 'relay authentication failed',
              recoverable: true,
              context: this.buildBoundaryContext({
                stage: 'auth',
                reason: authReason,
              }),
            });
            authError.reason = authReason;
            authError.fatal = true;
            authError.close = this.buildDisconnectInfo(null, authReason, 'auth');
            this.logger.error?.('[claworld:relay-client] auth failed', {
              accountId: this.runtimeConfig.accountId,
              agentId,
              error: authError.message,
              code: authError.code,
            });
            settleAuthReject(authError, { suppressClose: true, closeReason: authReason });
          }
        } catch (error) {
          const normalized = this.emitBoundaryError('[claworld:relay-client] relay message handling failed', error, {
            code: 'relay_ws_message_handling_failed',
            category: 'runtime',
            publicMessage: 'relay websocket message handling failed',
            context: {
              stage: 'message_handle',
              relayEvent: message?.event || null,
            },
          });
          if (!settled) {
            settleAuthReject(normalized, { suppressClose: true, closeReason: 'message_handling_failed' });
          }
        }
      });

      ws.on('close', (code, reason) => {
        if (this.ws === ws) this.ws = null;
        this.stopHeartbeatLoop();
        const disconnectInfo = this.buildDisconnectInfo(code, reason);
        this.lastDisconnectInfo = disconnectInfo;
        this.logger.warn?.('[claworld:relay-client] websocket closed', {
          accountId: this.runtimeConfig?.accountId || null,
          agentId: this.boundAgentId,
          code: disconnectInfo.code,
          reason: disconnectInfo.reason || '',
          recoverable: disconnectInfo.recoverable,
        });
        this.emit('disconnect', disconnectInfo);
        if (suppressCloseHandler) return;

        if (!settled) {
          settled = true;
          clearAuthTimer();
          this.connectionState = disconnectInfo.reason === 'duplicate_connection_replaced' ? 'replaced' : 'error';
          reject(this.createClosedBeforeAuthError(disconnectInfo));
          return;
        }

        if (this.shouldAutoReconnect(disconnectInfo)) {
          this.connectionState = 'reconnecting';
          this.scheduleReconnect(disconnectInfo);
          return;
        }

        this.connectionState = disconnectInfo.reason === 'duplicate_connection_replaced' ? 'replaced' : 'closed';
        this.emit('close', disconnectInfo);
      });

      ws.on('error', (error) => {
        const normalized = logRuntimeBoundary(this.logger, '[claworld:relay-client] websocket error', error, this.buildBoundaryContext({
          stage: settled ? 'runtime_socket_error' : 'connect_socket_error',
        }), {
          includeStack: false,
          fallback: {
            code: settled ? 'relay_ws_runtime_error' : 'relay_ws_connect_failed',
            category: 'transport',
            publicMessage: settled ? 'relay websocket runtime error' : 'relay websocket connection failed',
            recoverable: true,
          },
        });
        if (!settled) {
          normalized.reason = normalized.reason || normalized.code || normalized.message;
          settleAuthReject(normalized, { suppressClose: true, closeReason: 'connect_error' });
        }
      });
    });
  }

  scheduleReconnect(disconnectInfo = null) {
    if (!this.shouldAutoReconnect(disconnectInfo)) {
      this.connectionState = 'closed';
      this.emit('close', disconnectInfo || this.buildDisconnectInfo(null, 'reconnect_disabled', 'reconnect'));
      return;
    }

    this.clearReconnectTimer();
    const attempt = this.reconnectAttempts + 1;
    const delayMs = this.resolveReconnectDelayMs(attempt);
    this.reconnectAttempts = attempt;
    this.logger.warn?.('[claworld:relay-client] scheduling reconnect', {
      accountId: this.runtimeConfig?.accountId || null,
      agentId: this.boundAgentId,
      attempt,
      delayMs,
      reason: disconnectInfo?.reason || null,
    });
    this.emit('reconnecting', { attempt, delayMs, disconnectInfo });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.manualClose || !this.connectionParams) return;

      try {
        await this.openSocket(this.connectionParams);
        this.emit('reconnected', { attempt, disconnectInfo });
      } catch (error) {
        const nextDisconnect = this.buildDisconnectInfoFromError(error);
        this.lastDisconnectInfo = nextDisconnect;
        if (error?.fatal || !this.shouldAutoReconnect(nextDisconnect)) {
          this.connectionState = nextDisconnect.reason === 'duplicate_connection_replaced' ? 'replaced' : 'error';
          this.emit('close', nextDisconnect);
          return;
        }
        this.connectionState = 'reconnecting';
        this.scheduleReconnect(nextDisconnect);
      }
    }, delayMs);

    if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
  }

  async connect({
    config,
    agentId,
    credential = null,
    clientVersion = buildClaworldRelayClientVersion(),
    sessionTarget,
    fallbackTarget,
  } = {}) {
    if (!agentId) {
      throw createRuntimeBoundaryError({
        code: 'relay_agent_id_required',
        category: 'input',
        status: 400,
        message: 'agentId is required',
        publicMessage: 'agentId is required',
        recoverable: true,
      });
    }

    this.runtimeConfig = resolveClaworldRuntimeConfig(config);
    this.boundAgentId = agentId;
    this.serverUrl = this.runtimeConfig.serverUrl;
    this.manualClose = false;
    this.clearReconnectTimer();

    const wsUrl = normalizeRelayWebSocketUrl(this.runtimeConfig.serverUrl);
    this.connectionParams = {
      wsUrl,
      agentId,
      credential,
      clientVersion,
      sessionTarget,
      fallbackTarget,
    };
    this.connectionState = 'connecting';

    this.logger.info?.('[claworld:relay-client] connecting websocket', {
      accountId: this.runtimeConfig.accountId,
      agentId,
      wsUrl,
      reconnect: this.runtimeConfig.reconnect !== false,
    });

    return await this.openSocket(this.connectionParams);
  }

  startHeartbeatLoop() {
    this.stopHeartbeatLoop();
    const intervalMs = this.runtimeConfig.heartbeatSeconds * 1000;
    this.heartbeatTimer = setInterval(() => {
      try {
        this.sendHeartbeat();
      } catch (error) {
        logRuntimeBoundary(this.logger, '[claworld:relay-client] heartbeat failed', error, this.buildBoundaryContext({
          stage: 'heartbeat',
        }), {
          includeStack: false,
          fallback: {
            code: 'relay_heartbeat_failed',
            category: 'transport',
            publicMessage: 'relay heartbeat failed',
            recoverable: true,
          },
        });
      }
    }, intervalMs);
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
  }

  stopHeartbeatLoop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  buildWsNotConnectedError(stage = 'send') {
    return createRuntimeBoundaryError({
      code: 'relay_ws_not_connected',
      category: 'transport',
      status: 409,
      message: 'relay websocket is not connected',
      publicMessage: 'relay websocket is not connected',
      recoverable: true,
      context: this.buildBoundaryContext({
        stage,
      }),
    });
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== 1) {
      throw this.buildWsNotConnectedError('send');
    }
    this.ws.send(JSON.stringify(payload));
  }

  sendHeartbeat() {
    this.send({ type: 'heartbeat' });
  }

  sendAccepted({ deliveryId, sessionKey, source = 'runtime_dispatch' } = {}) {
    const normalizedDeliveryId = normalizeOptionalText(deliveryId);
    if (!normalizedDeliveryId) {
      throw createRuntimeBoundaryError({
        code: 'relay_delivery_id_required',
        category: 'input',
        status: 400,
        message: 'deliveryId is required to acknowledge relay delivery acceptance',
        publicMessage: 'deliveryId is required',
        recoverable: true,
      });
    }
    const envelope = {
      deliveryId: normalizedDeliveryId,
      sessionKey: normalizeOptionalText(sessionKey) || null,
      source: normalizeOptionalText(source) || 'runtime_dispatch',
    };
    this.send({
      type: 'accepted',
      deliveryId: envelope.deliveryId,
      sessionKey: envelope.sessionKey,
      payload: {
        source: envelope.source,
      },
    });
    return envelope;
  }

  sendReply({ deliveryId, sessionKey, replyText, source = 'subagent' } = {}) {
    const envelope = this.outbound.createReplyEnvelope({
      deliveryId,
      sessionKey,
      replyText,
      source,
    });
    this.send({
      type: 'reply',
      deliveryId: envelope.deliveryId,
      sessionKey: envelope.sessionKey,
      payload: {
        ...envelope.payload,
      },
    });
    return envelope;
  }

  replyToDelivery({ deliveryId, sessionKey, replyText, source = 'subagent' } = {}) {
    return this.sendReply({
      deliveryId,
      sessionKey,
      replyText,
      source,
    });
  }

  sendKeepSilent({ deliveryId, sessionKey, reason = null, source = 'openclaw-autochain' } = {}) {
    const normalizedDeliveryId = normalizeOptionalText(deliveryId);
    if (!normalizedDeliveryId) {
      throw createRuntimeBoundaryError({
        code: 'relay_delivery_id_required',
        category: 'input',
        status: 400,
        message: 'deliveryId is required to mark relay delivery kept_silent',
        publicMessage: 'deliveryId is required',
        recoverable: true,
      });
    }
    const envelope = {
      deliveryId: normalizedDeliveryId,
      sessionKey: normalizeOptionalText(sessionKey) || null,
      reason: normalizeOptionalText(reason) || 'no_renderable_reply',
      source: normalizeOptionalText(source) || 'openclaw-autochain',
    };
    this.send({
      type: 'kept_silent',
      deliveryId: envelope.deliveryId,
      sessionKey: envelope.sessionKey,
      payload: {
        reason: envelope.reason,
        source: envelope.source,
      },
    });
    return envelope;
  }

  waitForReplyAck({ deliveryId, timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS, signal = null } = {}) {
    const normalizedDeliveryId = normalizeOptionalText(deliveryId);
    if (!normalizedDeliveryId) {
      return Promise.reject(createRuntimeBoundaryError({
        code: 'relay_delivery_id_required',
        category: 'input',
        status: 400,
        message: 'deliveryId is required to wait for relay reply acknowledgement',
        publicMessage: 'deliveryId is required',
        recoverable: true,
      }));
    }
    if (signal?.aborted) {
      return Promise.reject(createRuntimeBoundaryError({
        code: 'relay_reply_ack_wait_cancelled',
        category: 'transport',
        status: 499,
        message: `relay reply acknowledgement wait cancelled for ${normalizedDeliveryId}`,
        publicMessage: 'relay reply acknowledgement wait cancelled',
        recoverable: true,
        context: this.buildBoundaryContext({
          stage: 'reply_ack_wait',
          deliveryId: normalizedDeliveryId,
        }),
      }));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        this.off('reply.accepted', onReplyAccepted);
        this.off('command.accepted', onCommandAccepted);
        this.off('disconnect', onDisconnect);
        this.off('close', onDisconnect);
        signal?.removeEventListener('abort', onAbort);
      };

      const settleResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onReplyAccepted = (message = {}) => {
        const repliedDeliveryId = normalizeOptionalText(message?.data?.repliedDeliveryId);
        if (repliedDeliveryId !== normalizedDeliveryId) return;
        settleResolve(message);
      };

      const onCommandAccepted = (message = {}) => {
        const command = message?.data?.command && typeof message.data.command === 'object'
          ? message.data.command
          : {};
        if (normalizeOptionalText(command.name) !== 'delivery.reply.requested') return;
        const commandDeliveryId = [
          command.deliveryId,
          command.aggregateId,
          command.partitionKey,
        ].map((value) => normalizeOptionalText(value)).find(Boolean) || null;
        if (commandDeliveryId !== normalizedDeliveryId) return;
        settleResolve(message);
      };

      const onDisconnect = (info = {}) => {
        settleReject(createRuntimeBoundaryError({
          code: 'relay_reply_ack_disconnected',
          category: 'transport',
          status: 502,
          message: `relay websocket closed before reply acknowledgement for ${normalizedDeliveryId}`,
          publicMessage: 'relay websocket closed before reply acknowledgement',
          recoverable: true,
          context: this.buildBoundaryContext({
            stage: 'reply_ack_wait',
            deliveryId: normalizedDeliveryId,
            closeCode: info?.code ?? null,
            closeReason: info?.reason || null,
          }),
        }));
      };

      const onAbort = () => {
        settleReject(createRuntimeBoundaryError({
          code: 'relay_reply_ack_wait_cancelled',
          category: 'transport',
          status: 499,
          message: `relay reply acknowledgement wait cancelled for ${normalizedDeliveryId}`,
          publicMessage: 'relay reply acknowledgement wait cancelled',
          recoverable: true,
          context: this.buildBoundaryContext({
            stage: 'reply_ack_wait',
            deliveryId: normalizedDeliveryId,
          }),
        }));
      };

      this.on('reply.accepted', onReplyAccepted);
      this.on('command.accepted', onCommandAccepted);
      this.on('disconnect', onDisconnect);
      this.on('close', onDisconnect);
      signal?.addEventListener('abort', onAbort, { once: true });

      timeout = setTimeout(() => {
        settleReject(buildReplyAckTimeoutError({
          deliveryId: normalizedDeliveryId,
          timeoutMs,
          context: this.buildBoundaryContext({
            stage: 'reply_ack_wait',
            deliveryId: normalizedDeliveryId,
          }),
        }));
      }, timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
    });
  }

  waitForAcceptedAck({ deliveryId, timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS, signal = null } = {}) {
    const normalizedDeliveryId = normalizeOptionalText(deliveryId);
    if (!normalizedDeliveryId) {
      return Promise.reject(createRuntimeBoundaryError({
        code: 'relay_delivery_id_required',
        category: 'input',
        status: 400,
        message: 'deliveryId is required to wait for relay delivery acceptance acknowledgement',
        publicMessage: 'deliveryId is required',
        recoverable: true,
      }));
    }
    if (signal?.aborted) {
      return Promise.reject(createRuntimeBoundaryError({
        code: 'relay_delivery_accept_ack_wait_cancelled',
        category: 'transport',
        status: 499,
        message: `relay delivery acceptance acknowledgement wait cancelled for ${normalizedDeliveryId}`,
        publicMessage: 'relay delivery acceptance acknowledgement wait cancelled',
        recoverable: true,
        context: this.buildBoundaryContext({
          stage: 'delivery_accept_ack_wait',
          deliveryId: normalizedDeliveryId,
        }),
      }));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        this.off('delivery.accepted', onAccepted);
        this.off('disconnect', onDisconnect);
        this.off('close', onDisconnect);
        signal?.removeEventListener('abort', onAbort);
      };

      const settleResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onAccepted = (message = {}) => {
        const acceptedDeliveryId = normalizeOptionalText(message?.data?.acceptedDeliveryId);
        if (acceptedDeliveryId !== normalizedDeliveryId) return;
        settleResolve(message);
      };

      const onDisconnect = (info = {}) => {
        settleReject(createRuntimeBoundaryError({
          code: 'relay_delivery_accept_ack_disconnected',
          category: 'transport',
          status: 502,
          message: `relay websocket closed before delivery acceptance acknowledgement for ${normalizedDeliveryId}`,
          publicMessage: 'relay websocket closed before delivery acceptance acknowledgement',
          recoverable: true,
          context: this.buildBoundaryContext({
            stage: 'delivery_accept_ack_wait',
            deliveryId: normalizedDeliveryId,
            closeCode: info?.code ?? null,
            closeReason: info?.reason || null,
          }),
        }));
      };

      const onAbort = () => {
        settleReject(createRuntimeBoundaryError({
          code: 'relay_delivery_accept_ack_wait_cancelled',
          category: 'transport',
          status: 499,
          message: `relay delivery acceptance acknowledgement wait cancelled for ${normalizedDeliveryId}`,
          publicMessage: 'relay delivery acceptance acknowledgement wait cancelled',
          recoverable: true,
          context: this.buildBoundaryContext({
            stage: 'delivery_accept_ack_wait',
            deliveryId: normalizedDeliveryId,
          }),
        }));
      };

      this.on('delivery.accepted', onAccepted);
      this.on('disconnect', onDisconnect);
      this.on('close', onDisconnect);
      signal?.addEventListener('abort', onAbort, { once: true });

      timeout = setTimeout(() => {
        settleReject(buildAcceptedAckTimeoutError({
          deliveryId: normalizedDeliveryId,
          timeoutMs,
          context: this.buildBoundaryContext({
            stage: 'delivery_accept_ack_wait',
            deliveryId: normalizedDeliveryId,
          }),
        }));
      }, timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
    });
  }

  waitForKeepSilentAck({ deliveryId, timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS, signal = null } = {}) {
    const normalizedDeliveryId = normalizeOptionalText(deliveryId);
    if (!normalizedDeliveryId) {
      return Promise.reject(createRuntimeBoundaryError({
        code: 'relay_delivery_id_required',
        category: 'input',
        status: 400,
        message: 'deliveryId is required to wait for relay kept_silent acknowledgement',
        publicMessage: 'deliveryId is required',
        recoverable: true,
      }));
    }
    if (signal?.aborted) {
      return Promise.reject(createRuntimeBoundaryError({
        code: 'relay_kept_silent_ack_wait_cancelled',
        category: 'transport',
        status: 499,
        message: `relay kept_silent acknowledgement wait cancelled for ${normalizedDeliveryId}`,
        publicMessage: 'relay kept_silent acknowledgement wait cancelled',
        recoverable: true,
        context: this.buildBoundaryContext({
          stage: 'kept_silent_ack_wait',
          deliveryId: normalizedDeliveryId,
        }),
      }));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout = null;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        this.off('kept_silent.accepted', onKeptSilentAccepted);
        this.off('disconnect', onDisconnect);
        this.off('close', onDisconnect);
        signal?.removeEventListener('abort', onAbort);
      };

      const settleResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onKeptSilentAccepted = (message = {}) => {
        const keptSilentDeliveryId = normalizeOptionalText(message?.data?.keptSilentDeliveryId);
        if (keptSilentDeliveryId !== normalizedDeliveryId) return;
        settleResolve(message);
      };

      const onDisconnect = (info = {}) => {
        settleReject(createRuntimeBoundaryError({
          code: 'relay_kept_silent_ack_disconnected',
          category: 'transport',
          status: 502,
          message: `relay websocket closed before kept_silent acknowledgement for ${normalizedDeliveryId}`,
          publicMessage: 'relay websocket closed before kept_silent acknowledgement',
          recoverable: true,
          context: this.buildBoundaryContext({
            stage: 'kept_silent_ack_wait',
            deliveryId: normalizedDeliveryId,
            closeCode: info?.code ?? null,
            closeReason: info?.reason || null,
          }),
        }));
      };

      const onAbort = () => {
        settleReject(createRuntimeBoundaryError({
          code: 'relay_kept_silent_ack_wait_cancelled',
          category: 'transport',
          status: 499,
          message: `relay kept_silent acknowledgement wait cancelled for ${normalizedDeliveryId}`,
          publicMessage: 'relay kept_silent acknowledgement wait cancelled',
          recoverable: true,
          context: this.buildBoundaryContext({
            stage: 'kept_silent_ack_wait',
            deliveryId: normalizedDeliveryId,
          }),
        }));
      };

      this.on('kept_silent.accepted', onKeptSilentAccepted);
      this.on('disconnect', onDisconnect);
      this.on('close', onDisconnect);
      signal?.addEventListener('abort', onAbort, { once: true });

      timeout = setTimeout(() => {
        settleReject(buildKeepSilentAckTimeoutError({
          deliveryId: normalizedDeliveryId,
          timeoutMs,
          context: this.buildBoundaryContext({
            stage: 'kept_silent_ack_wait',
            deliveryId: normalizedDeliveryId,
          }),
        }));
      }, timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
    });
  }

  async replyToDeliveryHttp({ deliveryId, replyText, source = 'subagent' } = {}) {
    const envelope = this.outbound.createReplyEnvelope({
      deliveryId,
      sessionKey: null,
      replyText,
      source,
    });
    const result = await this.requestJsonWithDeliveryVisibilityRetry(`/v1/runtime-deliveries/${encodeURIComponent(envelope.deliveryId)}/reply`, {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        fromAgentId: this.boundAgentId,
        payload: {
          ...envelope.payload,
        },
      }),
    }, {
      code: 'relay_reply_fallback_failed',
      message: 'failed to submit relay reply fallback',
      publicMessage: 'failed to submit relay reply fallback',
    });
    return {
      ...result,
      envelope,
    };
  }

  async submitReplyHttpFallback({
    deliveryId,
    sessionKey,
    replyText,
    source = 'subagent',
    error = null,
  } = {}) {
    this.logger.warn?.('[claworld:relay-client] reply websocket transport failed; attempting HTTP fallback', {
      accountId: this.runtimeConfig?.accountId || null,
      agentId: this.boundAgentId,
      deliveryId: normalizeOptionalText(deliveryId),
      sessionKey: normalizeOptionalText(sessionKey) || null,
      error: error?.message || String(error),
    });

    const fallbackResult = await this.replyToDeliveryHttp({
      deliveryId,
      replyText,
      source,
    });

    if (fallbackResult.status >= 200 && fallbackResult.status < 300) {
      return {
        ok: true,
        envelope: fallbackResult.envelope,
        ack: {
          event: 'reply.accepted',
          data: fallbackResult.body,
        },
        transport: 'http',
        fallbackUsed: true,
      };
    }

    if (isReplyAlreadyApplied(fallbackResult, fallbackResult.envelope.deliveryId)) {
      return {
        ok: true,
        envelope: fallbackResult.envelope,
        ack: {
          event: 'reply.accepted',
          data: {
            ...(fallbackResult.body && typeof fallbackResult.body === 'object' ? fallbackResult.body : {}),
            repliedDeliveryId: fallbackResult.envelope.deliveryId,
          },
        },
        transport: 'http-already-applied',
        fallbackUsed: true,
      };
    }

    throw buildReplyFallbackError({
      deliveryId: fallbackResult.envelope.deliveryId,
      status: fallbackResult.status,
      body: fallbackResult.body,
      context: this.buildBoundaryContext({
        stage: 'reply_fallback',
        deliveryId: fallbackResult.envelope.deliveryId,
        sessionKey: normalizeOptionalText(sessionKey) || null,
        fallbackFrom: error?.code || error?.message || null,
      }),
    });
  }

  async acceptDeliveryHttp({ deliveryId, sessionKey = null, source = 'runtime_dispatch' } = {}) {
    const normalizedDeliveryId = normalizeOptionalText(deliveryId);
    const result = await this.requestJsonWithDeliveryVisibilityRetry(`/v1/runtime-deliveries/${encodeURIComponent(normalizedDeliveryId)}/accepted`, {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        fromAgentId: this.boundAgentId,
        sessionKey: normalizeOptionalText(sessionKey) || null,
        source: normalizeOptionalText(source) || 'runtime_dispatch',
      }),
    }, {
      code: 'relay_delivery_accept_fallback_failed',
      message: 'failed to submit relay delivery acceptance fallback',
      publicMessage: 'failed to submit relay delivery acceptance fallback',
    });
    return {
      ...result,
      envelope: {
        deliveryId: normalizedDeliveryId,
        sessionKey: normalizeOptionalText(sessionKey) || null,
        source: normalizeOptionalText(source) || 'runtime_dispatch',
      },
    };
  }

  async submitAcceptedHttpFallback({
    deliveryId,
    sessionKey,
    source = 'runtime_dispatch',
    error = null,
  } = {}) {
    this.logger.warn?.('[claworld:relay-client] delivery acceptance websocket transport failed; attempting HTTP fallback', {
      accountId: this.runtimeConfig?.accountId || null,
      agentId: this.boundAgentId,
      deliveryId: normalizeOptionalText(deliveryId),
      sessionKey: normalizeOptionalText(sessionKey) || null,
      error: error?.message || String(error),
    });

    const fallbackResult = await this.acceptDeliveryHttp({
      deliveryId,
      sessionKey,
      source,
    });

    if (fallbackResult.status >= 200 && fallbackResult.status < 300) {
      return {
        ok: true,
        envelope: fallbackResult.envelope,
        ack: {
          event: 'delivery.accepted',
          data: fallbackResult.body,
        },
        transport: 'http',
        fallbackUsed: true,
      };
    }

    throw buildReplyFallbackError({
      deliveryId: fallbackResult.envelope.deliveryId,
      status: fallbackResult.status,
      body: fallbackResult.body,
      context: this.buildBoundaryContext({
        stage: 'delivery_accept_fallback',
        deliveryId: fallbackResult.envelope.deliveryId,
        sessionKey: normalizeOptionalText(sessionKey) || null,
        fallbackFrom: error?.code || error?.message || null,
      }),
    });
  }

  async sendReplyAndWaitForAck({
    deliveryId,
    sessionKey,
    replyText,
    source = 'subagent',
    timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS,
    httpFallback = true,
  } = {}) {
    if (httpFallback && (!this.ws || this.ws.readyState !== 1)) {
      return await this.submitReplyHttpFallback({
        deliveryId,
        sessionKey,
        replyText,
        source,
        error: this.buildWsNotConnectedError('reply_send'),
      });
    }

    const ackAbortController = new AbortController();
    const ackPromise = this.waitForReplyAck({
      deliveryId,
      timeoutMs,
      signal: ackAbortController.signal,
    });
    let envelope;

    try {
      envelope = this.sendReply({
        deliveryId,
        sessionKey,
        replyText,
        source,
      });
    } catch (error) {
      ackAbortController.abort();
      void ackPromise.catch(() => {});
      if (!httpFallback) throw error;
      return await this.submitReplyHttpFallback({
        deliveryId,
        sessionKey,
        replyText,
        source,
        error,
      });
    }

    try {
      const ack = await ackPromise;
      return {
        ok: true,
        envelope,
        ack,
        transport: 'websocket',
        fallbackUsed: false,
      };
    } catch (error) {
      if (!httpFallback) throw error;

      return await this.submitReplyHttpFallback({
        deliveryId: envelope.deliveryId,
        sessionKey: envelope.sessionKey,
        replyText,
        source,
        error,
      });
    }
  }

  async submitDeliveryReply({
    deliveryId,
    sessionKey,
    replyText,
    source = 'subagent',
    timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS,
    httpFallback = true,
  } = {}) {
    return await this.sendReplyAndWaitForAck({
      deliveryId,
      sessionKey,
      replyText,
      source,
      timeoutMs,
      httpFallback,
    });
  }

  async sendAcceptedAndWaitForAck({
    deliveryId,
    sessionKey,
    source = 'runtime_dispatch',
    timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS,
    httpFallback = true,
  } = {}) {
    if (httpFallback && (!this.ws || this.ws.readyState !== 1)) {
      return await this.submitAcceptedHttpFallback({
        deliveryId,
        sessionKey,
        source,
        error: this.buildWsNotConnectedError('delivery_accept_send'),
      });
    }

    const ackAbortController = new AbortController();
    const ackPromise = this.waitForAcceptedAck({
      deliveryId,
      timeoutMs,
      signal: ackAbortController.signal,
    });
    let envelope;

    try {
      envelope = this.sendAccepted({
        deliveryId,
        sessionKey,
        source,
      });
    } catch (error) {
      ackAbortController.abort();
      void ackPromise.catch(() => {});
      if (!httpFallback) throw error;
      return await this.submitAcceptedHttpFallback({
        deliveryId,
        sessionKey,
        source,
        error,
      });
    }

    try {
      const ack = await ackPromise;
      return {
        ok: true,
        envelope,
        ack,
        transport: 'websocket',
        fallbackUsed: false,
      };
    } catch (error) {
      if (!httpFallback) throw error;

      return await this.submitAcceptedHttpFallback({
        deliveryId: envelope.deliveryId,
        sessionKey: envelope.sessionKey,
        source: envelope.source,
        error,
      });
    }
  }

  async keepDeliverySilentHttp({ deliveryId, reason = null, source = 'openclaw-autochain' } = {}) {
    const normalizedDeliveryId = normalizeOptionalText(deliveryId);
    const result = await this.requestJsonWithDeliveryVisibilityRetry(`/v1/runtime-deliveries/${encodeURIComponent(normalizedDeliveryId)}/kept-silent`, {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        fromAgentId: this.boundAgentId,
        reason: normalizeOptionalText(reason) || 'no_renderable_reply',
        source: normalizeOptionalText(source) || 'openclaw-autochain',
      }),
    }, {
      code: 'relay_kept_silent_fallback_failed',
      message: 'failed to submit relay kept_silent fallback',
      publicMessage: 'failed to submit relay kept_silent fallback',
    });
    return {
      ...result,
      envelope: {
        deliveryId: normalizedDeliveryId,
        reason: normalizeOptionalText(reason) || 'no_renderable_reply',
        source: normalizeOptionalText(source) || 'openclaw-autochain',
      },
    };
  }

  async submitKeepSilentHttpFallback({
    deliveryId,
    sessionKey,
    reason = null,
    source = 'openclaw-autochain',
    error = null,
  } = {}) {
    this.logger.warn?.('[claworld:relay-client] kept_silent websocket transport failed; attempting HTTP fallback', {
      accountId: this.runtimeConfig?.accountId || null,
      agentId: this.boundAgentId,
      deliveryId: normalizeOptionalText(deliveryId),
      sessionKey: normalizeOptionalText(sessionKey) || null,
      error: error?.message || String(error),
    });

    const fallbackResult = await this.keepDeliverySilentHttp({
      deliveryId,
      reason,
      source,
    });

    if (fallbackResult.status >= 200 && fallbackResult.status < 300) {
      return {
        ok: true,
        envelope: fallbackResult.envelope,
        ack: {
          event: 'kept_silent.accepted',
          data: fallbackResult.body,
        },
        transport: 'http',
        fallbackUsed: true,
      };
    }

    if (isDeliveryKeptSilentAlreadyApplied(fallbackResult, fallbackResult.envelope.deliveryId)) {
      return {
        ok: true,
        envelope: fallbackResult.envelope,
        ack: {
          event: 'kept_silent.accepted',
          data: {
            ...(fallbackResult.body && typeof fallbackResult.body === 'object' ? fallbackResult.body : {}),
            keptSilentDeliveryId: fallbackResult.envelope.deliveryId,
          },
        },
        transport: 'http-already-applied',
        fallbackUsed: true,
      };
    }

    throw buildKeepSilentFallbackError({
      deliveryId: fallbackResult.envelope.deliveryId,
      status: fallbackResult.status,
      body: fallbackResult.body,
      context: this.buildBoundaryContext({
        stage: 'kept_silent_fallback',
        deliveryId: fallbackResult.envelope.deliveryId,
        sessionKey: normalizeOptionalText(sessionKey) || null,
        fallbackFrom: error?.code || error?.message || null,
      }),
    });
  }

  async sendKeepSilentAndWaitForAck({
    deliveryId,
    sessionKey,
    reason = null,
    source = 'openclaw-autochain',
    timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS,
    httpFallback = true,
  } = {}) {
    if (httpFallback && (!this.ws || this.ws.readyState !== 1)) {
      return await this.submitKeepSilentHttpFallback({
        deliveryId,
        sessionKey,
        reason,
        source,
        error: this.buildWsNotConnectedError('kept_silent_send'),
      });
    }

    const ackAbortController = new AbortController();
    const ackPromise = this.waitForKeepSilentAck({
      deliveryId,
      timeoutMs,
      signal: ackAbortController.signal,
    });
    let envelope;

    try {
      envelope = this.sendKeepSilent({
        deliveryId,
        sessionKey,
        reason,
        source,
      });
    } catch (error) {
      ackAbortController.abort();
      void ackPromise.catch(() => {});
      if (!httpFallback) throw error;
      return await this.submitKeepSilentHttpFallback({
        deliveryId,
        sessionKey,
        reason,
        source,
        error,
      });
    }

    try {
      const ack = await ackPromise;
      return {
        ok: true,
        envelope,
        ack,
        transport: 'websocket',
        fallbackUsed: false,
      };
    } catch (error) {
      if (!httpFallback) throw error;

      return await this.submitKeepSilentHttpFallback({
        deliveryId: envelope.deliveryId,
        sessionKey: envelope.sessionKey,
        reason: envelope.reason,
        source: envelope.source,
        error,
      });
    }
  }

  async submitDeliveryKeptSilent({
    deliveryId,
    sessionKey,
    reason = null,
    source = 'openclaw-autochain',
    timeoutMs = DEFAULT_REPLY_ACK_TIMEOUT_MS,
    httpFallback = true,
  } = {}) {
    return await this.sendKeepSilentAndWaitForAck({
      deliveryId,
      sessionKey,
      reason,
      source,
      timeoutMs,
      httpFallback,
    });
  }

  async createChatRequest({
    fromAgentId,
    displayName,
    agentCode,
    kickoffBrief = null,
    openingMessage = null,
    openingPayload = null,
    requestContext = {},
  } = {}) {
    const normalized = normalizeChatRequestInput({ requestContext, source: 'direct_lookup' });
    const normalizedDisplayName = normalizeOptionalText(displayName);
    const normalizedAgentCode = normalizeOptionalText(agentCode)?.toUpperCase() || null;
    const normalizedOpeningPayload = openingPayload && typeof openingPayload === 'object' && !Array.isArray(openingPayload)
      ? openingPayload
      : null;
    return await this.requestJson('/v1/chat-requests', {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        fromAgentId,
        ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
        ...(normalizedAgentCode ? { agentCode: normalizedAgentCode } : {}),
        kickoffBrief: kickoffBrief || normalized.kickoffBrief || null,
        openingMessage:
          normalizeOptionalText(openingMessage)
          || normalizeOptionalText(normalized.openingMessage)
          || normalizeOptionalText(normalizedOpeningPayload?.text)
          || null,
        ...(normalizedOpeningPayload ? { openingPayload: normalizedOpeningPayload } : {}),
        worldId: normalized.conversation?.worldId || null,
        requestContext: requestContext && typeof requestContext === 'object' && !Array.isArray(requestContext)
          ? requestContext
          : undefined,
      }),
    }, {
      code: 'relay_request_create_failed',
      message: 'failed to create relay chat request',
      publicMessage: 'failed to create relay chat request',
    });
  }

  async acceptChatRequest(requestId, { actorAgentId, ...options } = {}) {
    const result = await this.requestJson(`/v1/chat-requests/${requestId}/accept`, {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({ actorAgentId, ...options }),
    }, {
      code: 'relay_request_accept_failed',
      message: 'failed to accept relay chat request',
      publicMessage: 'failed to accept relay chat request',
    });
    if (result.status < 400 && requestId) {
      const kickoff = result.body?.kickoff && typeof result.body.kickoff === 'object' && !Array.isArray(result.body.kickoff)
        ? { ...result.body.kickoff }
        : null;
      this.acceptedChatRequests.set(requestId, {
        requestId,
        sessionKey: kickoff?.sessionKey || null,
        conversationKey: kickoff?.conversationKey || null,
        kickoff,
      });
    }
    return result;
  }

  async rejectChatRequest(requestId, { actorAgentId, ...options } = {}) {
    return await this.requestJson(`/v1/chat-requests/${requestId}/reject`, {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({ actorAgentId, ...options }),
    }, {
      code: 'relay_request_reject_failed',
      message: 'failed to reject relay chat request',
      publicMessage: 'failed to reject relay chat request',
    });
  }

  async closeConversation({ actorAgentId, conversationKey = null, localSessionKey = null } = {}) {
    return await this.requestJson('/v1/chat-requests/conversations/close', {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        actorAgentId,
        ...(conversationKey ? { conversationKey } : {}),
        ...(localSessionKey ? { localSessionKey } : {}),
      }),
    }, {
      code: 'relay_conversation_close_failed',
      message: 'failed to close relay conversation',
      publicMessage: 'failed to close relay conversation',
    });
  }

  async deliverMessage({ fromAgentId, targetAgentId, clientMessageId = null, payload = {}, conversation = {} } = {}) {
    const resolvedClientMessageId = requireClientMessageId(clientMessageId);
    const result = await this.requestJson('/v1/orchestration/messages', {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(this.runtimeConfig, { 'content-type': 'application/json' }),
      body: JSON.stringify({ fromAgentId, targetAgentId, clientMessageId: resolvedClientMessageId, payload, conversation }),
    }, {
      code: 'relay_message_delivery_failed',
      message: 'failed to deliver relay message',
      publicMessage: 'failed to deliver relay message',
    });
    return {
      ...result,
      clientMessageId: resolvedClientMessageId,
    };
  }

  waitFor(eventNameOrPredicate, timeoutMs = 8000) {
    const isPredicate = typeof eventNameOrPredicate === 'function';
    const predicate = isPredicate
      ? eventNameOrPredicate
      : (event) => event.event === eventNameOrPredicate;

    return new Promise((resolve, reject) => {
      const existing = this.events.find(predicate);
      if (existing) return resolve(existing);

      const started = Date.now();
      const timer = setInterval(() => {
        const found = this.events.find(predicate);
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          const eventName = isPredicate ? 'predicate event' : eventNameOrPredicate;
          reject(new Error(`timed out waiting for ${eventName}`));
        }
      }, 100);
    });
  }

  async establishConversation({ fromAgentId, displayName = null, agentCode = null, requestContext = {}, openingPayload = {} } = {}) {
    const normalizedRequestContext = requestContext && typeof requestContext === 'object' && !Array.isArray(requestContext)
      ? { ...requestContext }
      : {};
    const normalizedOpeningPayload = openingPayload && typeof openingPayload === 'object' && !Array.isArray(openingPayload)
      ? { ...openingPayload }
      : {};
    if (Object.keys(normalizedOpeningPayload).length > 0) {
      normalizedRequestContext.openingPayload = normalizedOpeningPayload;
      if (!normalizedRequestContext.message && typeof normalizedOpeningPayload.text === 'string' && normalizedOpeningPayload.text.trim()) {
        normalizedRequestContext.message = normalizedOpeningPayload.text.trim();
      }
    }

    const requestResult = await this.createChatRequest({
      fromAgentId,
      displayName,
      agentCode,
      openingPayload: normalizedOpeningPayload,
      requestContext: normalizedRequestContext,
    });
    if (requestResult.status !== 201) {
      throw new Error(`failed to create chat request: ${JSON.stringify(requestResult.body)}`);
    }
    const requestId = requestResult.body?.chatRequest?.chatRequestId || requestResult.body?.requestId || null;
    return {
      requestId,
      sessionKey: null,
      conversationKey: null,
      openAcceptedConversation: async ({ timeoutMs = 15000 } = {}) => {
        const acceptedRequest = this.acceptedChatRequests.get(requestId) || null;
        if (acceptedRequest?.kickoff || acceptedRequest?.conversationKey || acceptedRequest?.sessionKey) {
          return {
            requestId,
            sessionKey: acceptedRequest?.sessionKey || acceptedRequest?.kickoff?.sessionKey || null,
            conversationKey: acceptedRequest?.conversationKey || acceptedRequest?.kickoff?.conversationKey || null,
            kickoff: acceptedRequest?.kickoff || null,
            delivery: null,
          };
        }
        const deliveryEvent = await this.waitFor(
          (event) => event.event === 'delivery'
            && (
              event.data?.metadata?.kickoffRequestId === requestId
            ),
          timeoutMs,
        );
        const delivery = deliveryEvent?.data && typeof deliveryEvent.data === 'object' && !Array.isArray(deliveryEvent.data)
          ? deliveryEvent.data
          : {};
        const metadata = delivery.metadata && typeof delivery.metadata === 'object' && !Array.isArray(delivery.metadata)
          ? delivery.metadata
          : {};
        const kickoff = {
          status: 'delivered',
          deliveryId: delivery.deliveryId || null,
          sessionKey: delivery.sessionKey || metadata.sessionKey || null,
          conversationKey: delivery.conversationKey || null,
        };
        return {
          requestId,
          sessionKey: kickoff.sessionKey,
          conversationKey: kickoff.conversationKey,
          kickoff,
          delivery: deliveryEvent,
        };
      },
    };
  }

  snapshot() {
    return {
      connectionState: this.connectionState,
      boundAgentId: this.boundAgentId,
      eventCount: this.events.length,
      heartbeatSeconds: this.runtimeConfig?.heartbeatSeconds || null,
      hasActiveSocket: Boolean(this.ws && this.ws.readyState === 1),
      reconnectEnabled: this.runtimeConfig?.reconnect !== false,
      reconnectAttempts: this.reconnectAttempts,
      lastDisconnectCode: this.lastDisconnectInfo?.code ?? null,
      lastDisconnectReason: this.lastDisconnectInfo?.reason || null,
    };
  }

  async close(reason = 'manual_close') {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.stopHeartbeatLoop();
    if (!this.ws) return { closed: false, reason: 'not_connected' };
    const ws = this.ws;
    this.ws = null;
    await new Promise((resolve) => {
      if (ws.readyState === 3) return resolve();
      ws.once('close', resolve);
      ws.close(1000, reason);
    });
    this.connectionState = 'closed';
    return { closed: true, reason };
  }
}

export function createClaworldRelayClient(options = {}) {
  return new ClaworldRelayClient(options);
}

export { normalizeRelayWebSocketUrl };

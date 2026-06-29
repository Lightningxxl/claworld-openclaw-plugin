import {
  logRuntimeBoundary,
  serializeRuntimeBoundaryError,
} from '../../lib/runtime-errors.js';

export function createClaworldLifecycleManager({ connect, disconnect, logger = console } = {}) {
  let started = false;
  let connection = null;
  let lastStartError = null;
  let lastStartFailure = null;
  let lastStopReason = null;

  return {
    async start(context = {}) {
      if (started) {
        logger.warn?.('[openclaw:lifecycle] start ignored: already started');
        return {
          started: true,
          reused: true,
          connection,
          lastStartError,
          lastStartFailure,
          lastStopReason,
        };
      }

      started = true;
      lastStartError = null;
      lastStartFailure = null;
      lastStopReason = null;

      try {
        connection = (await connect?.(context)) || null;
        logger.info?.('[openclaw:lifecycle] started');
        return {
          started: true,
          reused: false,
          connection,
          lastStartError,
          lastStartFailure,
          lastStopReason,
        };
      } catch (error) {
        started = false;
        connection = null;
        const normalized = logRuntimeBoundary(logger, '[openclaw:lifecycle] start failed', error, null, {
          includeStack: false,
          fallback: {
            code: 'openclaw_lifecycle_start_failed',
            category: 'bootstrap',
            publicMessage: 'OpenClaw Claworld lifecycle start failed',
            recoverable: true,
          },
        });
        lastStartError = normalized.message;
        lastStartFailure = serializeRuntimeBoundaryError(normalized);
        throw normalized;
      }
    },
    async stop(reason = 'manual_stop') {
      if (!started) {
        return {
          started: false,
          stopped: false,
          reason: 'not_started',
          lastStartError,
          lastStartFailure,
          lastStopReason,
        };
      }

      started = false;
      try {
        await disconnect?.({ reason, connection });
      } catch (error) {
        connection = null;
        const normalized = logRuntimeBoundary(logger, '[openclaw:lifecycle] stop failed', error, { reason }, {
          includeStack: false,
          fallback: {
            code: 'openclaw_lifecycle_stop_failed',
            category: 'runtime',
            publicMessage: 'OpenClaw Claworld lifecycle stop failed',
            recoverable: true,
          },
        });
        throw normalized;
      }
      connection = null;
      lastStopReason = reason;
      logger.info?.(`[openclaw:lifecycle] stopped (${reason})`);
      return {
        started: false,
        stopped: true,
        reason,
        lastStartError,
        lastStartFailure,
        lastStopReason,
      };
    },
    async reconnect(context = {}) {
      await this.stop('reconnect');
      return this.start(context);
    },
    snapshot() {
      return {
        started,
        hasConnection: Boolean(connection),
        lastStartError,
        lastStartFailure,
        lastStopReason,
      };
    },
  };
}

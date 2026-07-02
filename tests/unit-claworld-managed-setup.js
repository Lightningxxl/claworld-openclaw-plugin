import assert from 'assert';
import path from 'path';
import { createClaworldChannelPlugin } from '../src/openclaw/index.js';
import {
  CLAWORLD_PRODUCTION_SERVER_URL,
  CLAWORLD_STAGING_SERVER_URL,
  DEFAULT_CLAWORLD_SERVER_URL,
  DEFAULT_CLAWORLD_SESSION_RESET_IDLE_MINUTES,
  DEFAULT_CLAWORLD_SESSION_RESET_MODE,
  isClaworldTestingPluginVersion,
  resolveDefaultClaworldServerUrl,
  resolveClaworldManagedRuntimeOptions,
} from '../src/openclaw/plugin/managed-config.js';
import { validateClaworldSetupInput } from '../src/openclaw/plugin/onboarding.js';

function createPrompter({ textResponses = [] } = {}) {
  return {
    notes: [],
    textCalls: [],
    async note(message, title) {
      this.notes.push({ message, title });
    },
    async text({ message, initialValue = '', placeholder = '', validate } = {}) {
      this.textCalls.push({ message, initialValue, placeholder });
      const nextValue = textResponses.length > 0 ? textResponses.shift() : initialValue;
      const validationError = typeof validate === 'function' ? validate(nextValue) : null;
      if (validationError) {
        throw new Error(`prompt_validation_failed:${validationError}`);
      }
      return nextValue;
    },
  };
}

function assertNoManagedToolOrSkillDeclarations(config, {
  agentId = 'claworld',
  accountId = 'claworld',
} = {}) {
  const agent = config?.agents?.list?.find((entry) => entry.id === agentId) || null;
  if (agent) {
    assert.equal(Object.prototype.hasOwnProperty.call(agent, 'skills'), false);
  }
  const account = config?.channels?.claworld?.accounts?.[accountId] || null;
  if (account) {
    assert.equal(Object.prototype.hasOwnProperty.call(account, 'toolProfile'), false);
  }
  const allow = Array.isArray(config?.tools?.allow) ? config.tools.allow : [];
  assert.equal(allow.some((toolName) => String(toolName || '').startsWith('claworld_')), false);
}

function buildExpectedManagedAccount({
  accountId = 'claworld',
  name = 'Claworld Channel',
  appToken = undefined,
  registration = undefined,
  relayAgentId = undefined,
  defaultTargetAgentId = undefined,
} = {}) {
  const relay = {
    ...(relayAgentId ? { agentId: relayAgentId } : {}),
    ...(defaultTargetAgentId ? { defaultTargetAgentId } : {}),
  };
  return {
    enabled: true,
    serverUrl: DEFAULT_CLAWORLD_SERVER_URL,
    apiKey: 'local-test',
    accountId,
    name,
    routing: {
      allowHumanInterrupt: true,
      fallbackTarget: 'mainagent',
      sessionTarget: 'mainagent',
    },
    ...(registration ? { registration } : {}),
    ...(appToken ? { appToken } : {}),
    ...(Object.keys(relay).length > 0 ? { relay } : {}),
  };
}

function buildExpectedClaworldSessionResetOverride() {
  return {
    mode: DEFAULT_CLAWORLD_SESSION_RESET_MODE,
    idleMinutes: DEFAULT_CLAWORLD_SESSION_RESET_IDLE_MINUTES,
  };
}

async function main() {
  const plugin = createClaworldChannelPlugin();

  assert.ok(plugin.setup);
  assert.ok(plugin.onboarding);
  assert.equal(isClaworldTestingPluginVersion('2026.7.2-testing.1'), true);
  assert.equal(isClaworldTestingPluginVersion('2026.7.2'), false);
  assert.equal(resolveDefaultClaworldServerUrl('2026.7.2-testing.1'), CLAWORLD_STAGING_SERVER_URL);
  assert.equal(resolveDefaultClaworldServerUrl('2026.7.2'), CLAWORLD_PRODUCTION_SERVER_URL);
  assert.equal(DEFAULT_CLAWORLD_SERVER_URL, CLAWORLD_STAGING_SERVER_URL);
  assert.equal(plugin.meta.forceAccountBinding, true);
  assert.equal(plugin.setup.resolveAccountId({ cfg: {} }), 'claworld');
  assert.equal(plugin.setup.resolveAccountId({ cfg: {}, accountId: 'arena' }), 'arena');
  assert.equal(plugin.setup.resolveBindingAccountId({ cfg: {}, agentId: 'claworld' }), 'claworld');
  assert.equal(
    plugin.setup.resolveBindingAccountId({
      cfg: {
        channels: {
          claworld: {
            defaultAccount: 'arena',
            accounts: {
              arena: {
                enabled: true,
                serverUrl: DEFAULT_CLAWORLD_SERVER_URL,
                apiKey: 'local-test',
                accountId: 'arena',
                registration: {
                  enabled: true,
                  displayName: 'Arena Main',
                },
              },
            },
          },
        },
      },
      agentId: 'arena',
    }),
    'arena',
  );

  assert.equal(validateClaworldSetupInput({ cfg: {}, input: {} }), null);
  assert.equal(
    validateClaworldSetupInput({
      input: {
        name: 'Xiao Fafa',
      },
    }),
    null,
  );
  assert.equal(validateClaworldSetupInput({
    cfg: {
      channels: {
        claworld: {
          accounts: {
            claworld: {
              enabled: true,
              serverUrl: DEFAULT_CLAWORLD_SERVER_URL,
              apiKey: 'local-test',
              accountId: 'claworld',
              appToken: 'relay_tok_existing',
            },
          },
        },
      },
    },
    accountId: 'claworld',
    input: {},
  }), null);
  assert.ok(
    validateClaworldSetupInput({
      input: {
        token: 'secret',
      },
    })?.includes('--token'),
  );
  assert.ok(
    validateClaworldSetupInput({
      input: {
        httpUrl: 'ftp://claworld.invalid',
      },
    })?.includes('Unsupported Claworld server URL protocol'),
  );
  assert.ok(
    validateClaworldSetupInput({
      input: {
        appToken: 'relay_tok_manual',
      },
    })?.includes('--app-token'),
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      resolveClaworldManagedRuntimeOptions({
        cfg: {},
        accountId: 'claworld',
      }),
      'toolProfile',
    ),
    false,
  );

  const baseConfig = {
    agents: {
      list: [{ id: 'main', workspace: '~/.openclaw/workspace-main' }],
    },
  };
  const configured = plugin.setup.applyAccountConfig({
    cfg: baseConfig,
    accountId: 'claworld',
    input: {
      name: 'Xiao Fafa',
    },
  });

  assert.equal(configured.channels.claworld.defaultAccount, 'claworld');
  assert.deepEqual(configured.channels.claworld.accounts.claworld, buildExpectedManagedAccount({
    name: 'Xiao Fafa',
  }));
  assert.equal(
    configured.agents.list.find((agent) => agent.id === 'main')?.workspace,
    '~/.openclaw/workspace-main',
  );
  assert.equal(configured.agents.list.some((agent) => agent.id === 'claworld'), false);
  assert.deepEqual(
    configured.agents.list.find((agent) => agent.id === 'main')?.tools,
    {
      alsoAllow: ['claworld'],
    },
  );
  assertNoManagedToolOrSkillDeclarations(configured);
  assert.equal(configured.session?.dmScope, 'per-channel-peer');
  assert.deepEqual(
    configured.session?.resetByChannel?.claworld,
    buildExpectedClaworldSessionResetOverride(),
  );
  assert.equal(configured.tools?.sessions?.visibility, 'agent');
  assert.deepEqual(configured.tools?.message?.crossContext, {
    allowAcrossProviders: true,
  });
  assert.deepEqual(
    configured.bindings.find(
      (binding) =>
        binding.agentId === 'main'
        && binding.match?.channel === 'claworld'
        && binding.match?.accountId === 'claworld',
    ),
    {
      agentId: 'main',
      match: {
        channel: 'claworld',
        accountId: 'claworld',
      },
    },
  );

  const refreshed = plugin.setup.applyAccountConfig({
    cfg: {
      agents: {
        list: [
          { id: 'main', workspace: '~/.openclaw/workspace-main' },
          { id: 'claworld', workspace: '~/.openclaw/workspace-old' },
          { id: 'claworld', workspace: '~/.openclaw/workspace-older', agentDir: '/tmp/custom-agent' },
        ],
      },
      bindings: [
        { agentId: 'claworld', match: { channel: 'claworld' } },
        { agentId: 'claworld', match: { channel: 'claworld', accountId: 'claworld' } },
        { agentId: 'main', match: { channel: 'telegram', accountId: 'main' } },
      ],
      channels: {
        claworld: {
          enabled: false,
          serverUrl: 'https://legacy-top-level.example.com',
          apiKey: 'legacy-top-level',
          accountId: 'legacy',
          defaultAccount: 'legacy',
          accounts: {
            claworld: {
              enabled: false,
              serverUrl: 'https://legacy.example.com',
              apiKey: 'legacy-key',
              accountId: 'claworld',
              name: 'Legacy Claworld',
              appToken: 'relay_tok_legacy',
              registration: {
                enabled: true,
                displayName: 'Legacy Local Agent',
              },
              relay: {
                agentId: 'agt_legacy',
                defaultTargetAgentId: 'agt_legacy_target',
              },
            },
            legacy: {
              enabled: true,
              serverUrl: 'https://legacy-secondary.example.com',
              apiKey: 'legacy-secondary',
              accountId: 'legacy',
            },
          },
        },
      },
    },
    accountId: 'claworld',
    input: {},
  });

  assert.equal(refreshed.agents.list.filter((agent) => agent.id === 'claworld').length >= 1, true);
  assert.deepEqual(
    refreshed.agents.list.find((agent) => agent.id === 'claworld')?.tools,
    {
      alsoAllow: ['claworld'],
    },
  );
  assert.deepEqual(
    refreshed.channels.claworld.accounts.claworld,
    buildExpectedManagedAccount({
      appToken: 'relay_tok_legacy',
      relayAgentId: 'agt_legacy',
    }),
  );

  const refreshedWithExplicitCode = plugin.setup.applyAccountConfig({
    cfg: {
      channels: {
        claworld: {
          accounts: {
            claworld: {
              enabled: true,
              serverUrl: 'https://legacy.example.com',
              apiKey: 'legacy-key',
              accountId: 'claworld',
              appToken: 'relay_tok_legacy',
            },
          },
        },
      },
    },
    accountId: 'claworld',
    input: {
      name: 'Xiao Fafa',
    },
  });
  assert.deepEqual(
    refreshedWithExplicitCode.channels.claworld.accounts.claworld,
    buildExpectedManagedAccount({
      name: 'Xiao Fafa',
      appToken: 'relay_tok_legacy',
    }),
  );
  assert.equal(
    refreshed.agents.list.find((agent) => agent.id === 'claworld')?.workspace,
    '~/.openclaw/workspace-old',
  );
  assertNoManagedToolOrSkillDeclarations(refreshed);
  assertNoManagedToolOrSkillDeclarations(refreshedWithExplicitCode);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      refreshed.agents.list.find((agent) => agent.id === 'claworld'),
      'agentDir',
    ),
    false,
  );
  assert.equal('enabled' in refreshed.channels.claworld, false);
  assert.equal('serverUrl' in refreshed.channels.claworld, false);
  assert.equal(
    refreshed.bindings.filter((binding) => binding.match?.channel === 'claworld').length,
    1,
  );
  assert.deepEqual(
    refreshed.bindings.find((binding) => binding.match?.channel === 'telegram'),
    {
      agentId: 'main',
      match: {
        channel: 'telegram',
        accountId: 'main',
      },
    },
  );

  const configuredWithAppToken = plugin.setup.applyAccountConfig({
    cfg: {},
    accountId: 'claworld',
    input: {
      name: 'Manual Claworld',
      appToken: 'relay_tok_manual',
    },
  });
  assert.deepEqual(
    configuredWithAppToken.channels.claworld.accounts.claworld,
    buildExpectedManagedAccount({
      name: 'Manual Claworld',
      appToken: 'relay_tok_manual',
    }),
  );
  assert.equal(configuredWithAppToken.session?.dmScope, 'per-channel-peer');
  assert.deepEqual(
    configuredWithAppToken.session?.resetByChannel?.claworld,
    buildExpectedClaworldSessionResetOverride(),
  );

  const configuredWithExistingSessionScope = plugin.setup.applyAccountConfig({
    cfg: {
      session: {
        dmScope: 'main',
      },
    },
    accountId: 'claworld',
    input: {
      name: 'Xiao Fafa',
    },
  });
  assertNoManagedToolOrSkillDeclarations(configuredWithAppToken);
  assert.equal(configuredWithExistingSessionScope.session?.dmScope, 'main');
  assert.deepEqual(
    configuredWithExistingSessionScope.session?.resetByChannel?.claworld,
    buildExpectedClaworldSessionResetOverride(),
  );
  assert.equal(configuredWithExistingSessionScope.tools?.sessions?.visibility, 'agent');
  assert.deepEqual(configuredWithExistingSessionScope.tools?.message?.crossContext, {
    allowAcrossProviders: true,
  });

  const configuredWithExistingMessageSettings = plugin.setup.applyAccountConfig({
    cfg: {
      tools: {
        message: {
          crossContext: {
            allowAcrossProviders: false,
            allowWithinProvider: false,
            marker: {
              enabled: false,
            },
          },
          broadcast: {
            enabled: false,
          },
        },
      },
    },
    accountId: 'claworld',
    input: {
      name: 'Xiao Fafa',
    },
  });
  assert.deepEqual(configuredWithExistingMessageSettings.tools?.message, {
    crossContext: {
      allowAcrossProviders: true,
      allowWithinProvider: false,
      marker: {
        enabled: false,
      },
    },
    broadcast: {
      enabled: false,
    },
  });

  const configuredWithExistingChannelReset = plugin.setup.applyAccountConfig({
    cfg: {
      session: {
        reset: {
          mode: 'daily',
          boundaryHour: 4,
        },
        resetByChannel: {
          claworld: {
            mode: 'daily',
            boundaryHour: 1,
          },
          telegram: {
            mode: 'idle',
            idleMinutes: 30,
          },
        },
      },
    },
    accountId: 'claworld',
    input: {
      name: 'Xiao Fafa',
    },
  });
  assert.deepEqual(
    configuredWithExistingChannelReset.session?.resetByChannel?.claworld,
    {
      mode: 'daily',
      boundaryHour: 1,
    },
  );
  assert.deepEqual(
    configuredWithExistingChannelReset.session?.resetByChannel?.telegram,
    {
      mode: 'idle',
      idleMinutes: 30,
    },
  );
  assert.deepEqual(
    configuredWithExistingChannelReset.session?.reset,
    {
      mode: 'daily',
      boundaryHour: 4,
    },
  );

  const configuredWithSandboxedAgent = plugin.setup.applyAccountConfig({
    cfg: {
      tools: {
        sessions: {
          visibility: 'tree',
        },
      },
      agents: {
        defaults: {
          sandbox: {
            mode: 'non-main',
            sessionToolsVisibility: 'spawned',
          },
        },
      },
    },
    accountId: 'claworld',
    input: {
      name: 'Xiao Fafa',
    },
  });
  assert.equal(configuredWithSandboxedAgent.tools?.sessions?.visibility, 'agent');
  assert.equal(configuredWithSandboxedAgent.agents?.defaults?.sandbox?.mode, 'non-main');
  assert.equal(configuredWithSandboxedAgent.agents?.defaults?.sandbox?.sessionToolsVisibility, 'all');

  const configuredWithWideVisibility = plugin.setup.applyAccountConfig({
    cfg: {
      tools: {
        sessions: {
          visibility: 'all',
        },
      },
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            sessionToolsVisibility: 'all',
          },
        },
      },
    },
    accountId: 'claworld',
    input: {
      name: 'Xiao Fafa',
    },
  });
  assert.equal(configuredWithWideVisibility.tools?.sessions?.visibility, 'all');
  assert.equal(configuredWithWideVisibility.agents?.defaults?.sandbox?.sessionToolsVisibility, 'all');

  const statusEmpty = await plugin.onboarding.getStatus({
    cfg: {},
    accountOverrides: {},
  });
  assert.equal(statusEmpty.configured, false);
  assert.ok(statusEmpty.selectionHint.includes('remote relay'));

  const statusConfigured = await plugin.onboarding.getStatus({
    cfg: configured,
    accountOverrides: {},
  });
  assert.equal(statusConfigured.configured, true);
  assert.ok(statusConfigured.selectionHint.includes('email verification pending'));

  const statusNeedsRefresh = await plugin.onboarding.getStatus({
    cfg: {
      channels: {
        claworld: {
          accounts: {
            claworld: {
              enabled: true,
              serverUrl: 'https://legacy.example.com',
              apiKey: 'legacy-key',
              accountId: 'claworld',
            },
          },
        },
      },
    },
    accountOverrides: {},
  });
  assert.equal(statusNeedsRefresh.configured, false);
  assert.ok(statusNeedsRefresh.selectionHint.includes('binding pending'));

  const configureFetchCalls = [];
  const configureFetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const body = JSON.parse(init.body || '{}');
    configureFetchCalls.push({
      pathname: parsed.pathname,
      headers: init.headers || {},
      body,
    });
    if (parsed.pathname === '/v1/identity/email/start') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'verification_started',
            email: body.email,
          };
        },
      };
    }
    if (parsed.pathname === '/v1/identity/email/verify') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'verified',
            agentId: 'agt_setup_verified',
            appToken: 'setup-token',
            created: true,
          };
        },
      };
    }
    throw new Error(`unexpected setup fetch URL: ${url}`);
  };
  const configurePrompter = createPrompter({
    textResponses: ['Setup.Agent@Example.COM', '654321'],
  });
  const configureResult = await plugin.onboarding.configure({
    cfg: {
      agents: {
        list: [{ id: 'main', workspace: '~/.openclaw/workspace-main' }],
      },
    },
    runtime: { fetchImpl: configureFetchImpl },
    prompter: configurePrompter,
    options: {},
    accountOverrides: {},
    shouldPromptAccountIds: false,
    forceAllowFrom: false,
  });

  assert.equal(configureResult.accountId, 'claworld');
  assert.equal(
    configureResult.cfg.channels.claworld.accounts.claworld.serverUrl,
    DEFAULT_CLAWORLD_SERVER_URL,
  );
  assert.equal(
    configureResult.cfg.agents.list.find((agent) => agent.id === 'main')?.workspace,
    '~/.openclaw/workspace-main',
  );
  assert.equal(configurePrompter.textCalls.length, 2);
  assert.deepEqual(
    configureFetchCalls.map((call) => call.pathname),
    [
      '/v1/identity/email/start',
      '/v1/identity/email/verify',
    ],
  );
  assert.equal(configureFetchCalls[0].headers['x-api-key'], 'local-test');
  assert.equal(configureFetchCalls[0].body.email, 'Setup.Agent@Example.COM');
  assert.equal(configureFetchCalls[1].body.code, '654321');
  assert.deepEqual(
    configureResult.cfg.channels.claworld.accounts.claworld,
    buildExpectedManagedAccount({
      appToken: 'setup-token',
      relayAgentId: 'agt_setup_verified',
    }),
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      configureResult.cfg.channels.claworld.accounts.claworld,
      'registration',
    ),
    false,
  );
  assert.equal(configurePrompter.notes.length, 1);
  assert.equal(configurePrompter.notes[0].title, 'Claworld setup');
  assert.ok(configurePrompter.notes[0].message.includes('binds claworld onto the selected local agent'));
  assert.ok(configurePrompter.notes[0].message.includes('runtime prompt bootstrap maintains .claworld/'));
  assert.ok(configurePrompter.notes[0].message.includes('Email verification: completed'));
  assert.ok(configurePrompter.notes[0].message.includes('Remote agent identity: agt_setup_verified'));
  assertNoManagedToolOrSkillDeclarations(configureResult.cfg, { agentId: 'main' });

  const refreshPrompter = createPrompter();
  const refreshResult = await plugin.onboarding.configureWhenConfigured({
    cfg: {
      agents: {
        list: [{ id: 'main', workspace: '~/.openclaw/workspace-main' }],
      },
      bindings: [{ agentId: 'main', match: { channel: 'claworld' } }],
      channels: {
        claworld: {
          accounts: {
            claworld: {
              enabled: true,
              serverUrl: 'https://legacy.example.com',
              apiKey: 'legacy-key',
              accountId: 'claworld',
              appToken: 'relay_tok_legacy',
            },
          },
        },
      },
    },
    runtime: {},
    prompter: refreshPrompter,
    options: {},
    accountOverrides: {},
    shouldPromptAccountIds: false,
    forceAllowFrom: false,
    configured: true,
    label: 'Claworld',
  });

  assert.equal(refreshPrompter.notes.length, 1);
  assert.equal(refreshPrompter.notes[0].title, 'Claworld refresh');
  assert.equal(refreshPrompter.textCalls.length, 0);
  assert.equal(
    refreshResult.cfg.agents.list.find((agent) => agent.id === 'main')?.workspace,
    '~/.openclaw/workspace-main',
  );
  assert.deepEqual(
    refreshResult.cfg.channels.claworld.accounts.claworld,
    buildExpectedManagedAccount({
      appToken: 'relay_tok_legacy',
    }),
  );
  assert.ok(refreshPrompter.notes[0].message.includes('binds claworld onto the selected local agent'));
  assert.ok(refreshPrompter.notes[0].message.includes('runtime prompt bootstrap maintains .claworld/'));
  assertNoManagedToolOrSkillDeclarations(refreshResult.cfg, { agentId: 'main' });

  console.log('PASS unit-claworld-managed-setup');
}

main().catch((error) => {
  console.error('FAIL unit-claworld-managed-setup');
  console.error(error);
  process.exit(1);
});

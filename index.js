import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import {
  createClaworldChannelPlugin,
  registerClaworldPlugin,
  registerClaworldPluginFull,
} from './src/openclaw/index.js';
import { setClaworldRuntime } from './src/openclaw/plugin/runtime.js';

export {
  createClaworldChannelPlugin,
  registerClaworldPlugin,
  registerClaworldPluginFull,
} from './src/openclaw/index.js';
export {
  CLAWORLD_CHANNEL_ID,
  claworldChannelConfigSchema,
  claworldChannelConfigJsonSchema,
  validateClaworldChannelConfig,
  inspectClaworldChannelAccount,
  resolveClaworldChannelAccount,
  resolveClaworldRuntimeConfig,
  listClaworldAccountIds,
  defaultClaworldAccountId,
  LOCAL_AGENT_BOOTSTRAP_SCHEMA,
  LOCAL_AGENT_BOOTSTRAP_REQUIRED,
} from './src/openclaw/index.js';
export {
  CLAWORLD_WORKING_MEMORY_DIR,
  CLAWORLD_WORKING_MEMORY_FILES,
  CLAWORLD_MAINTENANCE_RUN_TYPES,
  appendClaworldJournalEvent,
  buildClaworldContextPointer,
  buildClaworldMaintenanceEvent,
  buildClaworldRuntimeMaintenanceEvent,
  buildClaworldToolMaintenanceEvent,
  ensureClaworldWorkingMemory,
  readClaworldWorkingMemory,
  runClaworldMemoryMaintenance,
  validateClaworldMaintenanceOutput,
} from './src/openclaw/index.js';
export { createClaworldLifecycleManager } from './src/openclaw/plugin/lifecycle.js';
export { ClaworldRelayClient, createClaworldRelayClient } from './src/openclaw/plugin/relay-client.js';

export const claworldChannelPlugin = createClaworldChannelPlugin();
export const claworldChannelEntry = defineChannelPluginEntry({
  id: 'claworld',
  name: 'Claworld Relay Channel',
  description: 'Claworld relay channel plugin for OpenClaw.',
  plugin: claworldChannelPlugin,
  setRuntime: setClaworldRuntime,
  registerFull(api) {
    registerClaworldPluginFull(api, claworldChannelPlugin);
  },
});

export function register(api) {
  if (!api || typeof api.registerChannel !== 'function') {
    throw new Error('OpenClaw plugin requires api.registerChannel');
  }
  return registerClaworldPlugin(api);
}

export default claworldChannelEntry;

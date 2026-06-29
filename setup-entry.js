import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/core';
import { createClaworldChannelPlugin } from './src/openclaw/index.js';

export const claworldSetupPlugin = createClaworldChannelPlugin();

export default defineSetupPluginEntry(claworldSetupPlugin);

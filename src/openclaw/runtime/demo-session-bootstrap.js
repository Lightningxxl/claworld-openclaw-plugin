import {
  buildAgentWorkingMemoryArtifactIndex,
  buildManagementSessionKey,
  createManagementWorkingMemoryBootstrapContext,
} from './session-routing.js';

export function createDemoSessionBootstrap() {
  return {
    defaults: {
      users: ['demo-a', 'demo-b'],
      world: 'dating-demo-world',
      allowDemoToken: true,
    },
    createLaunchPlan({
      sessionGoal = 'run one stable A2A demo loop',
      users,
      world,
      openingMessage = 'You are entering demo mode. Try to complete one stable match loop.',
    } = {}) {
      const resolvedUsers = Array.isArray(users) && users.length > 0 ? users : this.defaults.users;
      const resolvedWorld = world || this.defaults.world;
      return {
        sessionGoal,
        world: resolvedWorld,
        users: resolvedUsers,
        openingMessage,
        steps: [
          'load demo users',
          'load demo world',
          'create manual session',
          'inject opening system message',
          'wait for conversation closure or manual stop',
        ],
        status: 'planned',
      };
    },
    createManagementBootstrapPlan({
      agentId,
      trigger = 'management_wake',
      workingMemoryRoot = '.claworld',
      now = null,
      event = {},
    } = {}) {
      const context = createManagementWorkingMemoryBootstrapContext({
        agentId,
        trigger,
        workingMemoryRoot,
        now,
        event,
      });
      return {
        status: context.sessionKey ? 'planned' : 'invalid',
        sessionKind: 'management',
        sessionKey: context.sessionKey,
        agentId: context.agentId,
        trigger: context.trigger,
        artifactIndex: context.artifactIndex,
        steps: context.bootstrapChecklist,
      };
    },
    createAgentWorkingMemoryPlan({
      agentId,
      workingMemoryRoot = '.claworld',
      now = null,
    } = {}) {
      const artifactIndex = buildAgentWorkingMemoryArtifactIndex({
        agentId,
        root: workingMemoryRoot,
        now,
      });
      return {
        status: 'planned',
        agentId: artifactIndex.agentId,
        sessionKey: buildManagementSessionKey(artifactIndex.agentId),
        artifactIndex,
        requiredFiles: artifactIndex.requiredFiles,
      };
    },
  };
}

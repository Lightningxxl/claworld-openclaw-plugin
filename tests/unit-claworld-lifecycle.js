import assert from 'assert';
import { createClaworldLifecycleManager } from '../src/openclaw/index.js';

async function main() {
  const events = [];

  const lifecycle = createClaworldLifecycleManager({
    logger: {
      info: (...args) => events.push(['info', ...args]),
      warn: (...args) => events.push(['warn', ...args]),
      error: (...args) => events.push(['error', ...args]),
    },
    connect: async () => {
      throw new Error('boom_connect');
    },
    disconnect: async () => {},
  });

  await assert.rejects(() => lifecycle.start({}), /boom_connect/);

  const afterFailure = lifecycle.snapshot();
  assert.equal(afterFailure.started, false);
  assert.equal(afterFailure.hasConnection, false);
  assert.equal(afterFailure.lastStartError, 'boom_connect');
  assert.equal(afterFailure.lastStartFailure.code, 'openclaw_lifecycle_start_failed');
  assert.equal(afterFailure.lastStartFailure.category, 'bootstrap');

  let calls = 0;
  const recovered = createClaworldLifecycleManager({
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    connect: async () => {
      calls += 1;
      if (calls === 1) throw new Error('first_fail');
      return { id: 'conn_ok' };
    },
    disconnect: async () => {},
  });

  await assert.rejects(() => recovered.start({}), /first_fail/);
  const startResult = await recovered.start({});
  assert.equal(calls, 2);
  assert.equal(startResult.started, true);
  assert.equal(startResult.reused, false);
  assert.deepEqual(startResult.connection, { id: 'conn_ok' });
  assert.equal(recovered.snapshot().lastStartFailure, null);

  console.log('PASS unit-claworld-lifecycle');
}

main().catch((error) => {
  console.error('FAIL unit-claworld-lifecycle');
  console.error(error);
  process.exit(1);
});

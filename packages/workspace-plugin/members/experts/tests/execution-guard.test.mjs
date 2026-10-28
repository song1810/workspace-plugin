import test from 'node:test';
import assert from 'node:assert/strict';
import { registerExpertExecutionGuard } from '../dist/runtime/execution-guard.js';

test('a standard root ignores a stale expert preset on a derived session', async () => {
  const handlers = new Map();
  let identityCalls = 0;
  const ctx = {
    on(event, handler) { handlers.set(event, handler); },
    agentTeams: { tryMembership: () => undefined },
    agentPresets: { composedPreset: () => 'standard' },
    effect() {},
    workspaceIdentity: {
      async resolve() {
        identityCalls += 1;
        throw new Error('identity resolution must not run for a standard root');
      },
    },
    workspaceExperts: {
      async resolveNativeRole() {
        throw new Error('expert binding must not be required for a standard root');
      },
    },
  };
  registerExpertExecutionGuard(ctx);
  const agent = { ctx: {}, session: { header: { agentPreset: 'wd-exp-stale-team' } } };
  let continued = false;
  await handlers.get('agent/pre-step')({ agent, signal: undefined }, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(identityCalls, 0);
});

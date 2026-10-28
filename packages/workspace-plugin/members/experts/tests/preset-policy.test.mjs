import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleExpertBinding, shouldClearInheritedExpert } from '../dist/client/preset-policy.js';

test('blank conversations clear inherited expert and expert-team presets', () => {
  assert.equal(shouldClearInheritedExpert({
    blank: true,
    sessionId: 'new-session',
    standardId: 'standard',
    current: 'wd-exp-team-stock',
  }), true);
  assert.equal(shouldClearInheritedExpert({
    blank: false,
    sessionId: 'active-session',
    standardId: 'standard',
    current: 'wd-exp-team-stock',
  }), false);
  assert.equal(shouldClearInheritedExpert({
    blank: true,
    sessionId: 'new-session',
    standardId: 'standard',
    current: 'standard',
  }), false);
});

test('only stale binding failures clear the inherited preset', () => {
  assert.equal(isStaleExpertBinding({ code: 'experts/not-found' }), true);
  assert.equal(isStaleExpertBinding({ code: 'experts/disabled' }), true);
  assert.equal(isStaleExpertBinding({ code: 'experts/request-cancelled' }), false);
  assert.equal(isStaleExpertBinding({ code: 'experts/outcome-unknown' }), false);
});

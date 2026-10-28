import test from 'node:test';
import assert from 'node:assert/strict';
import { activeBoundSessionIds, bindingRowsForExperts } from '../dist/services/lifecycle.js';

const binding = (sessionId, expertId) => ({
  sessionId,
  expertRevisionRef: { expertId, revisionId: `${expertId}-revision` },
  presetRevisionRef: `${expertId}-preset`,
});

test('only non-blank conversations keep an expert from being deleted', () => {
  const bindings = [binding('draft-session', 'expert-a'), binding('used-session', 'expert-a')];
  const active = activeBoundSessionIds(bindings, [
    { sessionId: 'draft-session', blank: true },
    { sessionId: 'used-session', blank: false },
    { sessionId: 'other-session', blank: false },
  ]);
  assert.deepEqual(active, ['used-session']);
});

test('team deletion includes bindings owned by its member experts', () => {
  const rows = [
    ['a', binding('one', 'team-a')],
    ['b', binding('two', 'member-a')],
    ['c', binding('three', 'team-b')],
  ];
  assert.deepEqual(
    bindingRowsForExperts(rows, new Set(['team-a', 'member-a'])).map(([key]) => key),
    ['a', 'b'],
  );
});

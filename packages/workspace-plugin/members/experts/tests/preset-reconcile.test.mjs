import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileExpertPreset } from '../dist/runtime/preset-compiler.js';

test('legacy expert presets adopt current base tool rows while keeping expert composition', () => {
  const ctx = {
    loader: {
      entries() {
        return [{
          disabled: false,
          options: {
            name: '@deepseek-ai/dsh-agent-preset',
            config: {
              id: 'standard',
              plugins: [
                { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'base' } },
                { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
                {
                  id: 'delegation',
                  name: 'cordis:group',
                  config: [{
                    id: 'tool-subagent',
                    name: '@deepseek-ai/dsh-tool-subagent',
                    config: { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true },
                  }],
                },
                { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
                { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
              ],
            },
          },
        }];
      },
    },
  };
  const legacy = {
    id: 'wd-exp-demo',
    name: 'Demo',
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'expert', complete: false } },
      {
        id: 'delegation',
        name: 'cordis:group',
        config: [{
          id: 'tool-subagent',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'spawn', toolName: 'subagent', modelSelectionSettings: true, backgroundMode: 'continuable' },
        }],
      },
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { includeDefaultRoots: true, customSkillDirs: ['/pinned'] } },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    ],
  };
  const result = reconcileExpertPreset(ctx, legacy);
  assert.equal(result.plugins.find(row => row.id === 'persona').config.prefix, 'expert');
  assert.deepEqual(result.plugins.find(row => row.id === 'skill-filesystem').config.customSkillDirs, ['/pinned']);
  assert.ok(result.plugins.some(row => row.id === 'time-context'));
  const delegation = result.plugins.find(row => row.id === 'delegation');
  assert.deepEqual(delegation.config[0].config, {
    provider: 'spawn',
    toolName: 'subagent',
    modelSelection: true,
    modelDiscovery: true,
  });
  assert.equal(result.plugins.filter(row => row.id === 'tool-skill').length, 1);
});

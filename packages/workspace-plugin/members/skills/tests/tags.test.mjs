import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem';
import { SkillManager } from '../dist/index.js';

test('skill tags persist through draft publication and can be edited or cleared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-skill-tags-'));
  const agentsHome = join(root, 'agents');
  const dshHome = join(root, 'dsh');
  const previousAgentsHome = process.env.DSH_AGENTS_HOME;
  const previousDshHome = process.env.DSH_HOME;
  const ctx = new Context();
  try {
    process.env.DSH_AGENTS_HOME = agentsHome;
    process.env.DSH_HOME = dshHome;
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(filesystem, { dshHome, agentsHome, watch: false });
    new SkillManager(ctx);
    const document = '---\nname: tagged-skill\ndescription: Tag persistence fixture\n---\nFollow the fixture.\n';
    const draft = await ctx.workspaceSkills.saveDraft({
      name: 'tagged-skill',
      document,
      tags: ['研究', '整理', '研究'],
    });
    assert.deepEqual(draft.tags, ['研究', '整理']);
    await ctx.workspaceSkills.publishDraft(draft.id, draft.revision);
    let detail = await ctx.workspaceSkills.detail('tagged-skill');
    assert.deepEqual(detail.tags, ['研究', '整理']);

    detail = await ctx.workspaceSkills.update({
      name: detail.name,
      document: detail.document,
      expectedRevision: detail.revision,
      tags: ['整理', '复核'],
    });
    assert.deepEqual(detail.tags, ['整理', '复核']);

    detail = await ctx.workspaceSkills.update({
      name: detail.name,
      document: detail.document,
      expectedRevision: detail.revision,
      tags: [],
    });
    assert.deepEqual(detail.tags, []);

    const importedDocument = '---\nname: imported-tags\ndescription: Imported tag fixture\n---\nUse the imported fixture.\n';
    const upload = new File([importedDocument], 'imported-tags.md', { type: 'text/markdown' });
    const staged = await ctx.workspaceSkills.imports.stage('imported-tags.md', upload.stream(), AbortSignal.timeout(10_000));
    await ctx.workspaceSkills.imports.commit(staged.id, 'shared-agents', AbortSignal.timeout(10_000), undefined, ['导入', '复核']);
    const imported = await ctx.workspaceSkills.detail('imported-tags');
    assert.deepEqual(imported.tags, ['导入', '复核']);
  } finally {
    await ctx.fiber.dispose();
    if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = previousAgentsHome;
    if (previousDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousDshHome;
    await rm(root, { recursive: true, force: true });
  }
});

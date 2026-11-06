import test from 'node:test';
import assert from 'node:assert/strict';
import { isBilingualTag, sanitizeBilingualTag } from '../dist/domain/values.js';

test('user tags accept Chinese, English, digits and common separators', () => {
  assert.equal(sanitizeBilingualTag(' 课程 AI 26 '), ' 课程 AI 26 ');
  assert.equal(sanitizeBilingualTag('开发,测试！'), '开发测试');
  assert.equal(sanitizeBilingualTag('AI-Agent_2'), 'AI-Agent_2');
  assert.equal(sanitizeBilingualTag('g'), 'g');
  assert.equal(sanitizeBilingualTag('AI 开发🙂'), 'AI 开发');
});

test('complete user tags must contain one to twenty Chinese/English characters', () => {
  assert.equal(isBilingualTag('课程开发'), true);
  assert.equal(isBilingualTag('AI 开发'), true);
  assert.equal(isBilingualTag('AI-Agent_2'), true);
  assert.equal(isBilingualTag(''), false);
  assert.equal(isBilingualTag('g'), true);
  assert.equal(isBilingualTag(' 开发'), false);
  assert.equal(isBilingualTag('开发🙂'), false);
  assert.equal(isBilingualTag('A'.repeat(20)), true);
  assert.equal(isBilingualTag('A'.repeat(21)), false);
});

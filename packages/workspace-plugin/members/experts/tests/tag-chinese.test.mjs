import test from 'node:test';
import assert from 'node:assert/strict';
import { isChineseTag, sanitizeChineseTag } from '../dist/domain/values.js';

test('user tags accept Chinese and remove Latin, digits, punctuation and whitespace', () => {
  assert.equal(sanitizeChineseTag('  课程 Development 2026  '), '课程');
  assert.equal(sanitizeChineseTag('开发,测试！'), '开发测试');
  assert.equal(sanitizeChineseTag('g'), '');
});

test('complete user tags must contain one to twenty Chinese characters', () => {
  assert.equal(isChineseTag('课程开发'), true);
  assert.equal(isChineseTag(''), false);
  assert.equal(isChineseTag('g'), false);
  assert.equal(isChineseTag('开发g'), false);
  assert.equal(isChineseTag('课'.repeat(20)), true);
  assert.equal(isChineseTag('课'.repeat(21)), false);
});

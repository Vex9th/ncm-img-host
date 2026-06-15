import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookie, cookieString } from '../functions/api/_lib/netease.js';

test('parseCookie 解析分号分隔字符串', () => {
  const c = parseCookie('MUSIC_U=abc; __csrf=xyz; os=pc');
  assert.equal(c.MUSIC_U, 'abc');
  assert.equal(c.__csrf, 'xyz');
  assert.equal(c.os, 'pc');
});

test('parseCookie 处理空值', () => {
  assert.deepEqual(parseCookie(''), {});
  assert.deepEqual(parseCookie(undefined), {});
});

test('cookieString 回环', () => {
  assert.equal(cookieString({ MUSIC_U: 'abc', __csrf: 'xyz' }), 'MUSIC_U=abc; __csrf=xyz');
});

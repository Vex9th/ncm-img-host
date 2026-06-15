import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  id2url, aesEncrypt, modpow, rsaNoPadding, weapi, md5hex,
} from '../functions/api/_lib/crypto.js';

test('id2url 匹配官方测试向量', () => {
  assert.equal(id2url('109951169393089538'), 'yQ97Zt-RKSwOLzW9llEeqA==');
});

test('id2url 对不同 docId 产出不同结果', () => {
  assert.notEqual(id2url('109951169393089538'), id2url('109951169393089539'));
});

test('aesEncrypt 用 presetKey 加密 {"type":3} 输出确定 base64', () => {
  assert.equal(aesEncrypt('{"type":3}', '0CoJUm6Qyw8W8jud'), 'F/OOL6PcB8XyxLo4ey75ww==');
});

test('modpow 正确：4^13 mod 497 = 445', () => {
  assert.equal(modpow(4n, 13n, 497n), 445n);
});

test('rsaNoPadding 用真实公钥输出 256 位 hex', () => {
  assert.match(rsaNoPadding('aB3xYz9kLm2nPq5w'), /^[0-9a-f]{256}$/);
});

test('rsaNoPadding 对同一输入稳定', () => {
  assert.equal(rsaNoPadding('abcdefghijklmnop'), rsaNoPadding('abcdefghijklmnop'));
});

test('weapi 输出 params 与 256-hex encSecKey', () => {
  const r = weapi({ type: 3 });
  assert.ok(r.params.length > 0);
  assert.match(r.encSecKey, /^[0-9a-f]{256}$/);
});

test('weapi params 两次随机不同（secretKey 随机）', () => {
  assert.notEqual(weapi({ type: 3 }).params, weapi({ type: 3 }).params);
});

test('md5hex 已知向量', () => {
  assert.equal(md5hex(Buffer.from('abc')), '900150983cd24fb0d6963f7d28e17f72');
});

import { createHash, createCipheriv } from 'node:crypto';

const ID_XOR_KEY = '3go8&$8*3*3h0k(2)2';
const IV = Buffer.from('0102030405060708', 'utf8');
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// 网易云固定公钥（1024-bit）
const RSA_MODULUS = BigInt('0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7');
const RSA_EXPONENT = 0x10001n;

// docId 逐字节与固定 key 循环异或 -> raw bytes -> MD5 -> url-safe base64
export function id2url(docId) {
  const raw = Buffer.alloc(docId.length);
  for (let i = 0; i < docId.length; i++) {
    raw[i] = docId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length);
  }
  return createHash('md5').update(raw).digest('base64')
    .replace(/\//g, '_').replace(/\+/g, '-');
}

// AES-128-CBC, PKCS7(node 默认), 输出 base64
export function aesEncrypt(text, key) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), IV);
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
    .toString('base64');
}

export function modpow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

// RSA 无填充：str 按 latin1 取字节 -> 左补零到 128 字节 -> m^e mod n -> 256 hex
export function rsaNoPadding(str) {
  const bytes = Buffer.from(str, 'latin1');
  const padded = Buffer.concat([Buffer.alloc(128 - bytes.length), bytes]);
  const m = BigInt('0x' + padded.toString('hex'));
  return modpow(m, RSA_EXPONENT, RSA_MODULUS).toString(16).padStart(256, '0');
}

function randomSecretKey() {
  let s = '';
  for (let i = 0; i < 16; i++) s += BASE62[Math.floor(Math.random() * 62)];
  return s;
}

// weapi: 二层 AES + RSA(反转 secretKey)
export function weapi(object) {
  const text = JSON.stringify(object);
  const secretKey = randomSecretKey();
  const params = aesEncrypt(aesEncrypt(text, PRESET_KEY), secretKey);
  const encSecKey = rsaNoPadding(secretKey.split('').reverse().join(''));
  return { params, encSecKey };
}

export function md5hex(buf) {
  return createHash('md5').update(buf).digest('hex');
}

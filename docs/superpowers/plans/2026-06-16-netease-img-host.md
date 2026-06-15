# 网易云图床 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Cloudflare Pages 部署一个无状态网易云图床：纯静态前端 + Pages Functions 代理网易云二维码登录与图片上传。

**Architecture:** `functions/api/**` 是按文件路由的 Pages Functions（Workers），用 `nodejs_compat` 引 `node:crypto` 做 weapi 加密、BigInt 做 RSA 无填充，纯代理不落存储；`public/**` 是原生 HTML/CSS/JS 前端，凭证存浏览器 `localStorage`。

**Tech Stack:** Cloudflare Pages + Pages Functions、`node:crypto`、BigInt、原生前端、`node:test`（仅单测纯逻辑）、`wrangler`（本地预览）。

**已验证事实（实现前已用官方 crypto-js/node-forge 交叉比对）：**
- node:crypto `aes-128-cbc` 输出与 crypto-js 字节一致。
- BigInt modpow（输入 latin1 字节、左补零到 128 字节、`m^e mod n`、256 hex）与 forge `encrypt(str,'NONE')` 完全一致。
- `Id2Url('109951169393089538') === 'yQ97Zt-RKSwOLzW9llEeqA=='`（raw-bytes MD5）。

---

## File Structure

```
functions/api/_lib/crypto.js    # weapi(), id2url(), md5() —— 纯逻辑，可单测
functions/api/_lib/netease.js   # parseCookie/cookieString/weapiRequest —— 代理封装
functions/api/qr/key.js         # POST /api/qr/key
functions/api/qr/create.js      # POST /api/qr/create
functions/api/qr/check.js       # POST /api/qr/check
functions/api/login/status.js   # POST /api/login/status
functions/api/upload.js         # POST /api/upload
public/index.html               # 结构
public/style.css                # 深色主题
public/app.js                   # 状态机/登录/上传/历史
public/qrcode.js                # 内置纯 JS 二维码渲染（无 CDN）
tests/crypto.test.mjs           # id2url + aes + rsa modpow 单测
package.json                    # type:module + test 脚本
wrangler.toml                   # nodejs_compat + compatibility_date
README.md
```

每个 `_lib` 文件用 ESM `export`，既被 Pages Functions 引用，也被 `node:test` 直接 import（无重复实现）。

---

## Task 1: 项目骨架

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Modify: `.gitignore`（已存在，追加）

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "netease-img-host",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "dev": "wrangler pages dev public"
  }
}
```

- [ ] **Step 2: 写 `wrangler.toml`**

```toml
name = "netease-img-host"
pages_build_output_dir = "public"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]
```

- [ ] **Step 3: 确认 `.gitignore` 含以下行（已有则跳过）**

```
images_clean.sql
node_modules/
.scratch/
.wrangler/
```

- [ ] **Step 4: 建空目录占位**

Run: `mkdir -p functions/api/_lib functions/api/qr functions/api/login public tests`
Expected: 无输出，目录创建成功

- [ ] **Step 5: Commit**

```bash
git add package.json wrangler.toml .gitignore
git commit -m "chore: 项目骨架与 CF Pages 配置"
```

---

## Task 2: crypto.js —— Id2Url（TDD）

**Files:**
- Create: `functions/api/_lib/crypto.js`
- Test: `tests/crypto.test.mjs`

- [ ] **Step 1: 写失败测试 `tests/crypto.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id2url } from '../functions/api/_lib/crypto.js';

test('id2url 匹配官方测试向量', () => {
  assert.equal(id2url('109951169393089538'), 'yQ97Zt-RKSwOLzW9llEeqA==');
});

test('id2url 对不同 docId 产出不同结果', () => {
  assert.notEqual(id2url('109951169393089538'), id2url('109951169393089539'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/crypto.test.mjs`
Expected: FAIL —— `Cannot find module ... crypto.js` 或 `id2url is not a function`

- [ ] **Step 3: 写最小实现 `functions/api/_lib/crypto.js`**

```js
import { createHash } from 'node:crypto';

const ID_XOR_KEY = '3go8&$8*3*3h0k(2)2';

// docId 逐字节与固定 key 循环异或 -> raw bytes -> MD5 -> url-safe base64
export function id2url(docId) {
  const raw = Buffer.alloc(docId.length);
  for (let i = 0; i < docId.length; i++) {
    raw[i] = docId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length);
  }
  return createHash('md5').update(raw).digest('base64')
    .replace(/\//g, '_').replace(/\+/g, '-');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/crypto.test.mjs`
Expected: PASS（2 项）

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/crypto.js tests/crypto.test.mjs
git commit -m "feat: Id2Url 算法及单测"
```

---

## Task 3: crypto.js —— AES-128-CBC（TDD）

**Files:**
- Modify: `functions/api/_lib/crypto.js`
- Test: `tests/crypto.test.mjs`

> AES-128-CBC 在固定 key/iv 下是确定性的，下方期望值由 node:crypto 预先算出并核对。

- [ ] **Step 1: 追加失败测试到 `tests/crypto.test.mjs`**

```js
import { aesEncrypt } from '../functions/api/_lib/crypto.js';

test('aesEncrypt 用 presetKey 加密 {"type":3} 输出确定 base64', () => {
  // 期望值 = node:crypto aes-128-cbc(key=0CoJUm6Qyw8W8jud, iv=0102030405060708) of '{"type":3}'
  assert.equal(
    aesEncrypt('{"type":3}', '0CoJUm6Qyw8W8jud'),
    'F/OOL6PcB8XyxLo4ey75ww=='
  );
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/crypto.test.mjs`
Expected: FAIL —— `aesEncrypt is not a function`

- [ ] **Step 3: 追加实现到 `functions/api/_lib/crypto.js`**

```js
import { createCipheriv } from 'node:crypto';

const IV = Buffer.from('0102030405060708', 'utf8');

// AES-128-CBC, PKCS7(node 默认), 输出 base64
export function aesEncrypt(text, key) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), IV);
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()])
    .toString('base64');
}
```

将 `import { createHash } from 'node:crypto';` 合并为 `import { createHash, createCipheriv } from 'node:crypto';`。

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/crypto.test.mjs`
Expected: PASS（3 项）。若期望值不符，先运行 `node -e "import('node:crypto').then(c=>{const ci=c.createCipheriv('aes-128-cbc',Buffer.from('0CoJUm6Qyw8W8jud'),Buffer.from('0102030405060708'));console.log(Buffer.concat([ci.update('{\"type\":3}'),ci.final()]).toString('base64'))})"` 取真值替换测试中的期望串后再跑。

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/crypto.js tests/crypto.test.mjs
git commit -m "feat: AES-128-CBC 加密及单测"
```

---

## Task 4: crypto.js —— RSA 无填充 modpow（TDD）

**Files:**
- Modify: `functions/api/_lib/crypto.js`
- Test: `tests/crypto.test.mjs`

> 用小素数 RSA 参数验证 modpow 与左补零逻辑（非循环验证）；再断言真实公钥输出为 256 hex。

- [ ] **Step 1: 追加失败测试到 `tests/crypto.test.mjs`**

```js
import { modpow, rsaNoPadding } from '../functions/api/_lib/crypto.js';

test('modpow 正确：4^13 mod 497 = 445', () => {
  assert.equal(modpow(4n, 13n, 497n), 445n);
});

test('rsaNoPadding 用真实公钥输出 256 位 hex', () => {
  const out = rsaNoPadding('aB3xYz9kLm2nPq5w');
  assert.match(out, /^[0-9a-f]{256}$/);
});

test('rsaNoPadding 对同一输入稳定', () => {
  assert.equal(rsaNoPadding('abcdefghijklmnop'), rsaNoPadding('abcdefghijklmnop'));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/crypto.test.mjs`
Expected: FAIL —— `modpow is not a function`

- [ ] **Step 3: 追加实现到 `functions/api/_lib/crypto.js`**

```js
// 网易云固定公钥（1024-bit）
const RSA_MODULUS = BigInt('0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7');
const RSA_EXPONENT = 0x10001n;

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
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/crypto.test.mjs`
Expected: PASS（6 项）

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/crypto.js tests/crypto.test.mjs
git commit -m "feat: RSA 无填充 modpow 及单测"
```

---

## Task 5: crypto.js —— weapi + md5 组装（TDD）

**Files:**
- Modify: `functions/api/_lib/crypto.js`
- Test: `tests/crypto.test.mjs`

- [ ] **Step 1: 追加失败测试到 `tests/crypto.test.mjs`**

```js
import { weapi, md5hex } from '../functions/api/_lib/crypto.js';

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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/crypto.test.mjs`
Expected: FAIL —— `weapi is not a function`

- [ ] **Step 3: 追加实现到 `functions/api/_lib/crypto.js`**

```js
const PRESET_KEY = '0CoJUm6Qyw8W8jud';
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test`
Expected: PASS（9 项全绿）

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/crypto.js tests/crypto.test.mjs
git commit -m "feat: weapi 加密组装与 md5"
```

---

## Task 6: netease.js —— cookie 工具（TDD）

**Files:**
- Create: `functions/api/_lib/netease.js`
- Test: `tests/netease.test.mjs`

- [ ] **Step 1: 写失败测试 `tests/netease.test.mjs`**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/netease.test.mjs`
Expected: FAIL —— 模块或函数未定义

- [ ] **Step 3: 写实现 `functions/api/_lib/netease.js`（仅 cookie 部分）**

```js
import { weapi } from './crypto.js';

const DOMAIN = 'https://music.163.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';

export function parseCookie(str) {
  const out = {};
  if (!str) return out;
  for (const part of str.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookieString(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('; ');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test tests/netease.test.mjs`
Expected: PASS（3 项）

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/netease.js tests/netease.test.mjs
git commit -m "feat: cookie 解析与序列化工具"
```

---

## Task 7: netease.js —— weapiRequest 代理封装

**Files:**
- Modify: `functions/api/_lib/netease.js`

> 该函数发真实网络请求，不做单测；正确性在端到端手动验证。代码完整给出。

- [ ] **Step 1: 追加实现到 `functions/api/_lib/netease.js`**

```js
// 向网易云 weapi 端点发请求。
// path 形如 'login/qrcode/unikey'；cookieStr 为前端传来的 cookie 字符串。
// 返回 { body, setCookies }：body 为 JSON，setCookies 为去掉 Domain 的 Set-Cookie 数组。
export async function weapiRequest(path, data, cookieStr) {
  const cookie = parseCookie(cookieStr);
  const payload = { ...data, csrf_token: cookie.__csrf || '' };
  const enc = weapi(payload);

  const resp = await fetch(`${DOMAIN}/weapi/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': DOMAIN,
      'User-Agent': UA,
      'Cookie': cookieStr || '',
    },
    body: new URLSearchParams({ params: enc.params, encSecKey: enc.encSecKey }).toString(),
  });

  // CF Workers: 用 getSetCookie() 取多个 Set-Cookie
  const rawCookies = typeof resp.headers.getSetCookie === 'function'
    ? resp.headers.getSetCookie()
    : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')] : []);
  const setCookies = rawCookies.map((x) => x.replace(/\s*Domain=[^;]+;?/i, ''));

  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { code: resp.status, raw: text }; }
  return { body, setCookies };
}

export { DOMAIN, UA };
```

- [ ] **Step 2: 运行全部单测确认无回归**

Run: `node --test`
Expected: PASS（已有 12 项不受影响）

- [ ] **Step 3: Commit**

```bash
git add functions/api/_lib/netease.js
git commit -m "feat: weapiRequest 网易云代理封装"
```

---

## Task 8: 统一响应工具 + qr/key + login/status

**Files:**
- Create: `functions/api/_lib/respond.js`
- Create: `functions/api/qr/key.js`
- Create: `functions/api/login/status.js`

- [ ] **Step 1: 写 `functions/api/_lib/respond.js`**

```js
// 统一 JSON 响应
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 安全读取请求 JSON 体
export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
```

- [ ] **Step 2: 写 `functions/api/qr/key.js`**

```js
import { weapiRequest } from '../_lib/netease.js';
import { json, readJson } from '../_lib/respond.js';

export async function onRequestPost({ request }) {
  const { cookie } = await readJson(request);
  const { body } = await weapiRequest('login/qrcode/unikey', { type: 3 }, cookie || '');
  if (body.code !== 200 || !body.unikey) {
    return json({ code: body.code || 500, msg: '获取 unikey 失败' }, 200);
  }
  return json({ code: 200, data: { unikey: body.unikey } });
}
```

- [ ] **Step 3: 写 `functions/api/login/status.js`**

```js
import { weapiRequest } from '../_lib/netease.js';
import { json, readJson } from '../_lib/respond.js';

export async function onRequestPost({ request }) {
  const { cookie } = await readJson(request);
  if (!cookie) return json({ code: 401, msg: '未登录' });
  const { body } = await weapiRequest('w/nuser/account/get', {}, cookie);
  const profile = body.profile;
  if (body.code !== 200 || !profile) {
    return json({ code: 401, msg: '凭证失效' });
  }
  return json({ code: 200, data: { nickname: profile.nickname, avatarUrl: profile.avatarUrl, userId: profile.userId } });
}
```

- [ ] **Step 4: 全量单测无回归**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add functions/api/_lib/respond.js functions/api/qr/key.js functions/api/login/status.js
git commit -m "feat: 响应工具 + qr/key + login/status 接口"
```

---

## Task 9: qr/create + qr/check

**Files:**
- Create: `functions/api/qr/create.js`
- Create: `functions/api/qr/check.js`

- [ ] **Step 1: 写 `functions/api/qr/create.js`**

```js
import { json, readJson } from '../_lib/respond.js';

// 仅拼 codekey URL，二维码图像由前端纯 JS 渲染
export async function onRequestPost({ request }) {
  const { key } = await readJson(request);
  if (!key) return json({ code: 400, msg: '缺少 key' });
  return json({ code: 200, data: { qrurl: `https://music.163.com/login?codekey=${key}` } });
}
```

- [ ] **Step 2: 写 `functions/api/qr/check.js`**

```js
import { weapiRequest, parseCookie } from '../_lib/netease.js';
import { json, readJson } from '../_lib/respond.js';

// 状态码：800 过期 / 801 等待 / 802 已扫待确认 / 803 授权成功
export async function onRequestPost({ request }) {
  const { key } = await readJson(request);
  if (!key) return json({ code: 400, msg: '缺少 key' });

  const { body, setCookies } = await weapiRequest('login/qrcode/client/login', { key, type: 3 }, '');
  const code = Number(body.code);

  if (code === 803) {
    // 合并所有 Set-Cookie 的 name=value 段，提取 MUSIC_U/__csrf 等
    const merged = {};
    for (const sc of setCookies) {
      const first = sc.split(';')[0];
      Object.assign(merged, parseCookie(first));
    }
    const cookieStr = Object.entries(merged)
      .filter(([k]) => ['MUSIC_U', '__csrf', '__remember_me', 'NMTID'].includes(k))
      .map(([k, v]) => `${k}=${v}`).join('; ');
    return json({ code: 803, data: { cookie: cookieStr }, msg: body.message || '授权成功' });
  }

  return json({ code, msg: body.message || body.nickname || '' });
}
```

- [ ] **Step 3: 全量单测无回归**

Run: `node --test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add functions/api/qr/create.js functions/api/qr/check.js
git commit -m "feat: qr/create + qr/check 接口"
```

---

## Task 10: upload 接口

**Files:**
- Create: `functions/api/upload.js`

> 接收前端 `multipart/form-data`：字段 `file`（二进制）、`cookie`（字符串）、`filename`。完整三步：token/alloc → 上传 → 拼 URL。

- [ ] **Step 1: 写 `functions/api/upload.js`**

```js
import { weapiRequest } from './_lib/netease.js';
import { id2url } from './_lib/crypto.js';
import { json } from './_lib/respond.js';

export async function onRequestPost({ request }) {
  const form = await request.formData();
  const file = form.get('file');
  const cookie = form.get('cookie');
  const filename = form.get('filename') || 'image.jpg';
  if (!file || typeof file === 'string') return json({ code: 400, msg: '缺少文件' });
  if (!cookie) return json({ code: 401, msg: '未登录' });

  // a. 申请 nos token
  const allocData = {
    bucket: 'yyimgs',
    ext: 'jpg',
    filename,
    local: false,
    nos_product: 0,
    return_body: '{"code":200,"size":"$(ObjectSize)"}',
    type: 'other',
  };
  const { body: alloc } = await weapiRequest('nos/token/alloc', allocData, cookie);
  const result = alloc.result;
  if (alloc.code !== 200 || !result || !result.token || !result.objectKey) {
    return json({ code: alloc.code || 401, msg: 'token 申请失败（可能凭证失效）' });
  }
  const { objectKey, token, docId } = result;

  // b. 上传二进制到 nos
  const bytes = await file.arrayBuffer();
  const upResp = await fetch(
    `https://nosup-hz1.127.net/yyimgs/${objectKey}?offset=0&complete=true&version=1.0`,
    { method: 'POST', headers: { 'x-nos-token': token, 'Content-Type': 'image/jpeg' }, body: bytes },
  );
  if (!upResp.ok) {
    return json({ code: 502, msg: `上传失败 HTTP ${upResp.status}` });
  }

  // c. 拼最终 URL（objectKey 为准；Id2Url 交叉校验仅记日志）
  if (docId && !objectKey.startsWith(id2url(String(docId)))) {
    console.log('[upload] Id2Url 与 objectKey 前缀不一致', docId, objectKey);
  }
  const p = 1 + Math.floor(Math.random() * 4);
  const url = `https://p${p}.music.126.net/${objectKey}.jpg`;
  return json({ code: 200, data: { url, picId: String(docId || objectKey) } });
}
```

- [ ] **Step 2: 全量单测无回归**

Run: `node --test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add functions/api/upload.js
git commit -m "feat: 图片上传三步代理接口"
```

---

## Task 11: 后端本地预览冒烟（手动验证）

**Files:** 无（验证步骤）

- [ ] **Step 1: 安装 wrangler 并启动本地预览**

Run: `npx wrangler pages dev public --compatibility-flags=nodejs_compat`
Expected: 输出本地地址（如 `http://localhost:8788`）

- [ ] **Step 2: 验证 qr/key 接口返回 unikey**

Run（另开终端）: `curl -s -X POST http://localhost:8788/api/qr/key -H "Content-Type: application/json" -d "{}"`
Expected: `{"code":200,"data":{"unikey":"..."}}`（拿到真实 unikey 即证明 weapi 加密与代理链路打通）

- [ ] **Step 3: 验证 qr/create 拼 URL**

Run: `curl -s -X POST http://localhost:8788/api/qr/create -H "Content-Type: application/json" -d "{\"key\":\"testkey\"}"`
Expected: `{"code":200,"data":{"qrurl":"https://music.163.com/login?codekey=testkey"}}`

- [ ] **Step 4: 记录结果**

若 qr/key 返回非 200，检查 `nodejs_compat` 是否生效、weapi 输出是否正确。通过后继续前端任务。无需 commit。

---

## Task 12: 前端骨架 index.html + 深色 style.css

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`

- [ ] **Step 1: 写 `public/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>网易云图床</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="topbar">
    <h1>网易云图床</h1>
    <div id="user-area"></div>
  </header>

  <main>
    <section id="login-view" hidden>
      <div class="qr-card">
        <p class="qr-tip">用网易云音乐 App 扫码登录</p>
        <div id="qr-canvas-wrap"><canvas id="qr-canvas"></canvas></div>
        <p id="qr-status" class="qr-status">加载中…</p>
        <button id="qr-refresh" class="btn-ghost" hidden>刷新二维码</button>
      </div>
    </section>

    <section id="app-view" hidden>
      <div id="dropzone" class="dropzone">
        <p>拖拽 / 点击选择 / Ctrl+V 粘贴图片</p>
        <input type="file" id="file-input" accept="image/*" multiple hidden>
      </div>
      <ul id="upload-list" class="upload-list"></ul>

      <h2 class="section-title">历史记录</h2>
      <div class="format-switch">
        <label>复制格式：</label>
        <select id="format-select">
          <option value="url">直链</option>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="thumb">缩略图 200y200</option>
        </select>
      </div>
      <div id="history-grid" class="history-grid"></div>
    </section>
  </main>

  <script src="qrcode.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 `public/style.css`（深色主题）**

```css
:root {
  --bg: #14161a; --surface: #1d2026; --surface-2: #262a32;
  --text: #e6e8eb; --muted: #9aa0a8; --accent: #c20c0c; --border: #2e333c;
  --radius: 10px;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
}
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; border-bottom: 1px solid var(--border); background: var(--surface);
}
.topbar h1 { font-size: 18px; margin: 0; }
main { max-width: 900px; margin: 0 auto; padding: 24px; }
.btn-ghost, button {
  cursor: pointer; border: 1px solid var(--border); background: var(--surface-2);
  color: var(--text); border-radius: 8px; padding: 6px 12px; font-size: 14px;
}
button:hover { border-color: var(--accent); }

/* 登录 */
.qr-card {
  margin: 48px auto; max-width: 320px; text-align: center;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 28px;
}
#qr-canvas-wrap { background: #fff; display: inline-block; padding: 12px; border-radius: 8px; }
.qr-tip { color: var(--muted); }
.qr-status { margin-top: 14px; font-size: 14px; }

/* 用户区 */
#user-area { display: flex; align-items: center; gap: 10px; }
#user-area img { width: 32px; height: 32px; border-radius: 50%; }

/* 上传区 */
.dropzone {
  border: 2px dashed var(--border); border-radius: var(--radius);
  padding: 48px; text-align: center; color: var(--muted); cursor: pointer;
  transition: border-color .15s;
}
.dropzone.dragover { border-color: var(--accent); color: var(--text); }
.upload-list { list-style: none; padding: 0; margin: 20px 0; }
.upload-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; margin-bottom: 8px;
}
.upload-item .name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.progress { width: 120px; height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.progress > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }

/* 历史瀑布流 */
.section-title { font-size: 16px; margin-top: 32px; }
.format-switch { margin: 10px 0; color: var(--muted); }
.format-switch select { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; }
.history-grid { column-count: 4; column-gap: 12px; }
@media (max-width: 700px) { .history-grid { column-count: 2; } }
.history-card {
  break-inside: avoid; margin-bottom: 12px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden; position: relative;
}
.history-card img { width: 100%; display: block; }
.history-card .actions {
  display: flex; gap: 6px; padding: 8px; opacity: 0; transition: opacity .15s;
  position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,.6);
}
.history-card:hover .actions { opacity: 1; }
.history-card .actions button { flex: 1; font-size: 12px; padding: 4px; }
.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: var(--surface-2); border: 1px solid var(--border);
  padding: 10px 18px; border-radius: 8px; opacity: 0; transition: opacity .2s; pointer-events: none;
}
.toast.show { opacity: 1; }
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: 前端骨架与深色主题样式"
```

---

## Task 13: 内置二维码生成 qrcode.js

**Files:**
- Create: `public/qrcode.js`

> 使用成熟的轻量 QR 实现（davidshimjs/qrcodejs 的单文件版，MIT），暴露全局 `QRCode`。该库纯 JS、无依赖、无网络。

- [ ] **Step 1: 写 `public/qrcode.js`**

将 `qrcodejs`（MIT，单文件 `qrcode.min.js`，约 19KB）的完整内容粘贴到此文件，文件头加注释：

```js
/*! qrcodejs by davidshimjs — MIT License. Vendored, no CDN. */
```

实现工作者需从 `https://github.com/davidshimjs/qrcodejs/blob/master/qrcode.min.js` 取得原文件内容粘贴（不引 CDN、不加依赖）。该库用法：`new QRCode(element, { text, width, height, correctLevel: QRCode.CorrectLevel.M })`，会在 element 内渲染 canvas/img。前端将用其 canvas 模式。

- [ ] **Step 2: 本地验证库可用**

在 `wrangler pages dev` 下打开页面，临时在 console 执行：
```js
new QRCode(document.getElementById('qr-canvas-wrap'), { text: 'https://example.com', width: 220, height: 220 });
```
Expected: 出现二维码图像

- [ ] **Step 3: Commit**

```bash
git add public/qrcode.js
git commit -m "feat: 内置 qrcodejs 二维码库（MIT，无 CDN）"
```

---

## Task 14: 前端 app.js —— API 封装 + 登录状态机

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: 写 `public/app.js` 第一部分（工具 + API + 登录）**

```js
'use strict';

// ---------- 本地存储 ----------
const LS_COOKIE = 'ncm_cookie';
const LS_HISTORY = 'ncm_history';
const getCookie = () => localStorage.getItem(LS_COOKIE) || '';
const setCookie = (c) => localStorage.setItem(LS_COOKIE, c);
const clearCookie = () => localStorage.removeItem(LS_COOKIE);
const getHistory = () => { try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; } };
const setHistory = (h) => localStorage.setItem(LS_HISTORY, JSON.stringify(h));

// ---------- API ----------
async function api(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return res.json();
}

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const loginView = $('#login-view');
const appView = $('#app-view');
const userArea = $('#user-area');
const qrStatus = $('#qr-status');
const qrRefresh = $('#qr-refresh');

let pollTimer = null;

function toast(msg) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------- 视图切换 ----------
function showLogin() {
  appView.hidden = true; loginView.hidden = false; userArea.innerHTML = '';
  startQrLogin();
}
function showApp(profile) {
  loginView.hidden = true; appView.hidden = false;
  stopPoll();
  userArea.innerHTML = `<img src="${profile.avatarUrl}" alt=""><span>${profile.nickname}</span><button id="logout">退出</button>`;
  $('#logout').onclick = () => { clearCookie(); showLogin(); };
  renderHistory();
}

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

// ---------- 二维码登录 ----------
async function startQrLogin() {
  stopPoll();
  qrStatus.textContent = '加载中…';
  qrRefresh.hidden = true;
  const keyRes = await api('/api/qr/key', { cookie: getCookie() });
  if (keyRes.code !== 200) { qrStatus.textContent = '获取二维码失败'; qrRefresh.hidden = false; return; }
  const unikey = keyRes.data.unikey;
  const createRes = await api('/api/qr/create', { key: unikey });
  const qrurl = createRes.data.qrurl;

  const wrap = $('#qr-canvas-wrap');
  wrap.innerHTML = '';
  new QRCode(wrap, { text: qrurl, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  qrStatus.textContent = '等待扫码…';

  pollTimer = setInterval(async () => {
    const r = await api('/api/qr/check', { key: unikey });
    if (r.code === 802) { qrStatus.textContent = '已扫码，请在手机确认'; }
    else if (r.code === 803) {
      stopPoll();
      setCookie(r.data.cookie);
      qrStatus.textContent = '登录成功';
      await boot();
    } else if (r.code === 800) {
      stopPoll();
      qrStatus.textContent = '二维码已过期';
      qrRefresh.hidden = false;
    }
  }, 2500);
}
qrRefresh.onclick = startQrLogin;

// ---------- 启动 ----------
async function boot() {
  const cookie = getCookie();
  if (cookie) {
    const st = await api('/api/login/status', { cookie });
    if (st.code === 200) { showApp(st.data); return; }
    clearCookie();
  }
  showLogin();
}
boot();
```

- [ ] **Step 2: 本地验证登录流程**

`wrangler pages dev` 打开页面：未登录显示二维码；用网易云 App 扫码 → 确认 → 页面切到已登录态显示昵称头像。
Expected: 扫码后成功登录（端到端验证 weapi/qr/check/803 提取 cookie/login status 全链路）

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: 前端登录状态机与二维码轮询"
```

---

## Task 15: 前端 app.js —— 上传（拖拽/点击/粘贴 + 并发 + 进度 + SHA-256 去重）

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 追加上传逻辑到 `public/app.js`**

```js
// ---------- 去重哈希 ----------
async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 上传单文件（XHR 取进度）----------
function uploadFile(file, onProgress) {
  return new Promise((resolve) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('filename', file.name);
    fd.append('cookie', getCookie());
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ code: 500, msg: '响应解析失败' }); } };
    xhr.onerror = () => resolve({ code: 502, msg: '网络错误' });
    xhr.send(fd);
  });
}

// ---------- 上传列表项 ----------
function addUploadItem(name) {
  const li = document.createElement('li');
  li.className = 'upload-item';
  li.innerHTML = `<span class="name">${name}</span><div class="progress"><i></i></div><span class="state">等待</span>`;
  $('#upload-list').appendChild(li);
  return {
    setProgress: (p) => { li.querySelector('i').style.width = `${Math.round(p * 100)}%`; },
    setState: (s) => { li.querySelector('.state').textContent = s; },
    remove: () => setTimeout(() => li.remove(), 1500),
  };
}

// ---------- 处理一批文件（并发）----------
async function handleFiles(files) {
  const history = getHistory();
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  await Promise.all(imgs.map(async (file) => {
    const item = addUploadItem(file.name);
    const buf = await file.arrayBuffer();
    const hash = await sha256(buf);
    const dup = history.find((h) => h.hash === hash);
    if (dup) { item.setState('已存在'); item.setProgress(1); item.remove(); toast('图片已上传过，复用历史'); return; }

    item.setState('上传中');
    const res = await uploadFile(file, item.setProgress);
    if (res.code === 401) { item.setState('未登录'); clearCookie(); showLogin(); return; }
    if (res.code !== 200) { item.setState('失败'); toast(res.msg || '上传失败'); return; }

    item.setProgress(1); item.setState('完成'); item.remove();
    const record = { picId: res.data.picId, url: res.data.url, filename: file.name, size: file.size, time: Date.now(), hash };
    history.unshift(record); setHistory(history); renderHistory();
  }));
}

// ---------- 拖拽 / 点击 / 粘贴 ----------
const dropzone = $('#dropzone');
const fileInput = $('#file-input');
dropzone.onclick = () => fileInput.click();
fileInput.onchange = () => { handleFiles(fileInput.files); fileInput.value = ''; };
dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
dropzone.ondragleave = () => dropzone.classList.remove('dragover');
dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); };
window.addEventListener('paste', (e) => {
  const files = [...e.clipboardData.items].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
  if (files.length) handleFiles(files);
});
```

- [ ] **Step 2: 本地验证上传**

登录后拖一张图：出现进度条 → 完成 → 历史区出现缩略图。再拖同一张：提示"已存在"。
Expected: 上传成功且去重生效（端到端验证 upload 三步与最终 URL 可访问）

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: 多文件并发上传、进度条与 SHA-256 去重"
```

---

## Task 16: 前端 app.js —— 历史瀑布流 + 复制/格式/删除

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 追加历史渲染到 `public/app.js`**

```js
// ---------- 格式化复制文本 ----------
function formatLink(record, fmt) {
  const { url, filename } = record;
  switch (fmt) {
    case 'markdown': return `![${filename}](${url})`;
    case 'html': return `<img src="${url}" alt="${filename}">`;
    case 'thumb': return `${url}?param=200y200`;
    default: return url;
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); }
  catch { toast('复制失败'); }
}

// ---------- 渲染历史 ----------
function renderHistory() {
  const grid = $('#history-grid');
  const fmt = $('#format-select').value;
  const history = getHistory();
  grid.innerHTML = '';
  for (const r of history) {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <img src="${r.url}?param=300y0" alt="${r.filename}" loading="lazy">
      <div class="actions">
        <button class="copy">复制</button>
        <button class="del">删除</button>
      </div>`;
    card.querySelector('.copy').onclick = () => copyText(formatLink(r, $('#format-select').value));
    card.querySelector('.del').onclick = () => {
      setHistory(getHistory().filter((x) => x.picId !== r.picId));
      renderHistory();
    };
    grid.appendChild(card);
  }
}
$('#format-select').onchange = renderHistory;
```

- [ ] **Step 2: 本地验证历史区**

切换复制格式后点"复制"，粘贴到文本编辑器核对各格式；点"删除"该卡片消失且刷新后不再出现。
Expected: 直链/Markdown/HTML/缩略图四种格式正确；删除持久化

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: 历史瀑布流、多格式复制与删除"
```

---

## Task 17: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 `README.md`**

````markdown
# 网易云图床

基于 Cloudflare Pages + Pages Functions 的无状态网易云图床。纯静态前端 + 同源 API 代理，**不存储任何用户凭证**。

## 部署

1. Fork 本仓库到你的 GitHub。
2. Cloudflare Dashboard → Workers & Pages → 创建 → Pages → 连接到 Git，选择该仓库。
3. 构建设置：
   - 构建命令：**留空**
   - 构建输出目录：`public`
4. 设置 → 函数 / 兼容性：
   - 兼容性标志（Compatibility flags）添加：`nodejs_compat`
   - 兼容性日期（Compatibility date）：设为较新日期（如 `2024-11-01`）
   > 也可由仓库内 `wrangler.toml` 自动带入。
5. 保存并部署。访问分配的 `*.pages.dev` 域名。

## 本地开发

```bash
npm install -g wrangler   # 或 npx
npm run dev               # = wrangler pages dev public
npm test                  # 运行加密/工具单测
```

## 使用

1. 用网易云音乐 App 扫码登录。
2. 拖拽 / 点击 / `Ctrl+V` 粘贴图片上传，支持多文件并发。
3. 历史区按需切换 直链 / Markdown / HTML / 缩略图(`?param=200y200`) 复制。

## 安全说明

- **代理零存储**：Pages Functions 不写 cookie、不写数据库，凭证仅在请求体中转发。
- **凭证存放在浏览器 `localStorage`**：你的网易云 cookie（含 `MUSIC_U`）保存在浏览器本地。
- **XSS 风险提示**：若站点被注入恶意脚本，`localStorage` 中的 cookie 可能被窃取，进而冒用你的网易云账号。**建议仅自用部署，不要在本站引入任何不可信的第三方脚本/统计代码。**
- 退出登录会清除本地凭证。

## 致谢

- 接口与加密逻辑参考 [NeteaseCloudMusicApi](https://www.npmjs.com/package/NeteaseCloudMusicApi)（已下架，本项目仅精简重实现所需的 weapi 代理逻辑）。
- 二维码渲染使用 [qrcodejs](https://github.com/davidshimjs/qrcodejs)（MIT）。
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README 部署、使用与安全说明"
```

---

## Task 18: 收尾验证清单（手动）

**Files:** 无

- [ ] **Step 1: 全量单测**

Run: `node --test`
Expected: 全绿（crypto + netease 共约 15 项）

- [ ] **Step 2: 本地端到端**

`npm run dev` 后逐项核对：
- [ ] 未登录显示二维码，扫码登录成功
- [ ] 拖拽 / 点击 / 粘贴 三种方式均能上传
- [ ] 多文件并发各自独立进度条
- [ ] 上传成功后图片 URL 可在浏览器直接打开（确认 `objectKey + .jpg` 格式正确；若打不开，按真实响应调整 `upload.js` 第 c 步 URL 拼法）
- [ ] 同图二次上传提示"已存在"
- [ ] 四种复制格式正确
- [ ] 历史删除持久化
- [ ] 退出后回到二维码登录

- [ ] **Step 3: 部署冒烟**

推送到 GitHub，CF Pages 自动构建后访问 `*.pages.dev`，重复 Step 2 关键项。

- [ ] **Step 4: 记录未决项**

若 Step 2 第 4 点 URL 格式需调整，更新 `upload.js` 与设计文档"未验证项"，提交：
```bash
git add functions/api/upload.js docs/
git commit -m "fix: 修正上传 URL 拼接以匹配真实响应"
```

# 网易云图床设计文档

日期：2026-06-16
状态：已确认，待实现

## 1. 目标与约束

在 Cloudflare Pages 免费托管一个网易云图床：纯静态前端 + Pages Functions（本质 Workers）做**同源、无状态**的 API 代理。

- 网易云 `music.163.com` / `nosup-hz1.127.net` 接口不返回 CORS 头，浏览器无法直连，必须代理。
- Pages Functions 与前端同源，前端 `fetch('/api/xxx')` 不跨域。
- 代理**完全无状态**：不存 cookie、不写数据库。用户凭证只存在浏览器 `localStorage`，请求时在 body 中来回传递。
- 单 Git 仓库，推送 GitHub 后由 CF Pages 自动构建部署。
- 不搬运整个 NeteaseCloudMusicApi（Express 长驻服务，不适合 Workers），只精简实现下述接口。

## 2. 关键决策（已与用户确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 加密实现 | `nodejs_compat` + `node:crypto`（MD5/AES）+ 纯 BigInt（RSA 无填充） | 最省事可靠；项目本就需开 `nodejs_compat`。Web Crypto 不支持 MD5 与 raw RSA |
| 上传目标与 URL | 跟官方源码：POST 到 `nosup-hz1.127.net`，最终 URL 用 `token/alloc` 返回的 `objectKey` 直拼 | 实测源码做法，最可靠 |
| Id2Url | 仍实现并单测，作为 `objectKey` 的交叉校验 | 用户 spec 要求；测试向量已通过 |
| 前端去重哈希 | `SubtleCrypto` SHA-256 | 浏览器原生一行调用；去重是纯本地行为，网易云不感知，用任意稳定哈希均可 |
| 二维码生成 | 后端只返回 codekey URL，前端用内置纯 JS 二维码库本地渲染 | 避免在 Workers 引 npm `qrcode`；契合"无框架无 CDN" |

## 3. 源码核对结果（来自 NeteaseCloudMusicApi npm 4.32.0，逐文件确认，非凭记忆）

### 3.1 weapi 加密（`util/crypto.js`）
- 二层 AES-128-CBC：`key="0CoJUm6Qyw8W8jud"`，`iv="0102030405060708"`，Pkcs7 padding，输出 base64。
  - 第一层：`aesEncrypt(JSON.stringify(obj), presetKey, iv)`
  - 第二层：`aesEncrypt(第一层结果, secretKey, iv)` → `params`
- `secretKey`：16 位随机字符（base62 字符集 `a-zA-Z0-9`）。
- `encSecKey`：`secretKey` **逐字符反转**后做 RSA **无填充**加密（`forge.encrypt(str,'NONE')`），输出 hex。
  - 公钥 modulus（1024-bit）：
    `00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7`
  - 指数 e = `010001`（65537）。
  - 实现：`reversedSecretKey` 按字节转 BigInt（左补零到 128 字节），`m^e mod n`，结果转 256 位 hex（不足左补零）。

### 3.2 接口真实路由
所有走 `https://music.163.com/weapi/<path>`（`<path>` = 去掉前缀 `/api/` 的部分），POST，body 为 `application/x-www-form-urlencoded` 的 `params=...&encSecKey=...`。

| 我方路由 | 上游 weapi path | 请求体 data |
|---|---|---|
| `/api/qr/key` | `login/qrcode/unikey` | `{ type: 3 }` |
| `/api/qr/create` | （无网络） | 仅返回 `https://music.163.com/login?codekey={key}` |
| `/api/qr/check` | `login/qrcode/client/login` | `{ key, type: 3 }` |
| `/api/login/status` | `w/nuser/account/get` | `{}` |
| `/api/upload`(step a) | `nos/token/alloc` | 见 3.4 |

请求头（weapi）：`Referer: https://music.163.com`、`User-Agent`（桌面端 Edge UA）、`Cookie`（含 `__csrf`，并把 `csrf_token` 加入 data）。

### 3.3 二维码状态码（`qr/check`）
- 800：二维码过期/不存在 → 前端重新生成
- 801：等待扫码
- 802：已扫码待确认
- 803：授权成功 → 响应 `Set-Cookie` 含 `MUSIC_U`、`__csrf` 等，提取后回传前端存 `localStorage`

### 3.4 上传流程（`plugins/upload.js`）
```
a. weapi POST nos/token/alloc
   data = { bucket:'yyimgs', ext:'jpg', filename, local:false,
            nos_product:0,
            return_body:'{"code":200,"size":"$(ObjectSize)"}', type:'other' }
   → result.{ objectKey, token, docId }
b. POST https://nosup-hz1.127.net/yyimgs/{objectKey}?offset=0&complete=true&version=1.0
   headers: { 'x-nos-token': token, 'Content-Type': 'image/jpeg' }
   body: 图片二进制
c. 最终 URL = https://p{随机1-4}.music.126.net/{objectKey}.jpg
   防御断言: Id2Url(docId) 应为 objectKey 的前缀，不一致仅记日志，仍以 objectKey 为准
```

### 3.5 Id2Url 算法（`module/register_anonimous.js` 的 `cloudmusic_dll_encode_id`）
- `docId` 每字节与固定 key `"3go8&$8*3*3h0k(2)2"` 循环异或。
- 对 raw bytes 做 MD5，base64，再 `'/'→'_'`、`'+'→'-'`（url-safe）。
- **测试向量（已跑通）**：`Id2Url('109951169393089538') === 'yQ97Zt-RKSwOLzW9llEeqA=='`。
- 注：`docId` 恒为数字串，异或后字节均 ≤ 0x7F，故 raw-bytes 与源码的 UTF-8 parse 结果一致；本项目用 raw-bytes 实现。

## 4. 目录结构

```
project-root/
├── functions/api/
│   ├── _lib/
│   │   ├── crypto.js      # weapi、Id2Url、md5
│   │   └── netease.js     # weapiRequest、cookie 解析、UA/Referer 封装
│   ├── qr/key.js          # POST /api/qr/key
│   ├── qr/create.js       # POST /api/qr/create
│   ├── qr/check.js        # POST /api/qr/check
│   ├── upload.js          # POST /api/upload
│   └── login/status.js    # POST /api/login/status
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── qrcode.js          # 内置纯 JS 二维码生成（无 CDN）
├── tests/
│   └── id2url.test.mjs    # node:test 单测
├── wrangler.toml          # nodejs_compat + 较新 compatibility_date
├── package.json           # 仅 test 脚本，无运行时依赖
├── .gitignore             # 忽略 images_clean.sql、node_modules
└── README.md
```

- CF Pages 用按文件路由的 Functions（`functions/api/qr/key.js` → `/api/qr/key`）。
- 纯静态前端无构建步骤：CF Pages 构建命令留空、输出目录 `public`。
- 目录内既存的 `images_clean.sql`（其他项目数据）加入 `.gitignore`，**不删除**。

## 5. 代理层接口契约

每个 Function 仅处理 POST，统一返回 JSON：`{ code, data?, msg? }`（`code=200` 成功）。

- `_lib/crypto.js`
  - `weapi(obj) → { params, encSecKey }`
  - `id2url(docId: string) → string`
  - `md5(buf) → Buffer`（node:crypto）
- `_lib/netease.js`
  - `weapiRequest(path, data, cookie) → { body, cookies }`：拼 `csrf_token`、构造 weapi、POST、解析 `Set-Cookie`（去掉 `Domain=`）。
  - `parseCookie(str) → { MUSIC_U, __csrf, ... }`、`cookieString(obj)`。

## 6. 前端设计（原生 HTML/CSS/JS，深色主题）

- **状态机**：
  - 未登录 → 拉 `qr/key` + `qr/create` 显示二维码，轮询 `qr/check`；800 过期自动重生。
  - 803 成功 → 存 cookie 到 `localStorage`，切换到已登录态。
  - 已登录 → `login/status` 拉头像+昵称，显示「头像 昵称 退出」。
- **上传**：拖拽、点击选择、`Ctrl+V` 粘贴；多文件并发，各自独立进度条（用 `XMLHttpRequest` 拿 `upload.onprogress`）。
- **去重**：上传前 `crypto.subtle.digest('SHA-256', …)`，与本地历史比对，命中则提示并复用已有结果。
- **结果区**：缩略图 + 一键复制；格式切换 直链 / Markdown / HTML / 缩略图（直链追加 `?param=200y200`）。
- **历史**：`localStorage` 存 `{picId,url,filename,size,time}`，瀑布流布局，可复制可删除单条。
- **失效处理**：任一接口判定未登录（如 status 非 200 / upload 鉴权失败）→ 清本地凭证，回二维码登录。

## 7. 测试与验证

- `node --test tests/id2url.test.mjs`：断言给定测试向量；额外覆盖空串、单字符边界。
- weapi 加密自检：本地生成一次 `{params, encSecKey}`，验证 `params` 可被 `0CoJUm6Qyw8W8jud` 逐层解密回原文，验证 RSA 输出为 256 hex。
- **端到端（登录+上传）需真实网易云账号扫码，无法自动化**，写成手动验证清单放入 README。

### 未验证项（诚实标注）
- `objectKey` 是否已含扩展名、最终是否需补 `.jpg`：只有真实登录上传一次才能 100% 确认。代码按 `objectKey + '.jpg'` 实现并加防御断言；联调时以真实响应为准修正。

## 8. README 要点

- 如何 fork、连接 CF Pages：构建命令留空、输出目录 `public`、开启 `nodejs_compat`、设置较新 `compatibility_date`。
- 声明：**本图床代理不存储任何用户凭证**。
- 安全提示：网易云 cookie 存浏览器 `localStorage` 存在 **XSS 风险**——建议仅自用、不要在站点引入不可信第三方脚本。

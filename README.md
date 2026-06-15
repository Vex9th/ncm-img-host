# 网易云图床

基于 Cloudflare Workers + 静态资源（Static Assets）的无状态网易云图床。纯静态前端 + 同源 API 代理，**不存储任何用户凭证**。

> 架构说明：`public/` 是静态前端，`src/index.js` 是 Worker 入口，按路径把 `/api/*` 分发到 `functions/api/**` 下的处理逻辑，其余请求交给静态资源。配置见 `wrangler.toml`（`main` + `[assets]` + `nodejs_compat`）。

## 部署（Cloudflare Workers Builds）

1. Fork 本仓库到你的 GitHub。
2. Cloudflare Dashboard → Workers & Pages → 创建 → **导入仓库（Import a repository）**，选择该仓库。
3. 部署命令保持默认：`npx wrangler deploy`（仓库内 `wrangler.toml` 已声明 `main`、`[assets]` 与 `nodejs_compat`，无需在面板额外配置输出目录）。
4. “路径”保持 `/`（仓库根目录）。
5. 保存并部署。访问分配的 `*.workers.dev` 域名。

> 若你的账号仍提供独立的 **Pages → 连接到 Git** 流程，本项目也兼容：构建命令留空、构建输出目录 `public`、开启 `nodejs_compat`（此时按 Pages Functions 约定运行 `functions/` 目录，无需用到 `src/index.js`）。

## 本地开发

```bash
npm install -g wrangler   # 或 npx
npm run dev               # = wrangler dev（Worker + 静态资源）
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

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

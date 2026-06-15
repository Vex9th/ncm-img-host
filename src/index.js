// Workers 入口：复用 functions/ 下的 Pages Functions handler，
// 按路径分发 /api/*，其余交给静态资源（ASSETS binding）。
import { onRequestPost as qrKey } from '../functions/api/qr/key.js';
import { onRequestPost as qrCreate } from '../functions/api/qr/create.js';
import { onRequestPost as qrCheck } from '../functions/api/qr/check.js';
import { onRequestPost as loginStatus } from '../functions/api/login/status.js';
import { onRequestPost as upload } from '../functions/api/upload.js';

const routes = {
  '/api/qr/key': qrKey,
  '/api/qr/create': qrCreate,
  '/api/qr/check': qrCheck,
  '/api/login/status': loginStatus,
  '/api/upload': upload,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = routes[url.pathname];
    if (handler) {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
      // Pages Functions handler 仅使用 context.request，签名兼容
      return handler({ request });
    }
    // 非 API 路径：回退到静态资源（404 由 ASSETS 处理）
    return env.ASSETS.fetch(request);
  },
};

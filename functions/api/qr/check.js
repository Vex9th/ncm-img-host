import { weapiRequest, parseCookie } from '../_lib/netease.js';
import { json, readJson } from '../_lib/respond.js';

// 状态码：800 过期 / 801 等待 / 802 已扫待确认 / 803 授权成功
export async function onRequestPost({ request }) {
  const { key } = await readJson(request);
  if (!key) return json({ code: 400, msg: '缺少 key' });

  const { body, setCookies } = await weapiRequest('login/qrcode/client/login', { key, type: 3 }, '');
  const code = Number(body.code);

  if (code === 803) {
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

import { json, readJson } from '../_lib/respond.js';

// 仅拼 codekey URL，二维码图像由前端纯 JS 渲染
export async function onRequestPost({ request }) {
  const { key } = await readJson(request);
  if (!key) return json({ code: 400, msg: '缺少 key' });
  return json({ code: 200, data: { qrurl: `https://music.163.com/login?codekey=${key}` } });
}

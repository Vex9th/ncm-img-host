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

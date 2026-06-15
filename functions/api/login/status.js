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

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

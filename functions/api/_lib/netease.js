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

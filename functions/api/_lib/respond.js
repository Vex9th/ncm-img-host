// 统一 JSON 响应
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 安全读取请求 JSON 体
export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

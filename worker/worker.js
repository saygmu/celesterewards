/**
 * 喬喬集點屋 - Cloudflare Worker
 * 整包 state JSON 同步 (KV-based)
 *
 * Endpoints:
 *   GET  /state   (header X-Pin)             -> { state, updatedAt } or 404
 *   PUT  /state   (header X-Pin, body=state) -> { ok: true, updatedAt }
 *
 * 一個 PIN = 一個 KV key = 一個獨立帳號的整包資料。
 */

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      const pin = (request.headers.get('X-Pin') || '').trim();
      if (!/^\d{4,8}$/.test(pin)) return json({ error: 'pin required (4-8 digits)' }, 400, cors);

      const url = new URL(request.url);
      if (url.pathname !== '/state') return json({ error: 'not found' }, 404, cors);

      const key = `state:${pin}`;

      if (request.method === 'GET') {
        const raw = await env.STATE_KV.get(key);
        if (!raw) return json({ state: null, updatedAt: null }, 200, cors);
        return new Response(raw, { headers: { 'Content-Type': 'application/json', ...cors } });
      }

      if (request.method === 'PUT') {
        const body = await request.json();
        if (!body || typeof body !== 'object') return json({ error: 'invalid body' }, 400, cors);
        const payload = JSON.stringify({ state: body, updatedAt: Date.now() });
        await env.STATE_KV.put(key, payload);
        return json({ ok: true, updatedAt: Date.now() }, 200, cors);
      }

      return json({ error: 'method not allowed' }, 405, cors);
    } catch (e) {
      return json({ error: e.message }, 500, cors);
    }
  },
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

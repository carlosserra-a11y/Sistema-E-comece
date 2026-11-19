// Servidor FALSO do Mercado Livre para testes: OAuth (refresh de uso único), pedidos, anúncios, 401 e 429 sob comando.
import http from 'node:http';

export const APP_ID = '123456';
export const APP_SECRET = 'segredo-do-app-de-teste';
export const CODIGO = 'CODIGO-OK';

export async function criarMLFalso() {
  const est = {
    vendedor: '555000111', pedidos: new Map(), itens: new Map(), tokens: new Set(), refresh: new Set(), seq: 0,
    chamadas: [], atualizacoes: [], falhas429: 0, falhas500: 0, forcar401: 0, refreshes: 0,
  };
  const emitir = () => {
    est.seq++;
    const t = { access_token: `AT-${est.seq}`, refresh_token: `RT-${est.seq}`, expires_in: 21600, user_id: Number(est.vendedor), token_type: 'bearer' };
    est.tokens.add(t.access_token); est.refresh.add(t.refresh_token); return t;
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const corpo = await new Promise((r) => { const p = []; req.on('data', (c) => p.push(c)); req.on('end', () => r(Buffer.concat(p).toString())); });
    const json = (s, o, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    est.chamadas.push({ m: req.method, p: url.pathname + url.search, auth: req.headers.authorization ?? null });
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      const f = new URLSearchParams(corpo);
      if (f.get('client_id') !== APP_ID || f.get('client_secret') !== APP_SECRET) return json(400, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') return f.get('code') === CODIGO ? json(200, emitir()) : json(400, { error: 'invalid_grant' });
      if (f.get('grant_type') === 'refresh_token') {
        est.refreshes++;
        if (!est.refresh.delete(f.get('refresh_token'))) return json(400, { error: 'invalid_grant', message: 'refresh token inválido' });
        return json(200, emitir());
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (est.falhas429 > 0) { est.falhas429--; return json(429, { message: 'too many requests' }, { 'Retry-After': '1' }); }
    if (est.falhas500 > 0) { est.falhas500--; return json(503, { message: 'indisponível' }); }
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (est.forcar401 > 0 && bearer) { est.forcar401--; est.tokens.delete(bearer); }
    if (!bearer || !est.tokens.has(bearer)) return json(401, { message: 'invalid_token', error: 'unauthorized' });
    let m;
    if (url.pathname === '/orders/search') {
      const todos = [...est.pedidos.values()].filter((p) => String(p.seller.id) === url.searchParams.get('seller'));
      const off = Number(url.searchParams.get('offset') ?? 0); const lim = Number(url.searchParams.get('limit') ?? 50);
      return json(200, { results: todos.slice(off, off + lim), paging: { total: todos.length, offset: off, limit: lim } });
    }
    if ((m = /^\/orders\/(\d+)$/.exec(url.pathname))) return est.pedidos.has(m[1]) ? json(200, est.pedidos.get(m[1])) : json(404, { message: 'order not found', error: 'not_found' });
    if ((m = /^\/items\/(MLB\d+)$/.exec(url.pathname))) {
      const item = est.itens.get(m[1]); if (!item) return json(404, { message: 'item not found', error: 'not_found' });
      if (req.method === 'GET') return json(200, item);
      if (req.method === 'PUT') { const b = JSON.parse(corpo || '{}'); est.atualizacoes.push({ id: m[1], corpo: b }); Object.assign(item, b.available_quantity !== undefined ? { available_quantity: b.available_quantity } : {}, b.status ? { status: b.status } : {}); return json(200, item); }
    }
    json(404, { message: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, est,
    fechar: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
    item(id, extra = {}) { est.itens.set(id, { id, seller_id: Number(est.vendedor), title: `Anúncio ${id}`, available_quantity: 0, status: 'active', variations: [], ...extra }); return id; },
    pedido(id, { status = 'paid', itens = [], total, vendedor = est.vendedor, data = new Date().toISOString() } = {}) {
      const o = { id: Number(id), status, date_created: data, total_amount: total ?? itens.reduce((a, i) => a + (i.preco ?? 25) * i.qtd, 0), seller: { id: Number(vendedor) }, buyer: { id: 777, nickname: 'COMPRADOR_TESTE' },
        order_items: itens.map((i) => ({ item: { id: i.item, title: i.titulo ?? 'Produto de teste', seller_sku: i.sku, variation_id: i.variacao ?? null }, quantity: i.qtd, unit_price: i.preco ?? 25 })) };
      est.pedidos.set(String(id), o); return o;
    },
  };
}

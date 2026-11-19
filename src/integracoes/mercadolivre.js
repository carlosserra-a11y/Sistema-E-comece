// Adapter do Mercado Livre (API oficial). Só fala com os hosts de cfg.ml (fixos em produção): sem SSRF, sem redirecionamento.
export class ErroML extends Error {
  constructor(status, codigo, mensagem) { super(mensagem); this.status = status; this.codigo = codigo; }
}

export const ITEM_RE = /^MLB\d{5,20}$/;
export const ID_RE = /^\d{1,20}$/;
const CAMINHO_RE = /^\/[A-Za-z0-9_\-./?=&%:+,]*$/;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const atraso = (n) => 500 * 2 ** n + Math.floor(Math.random() * 250);

export function criarClienteML(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const esperar = (ms) => (cfg.ml.esperar ?? dormir)(ms);

  /** Requisição com recuo exponencial em 429/5xx/rede, respeitando Retry-After. Nunca coloca token em mensagem de erro. */
  async function req(metodo, caminho, { token, corpo, form, tentativas = 4 } = {}) {
    if (!CAMINHO_RE.test(caminho) || caminho.includes('..') || caminho.startsWith('//')) throw new ErroML(0, 'CAMINHO', 'Caminho inválido.');
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (corpo) headers['Content-Type'] = 'application/json';
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    for (let n = 0; ; n++) {
      let r;
      try {
        r = await fetchImpl(cfg.ml.apiBase + caminho, { method: metodo, headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
          body: corpo ? JSON.stringify(corpo) : form ? new URLSearchParams(form).toString() : undefined });
      } catch {
        if (n + 1 < tentativas) { await esperar(atraso(n)); continue; }
        throw new ErroML(0, 'REDE', 'Falha de rede ao falar com o Mercado Livre.');
      }
      if ((r.status === 429 || r.status >= 500) && n + 1 < tentativas) {
        const ra = Number(r.headers.get('retry-after'));
        await esperar(ra > 0 ? Math.min(ra * 1000, 30_000) : atraso(n));
        continue;
      }
      const texto = await r.text();
      let json = null; try { json = JSON.parse(texto); } catch { /* resposta sem JSON */ }
      if (r.ok) return json ?? {};
      throw new ErroML(r.status, String(json?.error ?? `HTTP_${r.status}`).slice(0, 60), String(json?.message ?? 'Erro do Mercado Livre.').slice(0, 200));
    }
  }

  return {
    req,
    urlAutorizacao: ({ appId, redirectUri, state }) => `${cfg.ml.authBase}/authorization?${new URLSearchParams({ response_type: 'code', client_id: appId, redirect_uri: redirectUri, state })}`,
    trocarCodigo: ({ appId, secret, code, redirectUri }) => req('POST', '/oauth/token', { tentativas: 1, form: { grant_type: 'authorization_code', client_id: appId, client_secret: secret, code, redirect_uri: redirectUri } }),
    renovar: ({ appId, secret, refreshToken }) => req('POST', '/oauth/token', { tentativas: 2, form: { grant_type: 'refresh_token', client_id: appId, client_secret: secret, refresh_token: refreshToken } }),
    me: (token) => req('GET', '/users/me', { token }),
    buscarPedido: (token, id) => { if (!ID_RE.test(String(id))) throw new ErroML(0, 'ID', 'Pedido inválido.'); return req('GET', `/orders/${id}`, { token }); },
    pesquisarPedidos: (token, { vendedor, desde, offset = 0, limit = 50 }) => {
      if (!ID_RE.test(String(vendedor))) throw new ErroML(0, 'ID', 'Vendedor inválido.');
      return req('GET', `/orders/search?${new URLSearchParams({ seller: String(vendedor), 'order.date_created.from': desde, sort: 'date_desc', offset: String(offset), limit: String(limit) })}`, { token });
    },
    buscarItem: (token, id) => { if (!ITEM_RE.test(String(id))) throw new ErroML(0, 'ID', 'Anúncio inválido.'); return req('GET', `/items/${id}`, { token }); },
    atualizarItem: (token, id, corpo) => { if (!ITEM_RE.test(String(id))) throw new ErroML(0, 'ID', 'Anúncio inválido.'); return req('PUT', `/items/${id}`, { token, corpo }); },
  };
}

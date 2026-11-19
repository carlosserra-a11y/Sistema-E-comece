import { tx } from '../db.js';
import { conflito, erro, invalido, naoEncontrado } from '../util.js';
import { B, I, T, ID, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { aleatorio, cifrar, decifrar, hmacHex, iguais, sha256 } from '../security/crypto.js';
import { ErroML, ID_RE, ITEM_RE, criarClienteML } from '../integracoes/mercadolivre.js';
import { disponivelDe, importarPedido } from './pedidos.js';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (e) => String(e?.message ?? e).slice(0, 200);

export async function registrarIntegracoes(app, { cfg, db, log }) {
  const { rota } = app;
  const ml = criarClienteML(cfg, { fetchImpl: (...a) => (app.fetchImpl ?? globalThis.fetch)(...a) });
  const emVoo = new Set();
  const travaToken = new Map();
  let filaPedidos = Promise.resolve(); let filaEstoque = Promise.resolve(); let timerEstoque = null;
  const sistema = (origem) => ({ agora: cfg.agora, user: null, ip: origem });

  await db.run("INSERT INTO contas_canal (canal_id, criado_em, atualizado_em) SELECT id, CAST(? AS BIGINT), CAST(? AS BIGINT) FROM canais WHERE codigo = 'ML' ON CONFLICT DO NOTHING", cfg.agora(), cfg.agora());
  const conta = async (dbx = db) => await dbx.get("SELECT c.* FROM contas_canal c JOIN canais k ON k.id = c.canal_id WHERE k.codigo = 'ML'");
  const origemPublica = () => cfg.publicOrigin || `http://${cfg.host}:${cfg.port}`;
  const segredoWebhook = (c) => hmacHex(cfg.hmacKey, `ml-webhook|${c.id}|${c.webhook_versao}`).slice(0, 40);
  const credenciais = (c) => (c.app_id_enc && c.app_secret_enc ? { appId: decifrar(cfg.fieldKey, c.app_id_enc), secret: decifrar(cfg.fieldKey, c.app_secret_enc) } : null);

  function agendar(fn) {
    const p = Promise.resolve().then(fn).catch((e) => log.warn('tarefa de integração falhou', { erro: msg(e) })).finally(() => emVoo.delete(p));
    emVoo.add(p); return p;
  }
  const drenar = async () => { for (let i = 0; i < 50 && (emVoo.size || timerEstoque); i++) { if (timerEstoque) { clearTimeout(timerEstoque); timerEstoque = null; agendar(() => sincronizarEstoque('EVENTO')); } await Promise.allSettled([...emVoo]); } await Promise.allSettled([filaPedidos, filaEstoque]); };

  const abrirJob = async (c, tipo, origem) => await db.insert('INSERT INTO jobs_sincronizacao (conta_id, tipo, origem, iniciado_em) VALUES (?,?,?,?)', c.id, tipo, origem, cfg.agora());
  const fecharJob = async (id, ok, itens = 0, e = null) => await db.run('UPDATE jobs_sincronizacao SET concluido_em = ?, ok = ?, itens = ?, erro = ? WHERE id = ?', cfg.agora(), ok ? 1 : 0, itens, e ? msg(e) : null, id);
  const falhou = async (c, e) => await db.run('UPDATE contas_canal SET falhas_seguidas = falhas_seguidas + 1, ultimo_erro = ?, ultimo_erro_em = ?, atualizado_em = ? WHERE id = ?', msg(e), cfg.agora(), cfg.agora(), c.id);
  const deuCerto = async (c, campo) => await db.run(`UPDATE contas_canal SET falhas_seguidas = 0, ultimo_erro = NULL, ${campo} = ?, atualizado_em = ? WHERE id = ?`, cfg.agora(), cfg.agora(), c.id);

  // ---------- token (o refresh token do ML é de uso único: renovação serializada) ----------
  async function renovar(origem = 'EVENTO') {
    if (travaToken.has('ml')) return travaToken.get('ml');
    const p = (async () => {
      const c = await conta(); const cred = credenciais(c);
      if (!cred || !c.refresh_token_enc) throw new ErroML(0, 'SEM_TOKEN', 'Conta do Mercado Livre não conectada.');
      const job = await abrirJob(c, 'TOKEN', origem);
      try {
        const t = await ml.renovar({ ...cred, refreshToken: decifrar(cfg.fieldKey, c.refresh_token_enc) });
        await db.run('UPDATE contas_canal SET access_token_enc = ?, refresh_token_enc = ?, token_expira_em = ?, status = ?, atualizado_em = ? WHERE id = ?', cifrar(cfg.fieldKey, t.access_token), cifrar(cfg.fieldKey, t.refresh_token ?? decifrar(cfg.fieldKey, c.refresh_token_enc)), cfg.agora() + Number(t.expires_in ?? 21_600) * 1000, 'CONECTADA', cfg.agora(), c.id);
        await fecharJob(job, true);
      } catch (e) {
        await fecharJob(job, false, 0, e);
        if (e instanceof ErroML && [400, 401, 403].includes(e.status)) {
          await tx(db, async (db) => {
            await db.run("UPDATE contas_canal SET status = 'REAUTORIZAR', ultimo_erro = ?, ultimo_erro_em = ?, atualizado_em = ? WHERE id = ?", 'Autorização expirada ou revogada: reconecte a conta.', cfg.agora(), cfg.agora(), c.id);
            await auditar(db, sistema('ml'), 'ML_REAUTORIZAR', 'conta', c.id);
          });
        } else await falhou(c, e);
        throw e;
      }
    })().finally(() => travaToken.delete('ml'));
    travaToken.set('ml', p); return p;
  }
  async function token() {
    let c = await conta();
    if (c.status !== 'CONECTADA' || !c.access_token_enc) throw new ErroML(0, 'DESCONECTADA', 'Conta do Mercado Livre não conectada.');
    if ((c.token_expira_em ?? 0) - cfg.agora() < 5 * 60_000) { await renovar(); c = await conta(); }
    return decifrar(cfg.fieldKey, c.access_token_enc);
  }
  /** Executa com token; se o ML responder 401 (revogado antes da hora), renova uma vez e repete. */
  async function comToken(fn) {
    try { return await fn(await token()); } catch (e) {
      if (e instanceof ErroML && e.status === 401) { await renovar(); return fn(await token()); }
      throw e;
    }
  }

  // ---------- pedidos ----------
  function sincronizarPedidos(origem = 'MANUAL', dias = 7) {
    const exec = async () => {
      const c = await conta(); if (c.status !== 'CONECTADA') return { lidos: 0, novos: 0, atualizados: 0, erros: 0 };
      const job = await abrirJob(c, 'PEDIDOS', origem); const r = { lidos: 0, novos: 0, atualizados: 0, erros: 0 };
      try {
        const desde = new Date(cfg.agora() - dias * 86_400_000).toISOString();
        for (let pag = 0; pag < 20; pag++) {
          const res = await comToken((t) => ml.pesquisarPedidos(t, { vendedor: c.vendedor_id, desde, offset: pag * 50, limit: 50 }));
          const lista = Array.isArray(res.results) ? res.results : [];
          for (const o of lista) {
            r.lidos++;
            if (String(o.seller?.id ?? c.vendedor_id) !== String(c.vendedor_id)) continue;
            try { const x = await importarPedido(db, sistema('ml-polling'), c, o); if (x.novo) r.novos++; else if (x.mudou) r.atualizados++; } catch (e) { r.erros++; log.warn('pedido ignorado', { erro: msg(e) }); }
          }
          if (lista.length < 50) break;
        }
        await fecharJob(job, true, r.lidos); await deuCerto(c, 'ultima_sync_pedidos_em');
        if (r.novos || r.atualizados) agendarEstoque();
        return r;
      } catch (e) { await fecharJob(job, false, r.lidos, e); if (!(e instanceof ErroML && e.codigo === 'DESCONECTADA')) await falhou(c, e); throw e; }
    };
    filaPedidos = filaPedidos.catch(() => {}).then(exec);
    return filaPedidos;
  }

  async function processarWebhook(idWh) {
    const wh = await db.get('SELECT * FROM webhooks_recebidos WHERE id = ?', idWh); const c = await conta();
    const pedidoId = /^\/orders\/(\d{1,20})$/.exec(wh.recurso)[1];
    const job = await abrirJob(c, 'WEBHOOK', 'WEBHOOK');
    try {
      // Nunca se confia no corpo da notificação: o pedido é SEMPRE buscado na API com o token.
      const o = await comToken((t) => ml.buscarPedido(t, pedidoId));
      if (String(o.seller?.id ?? '') !== String(c.vendedor_id)) { await db.run('UPDATE webhooks_recebidos SET processado_em = ?, resultado = ? WHERE id = ?', cfg.agora(), 'ignorado: outro vendedor', idWh); await fecharJob(job, true); return; }
      const x = await importarPedido(db, sistema('ml-webhook'), c, o);
      await db.run('UPDATE webhooks_recebidos SET processado_em = ?, resultado = ? WHERE id = ?', cfg.agora(), x.novo ? 'importado' : 'atualizado', idWh);
      await fecharJob(job, true, 1); await deuCerto(c, 'ultima_sync_pedidos_em'); agendarEstoque();
    } catch (e) {
      await db.run('UPDATE webhooks_recebidos SET resultado = ? WHERE id = ?', `erro: ${msg(e)}`, idWh); // o polling reconcilia
      await fecharJob(job, false, 0, e); if (!(e instanceof ErroML && e.codigo === 'DESCONECTADA')) await falhou(c, e);
      throw e;
    }
  }

  // ---------- estoque -> anúncios ----------
  function agendarEstoque() {
    if (timerEstoque) return;
    timerEstoque = setTimeout(() => { timerEstoque = null; agendar(() => sincronizarEstoque('EVENTO')); }, cfg.ml.debounceMs ?? 5000);
    timerEstoque.unref?.();
  }
  app.eventos.on('estoque', agendarEstoque);

  function sincronizarEstoque(origem = 'MANUAL') {
    const exec = async () => {
      const c = await conta(); const r = { enviados: 0, ignorados: 0, erros: 0 };
      if (c.status !== 'CONECTADA' || !c.sync_estoque) return r;
      const job = await abrirJob(c, 'ESTOQUE', origem);
      try {
        const maps = await db.all('SELECT m.*, p.ativo AS produto_ativo FROM sku_marketplace m JOIN produtos p ON p.id = m.produto_id WHERE m.conta_id = ? AND m.sync_ativo = 1 ORDER BY m.id', c.id);
        for (const m of maps) {
          const d = await disponivelDe(db, m.produto_id);
          const qtd = m.produto_ativo ? Math.max(0, d.disponivel - c.margem_seguranca) : 0;
          let status = null;
          if (c.pausar_sem_estoque) status = qtd === 0 ? 'paused' : m.ultimo_status_enviado === 'paused' ? 'active' : null;
          if (qtd === m.ultima_qtd_enviada && (!status || status === m.ultimo_status_enviado)) { r.ignorados++; continue; }
          try {
            if (qtd !== m.ultima_qtd_enviada) {
              const corpo = m.variacao_id ? { variations: [{ id: Number(m.variacao_id), available_quantity: qtd }] } : { available_quantity: qtd };
              await comToken((t) => ml.atualizarItem(t, m.item_id, corpo));
            }
            if (status && status !== m.ultimo_status_enviado) await comToken((t) => ml.atualizarItem(t, m.item_id, { status }));
            await db.run('UPDATE sku_marketplace SET ultima_qtd_enviada = ?, ultimo_status_enviado = COALESCE(?, ultimo_status_enviado), ultimo_sync_em = ?, ultimo_erro = NULL WHERE id = ?', qtd, status, cfg.agora(), m.id);
            r.enviados++;
          } catch (e) {
            r.erros++; await db.run('UPDATE sku_marketplace SET ultimo_erro = ? WHERE id = ?', e instanceof ErroML && e.status === 404 ? 'Anúncio não encontrado no Mercado Livre.' : msg(e), m.id);
            if (e instanceof ErroML && (e.codigo === 'DESCONECTADA' || (await conta()).status === 'REAUTORIZAR')) throw e;
          }
          if (maps.length > 1) await (cfg.ml.esperar ?? dormir)(120);
        }
        await fecharJob(job, r.erros === 0, r.enviados, r.erros ? `${r.erros} anúncio(s) com erro` : null);
        if (!r.erros) await deuCerto(c, 'ultima_sync_estoque_em'); else await db.run('UPDATE contas_canal SET ultima_sync_estoque_em = ? WHERE id = ?', cfg.agora(), c.id);
        return r;
      } catch (e) { await fecharJob(job, false, r.enviados, e); throw e; }
    };
    filaEstoque = filaEstoque.catch(() => {}).then(exec);
    return filaEstoque;
  }

  // ---------- saúde ----------
  function saude(c) {
    if (c.status === 'SEM_APP') return { cor: 'cinza', motivo: 'Configure o aplicativo do Mercado Livre.' };
    if (c.status === 'DESCONECTADA') return { cor: 'cinza', motivo: 'Conecte a conta do vendedor.' };
    if (c.status === 'REAUTORIZAR') return { cor: 'vermelho', motivo: 'Autorização expirada ou revogada: reconecte.' };
    if (c.falhas_seguidas >= 3) return { cor: 'vermelho', motivo: `${c.falhas_seguidas} falhas seguidas: ${c.ultimo_erro ?? ''}` };
    if (c.falhas_seguidas >= 1) return { cor: 'amarelo', motivo: c.ultimo_erro ?? 'Falha recente.' };
    const limite = (3 * cfg.ml.pollMin + 5) * 60_000;
    if (cfg.ml.pollMin > 0 && (!c.ultima_sync_pedidos_em || cfg.agora() - c.ultima_sync_pedidos_em > limite)) return { cor: 'amarelo', motivo: 'Sem sincronizar pedidos há algum tempo.' };
    return { cor: 'verde', motivo: 'Tudo certo.' };
  }

  // ---------- rotas ----------
  rota('GET', '/api/integracoes', async () => {
    const c = await conta();
    const cont = async (s) => (await db.get('SELECT COUNT(*) c FROM pedidos WHERE status = ?', s)).c;
    return {
      ml: {
        status: c.status, saude: saude(c), vendedor_id: c.vendedor_id, app_configurado: !!c.app_id_enc && !!c.app_secret_enc,
        margem_seguranca: c.margem_seguranca, pausar_sem_estoque: !!c.pausar_sem_estoque, sync_estoque: !!c.sync_estoque,
        ultima_sync_pedidos_em: c.ultima_sync_pedidos_em, ultima_sync_estoque_em: c.ultima_sync_estoque_em, ultimo_erro: c.ultimo_erro, falhas_seguidas: c.falhas_seguidas,
        redirect_uri: `${origemPublica()}/api/integracoes/ml/callback`, webhook_url: `${origemPublica()}/api/integracoes/ml/webhook/${segredoWebhook(c)}`,
        pedidos: { novos: await cont('NOVO'), pagos: await cont('PAGO'), com_problema: await cont('COM_PROBLEMA') },
        anuncios: { total: (await db.get('SELECT COUNT(*) c FROM sku_marketplace WHERE conta_id = ?', c.id)).c, com_erro: (await db.get('SELECT COUNT(*) c FROM sku_marketplace WHERE conta_id = ? AND ultimo_erro IS NOT NULL', c.id)).c },
        sem_mapeamento: (await db.get("SELECT COUNT(*) c FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id WHERE i.produto_id IS NULL AND p.status <> 'CANCELADO'")).c,
        jobs: await db.all('SELECT id, tipo, origem, iniciado_em, concluido_em, ok, itens, erro FROM jobs_sincronizacao WHERE conta_id = ? ORDER BY id DESC LIMIT 12', c.id),
      },
    };
  });

  rota('PUT', '/api/integracoes/ml/config', { reauth: true }, async (ctx) => await tx(db, async (db) => {
    const d = validar(ctx.corpo, { app_id: T({ obrig: true, regex: /^\d{4,20}$/, msg: 'O App ID do Mercado Livre é numérico.' }), app_secret: T({ min: 8, max: 120 }),
      margem_seguranca: I({ max: 100_000, padrao: 0 }), pausar_sem_estoque: B({ padrao: 0 }), sync_estoque: B({ padrao: 1 }) });
    const c = await conta(db); const atual = credenciais(c);
    if (!d.app_secret && !atual) throw invalido({ app_secret: 'Informe a chave secreta do aplicativo.' });
    const mudou = !atual || atual.appId !== d.app_id || (d.app_secret && d.app_secret !== atual.secret);
    const status = c.status === 'SEM_APP' ? 'DESCONECTADA' : mudou ? 'DESCONECTADA' : c.status; // trocar o app invalida os tokens
    await db.run(`UPDATE contas_canal SET app_id_enc = ?, app_secret_enc = ?, margem_seguranca = ?, pausar_sem_estoque = ?, sync_estoque = ?, status = ?,
      access_token_enc = CASE WHEN CAST(? AS INTEGER) = 1 THEN NULL ELSE access_token_enc END, refresh_token_enc = CASE WHEN CAST(? AS INTEGER) = 1 THEN NULL ELSE refresh_token_enc END, atualizado_em = ? WHERE id = ?`, cifrar(cfg.fieldKey, d.app_id), cifrar(cfg.fieldKey, d.app_secret ?? atual.secret), d.margem_seguranca, d.pausar_sem_estoque, d.sync_estoque, status, mudou ? 1 : 0, mudou ? 1 : 0, cfg.agora(), c.id);
    await auditar(db, ctx, 'ML_CONFIGURADO', 'conta', c.id, { margem: d.margem_seguranca, pausar: d.pausar_sem_estoque, credenciais_alteradas: !!mudou });
    agendarEstoque();
    return { status };
  }));

  rota('POST', '/api/integracoes/ml/conectar', async (ctx) => {
    const c = await conta(); const cred = credenciais(c);
    if (!cred) throw conflito('SEM_APP', 'Configure o App ID e a chave secreta antes de conectar.');
    const state = aleatorio(24);
    await tx(db, async (db) => {
      await db.run('DELETE FROM oauth_estados WHERE expira_em < ?', cfg.agora());
      await db.run('INSERT INTO oauth_estados (state_hash, conta_id, user_id, expira_em) VALUES (?,?,?,?)', sha256(state), c.id, ctx.user.id, cfg.agora() + 10 * 60_000);
      await auditar(db, ctx, 'ML_CONEXAO_INICIADA', 'conta', c.id);
    });
    return { url: ml.urlAutorizacao({ appId: cred.appId, redirectUri: `${origemPublica()}/api/integracoes/ml/callback`, state }) };
  });

  // O ML redireciona o navegador para cá. O cookie SameSite=Strict não acompanha: quem autentica é o `state` (uso único, 10 min, ligado ao usuário).
  rota('GET', '/api/integracoes/ml/callback', { auth: 'publica' }, async (ctx) => {
    const voltar = (q) => ({ _raw: true, status: 302, tipo: 'text/plain; charset=utf-8', corpo: '', headers: { Location: `/#/integracoes?${q}` } });
    const { code, state, error } = ctx.query;
    if (typeof state !== 'string' || state.length > 100) return voltar('erro=estado');
    const consumido = await db.run('UPDATE oauth_estados SET usado_em = ? WHERE state_hash = ? AND usado_em IS NULL AND expira_em > ?', cfg.agora(), sha256(state), cfg.agora());
    if (!consumido.changes) return voltar('erro=estado');
    const est = await db.get('SELECT * FROM oauth_estados WHERE state_hash = ?', sha256(state));
    const c = await conta(); const cred = credenciais(c);
    if (error || typeof code !== 'string' || !/^[A-Za-z0-9_\-.]{4,200}$/.test(code) || !cred) return voltar('erro=negado');
    try {
      const t = await ml.trocarCodigo({ ...cred, code, redirectUri: `${origemPublica()}/api/integracoes/ml/callback` });
      const vendedor = String(t.user_id ?? '');
      if (!ID_RE.test(vendedor) || !t.access_token || !t.refresh_token) throw new ErroML(0, 'RESPOSTA', 'Resposta de autorização inválida.');
      const trocou = c.vendedor_id && c.vendedor_id !== vendedor;
      await tx(db, async (db) => {
        await db.run("UPDATE contas_canal SET vendedor_id = ?, access_token_enc = ?, refresh_token_enc = ?, token_expira_em = ?, status = 'CONECTADA', falhas_seguidas = 0, ultimo_erro = NULL, atualizado_em = ? WHERE id = ?", vendedor, cifrar(cfg.fieldKey, t.access_token), cifrar(cfg.fieldKey, t.refresh_token), cfg.agora() + Number(t.expires_in ?? 21_600) * 1000, cfg.agora(), c.id);
        // outra conta de vendedor: os anúncios mapeados são de outro dono. Nunca enviar estoque para eles.
        if (trocou) await db.run('UPDATE sku_marketplace SET sync_ativo = 0, ultima_qtd_enviada = NULL, ultimo_status_enviado = NULL WHERE conta_id = ?', c.id);
        await auditar(db, { agora: cfg.agora, user: { id: est.user_id }, ip: ctx.ip }, trocou ? 'ML_CONTA_TROCADA' : 'ML_CONECTADO', 'conta', c.id);
      });
      agendar(() => sincronizarPedidos('MANUAL'));
      return voltar(trocou ? 'conectado=1&trocou=1' : 'conectado=1');
    } catch (e) { log.warn('falha ao conectar ao Mercado Livre', { erro: msg(e) }); return voltar('erro=conexao'); }
  });

  rota('POST', '/api/integracoes/ml/desconectar', { reauth: true }, async (ctx) => await tx(db, async (db) => {
    const c = await conta(db);
    await db.run("UPDATE contas_canal SET access_token_enc = NULL, refresh_token_enc = NULL, token_expira_em = NULL, status = ?, atualizado_em = ? WHERE id = ?", credenciais(c) ? 'DESCONECTADA' : 'SEM_APP', cfg.agora(), c.id);
    await auditar(db, ctx, 'ML_DESCONECTADO', 'conta', c.id);
    return { status: 'DESCONECTADA' };
  }));

  rota('POST', '/api/integracoes/ml/sincronizar', async (ctx) => {
    const { tipo } = validar(ctx.corpo, { tipo: { tipo: 'enum', valores: ['pedidos', 'estoque', 'tudo'], padrao: 'tudo' } });
    if ((await conta()).status !== 'CONECTADA') throw conflito('DESCONECTADA', 'Conecte a conta do Mercado Livre primeiro.');
    const out = {};
    try {
      if (tipo !== 'estoque') out.pedidos = await sincronizarPedidos('MANUAL');
      if (tipo !== 'pedidos') out.estoque = await sincronizarEstoque('MANUAL');
    } catch (e) { throw erro(502, 'ML_ERRO', e instanceof ErroML ? e.message : 'Falha ao sincronizar.'); }
    return out;
  });

  rota('POST', '/api/integracoes/ml/rotacionar-webhook', { reauth: true }, async (ctx) => await tx(db, async (db) => {
    const c = await conta(db);
    await db.run('UPDATE contas_canal SET webhook_versao = webhook_versao + 1, atualizado_em = ? WHERE id = ?', cfg.agora(), c.id);
    await auditar(db, ctx, 'ML_WEBHOOK_ROTACIONADO', 'conta', c.id);
    return { ok: true };
  }));

  // Webhook do ML (orders_v2): sem cookie/Origin. Autentica pelo segredo na URL; o corpo só diz QUAL pedido buscar.
  rota('POST', '/api/integracoes/ml/webhook/:segredo', { auth: 'publica', externa: true, limite: 16 * 1024 }, async (ctx) => {
    const c = await conta();
    if (!iguais(segredoWebhook(c), ctx.params.segredo)) throw erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
    const b = ctx.corpo;
    const topico = typeof b?.topic === 'string' ? b.topic : ''; const recurso = typeof b?.resource === 'string' ? b.resource : '';
    if (!['orders_v2', 'orders'].includes(topico) || !/^\/orders\/\d{1,20}$/.test(recurso) || String(b.user_id ?? '') !== String(c.vendedor_id ?? '')) return { recebido: true, ignorado: true };
    if (c.status !== 'CONECTADA') return { recebido: true, ignorado: true };
    const pendente = await db.get('SELECT id FROM webhooks_recebidos WHERE conta_id = ? AND recurso = ? AND processado_em IS NULL', c.id, recurso);
    if (!pendente) {
      const id = await db.insert('INSERT INTO webhooks_recebidos (conta_id, topico, recurso, recebido_em) VALUES (?,?,?,?)', c.id, topico, recurso, cfg.agora());
      agendar(async () => await processarWebhook(id));
    }
    return { recebido: true }; // responde na hora (o ML espera 200 rápido); o processamento segue em segundo plano
  });

  // ---------- mapeamento de anúncios ----------
  const lerAnuncios = async (where = '1=1', ...args) => {
    const linhas = await db.all(`SELECT m.*, p.sku, p.nome FROM sku_marketplace m JOIN produtos p ON p.id = m.produto_id WHERE ${where} ORDER BY m.id DESC`, ...args);
    const saida = [];
    for (const m of linhas) saida.push({ ...m, ...(await disponivelDe(db, m.produto_id)) });
    return saida;
  };
  rota('GET', '/api/anuncios', async () => ({ itens: await lerAnuncios() }));
  rota('GET', '/api/produtos/:id/anuncios', async (ctx) => ({ itens: await lerAnuncios('m.produto_id = ?', Number(ctx.params.id)) }));

  rota('POST', '/api/produtos/:id/anuncios', async (ctx) => {
    const id = Number(ctx.params.id);
    const d = validar(ctx.corpo, { item_id: T({ obrig: true, upper: true, regex: ITEM_RE, msg: 'Informe o código do anúncio (ex.: MLB1234567890).' }), variacao_id: T({ regex: ID_RE, msg: 'A variação é numérica.', padrao: '' }) });
    if (!await db.get('SELECT 1 FROM produtos WHERE id = ?', id)) throw naoEncontrado('Produto');
    const c = await conta(); let titulo = null;
    if (c.status === 'CONECTADA') {
      let item; try { item = await comToken((t) => ml.buscarItem(t, d.item_id)); } catch (e) { const nf = e instanceof ErroML && e.status === 404; throw erro(nf ? 404 : 502, nf ? 'NAO_ENCONTRADO' : 'ML_ERRO', nf ? 'Anúncio não encontrado no Mercado Livre.' : 'Não consegui consultar o anúncio agora.'); }
      if (String(item.seller_id ?? '') !== String(c.vendedor_id)) throw invalido({ item_id: 'Este anúncio não pertence à conta conectada.' });
      const vars = Array.isArray(item.variations) ? item.variations : [];
      if (vars.length && !d.variacao_id) throw invalido({ variacao_id: `Anúncio com variações: informe uma (${vars.slice(0, 6).map((v) => v.id).join(', ')}).` });
      if (d.variacao_id && !vars.some((v) => String(v.id) === d.variacao_id)) throw invalido({ variacao_id: 'Variação inexistente neste anúncio.' });
      titulo = String(item.title ?? '').slice(0, 200) || null;
    }
    const novo = await tx(db, async (db) => {
      if (await db.get('SELECT 1 FROM sku_marketplace WHERE conta_id = ? AND item_id = ? AND variacao_id = ?', c.id, d.item_id, d.variacao_id)) throw conflito('ANUNCIO_DUPLICADO', 'Este anúncio já está mapeado.');
      const novoId = await db.insert('INSERT INTO sku_marketplace (conta_id, produto_id, item_id, variacao_id, titulo, criado_em) VALUES (?,?,?,?,?,?)', c.id, id, d.item_id, d.variacao_id, titulo, cfg.agora());
      await auditar(db, ctx, 'ANUNCIO_MAPEADO', 'produto', id, { item: d.item_id });
      return novoId;
    });
    agendarEstoque(); ctx.status = 201;
    return (await lerAnuncios('m.id = ?', novo))[0];
  });
  rota('PUT', '/api/anuncios/:id', async (ctx) => await tx(db, async (db) => {
    const { sync_ativo: s } = validar(ctx.corpo, { sync_ativo: B({ obrig: true }) });
    const r = await db.run('UPDATE sku_marketplace SET sync_ativo = ? WHERE id = ?', s, Number(ctx.params.id));
    if (!r.changes) throw naoEncontrado('Anúncio');
    await auditar(db, ctx, s ? 'ANUNCIO_SYNC_LIGADO' : 'ANUNCIO_SYNC_DESLIGADO', 'anuncio', ctx.params.id);
    if (s) agendarEstoque();
    return { sync_ativo: !!s };
  }));
  rota('DELETE', '/api/anuncios/:id', async (ctx) => await tx(db, async (db) => {
    const r = await db.run('DELETE FROM sku_marketplace WHERE id = ?', Number(ctx.params.id));
    if (!r.changes) throw naoEncontrado('Anúncio');
    await auditar(db, ctx, 'ANUNCIO_DESMAPEADO', 'anuncio', ctx.params.id);
    return { removido: true };
  }));

  /** Agendador de reconciliação (polling). Só o servidor chama; os testes disparam as sincronizações direto. */
  function iniciarAgendador() {
    if (!(cfg.ml.pollMin > 0)) return () => {};
    const t = setInterval(async () => {
      const c = await conta(); if (c.status !== 'CONECTADA') return;
      agendar(() => sincronizarPedidos('POLLING')); agendar(() => sincronizarEstoque('POLLING'));
    }, cfg.ml.pollMin * 60_000);
    t.unref(); return () => clearInterval(t);
  }
  return { drenar, sincronizarPedidos, sincronizarEstoque, renovar, iniciarAgendador, saude, agendarEstoque };
}

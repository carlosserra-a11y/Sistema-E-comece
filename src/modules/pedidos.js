import { tx } from '../db.js';
import { conflito, invalido, naoEncontrado, paginar } from '../util.js';
import { auditar } from '../security/audit.js';
import { ITEM_RE, ID_RE } from '../integracoes/mercadolivre.js';
import { diaDaLoja } from './vendas-base.js';

/** Disponível = físico em zonas vendáveis, sem lote vencido, - reservas ATIVAS. Pode ficar negativo (venda acima do estoque): vira problema no pedido. */
export async function disponivelDe(db, produtoId, hoje = diaDaLoja(Date.now())) {
  const vendavel = (await db.get(`SELECT COALESCE(SUM(s.qtd),0) q FROM saldos_por_endereco s JOIN enderecos e ON e.id = s.endereco_id JOIN zonas z ON z.id = e.zona_id LEFT JOIN lotes l ON l.id = s.lote_id
    WHERE s.produto_id = ? AND z.vendavel = 1 AND (l.validade IS NULL OR l.validade >= ?)`, produtoId, hoje)).q;
  const reservado = (await db.get("SELECT COALESCE(SUM(qtd),0) q FROM reservas WHERE produto_id = ? AND status = 'ATIVA'", produtoId)).q;
  return { vendavel, reservado, disponivel: vendavel - reservado };
}

const statusDoCanal = (s) => (s === 'paid' ? 'PAGO' : s === 'cancelled' ? 'CANCELADO' : 'NOVO');
const centavos = (v) => { const n = Number(v ?? 0); if (!Number.isFinite(n) || n < 0 || n > 1e9) throw invalido({ valor: 'Valor monetário inválido no pedido.' }); return Math.round(n * 100); };

/** Resolve o produto de cada item: mapeamento do anúncio; senão SKU do vendedor igual ao SKU interno (e já grava o mapeamento). */
async function resolverProdutos(db, ctx, contaId, pedidoId) {
  const mapeados = []; // a auditoria vem depois das travas de produto (mesma ordem da venda no balcão: sem impasse)
  for (const it of await db.all('SELECT * FROM pedido_itens WHERE pedido_id = ? AND produto_id IS NULL', pedidoId)) {
    let produtoId = (await db.get('SELECT produto_id FROM sku_marketplace WHERE conta_id = ? AND item_id = ? AND variacao_id = ?', contaId, it.item_id, it.variacao_id))?.produto_id ?? null;
    if (!produtoId && it.sku_canal) {
      const p = await db.get('SELECT id FROM produtos WHERE sku = ? AND ativo = 1', it.sku_canal);
      if (p) {
        produtoId = p.id;
        await db.run('INSERT INTO sku_marketplace (conta_id, produto_id, item_id, variacao_id, titulo, criado_em) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING', contaId, p.id, it.item_id, it.variacao_id, it.titulo, ctx.agora());
        mapeados.push({ produtoId: p.id, item: it.item_id });
      }
    }
    if (produtoId) await db.run('UPDATE pedido_itens SET produto_id = ? WHERE id = ?', produtoId, it.id);
  }
  return mapeados;
}

/** Reavalia um pedido: resolve SKUs, reserva estoque (uma vez por item) e decide o status. Cancelado é terminal e libera as reservas. */
async function avaliar(db, ctx, pedido, statusCanal) {
  const novo = statusDoCanal(statusCanal);
  const itens = async () => await db.all('SELECT * FROM pedido_itens WHERE pedido_id = ?', pedido.id);
  let status; let problema = null;
  if (pedido.status === 'CANCELADO' || novo === 'CANCELADO') {
    status = 'CANCELADO';
    await db.run("UPDATE reservas SET status = 'LIBERADA', atualizado_em = ? WHERE status = 'ATIVA' AND pedido_item_id IN (SELECT id FROM pedido_itens WHERE pedido_id = ?)", ctx.agora(), pedido.id);
  } else {
    const mapeados = await resolverProdutos(db, ctx, pedido.conta_id, pedido.id);
    // mesma trava da venda no balcão: pedido e balcão não levam a mesma última unidade
    for (const id of [...new Set((await itens()).map((x) => x.produto_id).filter(Boolean))].sort((a, b) => a - b)) await db.travar(`venda|produto|${id}`);
    for (const m of mapeados) await auditar(db, ctx, 'ANUNCIO_MAPEADO_POR_SKU', 'produto', m.produtoId, { item: m.item });
    const problemas = [];
    for (const it of await itens()) {
      if (!it.produto_id) { problemas.push(`SKU não mapeado: ${it.sku_canal ?? it.item_id}`); continue; }
      await db.run("INSERT INTO reservas (pedido_item_id, produto_id, qtd, status, criado_em, atualizado_em) VALUES (?,?,?,'ATIVA',?,?) ON CONFLICT DO NOTHING", it.id, it.produto_id, it.qtd, ctx.agora(), ctx.agora());
    }
    for (const it of (await itens()).filter((x) => x.produto_id)) {
      const d = await disponivelDe(db, it.produto_id, diaDaLoja(ctx.agora()));
      if (d.disponivel < 0) problemas.push(`Estoque insuficiente: ${(await db.get('SELECT sku FROM produtos WHERE id = ?', it.produto_id)).sku} (faltam ${-d.disponivel})`);
    }
    status = problemas.length ? 'COM_PROBLEMA' : novo;
    problema = problemas.length ? [...new Set(problemas)].join('; ').slice(0, 400) : null;
  }
  await db.run('UPDATE pedidos SET status = ?, status_canal = ?, problema = ?, atualizado_em = ? WHERE id = ?', status, statusCanal ?? pedido.status_canal, problema, ctx.agora(), pedido.id);
  return { status, problema };
}

/** Importa/atualiza um pedido do Mercado Livre. Idempotente: o mesmo pedido nunca entra, reserva ou cancela duas vezes. */
export async function importarPedido(db, ctx, conta, ml) {
  if (!ml || !ID_RE.test(String(ml.id)) || !Array.isArray(ml.order_items) || !ml.order_items.length || ml.order_items.length > 50) throw invalido({ pedido: 'Pedido do canal inválido.' });
  return await tx(db, async (db) => {
    const canalId = String(ml.id);
    let ped = await db.get('SELECT * FROM pedidos WHERE conta_id = ? AND canal_pedido_id = ?', conta.id, canalId);
    const novo = !ped;
    if (novo) {
      const itens = ml.order_items.map((oi) => {
        const qtd = Number(oi.quantity);
        const item = String(oi.item?.id ?? '');
        if (!ITEM_RE.test(item) || !Number.isInteger(qtd) || qtd < 1 || qtd > 100_000) throw invalido({ pedido: `Item inválido no pedido ${canalId}.` });
        const sku = String(oi.item?.seller_sku ?? oi.item?.seller_custom_field ?? '').trim().toUpperCase().slice(0, 40);
        return { item, variacao: String(oi.item?.variation_id ?? ''), titulo: String(oi.item?.title ?? '').slice(0, 200), sku: sku || null, qtd, preco: centavos(oi.unit_price) };
      });
      const data = Date.parse(ml.date_created ?? '');
      const pedidoId = await db.insert('INSERT INTO pedidos (conta_id, canal_pedido_id, status_canal, status, comprador_id, comprador_apelido, total_centavos, data_canal, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)', conta.id, canalId, ml.status ?? null, statusDoCanal(ml.status), String(ml.buyer?.id ?? '') || null, String(ml.buyer?.nickname ?? '').slice(0, 60) || null, centavos(ml.total_amount), Number.isNaN(data) ? ctx.agora() : data, ctx.agora(), ctx.agora());
      for (const i of itens) await db.run('INSERT INTO pedido_itens (pedido_id, item_id, variacao_id, titulo, sku_canal, qtd, preco_centavos) VALUES (?,?,?,?,?,?,?)', pedidoId, i.item, i.variacao, i.titulo, i.sku, i.qtd, i.preco);
      ped = await db.get('SELECT * FROM pedidos WHERE id = ?', pedidoId);
    }
    const antes = ped.status;
    const { status, problema } = await avaliar(db, ctx, ped, ml.status ?? ped.status_canal);
    if (novo) await auditar(db, ctx, 'PEDIDO_IMPORTADO', 'pedido', ped.id, { canal: canalId, status });
    else if (status !== antes) await auditar(db, ctx, status === 'CANCELADO' ? 'PEDIDO_CANCELADO' : 'PEDIDO_ATUALIZADO', 'pedido', ped.id, { de: antes, para: status });
    return { id: ped.id, novo, status, problema, mudou: novo || status !== antes };
  });
}

export function registrarPedidos(app, { db }) {
  const { rota } = app;
  rota('GET', '/api/pedidos', async (ctx) => {
    const { por, offset, pagina } = paginar(ctx.query, 25);
    const onde = ['1=1']; const args = [];
    if (['NOVO', 'PAGO', 'COM_PROBLEMA', 'CANCELADO'].includes(ctx.query.status)) { onde.push('p.status = ?'); args.push(ctx.query.status); }
    const from = `FROM pedidos p WHERE ${onde.join(' AND ')}`;
    return {
      total: (await db.get(`SELECT COUNT(*) c ${from}`, ...args)).c, pagina, por_pagina: por,
      itens: await db.all(`SELECT p.id, p.canal_pedido_id, p.status, p.status_canal, p.problema, p.comprador_apelido, p.total_centavos, p.data_canal,
        (SELECT COALESCE(SUM(qtd),0) FROM pedido_itens i WHERE i.pedido_id = p.id) AS unidades ${from} ORDER BY p.data_canal DESC, p.id DESC LIMIT ? OFFSET ?`, ...args, por, offset),
    };
  });
  rota('GET', '/api/pedidos/:id', async (ctx) => {
    const p = await db.get('SELECT * FROM pedidos WHERE id = ?', Number(ctx.params.id));
    if (!p) throw naoEncontrado('Pedido');
    const itens = await db.all(`SELECT i.*, pr.sku AS sku_interno, r.status AS reserva FROM pedido_itens i LEFT JOIN produtos pr ON pr.id = i.produto_id LEFT JOIN reservas r ON r.pedido_item_id = i.id WHERE i.pedido_id = ?`, p.id);
    return { ...p, itens };
  });
  // Pedido que já saiu da loja (com a baixa feita no Estoque): a reserva deixa de segurar unidades no balcão e no anúncio.
  rota('POST', '/api/pedidos/:id/enviado', async (ctx) => {
    const r = await tx(db, async (db) => {
      const p = await db.get('SELECT * FROM pedidos WHERE id = ?', Number(ctx.params.id));
      if (!p) throw naoEncontrado('Pedido');
      const { changes } = await db.run("UPDATE reservas SET status = 'CONSUMIDA', atualizado_em = ? WHERE status = 'ATIVA' AND pedido_item_id IN (SELECT id FROM pedido_itens WHERE pedido_id = ?)", ctx.agora(), p.id);
      if (!changes) throw conflito('SEM_RESERVA', 'Este pedido não tem reserva ativa.');
      await auditar(db, ctx, 'PEDIDO_ENVIADO', 'pedido', p.id, { reservas: changes });
      return { id: p.id, reservas: changes };
    });
    app.eventos.emit('estoque');
    return r;
  });
  rota('POST', '/api/pedidos/:id/reprocessar', async (ctx) => await tx(db, async (db) => {
    const p = await db.get('SELECT * FROM pedidos WHERE id = ?', Number(ctx.params.id));
    if (!p) throw naoEncontrado('Pedido');
    const r = await avaliar(db, ctx, p, p.status_canal);
    await auditar(db, ctx, 'PEDIDO_REPROCESSADO', 'pedido', p.id, r);
    return r;
  }));
}

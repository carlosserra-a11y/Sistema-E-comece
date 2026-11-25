// Balcão: busca de itens para vender, catálogo de serviços, configuração (Pix, desconto, cupom) e QR Code do Pix.
import { tx } from '../db.js';
import { conflito, escaparLike, invalido, naoEncontrado, normalizarTexto } from '../util.js';
import { I, T, validar } from '../validate.js';
import { auditar } from '../security/audit.js';
import { variantes } from '../barcode/gtin.js';
import { qrSvg } from '../barcode/qr.js';
import { limparTextoPix, normalizarChavePix, payloadPix } from '../pix.js';
import { normalizarLeitura } from './consultas.js';
import { vendavelAgora } from './vendas.js';
import { VALOR_MAXIMO, dadosDaLoja, diaDaLoja, lerConfig } from './vendas-base.js';

const ESPEC_SERVICO = { nome: T({ obrig: true, min: 2, max: 160 }), valor_centavos: I({ obrig: true, min: 0, max: VALOR_MAXIMO }) };

export function registrarBalcao(app, { db }) {
  const { rota } = app;

  const produtoParaVenda = async (p, hoje) => {
    const v = await vendavelAgora(db, p.id, hoje);
    return { tipo: 'PRODUTO', id: p.id, codigo: p.sku, nome: p.nome, marca: p.marca, unidade: p.unidade, preco_unit_centavos: p.preco_centavos, disponivel: v.maximo, enderecos: v.origens.slice(0, 3).map((o) => ({ codigo: o.codigo, qtd: o.qtd })) };
  };

  // `exato` = leitura de código de barras ou SKU (vai direto para o carrinho); senão, lista por nome.
  rota('GET', '/api/balcao/buscar', async (ctx) => {
    const lido = normalizarLeitura(ctx.query.q).slice(0, 80);
    if (!lido) return { exato: null, produtos: [], servicos: [] };
    const hoje = diaDaLoja(ctx.agora());
    const maius = lido.toUpperCase();
    const vs = variantes(maius);
    const campos = 'p.id, p.sku, p.nome, p.marca, p.unidade, p.preco_centavos';
    const direto = (await db.get(`SELECT ${campos} FROM codigos_barras c JOIN produtos p ON p.id = c.produto_id WHERE p.ativo = 1 AND c.codigo IN (${vs.map(() => '?').join(',')})`, ...vs))
      ?? (await db.get(`SELECT ${campos} FROM produtos p WHERE p.ativo = 1 AND p.sku = ?`, maius));
    if (direto) return { exato: await produtoParaVenda(direto, hoje), produtos: [], servicos: [] };
    const like = `%${escaparLike(normalizarTexto(lido))}%`;
    const produtos = await db.all(`SELECT ${campos} FROM produtos p WHERE p.ativo = 1 AND p.busca LIKE ? ESCAPE '\\' ORDER BY LOWER(p.nome), p.id LIMIT 10`, like);
    const lista = [];
    for (const p of produtos) lista.push(await produtoParaVenda(p, hoje));
    const servicos = (await db.all("SELECT id, nome, valor_centavos FROM servicos WHERE ativo = 1 AND busca LIKE ? ESCAPE '\\' ORDER BY LOWER(nome), id LIMIT 6", like))
      .map((s) => ({ tipo: 'SERVICO', id: s.id, codigo: null, nome: s.nome, unidade: 'UN', preco_unit_centavos: s.valor_centavos, disponivel: null }));
    return { exato: null, produtos: lista, servicos };
  });

  // ---------- serviços ----------
  rota('GET', '/api/servicos', async (ctx) => ({ itens: await db.all('SELECT id, nome, valor_centavos, ativo, versao FROM servicos WHERE ativo = ? ORDER BY LOWER(nome), id LIMIT 500', ctx.query.ativo === '0' ? 0 : 1) }));
  const servico = async (db, id) => {
    const s = await db.get('SELECT id, nome, valor_centavos, ativo, versao FROM servicos WHERE id = ?', id);
    if (!s) throw naoEncontrado('Serviço');
    return s;
  };
  rota('POST', '/api/servicos', async (ctx) => {
    const d = validar(ctx.corpo, ESPEC_SERVICO);
    ctx.status = 201;
    return await tx(db, async (db) => {
      const t = ctx.agora();
      const id = await db.insert('INSERT INTO servicos (nome, busca, valor_centavos, criado_em, atualizado_em) VALUES (?,?,?,?,?)', d.nome, normalizarTexto(d.nome), d.valor_centavos, t, t);
      await auditar(db, ctx, 'SERVICO_CRIADO', 'servico', id, { valor_centavos: d.valor_centavos });
      return await servico(db, id);
    });
  });
  rota('PUT', '/api/servicos/:id', async (ctx) => {
    const d = validar(ctx.corpo, { ...ESPEC_SERVICO, versao: I({ obrig: true, min: 1 }) });
    const id = Number(ctx.params.id);
    return await tx(db, async (db) => {
      await servico(db, id);
      const r = await db.run('UPDATE servicos SET nome = ?, busca = ?, valor_centavos = ?, versao = versao + 1, atualizado_em = ? WHERE id = ? AND versao = ?', d.nome, normalizarTexto(d.nome), d.valor_centavos, ctx.agora(), id, d.versao);
      if (!r.changes) throw conflito('VERSAO', 'Este serviço foi alterado em outra tela. Recarregue.');
      await auditar(db, ctx, 'SERVICO_ALTERADO', 'servico', id, { valor_centavos: d.valor_centavos });
      return await servico(db, id);
    });
  });
  for (const [acao, ativo] of [['inativar', 0], ['reativar', 1]]) {
    rota('POST', `/api/servicos/:id/${acao}`, async (ctx) => await tx(db, async (db) => {
      const s = await servico(db, Number(ctx.params.id));
      await db.run('UPDATE servicos SET ativo = ?, versao = versao + 1, atualizado_em = ? WHERE id = ?', ativo, ctx.agora(), s.id);
      await auditar(db, ctx, ativo ? 'SERVICO_REATIVADO' : 'SERVICO_INATIVADO', 'servico', s.id);
      return { ativo: !!ativo };
    }));
  }

  // ---------- configuração e Pix ----------
  const configPublica = async (ctx) => {
    const c = await lerConfig(db);
    const dono = ctx.pode('vendas.configurar');
    return {
      pix_ativo: !!c.pix_chave, desconto_max_pct: c.desconto_max_pct, validade_orcamento_dias: c.validade_orcamento_dias, cupom_rodape: c.cupom_rodape,
      ...(dono ? { pix_chave: c.pix_chave, pix_nome: c.pix_nome, pix_cidade: c.pix_cidade } : {}), loja: await dadosDaLoja(db),
    };
  };
  rota('GET', '/api/balcao/config', async (ctx) => await configPublica(ctx));
  // A chave Pix decide para onde vai o dinheiro: só o dono muda, confirmando a identidade.
  rota('PUT', '/api/balcao/config', { reauth: true }, async (ctx) => {
    const d = validar(ctx.corpo, { pix_chave: T({ max: 80 }), pix_nome: T({ max: 60 }), pix_cidade: T({ max: 40 }), desconto_max_pct: I({ min: 0, max: 100, padrao: 0 }), validade_orcamento_dias: I({ min: 1, max: 90, padrao: 7 }), cupom_rodape: T({ max: 200 }) });
    let chave = null;
    if (d.pix_chave) {
      chave = normalizarChavePix(d.pix_chave);
      if (!chave) throw invalido({ pix_chave: 'Chave inválida. Use CPF/CNPJ, e-mail, telefone com +55 ou a chave aleatória.' });
      if (!limparTextoPix(d.pix_nome ?? '', 25)) throw invalido({ pix_nome: 'Informe o nome de quem recebe o Pix.' });
      if (!limparTextoPix(d.pix_cidade ?? '', 15)) throw invalido({ pix_cidade: 'Informe a cidade de quem recebe o Pix.' });
    }
    await tx(db, async (db) => {
      const antes = await lerConfig(db);
      const campos = [chave, d.pix_nome ?? null, d.pix_cidade ?? null, d.desconto_max_pct, d.validade_orcamento_dias, d.cupom_rodape ?? null];
      await db.run(`INSERT INTO config_vendas (id, pix_chave, pix_nome, pix_cidade, desconto_max_pct, validade_orcamento_dias, cupom_rodape, atualizado_em) VALUES (1,?,?,?,?,?,?,?)
        ON CONFLICT (id) DO UPDATE SET pix_chave = excluded.pix_chave, pix_nome = excluded.pix_nome, pix_cidade = excluded.pix_cidade, desconto_max_pct = excluded.desconto_max_pct, validade_orcamento_dias = excluded.validade_orcamento_dias, cupom_rodape = excluded.cupom_rodape, atualizado_em = excluded.atualizado_em`, ...campos, ctx.agora());
      const depois = await lerConfig(db);
      const mudou = ['pix_chave', 'pix_nome', 'pix_cidade', 'desconto_max_pct', 'validade_orcamento_dias', 'cupom_rodape'].filter((k) => antes[k] !== depois[k]);
      await auditar(db, ctx, 'CONFIG_VENDAS_ALTERADA', 'config_vendas', 1, { campos: mudou, desconto_max_pct: depois.desconto_max_pct });
    });
    return await configPublica(ctx);
  });

  rota('POST', '/api/balcao/pix', async (ctx) => {
    const { valor_centavos: valor } = validar(ctx.corpo, { valor_centavos: I({ obrig: true, min: 1, max: VALOR_MAXIMO }) });
    const c = await lerConfig(db);
    if (!c.pix_chave) throw conflito('PIX_NAO_CONFIGURADO', 'A chave Pix ainda não foi cadastrada (Balcão → Ajustes, só o dono).');
    const copiaECola = payloadPix({ chave: c.pix_chave, nome: c.pix_nome, cidade: c.pix_cidade, valorCentavos: valor });
    return { valor_centavos: valor, recebedor: c.pix_nome, chave: c.pix_chave, copia_e_cola: copiaECola, svg: qrSvg(copiaECola, { px: 6 }) };
  });
}

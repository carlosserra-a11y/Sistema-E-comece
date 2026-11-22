// Carga inicial do cliente (FRIO Peças e Serviços): dados da empresa, endereçamento do galpão (simulado a partir das fotos do estoque),
// produtos lidos das etiquetas e o estoque de teste. Roda UMA vez na partida, só quando PROVISIONAR=frio, tudo numa transação
// (se algo falhar nada fica pela metade e a próxima partida tenta de novo). Os dados fiscais e de contato vêm de EMPRESA_JSON
// (variável do servidor): nunca ficam no código nem no GitHub.
import { tx } from './db.js';
import { codigoEndereco } from './modules/deposito.js';
import { criarProduto } from './modules/catalogo.js';
import { receber } from './modules/estoque.js';
import { gravarEmpresa } from './modules/empresa.js';
import { auditar } from './security/audit.js';

/** Mapa físico do galpão (fotos do estoque). Níveis contam de baixo para cima; prédios (vãos) da esquerda para a direita. */
export const MAPA = [
  { zona: 'P', rua: 1, predios: 4, niveis: 6, local: 'Parede principal: estante grande de 4 vãos (sob os ar-condicionados)' },
  { zona: 'P', rua: 2, predios: 3, niveis: 5, local: 'Estante alta do fundo: 3 colunas de prateleiras' },
  { zona: 'P', rua: 3, predios: 1, niveis: 6, local: 'Estante da lateral esquerda' },
  { zona: 'P', rua: 4, predios: 4, niveis: 2, local: 'Prateleiras de canto (parte de cima, em L)' },
  { zona: 'V', rua: 1, predios: 4, niveis: 1, local: 'Armários de baixo do canto' },
  { zona: 'V', rua: 2, predios: 4, niveis: 1, local: 'Chão ao longo do balcão (cilindros de gás refrigerante)' },
  { zona: 'V', rua: 3, predios: 2, niveis: 2, local: 'Mesa central (tampo e prateleira de baixo: rolos de cobre)' },
];

/** Produtos das etiquetas fotografadas. As quantidades são de TESTE (contagem aproximada pelas fotos). */
export const PRODUTOS = [
  { sku: 'GAS-MAPP-HULTER', nome: 'Gás MAPP Hulter', marca: 'Hulter', categoria: 'Gases e maçaricos', codigo: '07899733820664', estoque_min: 6, locais: [[[1, 3, 4, 1], 12], [[1, 3, 3, 1], 12]] },
  { sku: 'D-31016', nome: 'Capacitor 10 MFD 440V', marca: 'EOS', categoria: 'Capacitores', codigo: '7908786413850', estoque_min: 5, locais: [[[2, 1, 2, 1], 20]] },
  { sku: 'D-31017', nome: 'Capacitor 15 MFD 440V', marca: 'EOS', categoria: 'Capacitores', codigo: 'D31017', estoque_min: 5, locais: [[[2, 1, 3, 1], 20]] },
];

export async function provisionar(cfg, db, log) {
  if (cfg.provisionar !== 'frio') return false;
  try {
    const feito = await tx(db, async (db) => {
      // reserva a execução (atômico: duas instâncias subindo juntas não duplicam o estoque)
      const reserva = await db.get("INSERT INTO sequencias (nome, valor) VALUES ('provisionado_frio_v1', 1) ON CONFLICT (nome) DO NOTHING RETURNING nome");
      if (!reserva) return false;
      const dono = await db.get('SELECT id FROM users WHERE dono = 1 ORDER BY id LIMIT 1');
      const ctx = { agora: cfg.agora, ip: 'provisionamento', user: dono ? { id: dono.id } : null };

      if (cfg.empresaJson) {
        let dados = null;
        try { dados = JSON.parse(cfg.empresaJson); } catch { log?.error?.('EMPRESA_JSON inválido: dados da empresa não carregados'); }
        if (dados) await gravarEmpresa(db, ctx, dados);
      }

      const dep = await db.get('SELECT id, codigo FROM depositos ORDER BY id LIMIT 1');
      if (!dep) throw new Error('sem depósito');
      await db.run("UPDATE depositos SET nome = 'Loja e estoque FRIO' WHERE id = ?", dep.id);
      for (const m of MAPA) {
        const z = await db.get('SELECT id FROM zonas WHERE deposito_id = ? AND codigo = ?', dep.id, m.zona);
        if (!z) continue;
        for (let p = 1; p <= m.predios; p++) for (let n = 1; n <= m.niveis; n++) {
          await db.run('INSERT INTO enderecos (deposito_id, zona_id, codigo, rua, predio, nivel, posicao, cap_itens, cap_peso_g, criado_em) VALUES (?,?,?,?,?,?,?,0,0,?) ON CONFLICT DO NOTHING',
            dep.id, z.id, codigoEndereco(dep.codigo, m.zona, m.rua, p, n, 1), m.rua, p, n, 1, cfg.agora());
        }
      }
      await auditar(db, ctx, 'ENDERECOS_CRIADOS', 'deposito', dep.id, { origem: 'provisionamento', total: MAPA.reduce((a, m) => a + m.predios * m.niveis, 0) });

      for (const pr of PRODUTOS) {
        let p = await db.get('SELECT id FROM produtos WHERE sku = ?', pr.sku);
        if (!p) p = { id: await criarProduto(db, ctx, { sku: pr.sku, nome: pr.nome, marca: pr.marca, categoria: pr.categoria, unidade: 'UN', estoque_min: pr.estoque_min }, { codigo: pr.codigo }) };
        for (const [[rua, predio, nivel, pos], qtd] of pr.locais) {
          const e = await db.get('SELECT id FROM enderecos WHERE codigo = ?', codigoEndereco(dep.codigo, 'P', rua, predio, nivel, pos));
          if (e) await receber(db, ctx, { produto_id: p.id, endereco_id: e.id, qtd, documento: 'Saldo inicial (carga de teste)' });
        }
      }
      await auditar(db, ctx, 'PROVISIONAMENTO_FRIO', 'sistema', 1, { produtos: PRODUTOS.length });
      return true;
    });
    if (feito) log?.info?.('provisionamento da FRIO concluído');
    return feito;
  } catch (e) {
    log?.error?.('falha no provisionamento da FRIO (nada foi gravado)', { erro: e.message });
    return false;
  }
}

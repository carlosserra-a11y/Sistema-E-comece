// Dados FICTÍCIOS para treinamento e testes visuais. Nunca rode contra um banco de produção.
import { loadConfig } from '../src/config.js';
import { abrirBanco, migrar, tx } from '../src/db.js';
import { garantirDeposito, codigoEndereco } from '../src/modules/deposito.js';
import { criarProduto, gerarCodigoInterno } from '../src/modules/catalogo.js';
import { receber } from '../src/modules/estoque.js';

const cfg = loadConfig();
if (cfg.prod) { console.error('Recusado: seed de demonstração não roda em produção.'); process.exit(1); }
const db = abrirBanco(cfg.dbPath);
migrar(db, cfg.migrationsDir);
garantirDeposito(db, cfg.agora());
const ctx = { agora: cfg.agora, user: { id: 1 }, ip: 'seed' };

const zona = (tipo) => db.prepare('SELECT z.*, d.codigo AS dep FROM zonas z JOIN depositos d ON d.id = z.deposito_id WHERE z.tipo = ? LIMIT 1').get(tipo);
function enderecos(tipo, rua, predios, niveis, pos) {
  const z = zona(tipo); const ids = [];
  for (let p = 1; p <= predios; p++) for (let n = 1; n <= niveis; n++) for (let s = 1; s <= pos; s++) {
    db.prepare('INSERT OR IGNORE INTO enderecos (deposito_id, zona_id, codigo, rua, predio, nivel, posicao, cap_itens, criado_em) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(z.deposito_id, z.id, codigoEndereco(z.dep, z.codigo, rua, p, n, s), rua, p, n, s, 60, cfg.agora());
    ids.push(db.prepare('SELECT id FROM enderecos WHERE codigo = ?').get(codigoEndereco(z.dep, z.codigo, rua, p, n, s)).id);
  }
  return ids;
}

tx(db, () => {
  if (db.prepare('SELECT 1 FROM produtos LIMIT 1').get()) { console.log('Já existem produtos: seed ignorado.'); return; }
  const pick = enderecos('PICKING', 1, 4, 2, 2); const res = enderecos('RESERVA', 2, 4, 2, 2);
  const itens = [
    ['CAM-001', 'Camiseta Algodão Básica Azul M', 'Malharia Sul', 'Vestuário', 3590, 12, 40],
    ['CAM-002', 'Camiseta Algodão Básica Preta G', 'Malharia Sul', 'Vestuário', 3590, 12, 55],
    ['CAN-010', 'Caneca Porcelana 300 ml Branca', 'Casa & Cia', 'Casa', 2290, 20, 8],
    ['CAN-011', 'Caneca Térmica Inox 500 ml', 'Casa & Cia', 'Casa', 6990, 6, 0],
    ['FON-100', 'Fone de Ouvido Bluetooth', 'SomPlus', 'Eletrônicos', 12990, 5, 14],
    ['CAB-200', 'Cabo USB-C 1 m Trançado', 'SomPlus', 'Eletrônicos', 3490, 30, 90],
    ['MOC-300', 'Mochila Executiva 15" Impermeável', 'Urban Pack', 'Acessórios', 17990, 4, 3],
    ['GAR-400', 'Garrafa Squeeze 700 ml', 'Urban Pack', 'Acessórios', 2990, 15, 25],
    ['TEN-500', 'Tênis Corrida Masculino 42', 'Pace', 'Calçados', 25990, 6, 10],
    ['LIV-600', 'Caderno Universitário 200 fls', 'Papelaria Sol', 'Papelaria', 1890, 40, 80],
  ];
  itens.forEach(([sku, nome, marca, categoria, preco, min, qtd], i) => {
    const id = criarProduto(db, ctx, { sku, nome, marca, categoria, preco_centavos: preco, custo_centavos: Math.round(preco * 0.45), estoque_min: min, peso_g: 200 + i * 40 });
    if (i !== 3 && i !== 9) gerarCodigoInterno(db, ctx, id); // dois produtos ficam sem código para demonstrar "gerar faltantes"
    db.prepare('INSERT OR IGNORE INTO produto_picking (produto_id, endereco_id) VALUES (?, ?)').run(id, pick[i]);
    if (qtd > 0) receber(db, ctx, { produto_id: id, endereco_id: pick[i], qtd: Math.min(qtd, 30) });
    if (qtd > 30) receber(db, ctx, { produto_id: id, endereco_id: res[i], qtd: qtd - 30 });
  });
  console.log(`Demo criada: ${itens.length} produtos, ${pick.length} endereços de picking, ${res.length} de reserva.`);
});
db.close();

// Vistoria automática: bate em TODAS as rotas autenticadas com ids absurdos e corpos malformados, com o dono e com cada tipo de pessoa.
// Regra única: nenhuma resposta pode ser erro de servidor (5xx). Erro de quem chamou (4xx) é o comportamento certo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarSistema, entrarCompleto, novoProduto, criarEnderecos, SENHA_FORTE } from './helpers.js';
import { codigoTotp, passoAtual } from '../src/security/totp.js';
import { PAPEIS } from '../src/permissoes.js';

const IDS = ['1', 'abc', '0', '-1', '99999999999999999999', '1.5', '%00', '1%20OR%201=1'];
const CORPOS = [{}, [], 'texto', null, { id: 'x', qtd: -5, nome: 'a'.repeat(5000) }, { qtd: 1e30, produto_id: 99999999999999999999, endereco_id: -1 }, { constructor: 'x', permissoes: 'não é lista' }];
const CONSULTAS = ['', '?q=%27%20OR%201%3D1--', '?q=%25_%5C', '?pagina=-5&por_pagina=0', '?pagina=abc&por_pagina=1e9', '?por_pagina=99999999999999999999', '?codigo=' + 'A'.repeat(3000), '?produto_id=abc&qtd=-1', '?zona_id=1&status=zz'];

async function varrer(sis, c, rotulo) {
  const problemas = [];
  let chamadas = 0;
  for (const r of sis.app.rotas.filter((x) => x.opts.auth === 'completa')) {
    if (r.padrao === '/api/sessoes/sair-todas' || r.padrao.startsWith('/api/equipe')) continue; // mexem na própria sessão / criariam gente: já cobertos em equipe.test.js
    const caminhos = r.chaves.length ? IDS.map((v) => r.padrao.replace(/:[a-z_]+/gi, v)) : [r.padrao];
    for (const caminho of caminhos) {
      const consultas = r.metodo === 'GET' ? CONSULTAS : [''];
      for (const q of consultas) {
        for (const corpo of r.metodo === 'GET' || r.metodo === 'DELETE' ? [undefined] : CORPOS) {
          if (++chamadas % 400 === 0) sis.relogio.t += 61_000; // o limitador de requisições anda com o relógio do teste
          let res;
          try { res = await c.req(r.metodo, caminho + q, corpo, { headers: r.opts.idempotente ? { 'Idempotency-Key': `k${chamadas}`.padEnd(20, 'x') } : {}, texto: r.opts.texto && typeof corpo === 'string' }); } catch (e) { problemas.push(`${rotulo} ${r.metodo} ${caminho}${q.slice(0, 40)} -> exceção ${e.message}`); continue; }
          if (res.status >= 500) problemas.push(`${rotulo} ${r.metodo} ${caminho}${q.slice(0, 40)} corpo=${JSON.stringify(corpo)?.slice(0, 40)} -> ${res.status} ${res.erro?.code ?? res.texto.slice(0, 80)}`);
        }
      }
    }
  }
  return problemas;
}

async function entrarComo(sis, dono, papel) {
  await dono.post('/api/reautenticar', { senha: SENHA_FORTE }); // a varredura anda o relógio: a confirmação de senha do dono venceu
  const r = await dono.post('/api/equipe', { nome: `Pessoa ${papel}`, papel });
  const c = sis.cliente(); await c.get('/api/sessao');
  await c.post('/api/login', { login: r.data.login, senha: r.data.senha_provisoria });
  await c.post('/api/senha/trocar', { senha_atual: r.data.senha_provisoria, senha_nova: 'Lume!Verde#Telhado59' });
  const ini = await c.post('/api/mfa/iniciar');
  await c.post('/api/mfa/confirmar', { codigo: codigoTotp(ini.data.segredo, passoAtual(sis.relogio.t)) });
  return c;
}

test('vistoria: nenhuma rota devolve erro 500 com entradas absurdas (dono e todos os papéis)', { timeout: 280_000 }, async () => {
  const sis = await criarSistema();
  try {
    const dono = await entrarCompleto(sis);
    const p = await novoProduto(dono);
    await criarEnderecos(dono, 'PICKING', { predios: 1, pos: 2 });
    assert.ok(p.id);
    const todos = [...await varrer(sis, dono, 'dono')];
    for (const papel of Object.keys(PAPEIS)) todos.push(...await varrer(sis, await entrarComo(sis, dono, papel), papel));
    assert.deepEqual(todos.slice(0, 25), [], `${todos.length} resposta(s) 5xx`);
  } finally { await sis.parar(); }
});

// Cria o .env local com segredos aleatórios. Não imprime nenhum valor secreto e nunca sobrescreve um .env existente.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gerarSenhaForte } from '../src/security/password.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destino = path.join(raiz, '.env');

if (fs.existsSync(destino)) {
  console.log('.env já existe: nada foi alterado.');
  process.exit(0);
}
const hex = () => crypto.randomBytes(32).toString('hex');
const login = Array.from(crypto.randomBytes(11), (b) => b % 10).join('');
let modelo = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
const preencher = (chave, valor) => { modelo = modelo.replace(new RegExp(`^${chave}=.*$`, 'm'), `${chave}=${valor}`); };
preencher('PEPPER', hex());
preencher('HMAC_KEY', hex());
preencher('FIELD_KEY', hex());
preencher('ADMIN_LOGIN', login);
preencher('ADMIN_INITIAL_PASSWORD', gerarSenhaForte(18));
fs.writeFileSync(destino, modelo, { mode: 0o600 });
console.log('.env criado com segredos aleatórios.');
console.log('Abra o arquivo .env para ver ADMIN_LOGIN e ADMIN_INITIAL_PASSWORD, depois rode: npm run criar-admin');

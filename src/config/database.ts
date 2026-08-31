/**
 * Conexão com o MySQL.
 *
 * Até o 2º semestre o painel web falava com SQLite/Turso pelo `@libsql/client`.
 * A partir da migração deste semestre ele lê e escreve nas MESMAS tabelas que a
 * aplicação desktop em Java usa — `ingredientes` e `movimentacoes_estoque`, no
 * banco `custo_certo`. Antes disso, as duas interfaces mostravam bancos
 * diferentes: o que o operador dava baixa na balança pelo navegador não aparecia
 * na tela de estoque do Java, e vice-versa.
 *
 * O acesso é feito por um *pool* de conexões. Diferente do JDBC do desktop, que
 * abre e fecha uma conexão por operação, aqui um punhado de conexões fica aberto
 * e é reaproveitado — um servidor HTTP atende vários pedidos ao mesmo tempo e
 * abrir conexão a cada um seria caro.
 *
 * As funções abaixo mantêm de propósito a mesma assinatura que o cliente libSQL
 * expunha (`execute`, `batch`, `executeMultiple`). Assim os repositories, que são
 * a camada que de fato escreve SQL, continuaram valendo com poucas mudanças —
 * apenas o dialeto do SQL precisou ser ajustado.
 *
 * Variáveis de ambiente (veja `.env.example`), com os mesmos nomes que o
 * `config.properties` do desktop usa:
 *
 *   DB_HOST=localhost      máquina onde o MySQL roda
 *   DB_PORT=3306
 *   DB_NAME=custo_certo
 *   DB_USER=custocerto
 *   DB_PASSWORD=...
 */

import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Tipos que podem ser enviados como parâmetro de um comando SQL. */
export type ValorSql = string | number | boolean | null;

/** Uma linha devolvida pelo banco, com as colunas em snake_case. */
export type Linha = Record<string, unknown>;

/**
 * Resultado de um comando.
 *
 * Os três campos existem para que os repositories não precisem saber se o
 * comando foi um SELECT ou um INSERT: `rows` vem preenchido no primeiro caso,
 * `lastInsertRowid` e `rowsAffected` no segundo.
 */
export interface Resultado {
  rows: Linha[];
  rowsAffected: number;
  lastInsertRowid: number;
}

/** Um comando com os seus parâmetros, para uso em `execute` e `batch`. */
export interface Comando {
  sql: string;
  args?: ValorSql[];
}

let pool: Pool | null = null;
let initialized = false;

/**
 * Cria o pool na primeira chamada e o devolve nas seguintes.
 *
 * `dateStrings: true` é essencial: sem ele, o driver converte DATE e DATETIME em
 * objetos `Date` do JavaScript, e a validade "2026-12-31" chegaria ao navegador
 * como "Wed Dec 31 2026 00:00:00 GMT-0300". O frontend e o app desktop esperam
 * a data no formato do banco, então ela é lida como texto.
 */
export function getPool(): Pool {
  if (pool) return pool;

  const host = process.env.DB_HOST || 'localhost';
  const database = process.env.DB_NAME || 'custo_certo';
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (!user) {
    throw new Error(
      '❌ DB_USER não definida. Crie um .env baseado em .env.example.',
    );
  }

  pool = mysql.createPool({
    host,
    port: Number(process.env.DB_PORT) || 3306,
    database,
    user,
    password: password ?? '',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4_unicode_ci',
    dateStrings: true,
    timezone: 'local',
  });

  console.log(`🗄️  Banco conectado: MySQL em ${host}:${process.env.DB_PORT || 3306}/${database}`);
  return pool;
}

/**
 * Normaliza o que o driver devolve para o formato que os repositories esperam.
 *
 * Um SELECT devolve um array de linhas; um INSERT/UPDATE/DELETE devolve um
 * cabeçalho com `insertId` e `affectedRows`.
 */
function normalizar(retorno: unknown): Resultado {
  if (Array.isArray(retorno)) {
    return {
      rows: retorno as RowDataPacket[] as Linha[],
      rowsAffected: 0,
      lastInsertRowid: 0,
    };
  }

  const cabecalho = retorno as ResultSetHeader;
  return {
    rows: [],
    rowsAffected: Number(cabecalho?.affectedRows ?? 0),
    lastInsertRowid: Number(cabecalho?.insertId ?? 0),
  };
}

/**
 * Executa um comando único.
 *
 * Aceita tanto uma string (comando sem parâmetros) quanto `{ sql, args }`.
 * Quando há parâmetros, usa `execute`, que envia um *prepared statement*: os
 * valores viajam separados do texto do comando e por isso não conseguem alterar
 * o significado dele. É a mesma proteção contra injeção de SQL que o
 * `PreparedStatement` dá no lado Java.
 */
export async function execute(comando: string | Comando): Promise<Resultado> {
  const db = getPool();

  if (typeof comando === 'string') {
    const [retorno] = await db.query(comando);
    return normalizar(retorno);
  }

  const [retorno] = await db.execute(comando.sql, comando.args ?? []);
  return normalizar(retorno);
}

/**
 * Executa vários comandos dentro de uma única transação.
 *
 * Ou todos são gravados, ou nenhum é. É o que garante que registrar uma compra
 * não deixe o estoque somado sem a linha correspondente no histórico, caso o
 * servidor caia no meio da operação.
 *
 * O segundo parâmetro existe apenas por compatibilidade com a assinatura que o
 * cliente libSQL tinha, e é ignorado.
 */
export async function batch(comandos: Comando[], _modo?: string): Promise<Resultado[]> {
  const db = getPool();
  const conexao: PoolConnection = await db.getConnection();

  try {
    await conexao.beginTransaction();

    const resultados: Resultado[] = [];
    for (const comando of comandos) {
      const [retorno] = await conexao.execute(comando.sql, comando.args ?? []);
      resultados.push(normalizar(retorno));
    }

    await conexao.commit();
    return resultados;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/**
 * Executa vários comandos em transação, quando um depende do resultado do outro.
 *
 * `batch` recebe todos os comandos de uma vez e não serve para isso: gravar uma
 * ficha técnica exige inserir a receita, ler o id gerado e só então inserir os
 * itens que apontam para ele. Aqui o callback recebe uma função de execução
 * amarrada à mesma conexão, e portanto à mesma transação.
 *
 * Ou tudo é gravado, ou nada é — um produto nunca fica com a ficha pela metade.
 */
export async function transacao<T>(
  fn: (executar: (comando: string | Comando) => Promise<Resultado>) => Promise<T>,
): Promise<T> {
  const db = getPool();
  const conexao: PoolConnection = await db.getConnection();

  try {
    await conexao.beginTransaction();

    const executar = async (comando: string | Comando): Promise<Resultado> => {
      if (typeof comando === 'string') {
        const [retorno] = await conexao.query(comando);
        return normalizar(retorno);
      }
      const [retorno] = await conexao.execute(comando.sql, comando.args ?? []);
      return normalizar(retorno);
    };

    const resultado = await fn(executar);
    await conexao.commit();
    return resultado;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/**
 * Executa um script com vários comandos separados por ponto e vírgula.
 *
 * Usada apenas para aplicar o schema. Os comentários de linha são removidos
 * antes da divisão, e comandos vazios são descartados.
 */
export async function executeMultiple(script: string): Promise<void> {
  const db = getPool();

  const comandos = script
    .split('\n')
    .filter((linha) => !linha.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  for (const comando of comandos) {
    await db.query(comando);
  }
}

/**
 * Objeto com a mesma interface que os repositories já usavam.
 *
 * Mantê-lo evitou reescrever a camada de acesso a dados inteira na migração:
 * as chamadas `db.execute(...)` e `db.batch(...)` continuam idênticas.
 */
export function getDb() {
  return { execute, batch, executeMultiple, transacao };
}

/** Tabelas que o painel web precisa encontrar no banco para funcionar. */
const TABELAS_NECESSARIAS = ['ingredientes', 'movimentacoes_estoque',
                             'receitas', 'receita_ingredientes', 'vendas'];

/**
 * Descobre quais das tabelas necessárias ainda não existem no banco.
 */
async function tabelasAusentes(): Promise<string[]> {
  const marcadores = TABELAS_NECESSARIAS.map(() => '?').join(', ');

  const { rows } = await execute({
    sql: `SELECT table_name AS nome
            FROM information_schema.tables
           WHERE table_schema = DATABASE()
             AND table_name IN (${marcadores})`,
    args: TABELAS_NECESSARIAS,
  });

  const presentes = new Set(rows.map((linha) => String(linha.nome).toLowerCase()));
  return TABELAS_NECESSARIAS.filter((tabela) => !presentes.has(tabela));
}

/**
 * Garante que as tabelas existem antes de o servidor começar a atender.
 *
 * Confere primeiro, e só executa o DDL se algo estiver faltando. A ordem importa:
 * a conta que a aplicação usa (`custocerto`) tem de propósito apenas SELECT,
 * INSERT, UPDATE e DELETE no banco `custo_certo` — nenhum privilégio de criar ou
 * apagar tabela. É o princípio do menor privilégio: se um dia alguém conseguir
 * injetar SQL por uma rota, o estrago possível não inclui derrubar o schema.
 *
 * Como o MySQL exige o privilégio de CREATE mesmo para um
 * `CREATE TABLE IF NOT EXISTS` sobre tabela que já existe, rodar o DDL a cada
 * inicialização faria o servidor recusar a subir. Daí a verificação antes.
 *
 * Quando falta alguma tabela e a conta não pode criá-la, a mensagem aponta para
 * os scripts oficiais — que vivem no repositório do app desktop e são
 * executados como root.
 *
 * Procura o schema em duas localizações para suportar tanto execução via tsx
 * (src/) quanto via node após o build (dist/).
 */
export async function initSchema(): Promise<void> {
  if (initialized) return;

  const ausentes = await tabelasAusentes();

  if (ausentes.length === 0) {
    initialized = true;
    console.log('✅ Tabelas encontradas: ' + TABELAS_NECESSARIAS.join(', '));
    return;
  }

  const candidates = [
    resolve(__dirname, '..', 'database', 'schema.sql'),
    resolve(process.cwd(), 'src', 'database', 'schema.sql'),
    resolve(process.cwd(), 'dist', 'database', 'schema.sql'),
  ];

  let schemaSql: string | null = null;
  for (const path of candidates) {
    try {
      schemaSql = readFileSync(path, 'utf-8');
      break;
    } catch {
      // tenta próximo
    }
  }

  if (!schemaSql) {
    throw new Error(
      `❌ schema.sql não encontrado em nenhum dos caminhos: ${candidates.join(', ')}`,
    );
  }

  try {
    await executeMultiple(schemaSql);
  } catch (erro) {
    const codigo = (erro as { code?: string }).code;
    if (codigo === 'ER_TABLEACCESS_DENIED_ERROR' || codigo === 'ER_DBACCESS_DENIED_ERROR') {
      throw new Error(
        `❌ Faltam as tabelas ${ausentes.join(' e ')} no banco, e a conta "${process.env.DB_USER}" `
        + 'não tem permissão para criá-las (ela só pode ler e gravar dados, de propósito).\n'
        + '   Rode o schema como root. Os scripts oficiais estão no repositório\n'
        + '   do app desktop (Custo-Certo/versao_3semestre):\n'
        + '     mysql -u root -p < desktop/src/main/resources/sql/02_schema_insumos.sql',
      );
    }
    throw erro;
  }

  initialized = true;
  console.log('✅ Schema aplicado');
}

/**
 * Encerra o pool. Chamada no desligamento do servidor.
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    initialized = false;
  }
}

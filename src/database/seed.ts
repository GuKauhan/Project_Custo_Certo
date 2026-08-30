/**
 * Carga inicial do banco.
 *
 * Insere dados de demonstração SE a tabela de ingredientes estiver vazia.
 * Idempotente — rodar várias vezes não duplica nada.
 *
 * ------------------------------------------------------------------------
 * ATENÇÃO — este arquivo tem um irmão em outro repositório.
 *
 * O banco `custo_certo` é compartilhado com a aplicação desktop, que vive em
 * `Custo-Certo/versao_3semestre`. Lá existe o script
 * `desktop/src/main/resources/sql/02_schema_insumos.sql`, que é a **fonte
 * oficial** desta carga — é o arquivo entregue na matéria de Banco de Dados.
 *
 * As linhas abaixo repetem aquele script, com os MESMOS ids e os MESMOS
 * valores. Isso é o que torna as duas cargas compatíveis: como os dois lados
 * usam id explícito e ignoram duplicidade, tanto faz quem rodar primeiro. Se
 * um dos lados mudar um valor, mude no outro também.
 * ------------------------------------------------------------------------
 *
 * Pode ser invocado de duas formas:
 *  1) CLI:  npm run seed
 *  2) Bootstrap automático: AUTO_SEED=true no .env (chamado em server.ts)
 */

import 'dotenv/config';
import { getDb, initSchema, closeDb } from '../config/database.js';

/** Um insumo da carga inicial, com o id que ele tem no script oficial. */
interface SeedIngrediente {
  id: number;
  nome: string;
  unidade: 'kg' | 'g' | 'L' | 'ml' | 'un';
  preco: number;
  qtd: number;
  qtdMax: number;
  validade: string | null;
}

/** Uma movimentação da carga inicial. `preco` é nulo nas saídas. */
interface SeedMovimentacao {
  id: number;
  ingredienteId: number;
  tipo: 'entrada' | 'saida';
  quantidade: number;
  preco: number | null;
  observacao: string;
  data: string;
}

/**
 * Oito insumos. Três existem para demonstrar comportamentos específicos:
 * o id 2 está com a validade vencida, o id 3 está com 16% do estoque, e o
 * id 8 não tem validade nenhuma.
 */
const SEED_INGREDIENTES: SeedIngrediente[] = [
  { id: 1, nome: 'Café em Grãos Arábica',  unidade: 'kg', preco: 52.90, qtd: 3.2,   qtdMax: 5.0,    validade: '2026-12-31' },
  { id: 2, nome: 'Leite Integral',         unidade: 'L',  preco: 5.60,  qtd: 7.5,   qtdMax: 10.0,   validade: '2026-08-10' },
  { id: 3, nome: 'Açúcar Cristal',         unidade: 'kg', preco: 4.90,  qtd: 0.8,   qtdMax: 5.0,    validade: '2027-06-01' },
  { id: 4, nome: 'Farinha de Trigo',       unidade: 'kg', preco: 3.20,  qtd: 4.2,   qtdMax: 8.0,    validade: '2026-09-15' },
  { id: 5, nome: 'Chocolate em Pó 50%',    unidade: 'kg', preco: 28.40, qtd: 1.5,   qtdMax: 3.0,    validade: '2027-01-20' },
  { id: 6, nome: 'Creme de Leite Fresco',  unidade: 'L',  preco: 18.90, qtd: 2.0,   qtdMax: 4.0,    validade: '2026-09-05' },
  { id: 7, nome: 'Canela em Pó',           unidade: 'g',  preco: 0.12,  qtd: 450.0, qtdMax: 1000.0, validade: '2027-03-10' },
  { id: 8, nome: 'Copo Descartável 300ml', unidade: 'un', preco: 0.18,  qtd: 320.0, qtdMax: 500.0,  validade: null },
];

/**
 * Dez movimentações: seis entradas e quatro saídas. As entradas do mesmo
 * insumo com preços diferentes são o que alimenta o gráfico de evolução.
 */
const SEED_MOVIMENTACOES: SeedMovimentacao[] = [
  { id: 1,  ingredienteId: 1, tipo: 'entrada', quantidade: 5.0,  preco: 49.90, observacao: 'Compra mensal - fornecedor Serra Negra', data: '2026-07-03' },
  { id: 2,  ingredienteId: 2, tipo: 'entrada', quantidade: 10.0, preco: 5.40,  observacao: 'Reposição semanal',                      data: '2026-07-06' },
  { id: 3,  ingredienteId: 3, tipo: 'entrada', quantidade: 5.0,  preco: 4.75,  observacao: 'Compra mensal',                          data: '2026-07-03' },
  { id: 4,  ingredienteId: 1, tipo: 'saida',   quantidade: 1.8,  preco: null,  observacao: 'Consumo pesado na balança',              data: '2026-07-20' },
  { id: 5,  ingredienteId: 2, tipo: 'saida',   quantidade: 2.5,  preco: null,  observacao: 'Consumo pesado na balança',              data: '2026-07-22' },
  { id: 6,  ingredienteId: 1, tipo: 'entrada', quantidade: 2.0,  preco: 52.90, observacao: 'Reposição - preço subiu 6%',             data: '2026-08-04' },
  { id: 7,  ingredienteId: 5, tipo: 'entrada', quantidade: 3.0,  preco: 28.40, observacao: 'Primeira compra de chocolate',           data: '2026-08-04' },
  { id: 8,  ingredienteId: 3, tipo: 'saida',   quantidade: 4.2,  preco: null,  observacao: 'Consumo do mês - confeitaria',           data: '2026-08-12' },
  { id: 9,  ingredienteId: 6, tipo: 'entrada', quantidade: 4.0,  preco: 18.90, observacao: 'Compra semanal',                         data: '2026-08-18' },
  { id: 10, ingredienteId: 5, tipo: 'saida',   quantidade: 1.5,  preco: null,  observacao: 'Consumo pesado na balança',              data: '2026-08-25' },
];

export async function runSeed(): Promise<{ inserted: number }> {
  const db = getDb();
  await initSchema();

  // Só popula se o banco estiver vazio. Se a aplicação desktop já rodou os
  // scripts oficiais nesta máquina, não há nada a fazer aqui.
  const { rows } = await db.execute('SELECT COUNT(*) AS total FROM ingredientes');
  const total = Number(rows[0]?.total ?? 0);

  if (total > 0) {
    console.log(`⏭️  Seed pulado: banco já tem ${total} ingrediente(s)`);
    return { inserted: 0 };
  }

  for (const ing of SEED_INGREDIENTES) {
    await db.execute({
      sql: `INSERT IGNORE INTO ingredientes (id, nome, unidade, preco, qtd, qtd_max, validade)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [ing.id, ing.nome, ing.unidade, ing.preco, ing.qtd, ing.qtdMax, ing.validade],
    });
  }

  for (const mov of SEED_MOVIMENTACOES) {
    await db.execute({
      sql: `INSERT IGNORE INTO movimentacoes_estoque
            (id, ingrediente_id, tipo, quantidade, preco_unitario, observacao, data)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [mov.id, mov.ingredienteId, mov.tipo, mov.quantidade, mov.preco, mov.observacao, mov.data],
    });
  }

  console.log(
    `🌱 Seed concluído: ${SEED_INGREDIENTES.length} insumos e `
    + `${SEED_MOVIMENTACOES.length} movimentações`,
  );
  return { inserted: SEED_INGREDIENTES.length };
}

// Permite rodar como CLI: `npm run seed`
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runSeed()
    .then(() => closeDb())
    .catch((err) => {
      console.error('❌ Erro no seed:', err);
      process.exit(1);
    });
}

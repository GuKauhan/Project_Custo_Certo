/**
 * Camada de acesso a dados das fichas técnicas.
 *
 * Responsável APENAS por SQL e mapeamento snake_case <-> camelCase.
 *
 * O custo do produto não é lido de nenhuma coluna: ele é somado a cada consulta
 * a partir do preço que o insumo tem agora. É de propósito — guardar o custo em
 * coluna significaria recalcular o cardápio inteiro toda vez que um fornecedor
 * reajustasse um preço, e conviver com números velhos até alguém lembrar.
 */

import { getDb, transacao } from '../config/database.js';
import type {
  ItemFicha,
  Receita,
  ReceitaInput,
  ReceitaUpdateInput,
} from '../models/receita.model.js';
import type { Unidade } from '../models/ingrediente.model.js';

/** Converte uma linha de ficha, já com os dados do insumo resolvidos. */
function rowToItem(row: Record<string, unknown>): ItemFicha {
  const quantidade = Number(row.quantidade);
  const precoUnitario = Number(row.preco);

  return {
    id: Number(row.id),
    ingredienteId: Number(row.ingrediente_id),
    nome: String(row.nome_ingrediente),
    unidade: row.unidade as Unidade,
    quantidade,
    precoUnitario,
    custo: Number((quantidade * precoUnitario).toFixed(4)),
  };
}

/** Monta o produto completo a partir da linha e das suas fichas. */
function montarReceita(row: Record<string, unknown>, itens: ItemFicha[]): Receita {
  const precoVenda = Number(row.preco_venda);
  const custo = Number(itens.reduce((soma, i) => soma + i.custo, 0).toFixed(2));

  return {
    id: Number(row.id),
    nome: String(row.nome),
    descricao: row.descricao ? String(row.descricao) : null,
    precoVenda,
    ativo: Boolean(row.ativo),
    itens,
    custo,
    margem: Number((precoVenda - custo).toFixed(2)),
    percentualCusto: precoVenda > 0 ? (custo / precoVenda) * 100 : 0,
    temFicha: itens.length > 0,
    criadoEm: row.criado_em ? String(row.criado_em) : undefined,
    atualizadoEm: row.atualizado_em ? String(row.atualizado_em) : undefined,
  };
}

export const receitaRepository = {
  /**
   * Lista os produtos com as fichas preenchidas.
   *
   * Duas consultas em vez de uma junção só: a junção traria a receita repetida
   * uma vez por insumo, e remontar os objetos a partir disso dá mais trabalho e
   * mais chance de erro do que carregar as fichas e distribuí-las por chave.
   */
  async listarTodas(): Promise<Receita[]> {
    const db = getDb();

    const { rows } = await db.execute(
      `SELECT id, nome, descricao, preco_venda, ativo, criado_em, atualizado_em
         FROM receitas ORDER BY nome`,
    );

    if (rows.length === 0) return [];

    const { rows: itemRows } = await db.execute(`
      SELECT ri.id, ri.receita_id, ri.ingrediente_id, ri.quantidade,
             i.nome AS nome_ingrediente, i.unidade, i.preco
        FROM receita_ingredientes ri
        JOIN ingredientes i ON i.id = ri.ingrediente_id
       ORDER BY i.nome
    `);

    const porReceita: Record<number, ItemFicha[]> = {};
    for (const row of itemRows) {
      const r = row as Record<string, unknown>;
      const receitaId = Number(r.receita_id);
      if (!porReceita[receitaId]) porReceita[receitaId] = [];
      porReceita[receitaId].push(rowToItem(r));
    }

    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return montarReceita(r, porReceita[Number(r.id)] ?? []);
    });
  },

  /** Busca um produto pela chave. Retorna null se não existir. */
  async buscarPorId(id: number): Promise<Receita | null> {
    const db = getDb();

    const { rows } = await db.execute({
      sql: `SELECT id, nome, descricao, preco_venda, ativo, criado_em, atualizado_em
              FROM receitas WHERE id = ? LIMIT 1`,
      args: [id],
    });
    if (rows.length === 0) return null;

    const { rows: itemRows } = await db.execute({
      sql: `SELECT ri.id, ri.receita_id, ri.ingrediente_id, ri.quantidade,
                   i.nome AS nome_ingrediente, i.unidade, i.preco
              FROM receita_ingredientes ri
              JOIN ingredientes i ON i.id = ri.ingrediente_id
             WHERE ri.receita_id = ?
             ORDER BY i.nome`,
      args: [id],
    });

    const itens = itemRows.map((r) => rowToItem(r as Record<string, unknown>));
    return montarReceita(rows[0] as Record<string, unknown>, itens);
  },

  /** Cria o produto e a ficha dentro de uma transação. */
  async criar(input: ReceitaInput): Promise<Receita> {
    const id = await transacao(async (executar) => {
      const criado = await executar({
        sql: `INSERT INTO receitas (nome, descricao, preco_venda, ativo)
              VALUES (?, ?, ?, ?)`,
        args: [
          input.nome,
          input.descricao ?? null,
          input.precoVenda,
          input.ativo ?? true,
        ],
      });

      const receitaId = Number(criado.lastInsertRowid);

      for (const item of input.itens) {
        await executar({
          sql: `INSERT INTO receita_ingredientes (receita_id, ingrediente_id, quantidade)
                VALUES (?, ?, ?)`,
          args: [receitaId, item.ingredienteId, item.quantidade],
        });
      }

      return receitaId;
    });

    const criado = await this.buscarPorId(id);
    if (!criado) throw new Error('Falha ao recuperar o produto recém-criado');
    return criado;
  },

  /**
   * Atualiza o produto e, se `itens` vier no payload, substitui a ficha inteira.
   *
   * A ficha é apagada e regravada em vez de comparada linha a linha. Para meia
   * dúzia de insumos, calcular o que mudou custaria mais código do que a
   * operação economiza — e daria mais chance de deixar linha órfã.
   */
  async atualizar(id: number, update: ReceitaUpdateInput): Promise<Receita | null> {
    const atual = await this.buscarPorId(id);
    if (!atual) return null;

    await transacao(async (executar) => {
      const sets: string[] = [];
      const args: (string | number | boolean | null)[] = [];

      if (update.nome !== undefined) { sets.push('nome = ?'); args.push(update.nome); }
      if (update.descricao !== undefined) { sets.push('descricao = ?'); args.push(update.descricao); }
      if (update.precoVenda !== undefined) { sets.push('preco_venda = ?'); args.push(update.precoVenda); }
      if (update.ativo !== undefined) { sets.push('ativo = ?'); args.push(update.ativo); }

      if (sets.length > 0) {
        args.push(id);
        await executar({
          sql: `UPDATE receitas SET ${sets.join(', ')} WHERE id = ?`,
          args,
        });
      }

      if (update.itens !== undefined) {
        await executar({
          sql: 'DELETE FROM receita_ingredientes WHERE receita_id = ?',
          args: [id],
        });

        for (const item of update.itens) {
          await executar({
            sql: `INSERT INTO receita_ingredientes (receita_id, ingrediente_id, quantidade)
                  VALUES (?, ?, ?)`,
            args: [id, item.ingredienteId, item.quantidade],
          });
        }
      }
    });

    return this.buscarPorId(id);
  },

  /**
   * Remove o produto. A ficha sai em cascata.
   *
   * O banco recusa se o produto já tiver vendas: a chave estrangeira de
   * `vendas` usa ON DELETE RESTRICT, para o histórico de faturamento não ficar
   * órfão.
   */
  async remover(id: number): Promise<boolean> {
    const db = getDb();
    const resultado = await db.execute({
      sql: 'DELETE FROM receitas WHERE id = ?',
      args: [id],
    });
    return Number(resultado.rowsAffected) > 0;
  },

  /** Conta quantas vendas existem para um produto. */
  async contarVendas(receitaId: number): Promise<number> {
    const db = getDb();
    const { rows } = await db.execute({
      sql: 'SELECT COUNT(*) AS total FROM vendas WHERE receita_id = ?',
      args: [receitaId],
    });
    return Number((rows[0] as Record<string, unknown>)?.total ?? 0);
  },
};

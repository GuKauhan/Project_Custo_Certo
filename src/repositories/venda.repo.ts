/**
 * Camada de acesso a dados das vendas.
 *
 * Responsável APENAS por SQL e mapeamento snake_case <-> camelCase.
 *
 * Registrar uma venda NÃO mexe no estoque, e isso é intencional. A baixa dos
 * insumos acontece pela balança, em `movimentacoes_estoque`, por um caminho
 * independente. É essa independência que permite comparar depois quanto as
 * vendas pediam com quanto de fato saiu — se a venda abatesse o estoque
 * sozinha, os dois números seriam iguais por construção e a comparação não
 * diria nada.
 */

import { getDb } from '../config/database.js';
import type { Venda, VendaInput } from '../models/receita.model.js';

/** Teto de linhas por consulta, para a resposta não crescer sem limite. */
const LIMITE_PADRAO = 500;

/** Converte a linha do banco no modelo, já com os totais calculados. */
function rowToVenda(row: Record<string, unknown>): Venda {
  const quantidade = Number(row.quantidade);
  const precoUnitario = Number(row.preco_unitario);
  const custoUnitario = Number(row.custo_unitario ?? 0);

  const total = Number((quantidade * precoUnitario).toFixed(2));
  const custoTotal = Number((quantidade * custoUnitario).toFixed(2));

  return {
    id: Number(row.id),
    receitaId: Number(row.receita_id),
    nomeReceita: String(row.nome_receita),
    quantidade,
    precoUnitario,
    custoUnitario,
    total,
    custoTotal,
    margemTotal: Number((total - custoTotal).toFixed(2)),
    observacao: row.observacao ? String(row.observacao) : null,
    data: String(row.data),
  };
}

export const vendaRepository = {
  /**
   * Lista as vendas de um período, da mais recente para a mais antiga.
   *
   * O custo unitário vem por subconsulta, calculado a partir da ficha técnica e
   * dos preços atuais dos insumos — assim a listagem já mostra margem sem
   * precisar carregar as receitas inteiras.
   */
  async listar(inicio: string, fim: string, limite = LIMITE_PADRAO): Promise<Venda[]> {
    const db = getDb();

    const { rows } = await db.execute({
      sql: `SELECT v.id, v.receita_id, v.quantidade, v.preco_unitario,
                   v.observacao, v.data,
                   r.nome AS nome_receita,
                   (SELECT COALESCE(SUM(ri.quantidade * i.preco), 0)
                      FROM receita_ingredientes ri
                      JOIN ingredientes i ON i.id = ri.ingrediente_id
                     WHERE ri.receita_id = v.receita_id) AS custo_unitario
              FROM vendas v
              JOIN receitas r ON r.id = v.receita_id
             WHERE v.data BETWEEN ? AND ?
             ORDER BY v.data DESC, v.id DESC
             LIMIT ?`,
      args: [inicio, fim, limite],
    });

    return rows.map((r) => rowToVenda(r as Record<string, unknown>));
  },

  /** Busca uma venda pela chave. Retorna null se não existir. */
  async buscarPorId(id: number): Promise<Venda | null> {
    const db = getDb();

    const { rows } = await db.execute({
      sql: `SELECT v.id, v.receita_id, v.quantidade, v.preco_unitario,
                   v.observacao, v.data,
                   r.nome AS nome_receita,
                   (SELECT COALESCE(SUM(ri.quantidade * i.preco), 0)
                      FROM receita_ingredientes ri
                      JOIN ingredientes i ON i.id = ri.ingrediente_id
                     WHERE ri.receita_id = v.receita_id) AS custo_unitario
              FROM vendas v
              JOIN receitas r ON r.id = v.receita_id
             WHERE v.id = ? LIMIT 1`,
      args: [id],
    });

    if (rows.length === 0) return null;
    return rowToVenda(rows[0] as Record<string, unknown>);
  },

  /** Registra uma venda. */
  async criar(input: VendaInput): Promise<Venda> {
    const db = getDb();

    const resultado = await db.execute({
      sql: `INSERT INTO vendas (receita_id, quantidade, preco_unitario, observacao, data)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        input.receitaId,
        input.quantidade,
        input.precoUnitario,
        input.observacao ?? null,
        input.data ?? dataDeHoje(),
      ],
    });

    const criada = await this.buscarPorId(Number(resultado.lastInsertRowid));
    if (!criada) throw new Error('Falha ao recuperar a venda recém-criada');
    return criada;
  },

  /** Remove um lançamento de venda. Existe para corrigir digitação. */
  async remover(id: number): Promise<boolean> {
    const db = getDb();
    const resultado = await db.execute({
      sql: 'DELETE FROM vendas WHERE id = ?',
      args: [id],
    });
    return Number(resultado.rowsAffected) > 0;
  },
};

/**
 * Data de hoje no fuso da máquina, no formato YYYY-MM-DD.
 *
 * `toISOString()` devolveria a data em UTC — depois das 21h no horário de
 * Brasília isso já é o dia seguinte. A aplicação desktop grava data local, e as
 * duas escrevem na mesma tabela: elas precisam concordar sobre que dia é hoje.
 */
function dataDeHoje(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

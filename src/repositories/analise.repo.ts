/**
 * Camada de acesso a dados dos indicadores de negócio.
 *
 * Separada dos demais repositories porque a natureza do SQL é outra: aqui não
 * há inclusão nem alteração, só agregações que cruzam vendas, fichas técnicas e
 * movimentações de estoque. Concentrá-las também deixa evidente onde mora a
 * inteligência do sistema.
 *
 * As mesmas consultas existem no lado Java, em `IndicadoresDAO`. As duas
 * interfaces precisam dar o mesmo número para o mesmo período — se uma mudar de
 * fórmula, a outra tem de mudar junto.
 */

import { getDb } from '../config/database.js';
import type { Unidade } from '../models/ingrediente.model.js';

/** Totais brutos do período, antes dos percentuais serem derivados. */
export interface TotaisPeriodo {
  receita: number;
  unidadesVendidas: number;
  lancamentos: number;
  custoTeorico: number;
  custoReal: number;
  compras: number;
}

/** Linha bruta de giro por insumo. */
export interface LinhaGiro {
  ingredienteId: number;
  nome: string;
  unidade: Unidade;
  saldo: number;
  precoUnitario: number;
  consumoPeriodo: number;
  compradoPeriodo: number;
}

/** Linha bruta de comparação entre consumo teórico e real. */
export interface LinhaVariancia {
  ingredienteId: number;
  nome: string;
  unidade: Unidade;
  precoUnitario: number;
  teorico: number;
  real: number;
}

/** Linha bruta de desempenho por produto. */
export interface LinhaDesempenho {
  receitaId: number;
  nome: string;
  precoMedio: number;
  custoUnitario: number;
  unidadesVendidas: number;
  temFicha: boolean;
}

export const analiseRepository = {
  /**
   * Apura os totais financeiros do período.
   *
   * São três perguntas diferentes, e por isso três consultas: quanto se faturou,
   * quanto isso deveria ter custado pelas fichas, e quanto de fato saiu e entrou
   * no estoque.
   */
  async apurarTotais(inicio: string, fim: string): Promise<TotaisPeriodo> {
    const db = getDb();

    const { rows: vendasRows } = await db.execute({
      sql: `SELECT COALESCE(SUM(quantidade * preco_unitario), 0) AS receita,
                   COALESCE(SUM(quantidade), 0)                  AS unidades,
                   COUNT(*)                                      AS lancamentos
              FROM vendas
             WHERE data BETWEEN ? AND ?`,
      args: [inicio, fim],
    });
    const v = vendasRows[0] as Record<string, unknown>;

    // Cada venda puxa a ficha do seu produto, e cada linha da ficha é avaliada
    // pelo preço que o insumo tem hoje.
    const { rows: teoricoRows } = await db.execute({
      sql: `SELECT COALESCE(SUM(v.quantidade * ri.quantidade * i.preco), 0) AS custo
              FROM vendas v
              JOIN receita_ingredientes ri ON ri.receita_id = v.receita_id
              JOIN ingredientes i          ON i.id = ri.ingrediente_id
             WHERE v.data BETWEEN ? AND ?`,
      args: [inicio, fim],
    });

    // Saídas e entradas saem da mesma tabela, separadas pelo tipo. Nas entradas
    // o preço pago está na própria movimentação; nas saídas não há preço, então
    // o custo é avaliado pelo preço atual do insumo.
    const { rows: estoqueRows } = await db.execute({
      sql: `SELECT COALESCE(SUM(CASE WHEN m.tipo = 'saida'
                                     THEN m.quantidade * i.preco END), 0) AS custo_real,
                   COALESCE(SUM(CASE WHEN m.tipo = 'entrada'
                                     THEN m.quantidade * COALESCE(m.preco_unitario, i.preco)
                                END), 0)                                  AS compras
              FROM movimentacoes_estoque m
              JOIN ingredientes i ON i.id = m.ingrediente_id
             WHERE m.data BETWEEN ? AND ?`,
      args: [inicio, fim],
    });
    const e = estoqueRows[0] as Record<string, unknown>;

    return {
      receita: Number(v?.receita ?? 0),
      unidadesVendidas: Number(v?.unidades ?? 0),
      lancamentos: Number(v?.lancamentos ?? 0),
      custoTeorico: Number((teoricoRows[0] as Record<string, unknown>)?.custo ?? 0),
      custoReal: Number(e?.custo_real ?? 0),
      compras: Number(e?.compras ?? 0),
    };
  },

  /**
   * Levanta, por insumo, o saldo atual e o que girou no período.
   *
   * As junções à esquerda são o ponto da consulta: um insumo sem nenhuma saída
   * precisa aparecer mesmo assim, com consumo zero. Uma junção comum o deixaria
   * de fora, e ele sumiria justamente da tela que existe para mostrar o que
   * está parado.
   */
  async levantarGiro(inicio: string, fim: string): Promise<LinhaGiro[]> {
    const db = getDb();

    const { rows } = await db.execute({
      sql: `SELECT i.id, i.nome, i.unidade, i.qtd, i.preco,
                   COALESCE(saidas.consumo, 0)    AS consumo,
                   COALESCE(entradas.comprado, 0) AS comprado
              FROM ingredientes i
              LEFT JOIN (SELECT ingrediente_id, SUM(quantidade) AS consumo
                           FROM movimentacoes_estoque
                          WHERE tipo = 'saida' AND data BETWEEN ? AND ?
                          GROUP BY ingrediente_id) saidas
                     ON saidas.ingrediente_id = i.id
              LEFT JOIN (SELECT ingrediente_id,
                                SUM(quantidade * COALESCE(preco_unitario, 0)) AS comprado
                           FROM movimentacoes_estoque
                          WHERE tipo = 'entrada' AND data BETWEEN ? AND ?
                          GROUP BY ingrediente_id) entradas
                     ON entradas.ingrediente_id = i.id
             ORDER BY i.nome`,
      args: [inicio, fim, inicio, fim],
    });

    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ingredienteId: Number(r.id),
        nome: String(r.nome),
        unidade: r.unidade as Unidade,
        saldo: Number(r.qtd),
        precoUnitario: Number(r.preco),
        consumoPeriodo: Number(r.consumo),
        compradoPeriodo: Number(r.comprado),
      };
    });
  },

  /**
   * Compara, por insumo, o consumo que as vendas pediam com o que a balança
   * pesou.
   *
   * Descarta os insumos em que os dois lados são zero — não há o que dizer sobre
   * um insumo que ninguém vendeu nem consumiu.
   */
  async compararConsumo(inicio: string, fim: string): Promise<LinhaVariancia[]> {
    const db = getDb();

    const { rows } = await db.execute({
      sql: `SELECT i.id, i.nome, i.unidade, i.preco,
                   COALESCE(previsto.teorico, 0)  AS teorico,
                   COALESCE(medido.quantidade, 0) AS medido
              FROM ingredientes i
              LEFT JOIN (SELECT ri.ingrediente_id,
                                SUM(v.quantidade * ri.quantidade) AS teorico
                           FROM vendas v
                           JOIN receita_ingredientes ri ON ri.receita_id = v.receita_id
                          WHERE v.data BETWEEN ? AND ?
                          GROUP BY ri.ingrediente_id) previsto
                     ON previsto.ingrediente_id = i.id
              LEFT JOIN (SELECT ingrediente_id, SUM(quantidade) AS quantidade
                           FROM movimentacoes_estoque
                          WHERE tipo = 'saida' AND data BETWEEN ? AND ?
                          GROUP BY ingrediente_id) medido
                     ON medido.ingrediente_id = i.id
             WHERE COALESCE(previsto.teorico, 0) > 0
                OR COALESCE(medido.quantidade, 0) > 0
             ORDER BY i.nome`,
      args: [inicio, fim, inicio, fim],
    });

    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ingredienteId: Number(r.id),
        nome: String(r.nome),
        unidade: r.unidade as Unidade,
        precoUnitario: Number(r.preco),
        teorico: Number(r.teorico),
        real: Number(r.medido),
      };
    });
  },

  /**
   * Levanta o desempenho de cada produto no período.
   *
   * O preço usado é o médio praticado, ponderado pelas quantidades, e não o de
   * tabela: promoção e cortesia mudam o que de fato entrou no caixa. Sem vendas,
   * cai no preço de tabela, para o produto ainda aparecer com a margem potencial.
   */
  async levantarDesempenho(inicio: string, fim: string): Promise<LinhaDesempenho[]> {
    const db = getDb();

    const { rows } = await db.execute({
      sql: `SELECT r.id, r.nome, r.preco_venda,
                   COALESCE(SUM(v.quantidade), 0) AS unidades,
                   COALESCE(SUM(v.quantidade * v.preco_unitario)
                            / NULLIF(SUM(v.quantidade), 0), r.preco_venda) AS preco_medio,
                   (SELECT COALESCE(SUM(ri.quantidade * i.preco), 0)
                      FROM receita_ingredientes ri
                      JOIN ingredientes i ON i.id = ri.ingrediente_id
                     WHERE ri.receita_id = r.id) AS custo_unitario,
                   (SELECT COUNT(*) FROM receita_ingredientes ri2
                     WHERE ri2.receita_id = r.id) AS itens_ficha
              FROM receitas r
              LEFT JOIN vendas v
                     ON v.receita_id = r.id
                    AND v.data BETWEEN ? AND ?
             GROUP BY r.id, r.nome, r.preco_venda
             ORDER BY r.nome`,
      args: [inicio, fim],
    });

    return rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        receitaId: Number(r.id),
        nome: String(r.nome),
        precoMedio: Number(r.preco_medio),
        custoUnitario: Number(r.custo_unitario),
        unidadesVendidas: Number(r.unidades),
        temFicha: Number(r.itens_ficha) > 0,
      };
    });
  },
};

/**
 * Modelos dos indicadores de negócio.
 *
 * São os números que respondem "estou ganhando dinheiro" e "onde estou
 * perdendo", em vez de apenas "o que eu tenho". Substituem o CMV que o painel
 * exibia antes, que era uma constante: a receita era estimada como o valor em
 * estoque × 3,5 e o CMV era o valor em estoque ÷ essa receita, então a divisão
 * dava sempre 1/3,5 — 28,6%, qualquer que fosse a situação da cafeteria.
 */

import type { Unidade } from './ingrediente.model.js';

/** Intervalo analisado, sempre com as duas pontas incluídas. */
export interface Periodo {
  inicio: string;
  fim: string;
  dias: number;
}

/**
 * Os totais de um período.
 *
 * Há dois custos, que respondem perguntas diferentes:
 *
 * - `custoTeorico` — vendas × ficha técnica. O que a operação deveria ter
 *   custado. Cobre todos os insumos das fichas.
 * - `custoReal` — o que de fato saiu do estoque. Só enxerga o que passa pela
 *   balança, então costuma ficar mais baixo. A diferença entre os dois é o que
 *   a variância destrincha, insumo por insumo.
 */
export interface ResumoFinanceiro {
  periodo: Periodo;
  receita: number;
  custoTeorico: number;
  custoReal: number;
  compras: number;
  unidadesVendidas: number;
  lancamentos: number;
  cmvTeorico: number;
  cmvReal: number;
  margemBruta: number;
  ticketMedio: number;
  /** Quantas vezes o valor comprado supera o efetivamente consumido. */
  razaoCompraConsumo: number;
  classificacaoCmv: 'sem-venda' | 'ok' | 'atencao' | 'ruim';
  rotuloCmv: string;
  temVendas: boolean;
}

/** Classe da curva ABC — onde o dinheiro do estoque está concentrado. */
export type ClasseAbc = 'A' | 'B' | 'C';

/**
 * O que aconteceu com um insumo no período.
 *
 * `diasCobertura` responde a pergunta que importa — "quantos dias isso ainda
 * cobre" — em vez de "quanto resta da capacidade", que era o critério antigo e
 * dava o mesmo alerta para um leite que acaba em dois dias e uma canela que
 * dura sete meses. Vale -1 quando não houve consumo e não há ritmo a projetar.
 */
export interface IndicadorInsumo {
  ingredienteId: number;
  nome: string;
  unidade: Unidade;
  saldo: number;
  precoUnitario: number;
  consumoPeriodo: number;
  compradoPeriodo: number;
  consumoMedioDiario: number;
  custoConsumido: number;
  diasCobertura: number;
  participacaoCusto: number;
  classe: ClasseAbc;
  urgencia: 'critico' | 'atencao' | 'ok' | 'sem-consumo';
  rotuloCobertura: string;
}

/**
 * A diferença, para um insumo, entre o que as vendas pediam e o que a balança
 * pesou.
 *
 * `semBaixaRegistrada` marca os insumos que entram nas fichas mas não passam
 * pela balança — copo, canela, creme. Para eles não existe lado real, e exibir
 * 100% de variância seria um número errado que destruiria a confiança no
 * indicador inteiro.
 */
export interface VarianciaInsumo {
  ingredienteId: number;
  nome: string;
  unidade: Unidade;
  precoUnitario: number;
  teorico: number;
  real: number;
  diferenca: number;
  percentual: number;
  custoDiferenca: number;
  semBaixaRegistrada: boolean;
  classificacao: 'sem-dado' | 'bom' | 'tipico' | 'ruim';
  rotulo: string;
}

/** Quadrante da engenharia de cardápio. */
export type Quadrante = 'estrela' | 'cavalo' | 'enigma' | 'abacaxi';

/**
 * Como um produto se comportou no período.
 *
 * Os cortes entre "alto" e "baixo" são as médias do próprio cardápio, e não
 * valores fixos: a classificação se ajusta a qualquer cardápio em vez de
 * depender de um limite que valeria para uma cafeteria e não para outra.
 */
export interface DesempenhoProduto {
  receitaId: number;
  nome: string;
  precoMedio: number;
  custoUnitario: number;
  unidadesVendidas: number;
  margemUnitaria: number;
  margemTotal: number;
  faturamento: number;
  percentualCusto: number;
  participacaoVendas: number;
  temFicha: boolean;
  /** Nulo quando o produto ficou fora da classificação. */
  quadrante: Quadrante | null;
}

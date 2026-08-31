/**
 * Modelos do cardápio: fichas técnicas e vendas.
 *
 * Estas duas tabelas fecham a conta que faltava. Até elas existirem, o sistema
 * sabia o que entra e o que sai do estoque, mas não sabia o que a cafeteria
 * vende — e por isso exibia um CMV fixo de 28,6%, estimando a receita como o
 * próprio custo multiplicado por 3,5.
 *
 * As mesmas tabelas são usadas pela aplicação desktop, que vive em outro
 * repositório. Alterações no modelo precisam acontecer nos dois lados.
 */

import type { Unidade } from './ingrediente.model.js';

/** Uma linha da ficha técnica, com os dados do insumo já resolvidos. */
export interface ItemFicha {
  id: number;
  ingredienteId: number;
  nome: string;
  unidade: Unidade;
  /** Quanto entra em uma unidade do produto, na unidade do próprio insumo. */
  quantidade: number;
  /** Preço atual do insumo, por unidade de medida. */
  precoUnitario: number;
  /** quantidade × precoUnitario. */
  custo: number;
}

/**
 * Um produto do cardápio.
 *
 * `custo` e `margem` não estão gravados no banco: são calculados a cada leitura
 * a partir do preço que os insumos têm agora. É o que faz o custo do cappuccino
 * mudar sozinho quando o café é reajustado.
 */
export interface Receita {
  id: number;
  nome: string;
  descricao: string | null;
  precoVenda: number;
  ativo: boolean;
  itens: ItemFicha[];
  custo: number;
  margem: number;
  /** Quanto o custo representa do preço de venda, em percentual. */
  percentualCusto: number;
  /** Falso quando a ficha está vazia — aí custo e margem não significam nada. */
  temFicha: boolean;
  criadoEm?: string;
  atualizadoEm?: string;
}

/** Uma linha de ficha enviada pelo cliente. */
export interface ItemFichaInput {
  ingredienteId: number;
  quantidade: number;
}

/** Payload de criação de produto. */
export interface ReceitaInput {
  nome: string;
  descricao?: string | null;
  precoVenda: number;
  ativo?: boolean;
  itens: ItemFichaInput[];
}

/** Payload de atualização parcial de produto. */
export interface ReceitaUpdateInput {
  nome?: string;
  descricao?: string | null;
  precoVenda?: number;
  ativo?: boolean;
  itens?: ItemFichaInput[];
}

/**
 * Uma venda registrada.
 *
 * `precoUnitario` é o preço PRATICADO nesta venda, e não uma cópia do preço de
 * tabela: reajustar o cardápio hoje não pode reescrever o faturamento do mês
 * passado.
 */
export interface Venda {
  id: number;
  receitaId: number;
  nomeReceita: string;
  quantidade: number;
  precoUnitario: number;
  /** Custo de uma unidade pela ficha técnica, com os preços atuais. */
  custoUnitario: number;
  total: number;
  custoTotal: number;
  margemTotal: number;
  observacao: string | null;
  data: string;
}

/** Payload de registro de venda. */
export interface VendaInput {
  receitaId: number;
  quantidade: number;
  precoUnitario: number;
  observacao?: string | null;
  data?: string;
}

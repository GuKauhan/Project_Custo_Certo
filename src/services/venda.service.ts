/**
 * Regras de negócio do registro de vendas.
 *
 * O escopo é deliberadamente pequeno: registrar o que foi vendido, quando e por
 * quanto. Não é um ponto de venda — o objetivo é ter o lado da receita, sem o
 * qual nenhum indicador de margem existe.
 *
 * Registrar uma venda não abate o estoque. A baixa dos insumos acontece pela
 * balança, num caminho independente, e é isso que torna possível comparar depois
 * quanto as vendas pediam com quanto de fato saiu.
 */

import { vendaRepository } from '../repositories/venda.repo.js';
import { AppError, NotFoundError } from '../errors/app-error.js';
import { receitaRepository } from '../repositories/receita.repo.js';
import type { Venda, VendaInput } from '../models/receita.model.js';

export const vendaService = {
  async listar(inicio: string, fim: string): Promise<Venda[]> {
    return vendaRepository.listar(inicio, fim);
  },

  async registrar(input: VendaInput): Promise<Venda> {
    const produto = await receitaRepository.buscarPorId(input.receitaId);
    if (!produto) {
      throw new NotFoundError('Produto');
    }

    if (input.data && input.data > hoje()) {
      throw new AppError('A data da venda está no futuro.', 400);
    }

    return vendaRepository.criar(input);
  },

  async deletar(id: number): Promise<void> {
    const ok = await vendaRepository.remover(id);
    if (!ok) throw new NotFoundError('Venda');
  },
};

/** Data de hoje no fuso local, para comparar com a data enviada. */
function hoje(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Regras de negócio do cardápio e das fichas técnicas.
 *
 * Orquestra o repository e traduz as recusas do banco em erros com status HTTP.
 *
 * Uma decisão merece explicação: o serviço permite salvar um produto **sem ficha
 * técnica**. Exigir ao menos um insumo obrigaria a montar a ficha inteira antes
 * de conseguir cadastrar o produto, e na prática as duas coisas acontecem em
 * momentos diferentes. O preço é que o custo fica zero — e é por isso que o
 * modelo carrega `temFicha`: as telas avisam em vez de exibir uma margem igual
 * ao preço inteiro, que estaria errada.
 */

import { receitaRepository } from '../repositories/receita.repo.js';
import { AppError, ConflictError, NotFoundError } from '../errors/app-error.js';
import type {
  Receita,
  ReceitaInput,
  ReceitaUpdateInput,
} from '../models/receita.model.js';

/** Traduz a violação de restrição do MySQL em mensagem para o usuário. */
function traduzirErro(erro: unknown, nome?: string): never {
  const texto = erro instanceof Error ? erro.message : '';

  if (texto.includes('uk_receitas_nome') || texto.includes('Duplicate entry')) {
    throw new ConflictError(`Já existe um produto chamado "${nome ?? ''}".`.trim());
  }
  if (texto.includes('uk_ri_receita_ingrediente')) {
    throw new AppError('O mesmo insumo aparece duas vezes na ficha técnica.', 400);
  }
  if (texto.includes('ck_ri_quantidade')) {
    throw new AppError('As quantidades da ficha técnica precisam ser maiores que zero.', 400);
  }
  if (texto.includes('fk_ri_ingrediente')) {
    throw new AppError('Algum insumo da ficha técnica não existe mais.', 400);
  }
  throw erro;
}

export const receitaService = {
  async listar(): Promise<Receita[]> {
    return receitaRepository.listarTodas();
  },

  async buscarPorId(id: number): Promise<Receita> {
    const receita = await receitaRepository.buscarPorId(id);
    if (!receita) throw new NotFoundError('Produto');
    return receita;
  },

  async criar(input: ReceitaInput): Promise<Receita> {
    validarFicha(input.itens);
    try {
      return await receitaRepository.criar(input);
    } catch (erro) {
      traduzirErro(erro, input.nome);
    }
  },

  async atualizar(id: number, update: ReceitaUpdateInput): Promise<Receita> {
    if (update.itens) validarFicha(update.itens);
    try {
      const atualizado = await receitaRepository.atualizar(id, update);
      if (!atualizado) throw new NotFoundError('Produto');
      return atualizado;
    } catch (erro) {
      if (erro instanceof NotFoundError) throw erro;
      traduzirErro(erro, update.nome);
    }
  },

  /**
   * Remove um produto do cardápio.
   *
   * Consulta o histórico antes de tentar, para explicar o motivo em vez de
   * deixar o usuário esbarrar na recusa da chave estrangeira.
   */
  async deletar(id: number): Promise<void> {
    const vendas = await receitaRepository.contarVendas(id);
    if (vendas > 0) {
      throw new ConflictError(
        `Este produto tem ${vendas} ${vendas === 1 ? 'venda registrada' : 'vendas registradas'}. `
        + 'Apagá-lo deixaria o faturamento desses dias sem explicação. '
        + 'Se ele saiu do cardápio, marque-o como inativo em vez de excluir.',
      );
    }

    const ok = await receitaRepository.remover(id);
    if (!ok) throw new NotFoundError('Produto');
  },
};

/** Recusa fichas com insumo repetido, que seriam duas linhas contraditórias. */
function validarFicha(itens: { ingredienteId: number }[]): void {
  const vistos = new Set<number>();
  for (const item of itens) {
    if (vistos.has(item.ingredienteId)) {
      throw new AppError(
        'O mesmo insumo aparece duas vezes na ficha técnica. '
        + 'Some as quantidades em uma linha só.',
        400,
      );
    }
    vistos.add(item.ingredienteId);
  }
}

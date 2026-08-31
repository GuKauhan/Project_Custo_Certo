/**
 * Controllers HTTP do cardápio, das vendas e dos indicadores.
 *
 * Apenas adaptam req/res para os services. Sem regras de negócio — os erros
 * lançados caem no errorHandler global.
 */

import type { Request, Response } from 'express';
import { receitaService } from '../services/receita.service.js';
import { vendaService } from '../services/venda.service.js';
import { analiseService, montarPeriodo } from '../services/analise.service.js';
import { validateId } from '../schemas/ingrediente.schema.js';
import {
  validatePeriodoQuery,
  validateReceitaInput,
  validateReceitaUpdate,
  validateVendaInput,
} from '../schemas/cardapio.schema.js';

/** Lê o recorte de tempo da query, caindo nos últimos 90 dias por padrão. */
function periodoDaQuery(req: Request) {
  const { inicio, fim, dias } = validatePeriodoQuery(req.query);
  return montarPeriodo(inicio, fim, dias ?? 90);
}

export const receitasController = {
  /** GET /receitas */
  async listar(_req: Request, res: Response): Promise<void> {
    res.json(await receitaService.listar());
  },

  /** GET /receitas/:id */
  async buscar(req: Request<{ id: string }>, res: Response): Promise<void> {
    res.json(await receitaService.buscarPorId(validateId(req.params.id)));
  },

  /** POST /receitas */
  async cadastrar(req: Request, res: Response): Promise<void> {
    const nova = await receitaService.criar(validateReceitaInput(req.body));
    res.status(201).json(nova);
  },

  /** PUT /receitas/:id */
  async atualizar(req: Request<{ id: string }>, res: Response): Promise<void> {
    const id = validateId(req.params.id);
    res.json(await receitaService.atualizar(id, validateReceitaUpdate(req.body)));
  },

  /** DELETE /receitas/:id */
  async deletar(req: Request<{ id: string }>, res: Response): Promise<void> {
    await receitaService.deletar(validateId(req.params.id));
    res.status(204).send();
  },
};

export const vendasController = {
  /** GET /vendas?inicio=&fim=&dias= */
  async listar(req: Request, res: Response): Promise<void> {
    const periodo = periodoDaQuery(req);
    res.json({
      periodo,
      vendas: await vendaService.listar(periodo.inicio, periodo.fim),
    });
  },

  /** POST /vendas */
  async registrar(req: Request, res: Response): Promise<void> {
    const nova = await vendaService.registrar(validateVendaInput(req.body));
    res.status(201).json(nova);
  },

  /** DELETE /vendas/:id */
  async deletar(req: Request<{ id: string }>, res: Response): Promise<void> {
    await vendaService.deletar(validateId(req.params.id));
    res.status(204).send();
  },
};

export const indicadoresController = {
  /**
   * GET /indicadores — tudo de uma vez.
   *
   * O painel precisa dos quatro blocos juntos para desenhar a tela. Buscá-los em
   * quatro requisições separadas só multiplicaria idas ao servidor para montar
   * uma coisa só.
   */
  async completo(req: Request, res: Response): Promise<void> {
    const periodo = periodoDaQuery(req);

    const [resumo, giro, variancias, cardapio] = await Promise.all([
      analiseService.resumo(periodo),
      analiseService.giroDeInsumos(periodo),
      analiseService.variancias(periodo),
      analiseService.desempenhoDoCardapio(periodo),
    ]);

    res.json({ periodo, resumo, giro, variancias, cardapio });
  },

  /** GET /indicadores/resumo */
  async resumo(req: Request, res: Response): Promise<void> {
    res.json(await analiseService.resumo(periodoDaQuery(req)));
  },

  /** GET /indicadores/variancia */
  async variancia(req: Request, res: Response): Promise<void> {
    res.json(await analiseService.variancias(periodoDaQuery(req)));
  },

  /** GET /indicadores/cardapio */
  async cardapio(req: Request, res: Response): Promise<void> {
    res.json(await analiseService.desempenhoDoCardapio(periodoDaQuery(req)));
  },
};

/**
 * Rotas do cardapio, das vendas e dos indicadores.
 *
 * As tres familias vivem no mesmo arquivo porque respondem ao mesmo assunto: o
 * que a cafeteria vende e quanto isso deixa. Separa-las em tres arquivos de
 * quatro linhas nao ajudaria ninguem a achar nada.
 */

import { Router } from 'express';
import {
  receitasController,
  vendasController,
  indicadoresController,
} from '../controllers/cardapioController.js';

const receitasRouter = Router();
receitasRouter.get('/', receitasController.listar);
receitasRouter.post('/', receitasController.cadastrar);
receitasRouter.get('/:id', receitasController.buscar);
receitasRouter.put('/:id', receitasController.atualizar);
receitasRouter.delete('/:id', receitasController.deletar);

const vendasRouter = Router();
vendasRouter.get('/', vendasController.listar);
vendasRouter.post('/', vendasController.registrar);
vendasRouter.delete('/:id', vendasController.deletar);

const indicadoresRouter = Router();
// As rotas especificas vem antes da generica, senao "/resumo" cairia nela.
indicadoresRouter.get('/resumo', indicadoresController.resumo);
indicadoresRouter.get('/variancia', indicadoresController.variancia);
indicadoresRouter.get('/cardapio', indicadoresController.cardapio);
indicadoresRouter.get('/', indicadoresController.completo);

export { receitasRouter, vendasRouter, indicadoresRouter };

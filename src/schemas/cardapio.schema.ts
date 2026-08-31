/**
 * Validação dos payloads de cardápio, vendas e consultas de indicadores.
 *
 * Segue o mesmo desenho de `ingrediente.schema.ts`: o Zod descreve a forma
 * esperada e a função de validação converte a falha em `AppError`, que o
 * middleware traduz na resposta HTTP.
 */

import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import type {
  ReceitaInput,
  ReceitaUpdateInput,
  VendaInput,
} from '../models/receita.model.js';

/** Data no formato YYYY-MM-DD, que é como o MySQL devolve e recebe. */
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Data inválida');

const ItemFichaSchema = z.object({
  ingredienteId: z.number().int().positive('Escolha o insumo da linha'),
  quantidade: z
    .number()
    .positive('A quantidade da ficha precisa ser maior que zero')
    .finite(),
});

const ReceitaInputSchema = z.object({
  nome: z
    .string()
    .min(2, 'O nome do produto precisa ter ao menos 2 caracteres')
    .max(120, 'O nome do produto deve ter no máximo 120 caracteres')
    .transform((v) => v.trim()),
  descricao: z.string().max(255).nullish(),
  precoVenda: z.number().min(0, 'O preço de venda não pode ser negativo').finite(),
  ativo: z.boolean().optional(),
  // A ficha pode vir vazia: cadastrar o produto e montar a ficha costumam
  // acontecer em momentos diferentes.
  itens: z.array(ItemFichaSchema).default([]),
});

const ReceitaUpdateSchema = ReceitaInputSchema.partial().refine(
  (obj) => Object.keys(obj).length > 0,
  'Envie ao menos um campo para atualizar',
);

const VendaInputSchema = z.object({
  receitaId: z.number().int().positive('Escolha o produto vendido'),
  quantidade: z
    .number()
    .int('A quantidade vendida precisa ser um número inteiro')
    .positive('A quantidade vendida precisa ser maior que zero'),
  precoUnitario: z
    .number()
    .min(0, 'O preço praticado não pode ser negativo')
    .finite(),
  observacao: z.string().max(255).nullish(),
  data: IsoDateSchema.optional(),
});

const PeriodoQuerySchema = z.object({
  inicio: IsoDateSchema.optional(),
  fim: IsoDateSchema.optional(),
  dias: z.coerce.number().int().min(1).max(3650).optional(),
});

/** Converte a falha do Zod na primeira mensagem legível. */
function primeiraMensagem(erro: z.ZodError): string {
  const problema = erro.issues[0];
  return problema?.message ?? 'Dados inválidos';
}

export function validateReceitaInput(body: unknown): ReceitaInput {
  const resultado = ReceitaInputSchema.safeParse(body);
  if (!resultado.success) throw new AppError(primeiraMensagem(resultado.error), 400);
  return resultado.data as ReceitaInput;
}

export function validateReceitaUpdate(body: unknown): ReceitaUpdateInput {
  const resultado = ReceitaUpdateSchema.safeParse(body);
  if (!resultado.success) throw new AppError(primeiraMensagem(resultado.error), 400);
  return resultado.data as ReceitaUpdateInput;
}

export function validateVendaInput(body: unknown): VendaInput {
  const resultado = VendaInputSchema.safeParse(body);
  if (!resultado.success) throw new AppError(primeiraMensagem(resultado.error), 400);
  return resultado.data as VendaInput;
}

export function validatePeriodoQuery(query: unknown): {
  inicio?: string;
  fim?: string;
  dias?: number;
} {
  const resultado = PeriodoQuerySchema.safeParse(query);
  if (!resultado.success) throw new AppError(primeiraMensagem(resultado.error), 400);
  return resultado.data;
}

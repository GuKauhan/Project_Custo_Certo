/**
 * Regras de negócio da balança.
 *
 * Faz a ponte entre o estado em memória (peso/tara) e o estoque persistente.
 * Quando o frontend confirma uma pesagem, chama o ingredienteService para
 * abater do estoque — e aí sim isso vira uma movimentação registrada no banco.
 */

import { pesagemRepository } from '../repositories/pesagem.repo.js';
import type { PesoSnapshot } from '../repositories/pesagem.repo.js';
import * as dispositivo from './balanca-dispositivo.js';
import { ingredienteService } from './ingrediente.service.js';
import { AppError } from '../errors/app-error.js';
import type {
  BalancaState,
  ConfirmacaoPesagem,
} from '../models/pesagem.model.js';

export const balancaService = {
  /** ESP32 chama com peso medido */
  registrarLeitura(peso: number): void {
    pesagemRepository.setPeso(Math.max(0, peso));
  },

  /** Frontend lê peso atual + status de conexão */
  getEstadoAtual(): BalancaState & { online: boolean } {
    return {
      ...pesagemRepository.getState(),
      online: pesagemRepository.estaOnline(),
    };
  },

  /**
   * Frontend solicita tara.
   *
   * Com a balança configurada como dispositivo de rede, o pedido vai direto
   * para ela. Isso encerra um acoplamento antigo: a tara era uma flag guardada
   * aqui, que o firmware consumia na resposta do POST de peso — e por isso
   * firmware e backend tinham de subir juntos, sob pena de o pedido nunca
   * chegar ao aparelho.
   *
   * Sem BALANCA_URL definida, o servidor volta ao comportamento antigo e guarda
   * a flag, porque nesse caso é a balança que está empurrando as leituras — e é
   * na resposta delas que o pedido de tara consegue viajar de volta.
   */
  async solicitarTara(): Promise<{ ok: boolean; via: string }> {
    if (dispositivo.estaConfigurado()) {
      const aceitou = await dispositivo.enviarTara();
      if (aceitou) {
        return { ok: true, via: 'dispositivo' };
      }
      // A balança não respondeu. Guardar a flag ainda dá certo se ela estiver
      // empurrando leituras para cá em paralelo.
      pesagemRepository.solicitarTara();
      return { ok: false, via: 'dispositivo-sem-resposta' };
    }

    pesagemRepository.solicitarTara();
    return { ok: true, via: 'flag' };
  },

  /**
   * Começa a consultar a balança, quando há uma configurada.
   *
   * Cada leitura entra no mesmo estado em memória que as leituras empurradas,
   * então o navegador continua recebendo tudo por SSE sem saber a diferença.
   *
   * @returns função que interrompe a consulta
   */
  iniciarLeituraDoDispositivo(): () => void {
    return dispositivo.iniciarLeituraContinua((leitura) => {
      pesagemRepository.setPeso(leitura.peso);
    });
  },

  /** ESP32 verifica se deve tarar (consome a flag) */
  verificarTara(): boolean {
    return pesagemRepository.consumirTara();
  },

  /**
   * Registra callback chamado a cada nova leitura do ESP32.
   * Retorna função de unsubscribe — chame-a quando a conexão SSE fechar.
   */
  addSseListener(fn: (snapshot: PesoSnapshot) => void): () => void {
    return pesagemRepository.addListener(fn);
  },

  /**
   * Confirma pesagem: valida peso > 0, abate do estoque e
   * registra a saída como movimentação.
   */
  async confirmarPesagem(
    ingredienteId: number,
    quantidadeConsumida: number,
  ): Promise<ConfirmacaoPesagem> {
    const peso = pesagemRepository.getState().pesoAtual;

    if (peso <= 0.001) {
      throw new AppError('Peso inválido. Coloque o item na balança.', 400);
    }

    const atualizado = await ingredienteService.abaterConsumo(
      ingredienteId,
      quantidadeConsumida,
      `Pesagem de ${quantidadeConsumida.toFixed(3)}`,
    );

    return {
      ok: true,
      pesoConfirmado: peso,
      ingredienteId: atualizado.id,
      novaQtd: atualizado.qtd,
    };
  },
};
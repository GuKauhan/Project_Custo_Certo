/**
 * Regras de análise do negócio: classificar, ordenar e dar sentido aos números
 * que o repository traz do banco.
 *
 * A divisão de trabalho é a mesma do lado Java: o repository faz o que o banco
 * faz bem — somar, agrupar, cruzar tabelas — e este serviço faz o que exige
 * olhar o conjunto inteiro. A curva ABC precisa da lista ordenada e do total
 * acumulado; a engenharia de cardápio precisa das médias do próprio cardápio
 * para saber o que é "margem alta" naquele contexto.
 *
 * As constantes abaixo têm gêmeas em `ResumoFinanceiro.java`,
 * `VarianciaInsumo.java` e `AnaliseService.java`. Se uma faixa mudar aqui, tem
 * de mudar lá — as duas interfaces leem o mesmo banco e não podem discordar
 * sobre o que é um CMV saudável.
 */

import { analiseRepository } from '../repositories/analise.repo.js';
import type {
  DesempenhoProduto,
  IndicadorInsumo,
  Periodo,
  Quadrante,
  ResumoFinanceiro,
  VarianciaInsumo,
} from '../models/analise.model.js';

/**
 * CMV até o qual o resultado é saudável para uma cafeteria.
 *
 * Referência de mercado para food service: a faixa usual vai de 25% a 35%, e uma
 * cafeteria com operação enxuta fica na ponta baixa. O valor antigo do sistema —
 * 31% como ideal — não tinha origem citada.
 */
const CMV_IDEAL = 25;

/** CMV a partir do qual o resultado sai da faixa aceitável do setor. */
const CMV_LIMITE = 35;

/** Percentual acumulado até onde os insumos são classe A na curva ABC. */
const CORTE_A = 80;

/** Percentual acumulado até onde os insumos são classe B. */
const CORTE_B = 95;

/**
 * Fração da participação média a partir da qual um produto é popular.
 *
 * O corte clássico da engenharia de cardápio não usa a média cheia, e sim 70%
 * dela. A folga existe porque exigir a média inteira reprovaria quase metade de
 * qualquer cardápio por definição.
 */
const FATOR_POPULARIDADE = 0.7;

/** Variância até este percentual indica operação bem controlada. */
const VARIANCIA_BOA = 2;

/** Variância até este percentual é considerada típica pelo setor. */
const VARIANCIA_TIPICA = 5;

/**
 * Monta um período a partir de duas datas, ou dos últimos N dias.
 *
 * Nenhum indicador existe sem recorte de tempo: faturamento, consumo e variância
 * só significam alguma coisa dentro de um intervalo.
 */
export function montarPeriodo(inicio?: string, fim?: string, dias = 90): Periodo {
  const hoje = new Date();
  const formatar = (d: Date): string => {
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  };

  const dataFim = fim ?? formatar(hoje);
  let dataInicio = inicio;

  if (!dataInicio) {
    const recuo = new Date(hoje);
    recuo.setDate(recuo.getDate() - (Math.max(1, dias) - 1));
    dataInicio = formatar(recuo);
  }

  const diffMs = Date.parse(dataFim) - Date.parse(dataInicio);
  const totalDias = Math.max(1, Math.round(diffMs / 86_400_000) + 1);

  return { inicio: dataInicio, fim: dataFim, dias: totalDias };
}

/** Arredonda para duas casas, evitando o ruído de ponto flutuante. */
function centavos(valor: number): number {
  return Number(valor.toFixed(2));
}

export const analiseService = {
  /**
   * Apura receita, custos e compras de um período.
   *
   * Devolve dois CMVs. O teórico usa o custo das fichas, que cobre todos os
   * insumos; o real usa o que efetivamente saiu do estoque, e por isso costuma
   * ficar mais baixo — nem todo insumo passa pela balança. A diferença entre os
   * dois é o que a variância destrincha.
   */
  async resumo(periodo: Periodo): Promise<ResumoFinanceiro> {
    const t = await analiseRepository.apurarTotais(periodo.inicio, periodo.fim);

    const temVendas = t.receita > 0;
    const cmvTeorico = temVendas ? (t.custoTeorico / t.receita) * 100 : 0;
    const cmvReal = temVendas ? (t.custoReal / t.receita) * 100 : 0;

    let classificacaoCmv: ResumoFinanceiro['classificacaoCmv'];
    let rotuloCmv: string;

    if (!temVendas) {
      classificacaoCmv = 'sem-venda';
      rotuloCmv = 'Sem vendas no período';
    } else if (cmvTeorico <= CMV_IDEAL) {
      classificacaoCmv = 'ok';
      rotuloCmv = 'Dentro do ideal para cafeteria';
    } else if (cmvTeorico <= CMV_LIMITE) {
      classificacaoCmv = 'atencao';
      rotuloCmv = 'Acima do ideal, dentro da faixa comum';
    } else {
      classificacaoCmv = 'ruim';
      rotuloCmv = 'Acima da faixa do setor';
    }

    return {
      periodo,
      receita: centavos(t.receita),
      custoTeorico: centavos(t.custoTeorico),
      custoReal: centavos(t.custoReal),
      compras: centavos(t.compras),
      unidadesVendidas: t.unidadesVendidas,
      lancamentos: t.lancamentos,
      cmvTeorico,
      cmvReal,
      // A margem usa o custo teórico, que cobre todos os insumos das fichas. O
      // custo real só enxerga o que passa pela balança e subestimaria o gasto.
      margemBruta: centavos(t.receita - t.custoTeorico),
      ticketMedio: t.unidadesVendidas > 0 ? centavos(t.receita / t.unidadesVendidas) : 0,
      razaoCompraConsumo: t.custoReal > 0 ? t.compras / t.custoReal : 0,
      classificacaoCmv,
      rotuloCmv,
      temVendas,
    };
  },

  /**
   * Levanta os indicadores de giro por insumo e aplica a curva ABC.
   *
   * A lista volta ordenada do insumo que mais consome dinheiro para o que menos
   * consome, que é a ordem em que a curva ABC faz sentido.
   */
  async giroDeInsumos(periodo: Periodo): Promise<IndicadorInsumo[]> {
    const linhas = await analiseRepository.levantarGiro(periodo.inicio, periodo.fim);

    const indicadores: IndicadorInsumo[] = linhas.map((l) => {
      const consumoMedioDiario = l.consumoPeriodo / periodo.dias;
      const custoConsumido = centavos(l.consumoPeriodo * l.precoUnitario);

      // -1 quando não houve consumo: não há ritmo do qual projetar quanto tempo
      // o saldo dura, e fingir um número aqui seria pior do que não ter.
      const diasCobertura = consumoMedioDiario > 0 ? l.saldo / consumoMedioDiario : -1;

      let urgencia: IndicadorInsumo['urgencia'];
      let rotuloCobertura: string;

      if (diasCobertura < 0) {
        urgencia = 'sem-consumo';
        rotuloCobertura = 'sem saída no período';
      } else if (diasCobertura < 1) {
        urgencia = 'critico';
        rotuloCobertura = 'acaba hoje';
      } else {
        // Os cortes valem para quem compra ao menos uma vez por semana: abaixo
        // de três dias não dá tempo de um fornecedor entregar; abaixo de sete, o
        // item entra na próxima lista de compras.
        urgencia = diasCobertura < 3 ? 'critico' : diasCobertura < 7 ? 'atencao' : 'ok';
        const inteiro = Math.round(diasCobertura);
        rotuloCobertura = `cobre ${inteiro} ${inteiro === 1 ? 'dia' : 'dias'}`;
      }

      return {
        ingredienteId: l.ingredienteId,
        nome: l.nome,
        unidade: l.unidade,
        saldo: l.saldo,
        precoUnitario: l.precoUnitario,
        consumoPeriodo: l.consumoPeriodo,
        compradoPeriodo: centavos(l.compradoPeriodo),
        consumoMedioDiario,
        custoConsumido,
        diasCobertura,
        participacaoCusto: 0,
        classe: 'C',
        urgencia,
        rotuloCobertura,
      };
    });

    indicadores.sort((a, b) => b.custoConsumido - a.custoConsumido);

    const total = indicadores.reduce((soma, i) => soma + i.custoConsumido, 0);
    if (total > 0) {
      let acumulado = 0;
      for (const i of indicadores) {
        const participacao = (i.custoConsumido / total) * 100;
        i.participacaoCusto = participacao;
        acumulado += participacao;
        i.classe = acumulado <= CORTE_A ? 'A' : acumulado <= CORTE_B ? 'B' : 'C';
      }
    }

    return indicadores;
  },

  /**
   * Compara o consumo teórico com o real, insumo por insumo.
   *
   * Ordena pelo valor em reais da diferença, e não pelo percentual: um desvio de
   * 40% em canela custa centavos, um de 11% em café custa dezenas de reais.
   * Ordenar por percentual colocaria o problema irrelevante no topo.
   */
  async variancias(periodo: Periodo): Promise<VarianciaInsumo[]> {
    const linhas = await analiseRepository.compararConsumo(periodo.inicio, periodo.fim);

    const variancias: VarianciaInsumo[] = linhas.map((l) => {
      const diferenca = Number((l.real - l.teorico).toFixed(3));
      const percentual = l.teorico > 0 ? (diferenca / l.teorico) * 100 : 0;
      const custoDiferenca = centavos(diferenca * l.precoUnitario);

      // Insumo que entra nas fichas mas não passa pela balança. Sem lado real, a
      // variância não significa nada — exibir 100% seria um número errado que
      // destruiria a confiança no indicador inteiro.
      const semBaixaRegistrada = l.teorico > 0 && l.real === 0;

      let classificacao: VarianciaInsumo['classificacao'];
      let rotulo: string;

      if (semBaixaRegistrada || l.teorico <= 0) {
        classificacao = 'sem-dado';
        rotulo = 'Este insumo não passa pela balança — sem consumo real para comparar.';
      } else {
        const absoluto = Math.abs(percentual);
        if (absoluto <= VARIANCIA_BOA) {
          classificacao = 'bom';
          rotulo = 'Dentro do esperado para uma operação controlada.';
        } else if (absoluto <= VARIANCIA_TIPICA) {
          classificacao = 'tipico';
          rotulo = 'Variação comum, mas vale acompanhar.';
        } else {
          classificacao = 'ruim';
          rotulo = diferenca > 0
            ? 'Saiu bem mais do que as vendas pediam. Investigar dose, desperdício ou perda.'
            : 'Saiu bem menos do que as vendas pediam. Confira se as baixas estão sendo registradas.';
        }
      }

      return {
        ingredienteId: l.ingredienteId,
        nome: l.nome,
        unidade: l.unidade,
        precoUnitario: l.precoUnitario,
        teorico: l.teorico,
        real: l.real,
        diferenca,
        percentual,
        custoDiferenca,
        semBaixaRegistrada,
        classificacao,
        rotulo,
      };
    });

    variancias.sort((a, b) => Math.abs(b.custoDiferenca) - Math.abs(a.custoDiferenca));
    return variancias;
  },

  /**
   * Levanta o desempenho dos produtos e os distribui pelos quadrantes.
   *
   * Ficam fora da classificação os produtos sem venda no período e os sem ficha
   * técnica. Um produto sem ficha tem custo zero e entraria como margem máxima —
   * viraria uma estrela falsa e ainda puxaria a média para cima, bagunçando a
   * classificação de todos os outros.
   */
  async desempenhoDoCardapio(periodo: Periodo): Promise<DesempenhoProduto[]> {
    const linhas = await analiseRepository.levantarDesempenho(periodo.inicio, periodo.fim);

    const produtos: DesempenhoProduto[] = linhas.map((l) => {
      const margemUnitaria = centavos(l.precoMedio - l.custoUnitario);
      return {
        receitaId: l.receitaId,
        nome: l.nome,
        precoMedio: centavos(l.precoMedio),
        custoUnitario: Number(l.custoUnitario.toFixed(4)),
        unidadesVendidas: l.unidadesVendidas,
        margemUnitaria,
        margemTotal: centavos(margemUnitaria * l.unidadesVendidas),
        faturamento: centavos(l.precoMedio * l.unidadesVendidas),
        percentualCusto: l.precoMedio > 0 ? (l.custoUnitario / l.precoMedio) * 100 : 0,
        participacaoVendas: 0,
        temFicha: l.temFicha,
        quadrante: null,
      };
    });

    const classificaveis = produtos.filter((p) => p.unidadesVendidas > 0 && p.temFicha);
    const unidadesTotais = classificaveis.reduce((s, p) => s + p.unidadesVendidas, 0);

    if (classificaveis.length > 0 && unidadesTotais > 0) {
      const margemAcumulada = classificaveis.reduce((s, p) => s + p.margemTotal, 0);
      const margemReferencia = margemAcumulada / unidadesTotais;
      const participacaoReferencia = (100 / classificaveis.length) * FATOR_POPULARIDADE;

      for (const p of classificaveis) {
        const participacao = (p.unidadesVendidas * 100) / unidadesTotais;
        p.participacaoVendas = participacao;

        const margemAlta = p.margemUnitaria >= margemReferencia;
        const popular = participacao >= participacaoReferencia;

        let quadrante: Quadrante;
        if (margemAlta && popular) quadrante = 'estrela';
        else if (!margemAlta && popular) quadrante = 'cavalo';
        else if (margemAlta) quadrante = 'enigma';
        else quadrante = 'abacaxi';

        p.quadrante = quadrante;
      }
    }

    produtos.sort((a, b) => b.margemTotal - a.margemTotal);
    return produtos;
  },
};

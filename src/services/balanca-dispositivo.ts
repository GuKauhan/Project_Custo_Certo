/**
 * Cliente da balança.
 *
 * A balança deixou de empurrar o peso para cá e passou a ser um dispositivo de
 * rede com API própria: `GET /peso` e `POST /tara`. Quem quer a leitura pergunta
 * a ela. Este módulo é o lado do servidor Node dessa conversa.
 *
 * A troca resolveu um acoplamento entre projetos: o aplicativo desktop, que vive
 * em outro repositório, também consulta a balança diretamente e não depende mais
 * deste servidor estar no ar para funcionar. Os dois são clientes do mesmo
 * aparelho, e nenhum é intermediário do outro.
 *
 * O caminho antigo continua existindo. Se a balança estiver configurada para
 * empurrar leituras para uma URL remota, elas chegam por `POST /balanca/peso`
 * como antes — é o que mantém viável um painel hospedado fora da rede da
 * cafeteria, que jamais alcançaria um ESP32 atrás do roteador.
 *
 * Configuração:
 *
 *   BALANCA_URL           endereço da balança (ex.: http://custocerto-balanca.local)
 *                         vazio = não consulta ninguém, só recebe o que for empurrado
 *   BALANCA_INTERVALO_MS  de quanto em quanto tempo perguntar o peso
 */

/** Intervalo padrão entre consultas, em milissegundos. */
const INTERVALO_PADRAO_MS = 400;

/** Tempo máximo de espera por resposta do aparelho. */
const TIMEOUT_MS = 1500;

/**
 * Falhas seguidas antes de voltar a registrar no log.
 *
 * Sem isso, uma balança desligada encheria o console com uma linha a cada 400 ms.
 * O primeiro erro sempre aparece; os seguintes só de tempos em tempos.
 */
const FALHAS_ENTRE_AVISOS = 25;

/** Uma leitura devolvida pelo aparelho. */
export interface LeituraBalanca {
  peso: number;
  estavel: boolean;
}

let falhasSeguidas = 0;
let temporizador: NodeJS.Timeout | null = null;

/**
 * Retorna o endereço configurado da balança, sem barra no fim.
 */
export function getUrlDispositivo(): string | null {
  const url = (process.env.BALANCA_URL || '').trim();
  if (!url) return null;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Informa se há uma balança configurada para ser consultada.
 */
export function estaConfigurado(): boolean {
  return getUrlDispositivo() !== null;
}

/**
 * Faz uma requisição ao aparelho com tempo limite.
 *
 * O timeout é curto de propósito: a balança está na rede local e responde em
 * milissegundos. Se demorar mais que isso, ela está fora do ar, e insistir só
 * atrasaria a próxima leitura.
 */
async function requisitar(caminho: string, metodo: 'GET' | 'POST'): Promise<Response | null> {
  const base = getUrlDispositivo();
  if (!base) return null;

  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), TIMEOUT_MS);

  try {
    return await fetch(base + caminho, { method: metodo, signal: controle.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(alarme);
  }
}

/**
 * Pergunta o peso atual à balança.
 *
 * @returns a leitura, ou `null` se o aparelho não respondeu
 */
export async function lerPeso(): Promise<LeituraBalanca | null> {
  const resposta = await requisitar('/peso', 'GET');
  if (!resposta || !resposta.ok) return null;

  try {
    const dados = (await resposta.json()) as { peso?: unknown; estavel?: unknown };
    const peso = Number(dados.peso);
    if (!Number.isFinite(peso)) return null;

    return { peso: Math.max(0, peso), estavel: dados.estavel === true };
  } catch {
    return null;
  }
}

/**
 * Manda a balança zerar.
 *
 * @returns `true` se o aparelho confirmou
 */
export async function enviarTara(): Promise<boolean> {
  const resposta = await requisitar('/tara', 'POST');
  return resposta !== null && resposta.ok;
}

/**
 * Começa a perguntar o peso de tempos em tempos.
 *
 * Cada leitura recebida é entregue ao callback, que a repassa ao estado em
 * memória e, dali, ao navegador por SSE. Do ponto de vista do frontend nada
 * mudou: ele continua recebendo o peso empurrado por este servidor.
 *
 * @param aoLer callback chamado a cada leitura bem-sucedida
 * @returns função que interrompe a leitura contínua
 */
export function iniciarLeituraContinua(aoLer: (leitura: LeituraBalanca) => void): () => void {
  const base = getUrlDispositivo();
  if (!base) {
    console.log('⚖️  BALANCA_URL não definida — o servidor só recebe leituras empurradas.');
    return () => {};
  }

  const intervalo = Number(process.env.BALANCA_INTERVALO_MS) || INTERVALO_PADRAO_MS;
  console.log(`⚖️  Consultando a balança em ${base} a cada ${intervalo} ms`);

  let emVoo = false;

  temporizador = setInterval(async () => {
    // Se a consulta anterior ainda não voltou, pular esta. Sem isso, uma balança
    // lenta acumularia requisições sobrepostas até estourar.
    if (emVoo) return;
    emVoo = true;

    try {
      const leitura = await lerPeso();

      if (leitura) {
        if (falhasSeguidas > 0) {
          console.log('⚖️  Balança respondeu novamente.');
          falhasSeguidas = 0;
        }
        aoLer(leitura);
      } else {
        if (falhasSeguidas % FALHAS_ENTRE_AVISOS === 0) {
          console.warn(`⚠️  Balança não respondeu em ${base}`);
        }
        falhasSeguidas++;
      }
    } finally {
      emVoo = false;
    }
  }, intervalo);

  return pararLeituraContinua;
}

/**
 * Interrompe a leitura contínua. Chamada no desligamento do servidor.
 */
export function pararLeituraContinua(): void {
  if (temporizador) {
    clearInterval(temporizador);
    temporizador = null;
  }
}

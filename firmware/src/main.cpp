/**
 * Custo Certo — Firmware ESP32 (Balança HX711)
 *
 * A balança é um DISPOSITIVO DE REDE: ela sobe um servidor HTTP e responde a
 * quem perguntar o peso. Qualquer aplicação da rede local — o painel web em
 * Node, o aplicativo desktop em Java, ou um navegador aberto no IP dela — é
 * cliente da balança, e nenhuma depende da outra.
 *
 *   GET  /peso    -> {"peso":1.234,"estavel":true,"leituras":123,"uptime":45}
 *   POST /tara    -> zera a balança, responde {"ok":true}
 *   GET  /        -> página de status, útil para achar e testar o aparelho
 *
 * POR QUE O FLUXO FOI INVERTIDO
 * ---------------------------------------------------------------------------
 * Antes o ESP32 empurrava o peso para um servidor, e quem quisesse a leitura
 * tinha de perguntar para esse servidor. Isso amarrava o aplicativo desktop ao
 * projeto do painel web: sem o Node no ar, a balança não existia para o Java.
 *
 * Invertendo, os dois clientes fazem apenas conexão de SAÍDA até a balança.
 * Isso importa nesta operação: as máquinas do grupo não têm privilégio de
 * administrador, e abrir porta de ENTRADA no Firewall do Windows já foi o que
 * travou o acesso ao MySQL pela rede. Conexão de saída não precisa de regra.
 *
 * Some junto um acoplamento antigo: a tara era uma flag guardada no servidor,
 * que o firmware consumia — o que obrigava firmware e backend a subirem juntos,
 * sob pena de o pedido de tara nunca chegar. Agora a tara é um POST direto no
 * aparelho, e esse problema deixa de existir.
 *
 * O ENVIO REMOTO CONTINUA
 * ---------------------------------------------------------------------------
 * Se SERVER_URL estiver preenchido, o firmware também empurra a leitura para lá,
 * num ritmo mais lento. É o que mantém viável um painel hospedado fora da rede
 * da cafeteria, que jamais alcançaria um ESP32 atrás do roteador. Deixe
 * SERVER_URL vazio para desligar o envio e operar só na rede local.
 *
 * CONFIGURAÇÃO — via build_flags no platformio.ini (veja secrets.ini.example)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "HX711.h"

// =====================================================
// CONFIGURAÇÕES (sobrescreva via platformio.ini build_flags)
// =====================================================
#ifndef WIFI_SSID
#define WIFI_SSID "DEFINA_NO_SECRETS_INI"
#endif

#ifndef WIFI_PASS
#define WIFI_PASS "DEFINA_NO_SECRETS_INI"
#endif

#ifndef SERVER_URL
// Vazio = só rede local. Preenchido = também empurra para lá.
#define SERVER_URL ""
#endif

// Nome anunciado por mDNS. Os clientes podem usar http://custocerto-balanca.local
// em vez de decorar o IP, que muda a cada rede. Nem toda rede repassa mDNS, e por
// isso o IP continua aparecendo no Serial e na página de status.
#ifndef MDNS_NOME
#define MDNS_NOME "custocerto-balanca"
#endif

// =====================================================
// PINOS DA BALANÇA
// =====================================================
#define HX711_DT  32
#define HX711_SCK 33

// Calibração — ajuste com peso conhecido
#define SCALE_FACTOR 297313.0f

// =====================================================
// CONSTANTES DE TEMPO
// =====================================================
// O HX711 amostra a 10 Hz, ou seja, uma leitura fica pronta a cada ~100 ms.
// Pedir menos que isso não adianta: o chip não teria dado novo para entregar.
const unsigned long INTERVALO_LEITURA_MS = 100;

// O envio remoto é bem mais lento que a leitura de propósito. A chamada HTTP é
// bloqueante, e fazê-la dez vezes por segundo era o que travava o laço antes.
// Quem está na rede local não é afetado: consulta GET /peso quando quiser.
const unsigned long INTERVALO_ENVIO_REMOTO_MS = 1000;

const unsigned long WIFI_TIMEOUT_MS = 20000;

// Suavização por média móvel exponencial, feita aqui em software.
// Substitui o scale.get_units(5), que travava o laço por meio segundo
// esperando cinco amostras do chip. Com uma amostra só e este filtro, a
// leitura fica igualmente estável e chega cinco vezes mais rápido.
const float SUAVIZACAO = 0.35f;

// Quanto a leitura pode variar, entre amostras, e ainda ser considerada estável.
// A unidade é a mesma do peso — quilogramas — então 0.002 são dois gramas.
// Reajuste junto com SCALE_FACTOR se a calibração mudar de unidade.
const float TOLERANCIA_ESTAVEL = 0.002f;

// Quantas leituras seguidas dentro da tolerância confirmam que o prato parou.
// Três leituras a 10 Hz são cerca de 300 ms: rápido para quem está operando,
// e longo o bastante para não chamar de estável o meio de um movimento.
const int LEITURAS_PARA_ESTAVEL = 3;

// =====================================================
// ESTADO GLOBAL
// =====================================================
HX711 scale;
WebServer servidor(80);

unsigned long ultimaLeitura = 0;
unsigned long ultimoEnvioRemoto = 0;
unsigned long totalLeituras = 0;

float pesoSuavizado = 0.0f;
bool primeiraLeitura = true;
int leiturasEstaveis = 0;

/**
 * Informa se há um servidor remoto configurado para receber as leituras.
 */
bool temServidorRemoto() {
  return strlen(SERVER_URL) > 0;
}

/**
 * Informa se a URL remota usa TLS.
 */
bool servidorRemotoEhHttps() {
  return String(SERVER_URL).startsWith("https://");
}

/**
 * Informa se o prato parou de oscilar.
 */
bool pesoEstavel() {
  return leiturasEstaveis >= LEITURAS_PARA_ESTAVEL;
}

/**
 * Zera a balança e reinicia o filtro de suavização.
 *
 * O filtro precisa ser reiniciado junto: se ficasse com o valor antigo, ele
 * puxaria a leitura de volta ao peso anterior por vários ciclos depois da tara.
 */
void executarTara() {
  scale.tare();
  pesoSuavizado = 0.0f;
  primeiraLeitura = true;
  leiturasEstaveis = 0;
  Serial.println("Tara executada");
}

// =====================================================
// SERVIDOR HTTP DO APARELHO
// =====================================================

/**
 * Libera o acesso de qualquer origem.
 *
 * A balança serve dados de peso, sem autenticação e sem nada sensível, para
 * clientes que estão na mesma rede local. Sem este cabeçalho, uma página aberta
 * no navegador não conseguiria ler o peso por causa da política de origem.
 */
void enviarCabecalhosCors() {
  servidor.sendHeader("Access-Control-Allow-Origin", "*");
  servidor.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  servidor.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * GET /peso — a leitura atual.
 */
void tratarPeso() {
  enviarCabecalhosCors();

  char corpo[160];
  snprintf(corpo, sizeof(corpo),
           "{\"peso\":%.3f,\"estavel\":%s,\"leituras\":%lu,\"uptime\":%lu}",
           pesoSuavizado,
           pesoEstavel() ? "true" : "false",
           totalLeituras,
           millis() / 1000);

  servidor.send(200, "application/json", corpo);
}

/**
 * POST /tara — zera a balança.
 */
void tratarTara() {
  enviarCabecalhosCors();
  executarTara();
  servidor.send(200, "application/json", "{\"ok\":true}");
}

/**
 * Responde à consulta que o navegador faz antes de um POST de outra origem.
 */
void tratarPreflight() {
  enviarCabecalhosCors();
  servidor.send(204);
}

/**
 * GET / — página de status.
 *
 * Existe para o dia da apresentação: abrir o IP da balança no navegador mostra
 * na hora se ela está viva, qual o peso e qual o endereço a configurar nos dois
 * aplicativos. Também dá um botão de tara para testar sem depender de nada.
 */
void tratarRaiz() {
  enviarCabecalhosCors();

  String html = F(
      "<!doctype html><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>Custo Certo - Balanca</title>"
      "<style>body{font-family:system-ui,sans-serif;margin:0;padding:2rem;"
      "background:#f6f7f9;color:#1a1d1a}h1{font-size:1.1rem;margin:0 0 1.5rem;"
      "color:#00a86b}.p{font-size:3rem;font-weight:700;font-variant-numeric:"
      "tabular-nums}.s{color:#8892a4;font-size:.9rem;margin:.3rem 0 1.5rem}"
      "button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:6px;"
      "background:#00a86b;color:#fff;cursor:pointer}"
      "table{margin-top:2rem;border-collapse:collapse;font-size:.85rem}"
      "td{padding:.3rem 1rem .3rem 0;color:#4c5350}</style>"
      "<h1>Custo Certo &mdash; Balan&ccedil;a</h1>"
      "<div class='p' id='p'>--</div><div class='s' id='s'>lendo...</div>"
      "<button onclick=\"fetch('/tara',{method:'POST'})\">Tarar</button>"
      "<table><tr><td>Endere&ccedil;o</td><td id='ip'></td></tr>"
      "<tr><td>Nome mDNS</td><td>" MDNS_NOME ".local</td></tr>"
      "<tr><td>Rede</td><td>" WIFI_SSID "</td></tr></table>"
      "<script>setInterval(async()=>{try{const r=await fetch('/peso');"
      "const d=await r.json();document.getElementById('p').textContent="
      "d.peso.toFixed(3)+' kg';document.getElementById('s').textContent="
      "(d.estavel?'estavel':'oscilando')+' \\u00b7 '+d.leituras+' leituras \\u00b7 '"
      "+d.uptime+'s no ar';}catch(e){document.getElementById('s').textContent="
      "'sem resposta';}},400);</script>");

  html += "<script>document.getElementById('ip').textContent='";
  html += WiFi.localIP().toString();
  html += "';</script>";

  servidor.send(200, "text/html; charset=utf-8", html);
}

/**
 * Sobe o servidor HTTP e anuncia o aparelho por mDNS.
 */
void iniciarServidor() {
  servidor.on("/", HTTP_GET, tratarRaiz);
  servidor.on("/peso", HTTP_GET, tratarPeso);
  servidor.on("/tara", HTTP_POST, tratarTara);
  servidor.on("/tara", HTTP_OPTIONS, tratarPreflight);
  servidor.onNotFound([]() {
    enviarCabecalhosCors();
    servidor.send(404, "application/json", "{\"erro\":\"rota inexistente\"}");
  });

  servidor.begin();
  Serial.println("Servidor HTTP no ar na porta 80");

  if (MDNS.begin(MDNS_NOME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("Tambem acessivel em http://%s.local\n", MDNS_NOME);
  } else {
    Serial.println("mDNS indisponivel — use o IP acima");
  }
}

// =====================================================
// CONEXÃO WI-FI
// =====================================================
void conectarWiFi() {
  Serial.print("Conectando ao Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - inicio > WIFI_TIMEOUT_MS) {
      Serial.println("\nFalha ao conectar — reiniciando...");
      ESP.restart();
    }
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Wi-Fi OK | IP: ");
  Serial.println(WiFi.localIP());
}

// =====================================================
// ENVIO REMOTO (opcional)
// =====================================================
/**
 * Empurra a leitura para o servidor remoto, quando há um configurado.
 *
 * O cliente e a conexão são estáticos de propósito: com setReuse(true) a conexão
 * TCP fica aberta entre os envios, em vez de refazer o handshake a cada um.
 *
 * A resposta ainda é examinada em busca de um pedido de tara. Isso mantém o
 * caminho remoto funcionando para um painel hospedado fora da rede, que não
 * consegue chamar POST /tara diretamente no aparelho.
 */
void enviarParaServidorRemoto(float peso) {
  static HTTPClient http;
  static WiFiClient clientPlain;
  static WiFiClientSecure clientSecure;
  static bool configurado = false;

  if (!configurado) {
    clientSecure.setInsecure();
    http.setReuse(true);
    configurado = true;
  }

  bool ok;
  if (servidorRemotoEhHttps()) {
    ok = http.begin(clientSecure, String(SERVER_URL) + "/balanca/peso");
  } else {
    ok = http.begin(clientPlain, String(SERVER_URL) + "/balanca/peso");
  }

  if (!ok) {
    return;
  }

  http.addHeader("Content-Type", "application/json");
  // Timeout curto: se o servidor remoto não responder rápido, é melhor perder
  // um envio do que atrasar as leituras de quem está na rede local.
  http.setTimeout(2000);

  char corpo[64];
  snprintf(corpo, sizeof(corpo), "{\"peso\":%.3f}", peso);

  int code = http.POST(corpo);
  if (code >= 200 && code < 300) {
    if (http.getString().indexOf("\"tarar\":true") >= 0) {
      executarTara();
    }
  } else {
    Serial.printf("POST remoto -> %d\n", code);
  }

  http.end();
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Custo Certo - Balanca ===");

  conectarWiFi();

  Serial.print("Iniciando HX711 nos pinos DT=");
  Serial.print(HX711_DT);
  Serial.print(" SCK=");
  Serial.println(HX711_SCK);

  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(SCALE_FACTOR);
  scale.tare();
  Serial.println("Balanca calibrada e pronta");

  iniciarServidor();

  if (temServidorRemoto()) {
    Serial.print("Envio remoto ligado: ");
    Serial.println(SERVER_URL);
  } else {
    Serial.println("Envio remoto desligado — operando so na rede local");
  }
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi caiu — reconectando...");
    conectarWiFi();
  }

  // Atender quem perguntou o peso vem primeiro: é o caminho principal agora, e
  // é barato quando não há requisição pendente.
  servidor.handleClient();

  unsigned long agora = millis();

  // scale.is_ready() evita o ponto mais caro do laço: sem ele, get_units()
  // fica bloqueado esperando o chip terminar a conversão. Aqui só lemos
  // quando já existe amostra pronta, e o laço nunca trava.
  if (agora - ultimaLeitura >= INTERVALO_LEITURA_MS && scale.is_ready()) {
    ultimaLeitura = agora;
    totalLeituras++;

    float bruto = scale.get_units(1);
    if (bruto < 0) bruto = 0;

    if (primeiraLeitura) {
      pesoSuavizado = bruto;
      primeiraLeitura = false;
      leiturasEstaveis = 0;
    } else {
      if (fabsf(bruto - pesoSuavizado) <= TOLERANCIA_ESTAVEL) {
        if (leiturasEstaveis < LEITURAS_PARA_ESTAVEL) {
          leiturasEstaveis++;
        }
      } else {
        leiturasEstaveis = 0;
      }
      pesoSuavizado = (SUAVIZACAO * bruto) + ((1.0f - SUAVIZACAO) * pesoSuavizado);
    }
  }

  if (temServidorRemoto() && agora - ultimoEnvioRemoto >= INTERVALO_ENVIO_REMOTO_MS) {
    ultimoEnvioRemoto = agora;
    enviarParaServidorRemoto(pesoSuavizado);
  }

  delay(1);
}

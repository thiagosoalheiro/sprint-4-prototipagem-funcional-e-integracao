/* =====================================================================
   ChargeGrid Intelligence — Estação de recarga solar-first
   Challenge GoodWe 2026 · FIAP · Grupo 2
   ESP32 + Wokwi + Firebase Realtime Database

   FLUXO (versão simplificada, sem confirmação no app):
   1) O celular (main.html) grava telemetria/vaga1 { soc, plugado, ts }.
   2) No Serial Monitor do Wokwi, digita-se o e-mail do motorista.
   3) O ESP32 procura o e-mail em /users. Se existir, cria a sessão em
      /sessoes e começa a carregar na hora.
   4) A telemetria vai para estacoes/<id>/ e sessoes/<id>; o site lê de lá.
   5) O site grava estacoes/<id>/comandos/vagaN { acao:"parar" }. O ESP32
      lê, encerra a sessão e PARA de enviar telemetria daquela recarga.

   Vaga 1: veículo REAL (telemetria do Android via Battery Status API)
   Vagas 2-4: simuladas por potenciômetro + botão (cabo)
   ===================================================================== */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

/* ============ CONFIGURE AQUI ============ */
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";
const int   WIFI_CH   = 6;

const char* DB_URL     = "https://goodwedb-default-rtdb.firebaseio.com";
const char* ESTACAO_ID = "GW_COMMERCIAL_01";
/* ======================================== */

/* ---------- pinos (todos ADC1: ADC2 é bloqueado pelo Wi-Fi) ---------- */
#define PIN_SOLAR 34
const int PIN_SOC[4] = { 35, 32, 33, 39 };
const int PIN_BTN[4] = {  4,  5, 18, 19 };
#define PIN_LED   13
#define N_LEDS     8

/* ---------- parâmetros do modelo ---------- */
const float P_DISJUNTOR   = 40.0;   // kW — limite físico da entrada
const float P_REDE_PONTA  =  8.0;   // kW — teto de rede em horário de ponta
const float P_SOLAR_MAX   = 25.0;   // kW — geração de pico (escala 1:1000)
const float P_VAGA_MAX    = 11.0;   // kW — potência nominal por vaga
const float P_PISO        =  3.7;   // kW — ninguém fica parado
const float CAP_BATERIA   = 60.0;   // kWh — capacidade do "veículo"

const float TARIFA_PONTA  = 2.80;   // R$/kWh
const float TARIFA_REDE   = 2.20;
const float TARIFA_SOLAR  = 1.60;   // a tarifa segue o sol

const unsigned long TELEMETRIA_TTL = 15000;  // ms sem o celular mudar o "ts" = offline

/* ---------- identidade dos veículos (análogo ao EVCCID) ---------- */
const char* EVCCID[4] = {
  "A4F21B8C039E", "B7C3D91E2048", "C2E58A47F1B3", "D9014FA6C72E"
};

/* ---------- estado ---------- */
struct Vaga {
  bool     conectada  = false;   // cabo plugado
  bool     autorizada = false;   // motorista identificado (sessão criada)
  bool     parada     = false;   // sessão interrompida (site, Serial ou cabo)
  bool     concluida  = false;   // bateria em 100%
  int      soc        = 0;
  float    demanda    = 0;
  float    alocado    = 0;
  float    energia    = 0;   // kWh da sessão
  float    solarKwh   = 0;
  float    redeKwh    = 0;
  float    valor      = 0;
  uint32_t inicioMs   = 0;
  float    fase       = 0;   // animação do LED
  String   uid;
  String   nome;
  String   email;
  String   sessaoId;
};
Vaga vaga[4];

float solarKW      = 0;
float pLimite      = P_DISJUNTOR;
float pTotal       = 0;
float fracaoSolar  = 0;
bool  horarioPonta = false;
bool  deficitAtivo = false;

int  socRemoto = -1;
bool plugadoRemoto = false;
long tsRemoto = -1;               // último "ts" visto no celular
bool vaga0Remota = false;         // vaga 1 foi conectada pela telemetria
unsigned long ultimaTelemetria = 0;
bool telemetriaViva = false;

uint32_t contadorSessao = 0;
uint32_t contadorAlerta = 0;

String linhaSerial = "";
char   avisoL1[17] = "", avisoL2[17] = "";
unsigned long tAviso = 0;

/* ---------- objetos ---------- */
Adafruit_NeoPixel strip(N_LEDS, PIN_LED, NEO_GRB + NEO_KHZ800);
LiquidCrystal_I2C lcd(0x27, 16, 2);
WiFiClientSecure  net;
Preferences       prefs;

unsigned long tCiclo = 0, tRede = 0, tPub = 0, tHist = 0, tLcd = 0;
bool alternaLeitura = false;

/* =====================================================================
   SETUP
   ===================================================================== */
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[ChargeGrid] iniciando...");

  for (int i = 0; i < 4; i++) pinMode(PIN_BTN[i], INPUT_PULLUP);
  analogReadResolution(12);

  strip.begin();
  strip.setBrightness(120);
  strip.show();

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("ChargeGrid");
  lcd.setCursor(0, 1);
  lcd.print("conectando...");

  prefs.begin("chargegrid", false);
  contadorSessao = prefs.getUInt("sessao", 0);
  contadorAlerta = prefs.getUInt("alerta", 0);

  WiFi.begin(WIFI_SSID, WIFI_PASS, WIFI_CH);
  while (WiFi.status() != WL_CONNECTED) { delay(150); Serial.print("."); }
  Serial.printf("\n[WiFi] ok  IP %s\n", WiFi.localIP().toString().c_str());

  net.setInsecure();          // demo: sem validação de certificado

  lcd.clear();
  lcd.print("Estacao online");
  ajudaSerial();
}

/* =====================================================================
   ENTRADAS
   ===================================================================== */
inline bool ativa(int i) {  // carregando de fato
  return vaga[i].conectada && vaga[i].autorizada && !vaga[i].parada && !vaga[i].concluida;
}

void aviso(const char* l1, const char* l2) {
  snprintf(avisoL1, 17, "%-16s", l1);
  snprintf(avisoL2, 17, "%-16s", l2);
  tAviso = millis();
}

void lerBotoes() {
  static bool ultimo[4] = { HIGH, HIGH, HIGH, HIGH };
  static unsigned long tUlt[4] = { 0, 0, 0, 0 };

  for (int i = 0; i < 4; i++) {
    bool agora = digitalRead(PIN_BTN[i]);
    if (agora != ultimo[i] && millis() - tUlt[i] > 60) {
      tUlt[i] = millis();
      ultimo[i] = agora;
      if (agora == LOW) {
        // vaga 1 obedece à telemetria quando ela está viva
        if (i == 0 && telemetriaViva) continue;
        if (vaga[i].conectada) desconectar(i);
        else                   conectar(i);
      }
    }
  }
}

void conectar(int i) {
  vaga[i] = Vaga();
  vaga[i].conectada = true;
  vaga[i].inicioMs  = millis();
  Serial.printf("[vaga %d] veiculo %s conectado. Digite o e-mail do motorista%s.\n",
                i + 1, EVCCID[i], i == 0 ? "" : " (ex.: \"2 email@gmail.com\")");
  char l2[24];
  snprintf(l2, 24, "Vaga %d: login", i + 1);
  aviso("Veiculo conectado", l2);
}

void desconectar(int i) {
  if (vaga[i].sessaoId.length() > 0)
    finalizarSessao(i, "cabo_removido", vaga[i].concluida ? "concluida" : "parada");
  vaga[i] = Vaga();
  if (i == 0) vaga0Remota = false;
  Serial.printf("[vaga %d] liberada\n", i + 1);
}

void lerSensores() {
  solarKW = (analogRead(PIN_SOLAR) / 4095.0) * P_SOLAR_MAX;

  for (int i = 0; i < 4; i++) {
    if (i == 0 && telemetriaViva) {
      if (plugadoRemoto && !vaga[0].conectada)  { conectar(0); vaga0Remota = true; }
      if (!plugadoRemoto &&  vaga[0].conectada) { desconectar(0); }
      vaga[0].soc = socRemoto;                      // veículo real (depois do conectar, que zera o SoC)
    } else {
      int leitura = 0;
      for (int k = 0; k < 5; k++) leitura += analogRead(PIN_SOC[i]);  // média móvel
      vaga[i].soc = map(leitura / 5, 0, 4095, 0, 100);
    }
  }
}

/* =====================================================================
   SERIAL — identificação do motorista (simula o "login" no carregador)
   ===================================================================== */
void ajudaSerial() {
  Serial.println("[serial] Digite o e-mail do motorista para iniciar a recarga na vaga 1,");
  Serial.println("         ou 'N e-mail' para outra vaga (ex.: 2 maria@gmail.com).");
  Serial.println("         'parar' ou 'parar N' encerra a recarga. 'status' lista as vagas.");
}

void imprimirStatus() {
  for (int i = 0; i < 4; i++) {
    Serial.printf("[vaga %d] %-10s soc %3d%%  %4.1f kW  %.3f kWh  %s\n", i + 1, statusVaga(i),
                  vaga[i].soc, vaga[i].alocado, vaga[i].energia, vaga[i].nome.c_str());
  }
}

void processarLinha(String l) {
  l.trim();
  if (l.length() == 0) return;
  String baixo = l;
  baixo.toLowerCase();

  if (baixo == "ajuda" || baixo == "help" || baixo == "?") { ajudaSerial(); return; }
  if (baixo == "status") { imprimirStatus(); return; }

  if (baixo == "parar" || baixo.startsWith("parar ")) {
    int n = baixo.substring(5).toInt();
    if (n == 0) n = 1;
    if (n < 1 || n > 4) { Serial.println("[serial] vaga invalida (1 a 4)"); return; }
    if (!ativa(n - 1)) { Serial.printf("[vaga %d] nenhuma recarga em andamento\n", n); return; }
    pararVaga(n - 1, "comando_serial");
    return;
  }

  int idx = 0;
  String email = baixo;
  int sp = baixo.indexOf(' ');
  if (sp > 0) {
    int n = baixo.substring(0, sp).toInt();
    if (n >= 1 && n <= 4) {
      idx = n - 1;
      email = baixo.substring(sp + 1);
      email.trim();
    }
  }
  if (email.indexOf('@') < 1) { Serial.println("[serial] e-mail invalido. Digite 'ajuda'."); return; }
  iniciarPorEmail(idx, email);
}

void lerSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { processarLinha(linhaSerial); linhaSerial = ""; }
    else if (linhaSerial.length() < 100) linhaSerial += c;
  }
}

/* =====================================================================
   MODELO — demanda, rateio e energia
   ===================================================================== */
float demandaPorSoc(int soc) {
  if (soc >= 100) return 0.0;      // sessão concluída
  if (soc >=  95) return 2.0;      // taper CC-CV
  if (soc >=  80) return 7.4;      // tensão constante
  return P_VAGA_MAX;               // corrente constante
}

float tarifaAtual() {
  return horarioPonta ? TARIFA_PONTA : (fracaoSolar > 0.5 ? TARIFA_SOLAR : TARIFA_REDE);
}

void calcularAlocacao() {
  pLimite = P_DISJUNTOR;
  if (horarioPonta) pLimite = min(P_DISJUNTOR, solarKW + P_REDE_PONTA);

  float demandaTotal = 0;
  int   ativas = 0;
  for (int i = 0; i < 4; i++) {
    vaga[i].alocado = 0;
    vaga[i].concluida = (vaga[i].conectada && vaga[i].autorizada && vaga[i].soc >= 100);
    if (ativa(i)) {
      vaga[i].demanda = demandaPorSoc(vaga[i].soc);
      demandaTotal += vaga[i].demanda;
      ativas++;
    } else {
      vaga[i].demanda = 0;
    }
  }

  if (ativas == 0) { pTotal = 0; fracaoSolar = 0; verificarDeficit(false); return; }

  if (demandaTotal <= pLimite) {
    for (int i = 0; i < 4; i++) vaga[i].alocado = vaga[i].demanda;
    verificarDeficit(false);
  } else {
    // prioriza quem tem menos bateria
    int ordem[4], n = 0;
    for (int i = 0; i < 4; i++)
      if (ativa(i)) ordem[n++] = i;
    for (int a = 0; a < n - 1; a++)
      for (int b = a + 1; b < n; b++)
        if (vaga[ordem[b]].soc < vaga[ordem[a]].soc) {
          int t = ordem[a]; ordem[a] = ordem[b]; ordem[b] = t;
        }

    float piso = min(P_PISO, pLimite / n);
    float restante = pLimite - piso * n;
    for (int k = 0; k < n; k++) {
      int i = ordem[k];
      float extra = min(vaga[i].demanda - piso, restante);
      if (extra < 0) extra = 0;
      vaga[i].alocado = piso + extra;
      restante -= extra;
    }
    verificarDeficit(true);
  }

  pTotal = 0;
  for (int i = 0; i < 4; i++) pTotal += vaga[i].alocado;
  fracaoSolar = (pTotal > 0.01) ? min(1.0f, solarKW / pTotal) : 0;
}

void acumularEnergia(float dtSegundos) {
  float h = dtSegundos / 3600.0;
  float tarifa = tarifaAtual();

  for (int i = 0; i < 4; i++) {
    if (vaga[i].alocado <= 0) continue;
    float kwh = vaga[i].alocado * h;
    vaga[i].energia  += kwh;
    vaga[i].solarKwh += kwh * fracaoSolar;
    vaga[i].redeKwh  += kwh * (1.0 - fracaoSolar);
    vaga[i].valor    += kwh * tarifa;
  }
}

int minutosRestantes(int i) {
  if (vaga[i].alocado <= 0.01) return -1;
  float falta = (100 - vaga[i].soc) / 100.0 * CAP_BATERIA;   // kWh
  return (int)((falta / vaga[i].alocado) * 60.0);
}

const char* statusVaga(int i) {
  if (!vaga[i].conectada)  return "livre";
  if (!vaga[i].autorizada) return "aguardando";   // cabo ok, falta identificar o motorista
  if (vaga[i].concluida)   return "concluida";
  if (vaga[i].parada)      return "parada";
  return "carregando";
}

/* =====================================================================
   LEDS — 2 por vaga, velocidade proporcional à potência
   ===================================================================== */
void atualizarLeds() {
  for (int i = 0; i < 4; i++) {
    uint8_t r = 0, g = 0, b = 0;
    float brilhoA = 1.0, brilhoB = 1.0;

    if (!vaga[i].conectada) {
      r = 0; g = 60; b = 170;                       // azul: livre
      float p = (sin(millis() / 900.0) + 1) / 2;
      brilhoA = brilhoB = 0.25 + p * 0.45;
    } else if (!vaga[i].autorizada) {
      r = 150; g = 90; b = 220;                     // roxo: aguardando login
      float p = (sin(millis() / 350.0) + 1) / 2;
      brilhoA = brilhoB = 0.30 + p * 0.70;
    } else if (vaga[i].concluida) {
      r = 0; g = 170; b = 70;                       // verde fixo
    } else if (vaga[i].parada) {
      r = 214; g = 69; b = 60;                      // vermelho fixo: parada
    } else if (vaga[i].alocado > 0) {
      if (fracaoSolar > 0.5) { r = 0;   g = 180; b = 90; }  // solar
      else                   { r = 232; g = 163; b = 61; }  // rede
      float vel = 0.05 + (vaga[i].alocado / P_VAGA_MAX) * 0.45;
      vaga[i].fase += vel;
      brilhoA = 0.30 + (sin(vaga[i].fase) + 1) / 2 * 0.70;
      brilhoB = 0.30 + (sin(vaga[i].fase + PI) + 1) / 2 * 0.70;
    } else {
      r = 214; g = 69; b = 60;                      // vermelho: sem potência
    }

    strip.setPixelColor(i * 2,     strip.Color(r * brilhoA, g * brilhoA, b * brilhoA));
    strip.setPixelColor(i * 2 + 1, strip.Color(r * brilhoB, g * brilhoB, b * brilhoB));
  }
  strip.show();
}

void atualizarLcd() {
  if (millis() - tAviso < 4000 && avisoL1[0]) {   // mensagem temporária
    lcd.setCursor(0, 0); lcd.print(avisoL1);
    lcd.setCursor(0, 1); lcd.print(avisoL2);
    return;
  }
  char l1[17], l2[24];
  snprintf(l1, 17, "%4.1f/%4.1fkW %s", pTotal, pLimite, horarioPonta ? "PT" : "  ");
  int ativas = 0, espera = -1;
  for (int i = 0; i < 4; i++) {
    if (vaga[i].conectada) ativas++;
    if (vaga[i].conectada && !vaga[i].autorizada && espera < 0) espera = i;
  }
  if (espera >= 0) snprintf(l2, 24, "V%d aguarda login", espera + 1);
  else             snprintf(l2, 24, "Vagas %d/4  %s", ativas, fracaoSolar > 0.5 ? "SOLAR" : "REDE ");
  lcd.setCursor(0, 0); lcd.print(l1);
  lcd.setCursor(0, 1); lcd.print(l2);
}

/* =====================================================================
   FIREBASE (REST)
   ===================================================================== */
bool requisicao(const char* metodo, const String& caminho,
                const String& corpo, String& resposta) {
  HTTPClient http;
  http.setReuse(true);
  http.setTimeout(6000);
  if (!http.begin(net, String(DB_URL) + caminho)) return false;
  http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest(metodo, (uint8_t*)corpo.c_str(), corpo.length());
  bool ok = (code == 200);
  if (ok) resposta = http.getString();
  http.end();
  return ok;
}

String baseEstacao() { return String("estacoes/") + ESTACAO_ID; }

/* Carimbo de tempo do servidor do Firebase (não precisa de NTP). */
void svTs(JsonObject o, const char* chave) {
  JsonObject t = o.createNestedObject(chave);
  t[".sv"] = "timestamp";
}

/* Procura o e-mail na lista /users (gravada pelo app no cadastro). */
bool buscarUsuario(const String& email, String& uid, String& nome) {
  String resp;
  if (!requisicao("GET", "/users.json", "", resp)) {
    Serial.println("[users] falha ao consultar o Firebase");
    return false;
  }
  StaticJsonDocument<128> filtro;
  filtro["*"]["email"] = true;
  filtro["*"]["nome"]  = true;

  DynamicJsonDocument doc(8192);
  DeserializationError err = deserializeJson(doc, resp, DeserializationOption::Filter(filtro));
  if (err || doc.isNull()) return false;

  for (JsonPair kv : doc.as<JsonObject>()) {
    String e = String((const char*)(kv.value()["email"] | ""));
    e.trim();
    e.toLowerCase();
    if (e == email) {
      uid  = String(kv.key().c_str());
      nome = String((const char*)(kv.value()["nome"] | "Motorista"));
      return true;
    }
  }
  return false;
}

/* Cria o documento da sessão e devolve o id gerado pelo Firebase. */
String criarSessao(int i) {
  Vaga& v = vaga[i];
  DynamicJsonDocument doc(1536);
  JsonObject o = doc.to<JsonObject>();
  o["uid"]               = v.uid;
  o["nome"]              = v.nome;
  o["email"]             = v.email;
  o["carregador_id"]     = ESTACAO_ID;
  o["vaga"]              = String("vaga") + (i + 1);
  o["veiculo_id"]        = EVCCID[i];
  o["status"]            = "carregando";
  o["bateria_inicial"]   = v.soc;
  o["bateria_atual"]     = v.soc;
  o["vel_recarga_kw"]    = 0;
  o["energia_total_kwh"] = 0;
  o["solar_kwh"]         = 0;
  o["rede_kwh"]          = 0;
  o["custo_total"]       = 0;
  o["preco_kwh"]         = tarifaAtual();
  o["tempo_restante"]    = -1;
  svTs(o, "tempo_inicio");
  svTs(o, "atualizado_em");

  String corpo, resp;
  serializeJson(doc, corpo);
  if (!requisicao("POST", "/sessoes.json", corpo, resp)) return "";

  StaticJsonDocument<128> r;
  if (deserializeJson(r, resp)) return "";
  return String((const char*)(r["name"] | ""));
}

/* Fecha a sessão. Depois disso nada mais é enviado para ela. */
void finalizarSessao(int i, const char* motivo, const char* status) {
  Vaga& v = vaga[i];
  if (v.sessaoId.length() == 0) return;

  DynamicJsonDocument doc(1024);
  JsonObject o = doc.to<JsonObject>();
  o["status"]            = status;
  o["motivo_fim"]        = motivo;
  o["bateria_atual"]     = v.soc;
  o["bateria_final"]     = v.soc;
  o["vel_recarga_kw"]    = 0;
  o["tempo_restante"]    = 0;
  o["energia_total_kwh"] = round(v.energia * 1000) / 1000.0;
  o["solar_kwh"]         = round(v.solarKwh * 1000) / 1000.0;
  o["rede_kwh"]          = round(v.redeKwh * 1000) / 1000.0;
  o["custo_total"]       = round(v.valor * 100) / 100.0;
  o["duracao_s"]         = (millis() - v.inicioMs) / 1000;
  svTs(o, "tempo_fim");
  svTs(o, "atualizado_em");

  String corpo, resp;
  serializeJson(doc, corpo);
  requisicao("PATCH", "/sessoes/" + v.sessaoId + ".json", corpo, resp);

  contadorSessao++;
  prefs.putUInt("sessao", contadorSessao);
  Serial.printf("[sessao] vaga %d encerrada (%s): %.3f kWh  R$ %.2f\n",
                i + 1, motivo, v.energia, v.valor);
  v.sessaoId = "";
}

void iniciarSessao(int i, const String& uid, const String& nome, const String& email) {
  Vaga& v = vaga[i];
  v.uid = uid; v.nome = nome; v.email = email;
  v.autorizada = true; v.parada = false; v.concluida = false;
  v.energia = 0; v.solarKwh = 0; v.redeKwh = 0; v.valor = 0;
  v.inicioMs = millis();
  v.sessaoId = criarSessao(i);

  // um "parar" antigo ainda pendente não pode cancelar a sessão nova
  String r;
  requisicao("PATCH", "/" + baseEstacao() + "/comandos/vaga" + (i + 1) + ".json",
             "{\"processado\":true}", r);

  Serial.printf("[vaga %d] LOGIN OK: %s <%s>  uid %s\n", i + 1, nome.c_str(), email.c_str(), uid.c_str());
  if (v.sessaoId.length() == 0) Serial.println("[sessao] AVISO: nao foi possivel criar a sessao no Firebase");
  else Serial.printf("[sessao] %s criada. Recarga iniciada.\n", v.sessaoId.c_str());

  char l2[24];
  snprintf(l2, 24, "Vaga %d carregando", i + 1);
  aviso(nome.substring(0, 16).c_str(), l2);
  calcularAlocacao();
  publicarEstado();
}

void iniciarPorEmail(int i, const String& email) {
  lerSensores();                  // SoC e cabo atualizados no instante do login
  Vaga& v = vaga[i];
  if (!v.conectada) {
    Serial.printf("[vaga %d] nenhum veiculo conectado.%s\n", i + 1,
                  i == 0 ? " Plugue o celular (main.html) ou aperte o botao da vaga 1." : " Aperte o botao da vaga.");
    aviso("Sem veiculo", "conecte o cabo");
    return;
  }
  if (ativa(i)) { Serial.printf("[vaga %d] ja esta carregando\n", i + 1); return; }
  if (v.concluida || v.soc >= 100) {
    Serial.printf("[vaga %d] bateria ja esta em 100%%\n", i + 1);
    return;
  }

  Serial.printf("[vaga %d] procurando %s em /users ...\n", i + 1, email.c_str());
  String uid, nome;
  if (!buscarUsuario(email, uid, nome)) {
    Serial.println("[login] usuario NAO cadastrado (ou Firebase indisponivel). Recarga nao iniciada.");
    aviso("Nao cadastrado", email.substring(0, 16).c_str());
    return;
  }
  iniciarSessao(i, uid, nome, email);
}

void pararVaga(int i, const char* motivo) {
  if (!ativa(i)) return;
  vaga[i].parada = true;
  vaga[i].alocado = 0;
  vaga[i].demanda = 0;
  finalizarSessao(i, motivo, "parada");
  Serial.printf("[vaga %d] recarga PARADA (%s). Telemetria da sessao encerrada.\n", i + 1, motivo);
  char l2[24];
  snprintf(l2, 24, "Vaga %d parada", i + 1);
  aviso("Recarga parada", l2);
  calcularAlocacao();
  publicarEstado();
}

/* Um único PATCH na raiz com caminhos profundos: só os campos listados
   são atualizados, nada que o site tenha gravado é apagado. */
void publicarEstado() {
  tPub = millis();
  DynamicJsonDocument doc(8192);
  String base = baseEstacao();

  JsonObject est = doc.createNestedObject(base + "/estado");
  est["entrada_kw"]        = P_DISJUNTOR;
  est["limite_atual_kw"]   = round(pLimite * 10) / 10.0;
  est["geracao_solar_kw"]  = round(solarKW * 10) / 10.0;
  est["potencia_total_kw"] = round(pTotal * 10) / 10.0;
  est["fracao_solar"]      = round(fracaoSolar * 100) / 100.0;
  est["fonte_predominante"]= fracaoSolar > 0.5 ? "solar" : "rede";
  est["horario_ponta"]     = horarioPonta;
  est["tarifa_kwh"]        = tarifaAtual();
  est["veiculo_real"]      = telemetriaViva;
  est["uptime_s"]          = millis() / 1000;
  svTs(est, "atualizado_em");

  for (int i = 0; i < 4; i++) {
    Vaga& vg = vaga[i];
    JsonObject v = doc.createNestedObject(base + "/vagas/vaga" + (i + 1));
    v["status"]         = statusVaga(i);
    v["usuario"]        = vg.nome;
    v["email"]          = vg.email;
    v["uid"]            = vg.uid;
    v["sessao_id"]      = vg.sessaoId;
    v["veiculo_id"]     = vg.conectada ? EVCCID[i] : "";
    v["potencia_kw"]    = round(vg.alocado * 10) / 10.0;
    v["demanda_kw"]     = round(vg.demanda * 10) / 10.0;
    v["potencia_max_kw"]= P_VAGA_MAX;
    v["soc"]            = vg.soc;
    v["energia_kwh"]    = round(vg.energia * 1000) / 1000.0;
    v["solar_kwh"]      = round(vg.solarKwh * 1000) / 1000.0;
    v["rede_kwh"]       = round(vg.redeKwh * 1000) / 1000.0;
    v["valor"]          = round(vg.valor * 100) / 100.0;
    v["previsao_min"]   = vg.conectada ? minutosRestantes(i) : -1;
    v["fonte_real"]     = (i == 0 && telemetriaViva);

    // telemetria da sessão: só enquanto a recarga está ativa
    if (ativa(i) && vg.sessaoId.length() > 0) {
      String sp = String("sessoes/") + vg.sessaoId + "/";
      doc[sp + "bateria_atual"]     = vg.soc;
      doc[sp + "vel_recarga_kw"]    = round(vg.alocado * 10) / 10.0;
      doc[sp + "energia_total_kwh"] = round(vg.energia * 1000) / 1000.0;
      doc[sp + "solar_kwh"]         = round(vg.solarKwh * 1000) / 1000.0;
      doc[sp + "rede_kwh"]          = round(vg.redeKwh * 1000) / 1000.0;
      doc[sp + "custo_total"]       = round(vg.valor * 100) / 100.0;
      doc[sp + "tempo_restante"]    = minutosRestantes(i);
      JsonObject t = doc.createNestedObject(sp + "atualizado_em");
      t[".sv"] = "timestamp";
    }
  }

  if (doc.overflowed()) Serial.println("[firebase] AVISO: documento de publicacao grande demais");

  String corpo, resp;
  serializeJson(doc, corpo);
  if (!requisicao("PATCH", "/.json", corpo, resp))
    Serial.println("[firebase] falha ao publicar");
}

void lerTelemetria() {
  String resp;
  if (!requisicao("GET", "/telemetria/vaga1.json", "", resp)) return;

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, resp) || doc.isNull()) return;

  int  s  = doc["soc"]     | -1;
  bool p  = doc["plugado"] | false;
  long ts = doc["ts"]      | 0L;
  if (s < 0) return;

  // O celular manda um "ts" novo a cada ~3 s. Se o "ts" parar de mudar,
  // o celular sumiu. A 1ª leitura só fixa a referência (dado antigo não vale).
  if (tsRemoto == -1) { tsRemoto = ts; return; }
  if (ts != tsRemoto) {
    tsRemoto = ts;
    ultimaTelemetria = millis();
    socRemoto = s;
    plugadoRemoto = p;
    if (!telemetriaViva) Serial.println("[telemetria] veiculo real online");
  }
}

void lerComandos() {
  String resp;
  if (!requisicao("GET", "/" + baseEstacao() + "/comandos.json", "", resp)) return;

  DynamicJsonDocument doc(3072);
  if (deserializeJson(doc, resp) || doc.isNull()) return;

  for (JsonPair kv : doc.as<JsonObject>()) {
    JsonObject c = kv.value().as<JsonObject>();
    if (c.isNull()) continue;
    bool feito = c["processado"] | false;       // sem o campo = ainda não processado
    if (feito) continue;

    String alvo   = String(kv.key().c_str());
    String acao   = String((const char*)(c["acao"] | ""));
    String origem = String((const char*)(c["origem"] | "?"));
    float  valor  = c["valor"] | 0.0;

    if (alvo == "estacao") {
      if (acao == "ponta") { horarioPonta = (valor > 0.5); Serial.printf("[comando] ponta = %d\n", horarioPonta); }
    } else if (alvo == "global") {
      if (acao == "parar") {
        Serial.printf("[comando] PARAR estacao inteira (%s)\n", origem.c_str());
        for (int i = 0; i < 4; i++) pararVaga(i, "comando_site");
      }
    } else if (alvo.startsWith("vaga")) {
      int i = alvo.substring(4).toInt() - 1;
      if (i >= 0 && i < 4) {
        if (acao == "parar") {
          Serial.printf("[comando] PARAR %s (%s)\n", alvo.c_str(), origem.c_str());
          pararVaga(i, "comando_site");
        } else if (acao == "iniciar") {
          Serial.println("[comando] 'iniciar' nao e aceito pelo site: a recarga so comeca pelo login no carregador");
        }
      }
    }
    String r;
    requisicao("PATCH", "/" + baseEstacao() + "/comandos/" + alvo + ".json", "{\"processado\":true}", r);
  }
}

void verificarDeficit(bool emDeficit) {
  if (emDeficit && !deficitAtivo) {
    StaticJsonDocument<384> doc;
    doc["tipo"]       = "demanda_acima_do_limite";
    doc["severidade"] = "aviso";
    doc["mensagem"]   = String("Demanda excede ") + pLimite +
                        " kW disponiveis. Potencia rateada entre as vagas.";
    doc["uptime_s"]   = millis() / 1000;
    String corpo, resp;
    serializeJson(doc, corpo);
    if (requisicao("POST", "/" + baseEstacao() + "/alertas.json", corpo, resp)) {
      contadorAlerta++;
      prefs.putUInt("alerta", contadorAlerta);
    }
    Serial.println("[alerta] rateio ativado");
  }
  deficitAtivo = emDeficit;
}

void enviarHistorico() {
  DynamicJsonDocument doc(384);
  JsonObject o = doc.to<JsonObject>();
  o["potencia_kw"] = round(pTotal * 10) / 10.0;
  o["solar_kw"]    = round(solarKW * 10) / 10.0;
  o["limite_kw"]   = round(pLimite * 10) / 10.0;
  o["uptime_s"]    = millis() / 1000;
  svTs(o, "ts");
  String corpo, resp;
  serializeJson(doc, corpo);
  requisicao("POST", "/" + baseEstacao() + "/historico.json", corpo, resp);
}

/* =====================================================================
   LOOP
   ===================================================================== */
void loop() {
  unsigned long agora = millis();

  // telemetria expirada (o "ts" do celular parou de mudar)
  bool viva = (agora - ultimaTelemetria < TELEMETRIA_TTL) && socRemoto >= 0;
  if (telemetriaViva && !viva && vaga0Remota && vaga[0].conectada) {
    Serial.println("[telemetria] celular offline: vaga 1 liberada");
    desconectar(0);
  }
  telemetriaViva = viva;

  lerSerial();

  if (agora - tCiclo >= 200) {
    float dt = (agora - tCiclo) / 1000.0;
    tCiclo = agora;

    lerBotoes();
    lerSensores();
    calcularAlocacao();
    acumularEnergia(dt);
    atualizarLeds();

    // bateria cheia: fecha a sessão uma única vez
    for (int i = 0; i < 4; i++)
      if (vaga[i].autorizada && vaga[i].concluida && vaga[i].sessaoId.length() > 0)
        finalizarSessao(i, "bateria_cheia", "concluida");
  }

  if (agora - tLcd >= 500)  { tLcd  = agora; atualizarLcd(); }

  if (agora - tRede >= 1000) {
    tRede = agora;
    alternaLeitura = !alternaLeitura;
    if (alternaLeitura) lerTelemetria();
    else                lerComandos();
  }

  if (agora - tPub  >= 2000)  publicarEstado();
  if (agora - tHist >= 30000) { tHist = agora; enviarHistorico(); }
}

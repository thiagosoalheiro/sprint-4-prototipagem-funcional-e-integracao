/* ============================================================
   Conexão com o Firebase (opcional)
   ------------------------------------------------------------
   Sem configuração, o site roda em "Simulação local": todo o
   comportamento (rateio, CC-CV, Solar-First, tarifa) é calculado
   no próprio navegador, para demonstração.

   Para ler a telemetria real do ESP32 (Wokwi) e enviar comandos:
   1) Cole abaixo o objeto firebaseConfig do seu projeto
      (Console do Firebase > Configurações do projeto > Seus apps).
   2) Ajuste CHARGEGRID_PATHS para os caminhos usados no seu
      Realtime Database.
   ============================================================ */
window.CHARGEGRID_FIREBASE = null;
/* Exemplo:
window.CHARGEGRID_FIREBASE = {
  apiKey: "...", authDomain: "...", databaseURL: "https://SEU-PROJETO-default-rtdb.firebaseio.com",
  projectId: "...", appId: "..."
};
*/

/* Formato esperado dos dados (ajuste os nomes se o seu for diferente):
   estacao: { geracao_kw, limite_kw, tarifa }
   vagas/vaga1..vaga4: { status: "livre|pendente|liberado|carregando|pausada|concluida",
                         soc, potencia_kw, energia_kwh, evccid }
   comandos/vagaN:     { acao: "iniciar|parar", ts }
   comandos/global:    { acao: "iniciar|parar", ts }                              */
window.CHARGEGRID_PATHS = { estacao: "estacao", vagas: "vagas", comandos: "comandos" };

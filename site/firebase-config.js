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
window.CHARGEGRID_FIREBASE = {
  apiKey: "AIzaSyCU1M_zmx5zqqrEc-L0JxujcyOSX0oq5KY",
  authDomain: "goodwedb.firebaseapp.com",
  databaseURL: "https://goodwedb-default-rtdb.firebaseio.com",
  projectId: "goodwedb",
  storageBucket: "goodwedb.firebasestorage.app",
  messagingSenderId: "738074450770",
  appId: "1:738074450770:web:aee718699dcaf7eb25788b",
  measurementId: "G-LLYMHLXZZX"
};

/* Estrutura do Realtime Database (ver LEIA-ME.md):
   estacoes/GW_COMMERCIAL_01/estado   -> geracao_solar_kw, limite_atual_kw, tarifa_kwh, horario_ponta, atualizado_em
   estacoes/GW_COMMERCIAL_01/vagas/vagaN -> status (livre|aguardando|carregando|parada|concluida), usuario, veiculo_id,
                                          soc, potencia_kw, demanda_kw, energia_kwh, solar_kwh, valor ...
   estacoes/GW_COMMERCIAL_01/comandos/vagaN | global -> { acao:"parar", origem:"site", ts, processado:false }
   O site LÊ estado e vagas e só ESCREVE em comandos. */
window.CHARGEGRID_PATHS = {
  estacao:  "estacoes/GW_COMMERCIAL_01/estado",
  vagas:    "estacoes/GW_COMMERCIAL_01/vagas",
  comandos: "estacoes/GW_COMMERCIAL_01/comandos"
};

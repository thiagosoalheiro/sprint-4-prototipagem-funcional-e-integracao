# ⚡ ChargeGrid Intelligence — Grupo 2
 
Gerenciamento inteligente de demanda para estações de recarga de veículos elétricos, integrando energia solar, armazenamento em bateria e automação em nuvem — desenvolvido com equipamentos **GoodWe**
 
> 🎥 <a href="https://youtu.be/ggT8hUnfNXI?si=upFxEk8xvHdklanF">**Clique aqui para ver o vídeo pitch!**</a> 

> 🏫 **Disciplina: Pensamento Computacional e Automação com Python e Soluções em Energias Renováveis e Sustentáveis** / **Sprint 4 — Solução Final Integrada e Inovadora GoodWe**
 
---
 
## 👥 Equipe
 
| Nome completo | RM |
|---|---|
| *Guilherme Figueira Velloso* | *568827* |
| *José Augusto Ribeiro Freire Manfrinato* | *571151* |
| *Lais da Silva Dias* | *569943* |
| *João Augusto Poloniato Telles* | *571443* |
| *Thiago Soalheiro Diamantino* | *569316* |
| *Kauan Damasceno de Lima* | *573727* |

---

## 📂 Estrutura do Repositório

| Pasta | Conteúdo |
|---|---|
| [`chargegrid/`](chargegrid/) | Firmware ESP32 (C++) e `diagram.json` do circuito simulado no Wokwi |
| [`site/`](site/) | Dashboard web GOODWE EVSE Manager B2B (`index.html`, `style.css`, `app.js`) integrado ao Firebase |

---

## 🧩 O Desafio / Problema

Este estudo dedica-se a investigar a possibilidade de transformar dispositivos originalmente criados para uso doméstico em aplicações comerciais, focando no gerenciamento inteligente de demanda de potência, na implementação de sistemas de cobrança automatizados e na criação de interfaces voltadas a estabelecimentos como academias, shoppings e centros comerciais. Para firmar essa análise, o trabalho explora os pilares do ChargeGrid, estabelecendo uma conexão direta com o hardware da linha HCA G2. 

O projeto parte de um cenário real: **o estacionamento de um shopping** que decide instalar carregadores para veículos elétricos.
 
- Cada carregador consome **1 veículo = 11 kWh**.
- Com apenas **4 veículos carregando ao mesmo tempo → 4 × 11 kWh = 44 kWh** de demanda simultânea.
- O quadro de energia do setor, porém, tem um **limite de disjuntor de 40 kW**.
**Resultado: "a conta não fecha."** A demanda (44 kW) ultrapassa a capacidade contratada (40 kW), gerando um **excedente de -4 kW** — ou seja, um problema físico e financeiro real: risco de desarme do disjuntor, sobrecarga da instalação e inviabilidade comercial de oferecer recarga para todas as vagas ao mesmo tempo.
 
Foi para resolver exatamente esse obstáculo que a **GoodWe desenvolveu uma solução junto com nós**: o **ChargeGrid Intelligence**.
 
---

## 1. Demonstração clara da conexão e atuação conjunta dos componentes

A solução integra, em um único ecossistema, três camadas que atuam em conjunto:
 
**Camada física (energia):**
- Painéis solares → **Inversor híbrido GoodWe** → **Sistema de armazenamento em bateria (GoodWe SEC1000S)** → Quadro de distribuição do estacionamento → **4 carregadores, linha HCA G2 da GoodWe**, um por vaga.
- O inversor mede em tempo real a geração solar e decide, automaticamente, se a energia entregue aos carregadores vem do sol, da bateria ou da rede elétrica (fonte complementar).

**Camada de identificação e cobrança (por vaga/veículo):**
- **Etapa 1 – Veículo:** o carro chega e se identifica pelo próprio cabo de recarga, padrão **CCS + EVCCID** (identificador único do veículo, ex.: `A4:F2:1B:8C:03:9E`), sem necessidade de leitura de placa ou câmeras.
- **Etapa 2 – Conta:** o EVCCID é associado a uma conta de usuário (ex.: `conta_0271`), de forma análoga a um login por e-mail.
- **Etapa 3 – Pagamento:** desacoplado da identificação do veículo — demonstrado via **Pix**, com **Sem Parar** e **cartão** já previstos na arquitetura.

**Camada de software e nuvem:**
- Todos os dados de geração, consumo por vaga, SOC (estado de carga) do veículo e tarifa são sincronizados pelo Firebase ao **GOODWE EVSE Manager B2B**, um dashboard web que centraliza o monitoramento e o controle remoto (comandos "Iniciar"/"Parar" por vaga e comandos globais da estação).
- Um aplicativo mobile (integrado ao SEM) permite ao motorista localizar carregadores próximos via Waze, identificar o equipamento pelo nome e acompanhar a recarga em tempo real.

A demonstração do vídeo mostra justamente essa cadeia funcionando de ponta a ponta: da geração solar no inversor, passando pela alocação de potência entre as 4 vagas, até a cobrança do motorista no aplicativo.
 
---
 
## 2. Dados funcionais, medições e comandos automatizados
 
### 2.1 Painel de gerenciamento de demanda em tempo real (cenário crítico)
 
| Indicador | Valor | Detalhe |
|---|---|---|
| Geração solar tempo real | **6,2 kW** | Inversor GoodWe · 4 strings |
| Potência total entregue | **36,8 kW** | Soma das 4 vagas ativas |
| Limite disponível | **40,0 kW** | Contrato pleno fora de ponta |
| Fonte predominante | **Rede** | Rede complementa a queda de geração |
 
**Potência por vaga (cenário de sobrecarga simulado):**
 
| Vaga | Potência |
|---|---|
| Vaga 01 | 11,0 kW |
| Vaga 02 | 11,0 kW |
| Vaga 03 | 7,4 kW |
| Vaga 04 | 7,4 kW |
 
Nesse cenário, a estação **entra em alerta** (indicadores em vermelho), pois a soma da demanda das vagas pressiona o limite de entrada — o mesmo problema físico descrito na introdução, agora sendo **medido e visualizado em tempo real** pelo sistema.
 
### 2.2 Rateio automático de potência (comando automatizado)
 
Quando a demanda solicitada ultrapassa o limite contratado, o sistema aciona o **rateio proporcional automático**:
 
| Vaga | Bateria (SOC) | Potência alocada | Observação |
|---|---|---|---|
| Vaga 01 | 34% | **11,0 kW** | 🔶 Prioridade |
| Vaga 02 | 61% | 11,0 kW | — |
| Vaga 03 | 94% | 3,7 kW | Quase cheia → recebe menos |
| Vaga 04 | 88% | 6,3 kW | Quase cheia → recebe menos |
 
- **Limite da estação:** 32,0 kW (com "Rateio Ativo")
- **Potência alocada:** 32,0 kW (demanda solicitada era 36,8 kW → rateio proporcional)
- **Fonte da energia:** Rede (geração solar insuficiente no momento)
- **Tarifa ao motorista:** R$ 2,20/kWh (preço indexado à origem da energia)

Esse é um **comando automatizado real**: o algoritmo prioriza veículos com menor SOC (Vaga 01) e reduz a potência entregue a veículos quase cheios (Vagas 03 e 04), sem intervenção manual, respeitando o limite físico do disjuntor.
 
### 2.3 Inteligência preditiva (GoodWezinho AI)
 
| Indicador | Valor |
|---|---|
| Geração solar tempo real | 0,0 kW *(estado inicial "fora de ponta")* |
| Demanda total da estação | 0,0 kW |
| Limite de entrada | 0,0 kW |
| Tarifação operacional | **Fora de Ponta** |
 
**Recomendações preditivas de carga:**
- Load Balancing: distribuição "Solar-First" ativa (prioriza sempre consumir energia solar antes da rede).
- Referência normativa: **Resolução Normativa ANEEL nº 1.000/2021** (que rege a tarifação de energia e o uso da rede por unidades geradoras/consumidoras).
- Módulo de **previsão de geração solar e demanda para os próximos 60 minutos**, usado para antecipar picos e ajustar o rateio antes que o problema físico aconteça.
- **Comandos automatizados disponíveis por vaga:** Iniciar / Parar recarga individualmente, além de **Comandos Globais da Estação** (parar/iniciar toda a estação de uma vez).
 
### 2.4 Simulação de hardware (protótipo)
 
Na bancada de simulação pelo aplicativo Woke ("ChargeGrid conectando..."), o protótipo demonstra o comportamento do sistema de bateria/carregador em funcionamento, com telas de celular mostrando o **percentual de carga evoluindo (69% → 70%)** durante a demonstração — validando que a lógica de controle responde a dados em tempo real, e não apenas a uma interface estática.
 
---
 
## 3. Justificativa dos equipamentos e lógica de integração

| Equipamento | Função na solução | Por que foi escolhido |
|---|---|---|
| **Inversor híbrido GoodWe** | Converte energia solar CC em CA e gerencia o fluxo entre painel, bateria, carregadores e rede | Permite operação simultânea com múltiplas *strings* solares e integração nativa com o ecossistema de monitoramento GoodWe |
| **Sistema de armazenamento GoodWe SEC1000S** | Armazena excedente de energia solar para uso em horários de pico ou baixa geração | Atua como "buffer" que reduz a dependência da rede exatamente nos momentos em que a demanda dos 4 carregadores é maior |
| **Carregadores da linha HCA G2 da GoodWe** | Entregam energia ao veículo e o identificam de forma única na conexão | Padrão aberto e amplamente adotado (CCS), com identificação do veículo (EVCCID) sem necessidade de câmeras, leitura de placa ou hardware adicional |
| **Camada criptográfica ISO 15118 + certificados PKI** | Garante que a identificação do veículo e a comunicação carregador–veículo sejam autenticadas | Segurança "by design": impede fraude na cobrança e protege dados do motorista sem expor informações sensíveis |
| **GOODWE EVSE Manager B2B (dashboard em nuvem - Firebase)** | Centraliza monitoramento, rateio de potência e comandos remotos | Permite ao operador do estacionamento (shopping) gerenciar a estação inteira em tempo real, de qualquer lugar |
| **GoodWezinho AI (módulo preditivo)** | Recomenda tarifação dinâmica e antecipa picos de demanda/geração | Transforma dados históricos e em tempo real em decisões automáticas, reduzindo a necessidade de operação manual |
| **Aplicativo do motorista (integrado ao SEM)** | Localização de carregadores, início de recarga e acompanhamento do consumo | Fecha o ciclo de experiência do usuário final, conectando a infraestrutura física à cobrança e ao pagamento |
 
**Lógica de integração:** cada componente publica e consome dados do mesmo barramento de informação (geração solar, SOC por vaga, limite do disjuntor, tarifa). Isso permite que uma mudança física (ex.: queda de geração solar) reflita automaticamente em uma decisão de software (ex.: acionar rateio, mudar fonte para "rede", recalcular tarifa) — sem que nenhum evento dependa de ação manual do operador.
 
---
 
## 4. Arquitetura da Solução e Fluxo de Carregamento

O fluxo de funcionamento descreve a jornada completa desde a chegada do veículo elétrico à vaga até o encerramento da sessão de carga, integrando a bancada física (simulada via ESP32), o backend em nuvem (Firebase) e a interface mobile do motorista.


<img width="1580" height="889" alt="Fluxo de carregamento goodwe" src="https://github.com/user-attachments/assets/08140eef-bae4-48f3-9da4-86a723c66cc7" />


### **Detalhamento do Fluxo:**

| Etapa | Ação / Componente | O que acontece no sistema |
| --- | --- | --- |
| **Conexão & Identificação** | Veículo&nbsp;➔&nbsp;ESP32 | O motorista conecta o cabo. O microcontrolador ESP32 lê o ID do veículo (EVCCID) e detecta a presença física na vaga. |
| **Registro de Recarga** | ESP32&nbsp;➔&nbsp;Firebase | O ESP32 envia os dados iniciais do ponto de carga e cria um novo documento de sessão no Firebase Realtime Database com status `pendente`. |
| **Notificação & Pagamento** | App&nbsp;Mobile&nbsp;➔&nbsp;Firebase | O aplicativo identifica a vaga conectada, exibe o valor/tarifa e solicita a confirmação do pagamento pelo motorista (ex.: Pix). |
| **Sinalização de Liberação** | Firebase&nbsp;➔&nbsp;ESP32 | Com o pagamento confirmado, o Firebase atualiza a flag da sessão para `liberado`. O ESP32, escutando a nuvem em tempo real, detecta a mudança e aciona os relés de carregamento. |
| **Telemetria em Tempo Real** | ESP32&nbsp;➔&nbsp;Nuvem&nbsp;➔&nbsp;App | Durante a recarga, o ESP32 transmite continuamente os parâmetros de SOC (%), potência (kW), corrente e consumo acumulado (kWh). Os dados sobem para o Firebase e são exibidos instantaneamente na tela do aplicativo e no Dashboard B2B. |
| **Encerramento Flexível** | App&nbsp;/&nbsp;ESP32&nbsp;➔&nbsp;Firebase | A recarga pode ser finalizada automaticamente ao atingir 100% (ou a meta estipulada) ou **interrompida manualmente a qualquer momento pelo aplicativo**, garantindo controle total ao usuário. |
 
---
### 4.1 Interfaces e Protótipos Funcionais

#### A. Painel Web de Gestão B2B (`GOODWE EVSE Manager B2B`)
O painel de controle executivo (Web Dashboard) sincroniza via **Firebase** os parâmetros de operação do estacionamento. Ele exibe os indicadores de geração solar real-time, demanda total da estação e o teto do disjuntor. Além disso, disponibiliza os seletores para acionamento ou interrupção do carregamento por vaga individual e comandos globais da estação.

> 💻 Código-fonte: [`site/`](site/) (`index.html`, `style.css`, `app.js`)

<img width="1437" height="849" alt="image" src="https://github.com/user-attachments/assets/f8a38790-6f95-410d-8c04-bf20e8f7e46e" />

#### B. Aplicativo Mobile do Motorista (Integrado ao SEMS e Firebase)

O aplicativo entrega a experiência completa do motorista de veículos elétricos, combinando facilidade de navegação com padrões modernos de segurança digital:

1. **Sistema de Autenticação e Verificação por E-mail:**
* O acesso é protegido via **Firebase Authentication**.
* O cadastro de novos motoristas **exige obrigatoriamente a confirmação por e-mail** (verificação de link) antes da liberação do primeiro acesso, prevenindo contas falsas e garantindo a rastreabilidade das transações financeiras.

2. **Containerização e Isolamento de Dados (*Security Rules*):**
* O banco de dados NoSQL (Firebase) é estruturado de forma estritamente "containerizada", vinculando cada registro de usuário ao seu identificador único (`auth.uid`).
* Através das **Regras de Segurança do Firebase** (*Security Rules*), cada motorista tem permissão de leitura e escrita **exclusivamente no seu próprio nó de dados** (`/users/{uid}` e `/recargas/{uid}`). Isso garante que histórico de recargas, dados de pagamento e veículos cadastrados fiquem completamente isolados e inacessíveis para terceiros, atendendo às diretrizes da LGPD.

3. **Jornada de Recarga no App:**
* **Localização & Status:** Mapa interativo das estações (ex: Shopping Vila Olímpia) com rotas integradas via Waze e indicação de ocupação das vagas.
* **Acompanhamento Real-Time:** Exibição contínua da potência instantânea (kW), progresso da bateria (%), tempo decorrido e botão de **Interrupção Manual** da sessão.
* **Checkout Desacoplado:** Telas de confirmação de pagamento automatizado via Pix antes da liberação do hardware pelo ESP32.

| Navegação e Mapa de Carregadores | Progresso do Carregamento em Tempo Real | Confirmação de Pagamento Automatizado |
| :---: | :---: | :---: |
| <img width="372" height="679" alt="image" src="https://github.com/user-attachments/assets/4f028cb6-3ec1-4697-b3da-80672d1c02c5" /> | <img width="359" height="719" alt="image" src="https://github.com/user-attachments/assets/6c7db1cb-7942-4d05-9f79-f03ad91e1ff7" /> | <img width="358" height="716" alt="image" src="https://github.com/user-attachments/assets/1c8a0a19-4565-48e3-b1e6-774689e0b4db" /> |

#### C. Simulação de Hardware de Bancada (ESP32 via Wokwi)
Para homologação das regras de *Load Balancing* e protocolo de comunicação, foi desenvolvido um circuito emulador no **Wokwi** controlado por um **ESP32**:
- **Potenciômetros:** Emulam a variação do estado de carga (SOC) e da demanda solicitada em cada uma das 4 vagas.
- **Push Buttons:** Simulam a conexão/desconexão física do cabo CCS no veículo.
- **Display LCD 16x2:** Exibe os dados instantâneos locais (`11.0/40.0kW - Vagas 1/4 SOLAR`), transmitindo a telemetria via OCPP e Firebase para o sistema em nuvem.

> 💻 Código-fonte: [`chargegrid/`](chargegrid/) (firmware ESP32 + `diagram.json` do Wokwi)

<img width="771" height="522" alt="image" src="https://github.com/user-attachments/assets/55349b7f-9b4c-4b5b-ae70-c50c95e4f244" />

### 4.2 Integração entre os Sistemas

Na solução final, cada sistema conversa com os demais por uma interface bem definida. O **Firebase** funciona como ponto central de sincronização, e é isso que permite que a bancada, o painel B2B e o aplicativo reajam ao mesmo dado ao mesmo tempo:

| Origem ➔ Destino | Interface / Protocolo | O que trafega |
| --- | --- | --- |
| Veículo ➔ Carregador (HCA G2 / ESP32 na bancada) | CCS + ISO 15118 (EVCCID) | Identificação do veículo, conexão física do cabo |
| ESP32 ➔ Firebase | Firebase Realtime Database | Sessão de recarga (`pendente` / `liberado`), SOC, potência, corrente, kWh acumulado |
| Firebase ➔ ESP32 | Escuta em tempo real | Liberação da sessão e comandos de Iniciar/Parar, que acionam os relés |
| Aplicativo do motorista ↔ Firebase | Firebase Authentication + Realtime Database | Login verificado por e-mail, confirmação de Pix, telemetria da recarga, interrupção manual |
| Dashboard B2B ↔ Firebase | Realtime Database (`site/app.js`) | Geração solar, demanda total, limite do disjuntor, estado de cada vaga e comandos globais da estação |
| Aplicativo ➔ Waze | Rota externa | Navegação do motorista até a estação |

Com isso, uma única ação (por exemplo, o motorista confirmar o Pix) atravessa a cadeia inteira: o aplicativo atualiza o Firebase, o ESP32 detecta a liberação, aciona o relé e passa a enviar a telemetria que o aplicativo e o dashboard exibem em tempo real.

---

## 5. Justificativa Técnica das Escolhas

A seleção das tecnologias adotadas no projeto **ChargeGrid Intelligence** atende a critérios rigorosos de escalabilidade, interoperabilidade, segurança da informação e viabilidade financeira:

1. **Padrão ISO 15118 (EVCCID / CCS) vs. Leitura de Placas (OCR / Câmeras):**
   * *Justificativa:* O padrão ISO 15118 estabelece o conceito *Plug & Charge*, no qual o veículo é identificado diretamente pelo hardware do cabo de recarga por meio de um endereço único de hardware (EVCCID) criptografado por certificados PKI. Isso elimina a necessidade de instalar câmeras OCR de alto custo em cada vaga, evita falhas por iluminação e garante conformidade estrita com a privacidade de dados (LGPD), sem gravar placas ou imagem dos motoristas.

2. **Protocolo OCPP (Open Charge Point Protocol) & Firebase:**
   * *Justificativa:* A utilização do protocolo aberto OCPP garante que a infraestrutura desenvolvida seja interoperável com qualquer modelo de Wallbox comercial da GoodWe. A sincronização em tempo real via Firebase NoSQL garante latência inferior a 200 ms na comunicação entre o microcontrolador ESP32 e o dashboard B2B.

3. **Arquitetura Solar-First com Curva CC-CV de Carregamento:**
   * *Justificativa:* A lógica algorítmica prioriza a energia fotovoltaica do inversor GoodWe para baratear a tarifa. Além disso, o software monitora a curva de carga das baterias dos veículos (fase de Corrente Constante - Tensão Constante / CC-CV). Ao detectar que um veículo atinge 95% do SOC, o sistema reduz gradativamente sua potência para evitar sobreaquecimento e degradação celular, realocando o excedente de potência disponível para os veículos com menor carga.

---

## 6. Resultados e Dados Funcionais Apresentados

O protótipo integrado do ChargeGrid Intelligence demonstrou capacidade total de resolução do problema físico de sobrecarga elétrica, além de apresentar viabilidade comercial atrativa para os estabelecimentos B2B.

### 6.1 Resultados de Desempenho Técnico
* **Mitigação do Excedente:** Em cenários de estresse máximo (4 veículos de 11 kW tentando consumir 44 kW em um painel de 40 kW), a automação de rateio reduziu a demanda ativa para **32,0 kW**, operando com **100% de margem de segurança** em relação ao disjuntor.
* **Priorização Inteligente:** Veículos com bateria crítica (SOC em 34%) mantiveram taxa máxima de recarga (11,0 kW), enquanto veículos em nível avançado (SOC > 88%) sofreram modulação automática para 3,7 kW - 6,3 kW.

### 6.2 Análise de Viabilidade Financeira (Business Case para Lojistas / Shoppings)
A validação do modelo financeiro para a instalação de uma estação de 4 vagas revelou um payback acelerado e alta atratividade de investimento:

| Parâmetro Financeiro | Valor Medido / Estimado |
|---|---|
| **Investimento Inicial (CAPEX)** | R$ 60.000,00 *(Hardware GoodWe, ESP32 e instalação)* |
| **Receita Líquida Mensal Estimada** | R$ 4.455,00 / mês *(Margem sob recarga e tarifa dinâmica)* |
| **Tempo de Retorno (Payback)** | **14 meses** |

### 6.3 Resultados Quantitativos de Eficiência e Sustentabilidade

Os números abaixo combinam **dados medidos no protótipo** (potência, rateio, limite do disjuntor) com **estimativas calculadas** a partir das premissas do modelo financeiro (90 kWh vendidos por dia · 50% da energia vinda do sol · margem média de R$ 1,65/kWh). As estimativas estão identificadas como tal e a memória de cálculo está logo abaixo da tabela.

| Indicador | Resultado | Tipo |
|---|---|---|
| Demanda sem gerenciamento | 44 kW (**110%** do limite de 40 kW) | Medido no protótipo |
| Demanda com rateio automático | 32 kW (**80%** do limite, com 8 kW de folga) | Medido no protótipo |
| Redução de pico de demanda | **−27,3%** (44 kW → 32 kW) | Calculado sobre dado medido |
| Taxa de recarga do veículo mais descarregado (SOC 34%) | 11,0 kW contra 8,0 kW numa divisão igualitária (**+37,5%**) | Calculado sobre dado medido |
| Energia entregue por ano | 32.850 kWh | Estimativa |
| Energia solar usada por ano (Solar-First, 50%) | 16.425 kWh | Estimativa |
| CO₂ evitado pelo uso de energia solar | ≈ **632 kg CO₂/ano** (≈ 475 kg com o fator de 2025) | Estimativa |
| CO₂ evitado em relação a abastecer os mesmos veículos com gasolina | ≈ **40 t CO₂/ano** | Estimativa |
| Receita líquida mensal | R$ 4.455 (90 kWh × 30 dias × R$ 1,65) | Calculado |
| Payback | 60.000 ÷ 4.455 ≈ 13,5 → **14 meses** | Calculado |

**Memória de cálculo**

- **Energia:** 90 kWh/dia × 365 dias = **32.850 kWh/ano**; 50% solar = **16.425 kWh/ano** vindos do sol e 16.425 kWh da rede.
- **CO₂ da rede:** o fator médio do Sistema Interligado Nacional (SIN) foi de **38,5 kg CO₂/MWh em 2023** (dado do MCTI) e de 28,9 kg CO₂/MWh em abril de 2025. Com 38,5 kg/MWh: 32.850 kWh na rede emitiriam ≈ 1.265 kg/ano; com Solar-First, apenas 16.425 kWh vêm da rede (≈ 632 kg/ano). A diferença, **≈ 632 kg CO₂/ano**, é o CO₂ evitado pelo uso do sol. Com o fator de abril de 2025 o valor cai para ≈ 475 kg/ano.
- **Comparação com gasolina** (premissas adotadas pelo grupo: consumo de 0,15 kWh/km, carro a gasolina de 12 km/L e 2,23 kg CO₂ por litro de gasolina): 90 kWh ÷ 0,15 = 600 km/dia; 600 ÷ 12 = 50 L/dia; 50 × 2,23 = 111,5 kg CO₂/dia ≈ **40,7 t/ano**. Os mesmos 600 km rodados por veículos abastecidos na estação com Solar-First geram ≈ 0,63 t/ano, ou seja, uma diferença de ≈ **40 t CO₂/ano**.
- **Divisão igualitária** de 32 kW entre 4 vagas = 8,0 kW por vaga; o rateio por SOC entrega 11,0 kW à Vaga 01: 11,0 ÷ 8,0 = 1,375 (**+37,5%**).

### 6.4 Resultados Qualitativos

- **Operação sem intervenção manual:** o rateio, a priorização por SOC, a liberação da sessão após o Pix e o encerramento por meta acontecem automaticamente, sem que o operador do shopping precise agir.
- **Todas as vagas atendidas ao mesmo tempo:** em vez de bloquear vagas ou desarmar o disjuntor, os quatro veículos recebem energia simultaneamente, cada um com a potência que realmente consegue aproveitar.
- **Transparência para o motorista:** o aplicativo mostra potência, progresso da bateria, tempo decorrido e tarifa, e permite interromper a recarga a qualquer momento.
- **Visão completa para o operador:** o dashboard B2B mostra geração solar, demanda total, limite do disjuntor e o estado de cada vaga em tempo real, com comandos por vaga e globais.
- **Privacidade comprovável:** a identificação por EVCCID dispensa câmeras e leitura de placa, e o isolamento por `auth.uid` impede que um motorista acesse dados de outro.

---

## 7. Conexão com os Conteúdos da Disciplina

O desenvolvimento das **Sprints 3 e 4** consolidou os conceitos teóricos e práticos abordados nas matérias da matriz curricular:

1. **Pensamento Computacional e Automação com Python:**
   * Implementação de estruturas lógicas condicionais e algoritmos de otimização para o cálculo proporcional de rateio de potência.
   * Criação do módulo preditivo (*GoodWezinho AI*) para análise estocástica de geração fotovoltaica com base na **Resolução Normativa ANEEL nº 1.000/2021**.

2. **Soluções em Energias Renováveis e Sustentáveis:**
   * Gerenciamento de matriz energética híbrida (Solar Photovoltaic + BESS Storage + Grid).
   * Aplicação de estratégias de *Peak Shaving* (supressão de picos de demanda) e *Load Balancing* para mitigar o impacto de infraestruturas pesadas de mobilidade elétrica na rede de distribuição urbana.

3. **Internet das Coisas (IoT) e Sistemas Embarcados:**
   * Programação de microcontroladores ESP32 utilizando bibliotecas de comunicação assíncrona, integração de sensores/atuadores e envio de telemetria via nuvem.

4. **Eficiência Energética e Análise de Impacto (Sprint 4):**
   * Uso de fatores de emissão oficiais (MCTI) para converter energia solar consumida em CO₂ evitado, aplicando o raciocínio de inventário de emissões visto na disciplina.
   * Análise de viabilidade técnica e econômica (CAPEX, receita líquida, payback) para sustentar a decisão de investimento de um estabelecimento comercial.
   * Raciocínio de eficiência aplicado à bateria do veículo: respeitar a curva CC-CV reduz perdas por aquecimento e preserva a vida útil do armazenamento.

---

## 8. Alinhamento ao Desafio GoodWe

O desafio proposto pela GoodWe é transformar equipamentos de uso residencial em uma solução comercial de recarga, com gerenciamento de potência, cobrança automática e interface para o estabelecimento. A tabela mostra, ponto a ponto, como cada parte do ChargeGrid responde a ele:

| Ponto-chave do desafio | Como o ChargeGrid resolve | Onde ver |
|---|---|---|
| **Levar dispositivos domésticos para o uso comercial** | Os carregadores HCA G2, o inversor híbrido e a bateria SEC1000S são os mesmos equipamentos da linha GoodWe. A adaptação para uso comercial vem da camada de software (EVSE Manager B2B, rateio, cobrança), sem exigir hardware proprietário novo. | Seções 3 e 4.1 |
| **Gerenciar a demanda de potência** (44 kW pedidos contra 40 kW de disjuntor) | O rateio proporcional por SOC reduz a demanda para 32 kW (80% do limite) e atende as 4 vagas ao mesmo tempo. A previsão de 60 minutos do GoodWezinho AI antecipa picos antes que o disjuntor seja pressionado. | Seções 2.2, 2.3 e 6.1 |
| **Automatizar a cobrança** | O fluxo Veículo ➔ Conta ➔ Pagamento é desacoplado: o EVCCID identifica o carro, a conta registra o motorista e o Pix libera a sessão (`pendente` ➔ `liberado`). O hardware só energiza o relé depois da confirmação. | Seções 1, 4 e 4.1.B |
| **Criar interfaces para o estabelecimento e para o motorista** | O dashboard B2B dá ao shopping monitoramento e comandos (por vaga e globais). O aplicativo dá ao motorista mapa, rota via Waze, acompanhamento em tempo real e interrupção manual. | Seções 4.1.A e 4.1.B |
| **Usar energia renovável e armazenamento** | A lógica Solar-First consome primeiro o que o inversor gera, a bateria SEC1000S guarda excedente para horários de pico e a rede entra só como complemento. | Seções 1, 3 e 5 |
| **Garantir segurança e privacidade** | ISO 15118 com certificados PKI, ausência de câmeras e leitura de placa, Firebase Authentication com e-mail verificado e Security Rules que isolam os dados de cada motorista. | Seções 4.1.B e 5 |
| **Provar viabilidade comercial** | Investimento de R$ 60.000, receita líquida de R$ 4.455/mês e payback de 14 meses, sem obras de ampliação da rede elétrica. | Seções 6.2 e 6.3 |

**Alinhamento à disciplina:** o projeto exercita, em uma única solução, os três eixos da disciplina: automação com Python e lógica de otimização (rateio e previsão), energias renováveis e sustentáveis (solar, armazenamento, Peak Shaving e Load Balancing) e IoT com sistemas embarcados (ESP32 e telemetria em nuvem). O detalhamento está na seção 7.

---

## 9. Avaliação Crítica de Sustentabilidade e Inovação

### 9.1 Como uma recarga mais eficiente desgasta menos o meio ambiente

A ideia central de sustentabilidade do ChargeGrid é simples: **recarregar de forma mais eficiente significa usar menos energia, menos equipamento e menos infraestrutura para entregar o mesmo serviço**. Isso acontece em cinco frentes:

1. **Recarga que respeita a bateria do veículo.** Ao chegar perto de 95% de SOC, o sistema reduz gradualmente a potência (curva CC-CV). Com menos calor e menos estresse nas células, a bateria degrada mais devagar e dura mais. Uma bateria que dura mais é uma bateria que não precisa ser fabricada e descartada antes da hora, o que reduz extração de minerais, consumo de energia de fabricação e resíduo eletrônico.
2. **Potência entregue a quem precisa dela.** O rateio por SOC dá 11,0 kW ao carro com 34% de bateria e apenas 3,7 kW ao carro com 94%, que já não consegue absorver muita potência. A capacidade limitada da instalação (32 a 40 kW) é usada onde rende mais, em vez de ficar parada em um veículo quase cheio. O resultado é menos tempo de ocupação por vaga e menos desperdício de capacidade elétrica contratada.
3. **Solar-First e bateria de apoio.** Consumir primeiro a energia gerada no local reduz a energia puxada da rede, principalmente nos picos, e usa uma fonte limpa de forma direta. O armazenamento SEC1000S guarda o excedente em vez de perdê-lo.
4. **Nenhuma obra de ampliação da rede.** Como o software gerencia a demanda dentro do limite existente, o shopping não precisa trocar disjuntor, quadro ou cabeamento para instalar 4 carregadores. Isso evita materiais (cobre, aço, concreto) e a intervenção civil que uma ampliação exigiria.
5. **Menos hardware e menos deslocamento.** A identificação por EVCCID dispensa câmeras e leitores de placa em cada vaga, e a telemetria remota permite diagnosticar e operar a estação sem visitas técnicas para tarefas rotineiras.

### 9.2 Impactos objetivos

| Dimensão | Impacto | Base |
|---|---|---|
| **Viabilidade técnica** | Quatro veículos de 11 kW operam em um quadro de 40 kW, com a demanda mantida em 32 kW | Medido no protótipo (6.1) |
| **Ganho de eficiência** | −27,3% de pico de demanda e +37,5% de potência para o veículo mais descarregado, em comparação com uma divisão igualitária | Calculado sobre dados medidos (6.3) |
| **Pegada de carbono (energia)** | ≈ 632 kg CO₂/ano evitados pelo uso de energia solar em 16.425 kWh | Estimativa com fator MCTI 2023 (6.3) |
| **Pegada de carbono (mobilidade)** | ≈ 40 t CO₂/ano a menos do que abastecer os mesmos 600 km/dia com gasolina | Estimativa (6.3) |
| **Viabilidade econômica** | Payback de 14 meses e receita líquida de R$ 4.455/mês | Calculado (6.2) |
| **Relevância social** | Dá a shoppings, academias e centros comerciais um caminho barato para oferecer recarga, ampliando o acesso a eletromobilidade; a privacidade por arquitetura protege os dados dos motoristas (LGPD) | Seções 4.1.B e 5 |

### 9.3 Limitações e leitura crítica dos números

- **Parte dos resultados vem de simulação.** O rateio, o SOC e a telemetria foram validados no protótipo com ESP32 no Wokwi e no dashboard, e não em uma estação com quatro veículos reais em operação contínua. Os números de energia, CO₂ e receita são estimativas baseadas em premissas (90 kWh/dia, 50% solar).
- **O ganho de CO₂ da energia solar é modesto.** A rede brasileira já é muito limpa (38,5 kg CO₂/MWh em 2023, segundo o MCTI), então trocar rede por sol evita pouco CO₂ (≈ 0,6 t/ano). O ganho ambiental grande vem de a estação viabilizar a mobilidade elétrica no lugar da gasolina, e esse benefício é compartilhado com o próprio veículo elétrico, não só com o ChargeGrid.
- **O benefício de longevidade da bateria é qualitativo.** Reduzir potência em SOC alto é uma prática reconhecida de proteção de baterias, mas o projeto não mediu degradação real ao longo do tempo.
- **O payback depende das premissas.** Se o volume diário vendido for menor que 90 kWh ou a margem cair abaixo de R$ 1,65/kWh, o retorno passa de 14 meses.
- **Próximos passos naturais:** validar a estação com veículos reais, medir degradação e autoconsumo solar ao longo de semanas e ajustar o modelo de tarifação com dados de uso.

### 9.4 Inovação

A inovação do projeto está em combinar, em uma só solução, hardware GoodWe existente, algoritmos de gestão de potência e uma jornada completa de cobrança, resolvendo o gargalo físico (44 kW contra 40 kW) com software e não com obra. Os diferenciais estão detalhados na seção 10.

---

## 10. Diferenciais Inovadores

| Diferencial | O que o sistema faz |
|---|---|
| **Algoritmos inteligentes** | Rateio proporcional por SOC; redução gradual de potência em SOC alto (CC-CV); distribuição Solar-First; previsão de geração e demanda para os próximos 60 minutos (GoodWezinho AI). |
| **Automações avançadas** | Liberação automática do hardware após o pagamento (`liberado`), encerramento ao atingir a meta de carga, comandos globais da estação e relés acionados pelo ESP32 em resposta à nuvem. |
| **Interface amigável** | Aplicativo com mapa de estações, rota via Waze, tela de progresso em tempo real, tarifa visível, pagamento via Pix e botão de interrupção manual; dashboard B2B com controles por vaga. |
| **Visualização de dados** | Dashboard com geração solar, demanda total, limite do disjuntor e estado de cada vaga; barras de potência por vaga; gráfico de previsão de geração e demanda; telemetria de SOC, kW, corrente e kWh no aplicativo. |
| **Assistente virtual** | O GoodWezinho AI está integrado ao EVSE Manager B2B e entrega recomendações de carga ao operador, como a distribuição Solar-First e o ajuste de rateio. |
| **Privacidade e segurança por arquitetura** | Identificação por EVCCID e certificados PKI, sem câmeras nem leitura de placa; Firebase Authentication com e-mail verificado; Security Rules que isolam o dado de cada motorista. |

---

## 11. Referências e Conexões com Frameworks, Ferramentas, Linguagens e Sensores

### 11.1 Linguagens

| Linguagem | Uso no projeto |
|---|---|
| **C++ (Arduino/ESP32)** | Firmware do ESP32: leitura de sensores, lógica de rateio, comunicação com o Firebase e acionamento dos relés (`chargegrid/`) |
| **HTML, CSS e JavaScript** | Dashboard web GOODWE EVSE Manager B2B (`site/index.html`, `style.css`, `app.js`) |
| **Python** | Lógica de otimização do rateio e módulo preditivo GoodWezinho AI, conforme a disciplina de Pensamento Computacional e Automação |

### 11.2 Frameworks, plataformas e ferramentas

| Ferramenta | Função |
|---|---|
| **Firebase Realtime Database** | Sincronização em tempo real entre ESP32, aplicativo e dashboard |
| **Firebase Authentication** | Login de motoristas com verificação obrigatória por e-mail |
| **Firebase Security Rules** | Isolamento dos dados por `auth.uid` (`/users/{uid}` e `/recargas/{uid}`) |
| **Wokwi** | Simulação do circuito com ESP32 (`diagram.json`) |
| **Waze** | Rota do motorista até a estação |
| **Pix** | Meio de pagamento demonstrado no checkout |
| **GitHub** | Versionamento do código-fonte, diagramas e documentação |

### 11.3 Hardware e equipamentos GoodWe

| Equipamento | Papel |
|---|---|
| Inversor híbrido GoodWe | Gerencia o fluxo entre painéis, bateria, carregadores e rede, e mede a geração solar |
| Bateria GoodWe SEC1000S | Armazena o excedente solar para horários de pico ou baixa geração |
| Carregadores GoodWe linha HCA G2 | Entregam energia e identificam o veículo via CCS |
| Aplicação SEMS | Monitoramento do ecossistema GoodWe integrado ao aplicativo |

### 11.4 Sensores e atuadores (protótipo de bancada)

| Componente | O que emula ou controla |
|---|---|
| Potenciômetros | Variação do SOC e da demanda solicitada em cada uma das 4 vagas |
| Push buttons | Conexão e desconexão física do cabo CCS |
| Display LCD 16x2 | Dados locais da estação (`11.0/40.0kW - Vagas 1/4 SOLAR`) |
| Relés | Liberação da energia ao veículo após o pagamento |

Em uma instalação real, a medição de potência por vaga e a geração solar vêm do inversor e dos carregadores GoodWe; no protótipo, esses sinais são emulados pelos componentes acima.

### 11.5 Padrões, protocolos e normas

- **ISO 15118** (*Plug & Charge*), **CCS** e **EVCCID**, para identificação e comunicação segura entre veículo e carregador.
- **OCPP** (Open Charge Point Protocol), para interoperabilidade com carregadores comerciais.
- **Resolução Normativa ANEEL nº 1.000/2021**, referência para a lógica de tarifação e uso da rede.
- **LGPD**, que orienta a privacidade por arquitetura.

### 11.6 Fontes dos dados de sustentabilidade

- Fator de emissão do SIN em 2023 (38,5 kg CO₂/MWh), divulgado pelo MCTI: [O Setor Elétrico](https://www.osetoreletrico.com.br/?p=159478)
- Fator de emissão do SIN em abril de 2025 (28,9 kg CO₂/MWh), publicado no SIRENE/MCTI: [Cenário Energia](https://cenarioenergia.com.br/2025/06/13/brasil-reduz-intensidade-de-carbono-na-geracao-eletrica-com-inclusao-de-novas-renovaveis-na-base-de-calculo-oficial/)
- Fator de emissão da gasolina (2,23 kg CO₂/L): [AutoData, junho de 2026](https://www.autodata.com.br/revistas/flipbook/433-2026-06/36/)

---

## 12. Critérios de Avaliação Atendidos

| Critério | Onde é atendido neste README |
|---|---|
| **Solução inovadora, funcional e integrada** | Seções 1, 2 e 4 (integração e funcionamento), 4.2 (interfaces entre os sistemas), 6 (resultados medidos e estimados) e 10 (diferenciais inovadores) |
| **Justificativa alinhada à disciplina e à GoodWe** | Seções 3 e 5 (escolha dos equipamentos e das tecnologias), 7 (conteúdos da disciplina), 8 (alinhamento ao desafio GoodWe) e 9 (avaliação crítica de sustentabilidade e inovação) |
| **Organização, documentação técnica e repositório** | Estrutura do repositório (`chargegrid/` e `site/`), diagramas e imagens reais do sistema na seção 4, referências e tecnologias na seção 11 |

---

## 📝 Considerações Finais

O projeto **ChargeGrid Intelligence** comprova que a transformação de equipamentos de linha residencial/comercial GoodWe em uma rede B2B inteligente de recarga é plenamente viável, segura e altamente rentável.

Através do alinhamento entre a camada física de potência (Inversores Híbridos, Baterias SEC1000S e Wallboxes HCA G2), a eletrônica embarcada (ESP32 via ISO 15118) e a nuvem B2B (Firebase/EVSE Manager), eliminou-se o gargalo físico de sobrecarga sem a necessidade de obras dispendiosas de ampliação da rede elétrica. A solução promove a sustentabilidade energética, maximiza a utilização de fontes renováveis e oferece uma jornada fluida e segura para o usuário final e para o operador comercial.

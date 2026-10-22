/* ChargeGrid Intelligence · EVSE Manager B2B
   Lógica do painel: simulação local (rateio por SoC, Solar-First, CC-CV, tarifa) e,
   opcionalmente, leitura/comandos pelo Firebase (ver firebase-config.js).
   Todos os valores são simulados ou estimados. */
(function () {
"use strict";

/* ===================== premissas (editáveis) ===================== */
const CFG = {
  breaker: 40,          // kW, disjuntor do setor
  limit: 32,            // kW, limite da estação
  peakGrid: 8,          // kW, rede disponível no horário de ponta
  maxSlot: 11,          // kW por vaga (HCA G2)
  solarPeak: 24,        // kW, pico do inversor ao meio-dia
  price: 1.65,          // R$/kWh, base do modelo financeiro
  offDiscount: 0.10,    // desconto fora de ponta
  solarDiscount: 0.10,  // desconto adicional proporcional ao uso de sol (tarifa indexada à origem)
  peakStart: 18, peakEnd: 21,
  gridCO2: 38.5,        // g CO2/kWh (rede brasileira, 2023)
  kwhKm: 0.15, kmL: 12, gasCO2: 2.23,
  goalDay: 148.5,       // R$/dia do modelo (90 kWh x R$ 1,65)
  batKW: 5              // kW máx. de carga da bateria SEC1000S com o excedente
};
const PITCH_SOC = [34, 70, 90, 94];

/* ===================== utilitários ===================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sum = a => a.reduce((x, y) => x + y, 0);
const n1 = x => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1);
const n2 = x => x.toFixed(2);
const brl = x => "R$ " + x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hh = h => { h = ((h % 24) + 24) % 24; const m = Math.round((h - Math.floor(h)) * 60); const H = m === 60 ? Math.floor(h) + 1 : Math.floor(h); return String(H % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const norm = s => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const evccid = () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase()).join(":");

/* ===================== estado ===================== */
const S = {
  h: 11, speed: 300, relAuto: false, paused: false, rateio: true, live: false,
  slots: [1, 2, 3, 4].map(n => blank(n)),
  tot: { energy: 0, solar: 0, grid: 0, rev: 0 },
  last: { sol: 0, lim: CFG.limit, req: 0, al: 0, grid: 0 },
  log: []
};
function blank(n) { return { n, status: "livre", soc: 0, power: 0, req: 0, energy: 0, solarE: 0, valor: 0, evccid: "" }; }

/* ===================== modelo ===================== */
const solarAt = h => { const x = (h - 6) / 12; return x <= 0 || x >= 1 ? 0 : CFG.solarPeak * Math.pow(Math.sin(Math.PI * x), 1.3); };
const isPeak = h => h >= CFG.peakStart && h < CFG.peakEnd;
function limitAt(h) { const sol = solarAt(h), grid = isPeak(h) ? CFG.peakGrid : CFG.limit; return { sol, grid, limit: Math.min(CFG.limit, sol + grid) }; }
const priceAt = (h, solShare) => CFG.price * (isPeak(h) ? 1 : 1 - CFG.offDiscount) * (1 - CFG.solarDiscount * solShare);
const reqPower = soc => CFG.maxSlot * (soc < 95 ? 1 : Math.max(0.12, (100 - soc) / 5));

/* Rateio proporcional a (100 − SoC), com teto no pedido de cada vaga. Sem rateio: divisão igual. */
function allocate(reqs, socs, limit, prop) {
  const out = reqs.map(() => 0);
  let act = reqs.map((r, i) => (r > 0 ? i : -1)).filter(i => i >= 0), rem = limit;
  if (sum(act.map(i => reqs[i])) <= limit) { act.forEach(i => (out[i] = reqs[i])); return out; }
  const w = i => (prop ? Math.max(100 - socs[i], 1) : 1);
  while (act.length && rem > 1e-9) {
    const ws = sum(act.map(w));
    const capped = act.filter(i => (rem * w(i)) / ws >= reqs[i] - 1e-9);
    if (!capped.length) { act.forEach(i => (out[i] = (rem * w(i)) / ws)); break; }
    capped.forEach(i => { out[i] = reqs[i]; rem -= reqs[i]; });
    act = act.filter(i => !capped.includes(i));
  }
  return out;
}

/* ===================== log e ações ===================== */
function log(msg, cls = "") { S.log.unshift({ h: S.h, msg, cls }); if (S.log.length > 60) S.log.pop(); renderLog(); }
function renderLog() { $("#log").innerHTML = S.log.map(l => `<li class="${l.cls}"><time>${hh(l.h)}</time><span>${l.msg}</span></li>`).join(""); }

function send(acao, n) { // comandos pelo Firebase (modo ao vivo)
  if (!S.live || !S.db) return;
  const P = window.CHARGEGRID_PATHS, path = n ? `${P.comandos}/vaga${n}` : `${P.comandos}/global`;
  S.db.ref(path).set({ acao, ts: Date.now() }).catch(e => log("Falha ao enviar comando: " + e.message, "bad"));
}
function plug(i, soc) {
  const s = S.slots[i]; if (s.status !== "livre") return;
  Object.assign(s, blank(s.n), { status: "pendente", soc: soc != null ? soc : Math.round(15 + Math.random() * 45), evccid: evccid() });
  log(`Vaga ${s.n}: cabo conectado. EVCCID ${s.evccid} lido pelo próprio cabo, sem câmera nem placa. Aguardando Pix.`, "warn");
}
function unplug(i) { const s = S.slots[i]; if (s.status === "livre") return; log(`Vaga ${s.n}: cabo removido, vaga livre.`); S.slots[i] = blank(s.n); }
function pay(i) {
  const s = S.slots[i]; if (s.status !== "pendente") return;
  s.status = "liberado"; log(`Vaga ${s.n}: Pix aprovado (simulado). Carregador liberado.`, "good");
  setTimeout(() => { if (s.status === "liberado") { s.status = "carregando"; log(`Vaga ${s.n}: recarga iniciada.`, "good"); } }, 900);
}
function cmdSlot(i, acao) {
  const s = S.slots[i];
  if (acao === "parar" && s.status === "carregando") { s.status = "pausada"; s.power = 0; log(`Vaga ${s.n}: comando Parar entregue pela conexão de saída do carregador (OCPP).`, "bad"); send("parar", s.n); }
  if (acao === "iniciar" && (s.status === "pausada" || s.status === "liberado")) { s.status = "carregando"; log(`Vaga ${s.n}: comando Iniciar entregue.`, "good"); send("iniciar", s.n); }
}
function cmdAll(acao) { S.slots.forEach((s, i) => cmdSlot(i, acao)); send(acao, 0); log(acao === "parar" ? "Estação inteira parada." : "Estação inteira iniciada.", acao === "parar" ? "bad" : "good"); }
function clearAll() { S.slots = [1, 2, 3, 4].map(blank); log("Estação limpa."); }
function critical() {
  clearAll(); setHour(12);
  S.slots.forEach((s, i) => { plug(i, PITCH_SOC[i]); s.status = "liberado"; setTimeout(() => { if (s.status === "liberado") s.status = "carregando"; }, 700 + i * 150); });
  log("Cenário crítico: quatro carros pedindo 44 kW em um circuito de 40 kW.", "warn");
}
function setHour(h) { S.h = h; $("#hora").value = h; $("#hVal").textContent = hh(h); }

/* ===================== passo da simulação ===================== */
function step(dt) {
  const L = limitAt(S.h), dtH = dt * S.speed / 3600;
  const reqs = S.slots.map(s => (s.status === "carregando" ? reqPower(s.soc) : 0));
  const al = allocate(reqs, S.slots.map(s => s.soc), L.limit, S.rateio);
  const tot = sum(al), solShare = tot > 0 ? Math.min(1, L.sol / tot) : 0, pr = priceAt(S.h, solShare);
  S.last = { sol: L.sol, lim: L.limit, req: sum(reqs), al: tot, grid: Math.max(0, tot - L.sol), peak: isPeak(S.h), solShare, price: pr };
  S.slots.forEach((s, i) => {
    s.req = reqs[i]; s.power = s.status === "carregando" ? al[i] : 0;
    if (s.status !== "carregando") return;
    const dE = al[i] * dtH;
    s.energy += dE; s.solarE += dE * solShare; s.valor += dE * pr;
    S.tot.energy += dE; S.tot.solar += dE * solShare; S.tot.grid += dE * (1 - solShare); S.tot.rev += dE * pr;
    s.soc += dE / 60 * 100; // bateria de referência de 60 kWh
    if (s.soc >= 100) { s.soc = 100; s.power = 0; s.req = 0; s.status = "concluida"; log(`Vaga ${s.n}: bateria em 100%. Sessão de ${n2(s.energy)} kWh, ${brl(s.valor)}.`, "good"); }
  });
  if (S.relAuto) { S.h += dtH; if (S.h >= 21) S.h = 5; $("#hora").value = S.h; $("#hVal").textContent = hh(S.h); }
}
function forecast() {
  const sl = S.slots.map(s => ({ on: s.status === "carregando", soc: s.soc })), pts = []; let h = S.h;
  for (let k = 0; k <= 30; k++) {
    const L = limitAt(h), rq = sl.map(s => (s.on ? reqPower(s.soc) : 0)), al = allocate(rq, sl.map(s => s.soc), L.limit, S.rateio);
    pts.push({ h, sol: L.sol, req: sum(rq), al: sum(al), lim: L.limit });
    sl.forEach((s, i) => { if (!s.on) return; s.soc += al[i] * (2 / 60) / 60 * 100; if (s.soc >= 100) { s.soc = 100; s.on = false; } });
    h += 2 / 60;
  }
  return pts;
}

/* ===================== renderização ===================== */
const STAT = { livre: ["LIVRE", "b-livre"], pendente: ["PENDENTE · PIX", "b-pendente"], liberado: ["LIBERADO", "b-carregando"], carregando: ["CARREGANDO", "b-carregando"], pausada: ["PAUSADA", "b-pausada"], concluida: ["CONCLUÍDA", "b-concluida"] };
function buildVagas() {
  $("#vagas").innerHTML = S.slots.map((s, i) => `
  <article class="vaga" id="v${i}">
    <header><h3>Vaga ${String(s.n).padStart(2, "0")}</h3><span class="badge" data-r="badge"></span></header>
    <div class="veic" data-r="veic"></div>
    <div class="soc"><div class="row"><span>Bateria (SoC)</span><span data-r="soc">0%</span></div><div class="bar"><i data-r="bar" style="width:0%"></i><span class="mark95" title="95%: a partir daqui a carga cai (CC-CV)"></span></div></div>
    <div class="metrics">
      <div><small>Potência</small><b data-r="pow">0.0 kW</b><em data-r="powsub">&nbsp;</em></div>
      <div><small>Energia</small><b data-r="en">0.00 kWh</b><em data-r="srcsub">&nbsp;</em></div>
      <div><small>Valor</small><b data-r="val">R$ 0,00</b><em data-r="prsub">&nbsp;</em></div>
    </div>
    <div class="tags" data-r="tags"></div>
    <div class="actions"><button class="btn stop" data-a="parar">Parar</button><button class="btn go" data-a="iniciar">Iniciar</button></div>
  </article>`).join("");
  $$("#vagas .vaga").forEach((el, i) => $$(".btn", el).forEach(b => (b.onclick = () => cmdSlot(i, b.dataset.a))));
  $("#simRows").innerHTML = S.slots.map((s, i) => `
  <div class="simrow" data-i="${i}"><b>Vaga ${s.n}</b>
    <button class="btn ghost" data-a="cabo">Conectar cabo</button>
    <input type="range" min="0" max="100" value="50" aria-label="SoC da vaga ${s.n} (potenciômetro)"><span class="val">0%</span>
    <button class="btn go pix" data-a="pix">Pagar Pix</button></div>`).join("");
  $$("#simRows .simrow").forEach(r => {
    const i = +r.dataset.i;
    $("[data-a=cabo]", r).onclick = () => (S.slots[i].status === "livre" ? plug(i) : unplug(i));
    $("[data-a=pix]", r).onclick = () => pay(i);
    $("input", r).oninput = e => { const s = S.slots[i]; if (s.status === "livre") return; s.soc = +e.target.value; if (s.status === "concluida" && s.soc < 100) s.status = "pausada"; };
  });
}
const R = (i, k) => $(`#v${i} [data-r=${k}]`);
function renderVagas() {
  const L = S.last;
  S.slots.forEach((s, i) => {
    const el = $("#v" + i), st = STAT[s.status];
    const cv = s.status === "carregando" && s.soc >= 95, lim = s.status === "carregando" && s.power < s.req - 0.05 && !cv;
    el.className = "vaga" + (s.status === "carregando" ? " charging" : "") + (lim ? " limited" : "");
    const b = R(i, "badge"); b.textContent = st[0]; b.className = "badge " + st[1];
    R(i, "veic").innerHTML = s.status === "livre" ? "Veículo: —" : `EVCCID <b>${s.evccid}</b>`;
    R(i, "soc").textContent = Math.floor(s.soc) + "%"; R(i, "bar").style.width = s.soc + "%";
    R(i, "pow").textContent = n1(s.power) + " kW";
    R(i, "powsub").textContent = s.status === "carregando" ? "pedido " + n1(s.req) + " kW" : " ";
    R(i, "en").textContent = n2(s.energy) + " kWh";
    R(i, "srcsub").textContent = s.energy > 0 ? Math.round(s.solarE / s.energy * 100) + "% solar" : " ";
    R(i, "val").textContent = brl(s.valor);
    R(i, "prsub").textContent = s.energy > 0 ? "R$ " + (s.valor / s.energy).toFixed(2).replace(".", ",") + "/kWh" : " ";
    const tags = [];
    if (s.status === "carregando" && L.solShare > 0.5) tags.push('<span class="tag pri">SOLAR-FIRST</span>');
    if (lim) tags.push('<span class="tag rat">RATEIO</span>');
    if (cv) tags.push('<span class="tag cv">CC-CV</span>');
    R(i, "tags").innerHTML = tags.join("");
    const [bp, bi] = $$(".actions .btn", el);
    bp.disabled = s.status !== "carregando"; bi.disabled = !(s.status === "pausada" || s.status === "liberado");
    // simulador
    const row = $(`#simRows .simrow[data-i="${i}"]`), free = s.status === "livre";
    $("[data-a=cabo]", row).textContent = free ? "Conectar cabo" : "Remover cabo";
    const inp = $("input", row); inp.disabled = free; if (document.activeElement !== inp) inp.value = s.soc;
    $(".val", row).textContent = Math.floor(s.soc) + "%";
    $("[data-a=pix]", row).disabled = s.status !== "pendente";
  });
}
function renderTop() {
  const L = S.last, h = S.h;
  $("#clock").textContent = hh(h);
  $("#kSolar").textContent = n1(L.sol) + " kW"; $("#kSolarSub").textContent = L.sol > 0.05 ? "Inversor GoodWe" : "Sem geração (noite)";
  $("#kDem").textContent = n1(L.al) + " kW"; $("#kDemSub").textContent = "solicitado " + n1(L.req) + " kW";
  const constrained = L.req > L.lim + 0.05;
  $("#kLim").textContent = n1(L.lim) + " kW"; $("#kLimSub").textContent = isPeak(h) ? `Ponta: ${n1(L.sol)} kW sol + ${CFG.peakGrid} kW rede` : "Disjuntor " + CFG.breaker + " kW";
  $("#kLim").closest(".kpi").classList.toggle("warn", constrained);
  const t = $("#kTar"); t.textContent = isPeak(h) ? "Ponta" : "Fora de Ponta"; t.className = isPeak(h) ? "amber" : "green";
  const p = priceAt(h, L.solShare || 0); $("#kTarSub").textContent = "R$ " + p.toFixed(2).replace(".", ",") + "/kWh";
  // fluxo
  const MAX = 48, pc = v => Math.min(100, v / MAX * 100), used = Math.min(L.sol, L.al);
  $("#fSolar").style.width = pc(used) + "%"; $("#fRede").style.width = pc(L.grid) + "%";
  $("#fLim").style.left = pc(L.lim) + "%"; $("#fLim").firstElementChild.textContent = "limite " + n1(L.lim) + " kW";
  $("#fBrk").style.left = pc(CFG.breaker) + "%";
  $("#lSolar").textContent = n1(used) + " kW"; $("#lRede").textContent = n1(L.grid) + " kW";
  const surplus = Math.min(CFG.batKW, Math.max(0, L.sol - L.al)); $("#lBat").textContent = n1(surplus) + " kW";
  $("#flowHint").textContent = L.al > 0 ? (L.sol >= L.al ? "Solar-First: o sol cobre toda a recarga e o excedente carrega a bateria SEC1000S." : "Solar-First: o sol entra primeiro e a rede completa a diferença.") : "Solar-First: a estação consome primeiro a energia do sol e só depois a rede.";
  // alerta
  const a = $("#alert");
  if (L.req <= 0) a.className = "alert hidden";
  else if (constrained && S.rateio) { a.className = "alert info"; a.textContent = `Pedido de ${n1(L.req)} kW acima do limite de ${n1(L.lim)} kW. Rateio por bateria ativo: pico reduzido em ${((L.req - L.al) / L.req * 100).toFixed(1).replace(".", ",")}%.`; }
  else if (constrained) { a.className = "alert bad"; a.textContent = `Rateio desligado: ${n1(L.lim)} kW divididos igualmente. O carro com menos bateria recebe menos do que precisa.`; }
  else { a.className = "alert ok"; a.textContent = "Estação dentro do limite: todas as vagas recebem a potência pedida."; }
}
function renderBilling() {
  const T = S.tot, L = S.last;
  $("#fReceita").textContent = brl(T.rev); $("#fKwh").textContent = n2(T.energy) + " kWh";
  $("#fKwhSub").textContent = (T.energy > 0 ? Math.round(T.solar / T.energy * 100) : 0) + "% de origem solar";
  const pr = x => "R$ " + x.toFixed(2).replace(".", ",");
  $("#fTarMed").textContent = T.energy > 0 ? pr(T.rev / T.energy) : "R$ 0,00"; $("#fTarNow").textContent = pr(priceAt(S.h, L.solShare || 0));
  $("#fTbl").innerHTML = S.slots.map(s => `<tr><td>Vaga ${s.n}</td><td><span class="badge ${STAT[s.status][1]}">${STAT[s.status][0]}</span></td><td>${Math.floor(s.soc)}%</td><td>${n2(s.energy)} kWh</td><td><b>${brl(s.valor)}</b></td></tr>`).join("");
  const g = Math.min(100, T.rev / CFG.goalDay * 100);
  $("#payBar").style.width = g + "%";
  $("#proj").textContent = `Receita desta sessão: ${brl(T.rev)}, ${g.toFixed(0)}% da meta diária do modelo (90 kWh × R$ 1,65 = R$ 148,50).`;
}
function renderSus() {
  const T = S.tot, L = S.last;
  $("#sPico").textContent = n1(Math.max(0, L.req - L.al)) + " kW"; $("#sSolar").textContent = n2(T.solar) + " kWh";
  $("#sCo2").textContent = Math.round(T.solar * CFG.gridCO2) + " g";
  $("#sCv").textContent = S.slots.filter(s => s.status === "carregando" && s.soc >= 95).length;
}
const IC = { g: "☀", a: "$", b: "⚖", r: "⚡" };
function recs() {
  const L = S.last, r = [], h = S.h, f = forecast();
  r.push(["g", L.sol > 0.5 ? `<b>Solar-First ativo.</b> ${n1(L.sol)} kW de geração entram primeiro; a rede completa o restante.` : `<b>Sem sol agora.</b> A estação opera só com a rede${isPeak(h) ? ", limitada a 8 kW na ponta" : ""}.`]);
  if (L.req > L.lim + 0.05) {
    const c = S.slots.filter(s => s.status === "carregando").sort((a, b) => a.soc - b.soc)[0];
    r.push(["b", `<b>Load Balancing.</b> Pedido de ${n1(L.req)} kW limitado a ${n1(L.al)} kW. A Vaga ${c.n} (SoC ${Math.floor(c.soc)}%) tem prioridade.`]);
  } else r.push(["b", "<b>Load Balancing.</b> Distribuição Solar-First ativa, sem necessidade de corte."]);
  S.slots.filter(s => s.status === "carregando" && s.soc >= 95).forEach(s => r.push(["r", `<b>Vaga ${s.n} em CC-CV (${Math.floor(s.soc)}%).</b> Carga reduzida para ${n1(s.power)} kW e potência realocada.`]));
  r.push(["a", isPeak(h) ? "<b>Tarifação preditiva.</b> Ponta sem desconto: incentivar recargas fora do pico." : "<b>Tarifação preditiva.</b> Desconto de 10% mantido para atração fora do pico."]);
  const pk = f.reduce((b, p) => (p.req > b.req ? p : b), f[0]);
  r.push(["r", pk.req > 0 ? `<b>Próximos 60 min.</b> Pico de demanda de ${n1(pk.req)} kW às ${hh(pk.h)}; alocação máxima de ${n1(Math.max(...f.map(p => p.al)))} kW.` : "<b>Próximos 60 min.</b> Nenhuma recarga em andamento."]);
  return { r, f, pk };
}
function renderAI() {
  const { r, f, pk } = recs();
  $("#recs").innerHTML = r.map(x => `<li><span class="ic ${x[0]}">${IC[x[0]]}</span><span>${x[1]}</span></li>`).join("");
  $("#aiHint").textContent = pk.req > 0 ? `Pico previsto de ${n1(pk.req)} kW às ${hh(pk.h)}; limite de entrada de ${n1(pk.lim)} kW.` : "Sem demanda prevista. Conecte veículos para ver a previsão.";
  return f;
}

/* ===================== gráficos (canvas) ===================== */
function draw(cv, pts, H) {
  const w = cv.clientWidth; if (!w) return;
  const dpr = window.devicePixelRatio || 1; cv.style.height = H + "px"; cv.width = w * dpr; cv.height = H * dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, H);
  const Lm = 38, Rm = 10, Tm = 12, Bm = 26;
  const ymax = Math.max(40, Math.ceil(Math.max(...pts.map(p => Math.max(p.sol, p.req, p.lim))) / 10) * 10);
  const x = i => Lm + (w - Lm - Rm) * i / (pts.length - 1), y = v => Tm + (H - Tm - Bm) * (1 - v / ymax);
  c.font = "11px Inter,system-ui,sans-serif"; c.textBaseline = "middle";
  for (let v = 0; v <= ymax; v += 10) { c.strokeStyle = "#1E2D3B"; c.beginPath(); c.moveTo(Lm, y(v)); c.lineTo(w - Rm, y(v)); c.stroke(); c.fillStyle = "#8FA3B5"; c.textAlign = "right"; c.fillText(v, Lm - 8, y(v)); }
  for (let i = 0; i < pts.length; i += 5) { c.fillStyle = "#8FA3B5"; c.textAlign = i === 0 ? "left" : (i + 5 >= pts.length ? "right" : "center"); c.fillText(i ? hh(pts[i].h) : "agora", x(i), H - 10); }
  const line = (k, col, wd, dash) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(x(i), y(p[k])) : c.moveTo(x(i), y(p[k])))); c.strokeStyle = col; c.lineWidth = wd; c.setLineDash(dash || []); c.lineJoin = "round"; c.stroke(); c.setLineDash([]); };
  c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(x(i), y(p.sol)) : c.moveTo(x(i), y(p.sol)))); c.lineTo(x(pts.length - 1), y(0)); c.lineTo(x(0), y(0)); c.closePath(); c.fillStyle = "rgba(61,220,151,.14)"; c.fill();
  line("sol", "#3DDC97", 2.5); line("req", "#6f95c4", 1.6, [5, 4]); line("al", "#4DA3FF", 3); line("lim", "#FFB84D", 2, [3, 5]);
  c.strokeStyle = "#E8453C"; c.lineWidth = 2; c.beginPath(); c.moveTo(x(0), Tm); c.lineTo(x(0), H - Bm); c.stroke();
  // legenda
  const lg = [["#3DDC97", "solar"], ["#4DA3FF", "alocada"], ["#6f95c4", "pedida"], ["#FFB84D", "limite"]]; let lx = Lm + 6; c.textAlign = "left";
  lg.forEach(([col, t]) => { c.fillStyle = col; c.fillRect(lx, 8, 12, 3); c.fillStyle = "#8FA3B5"; c.fillText(t, lx + 17, 10); lx += 22 + c.measureText(t).width + 12; });
}

/* ===================== assistente ===================== */
const CHIPS = ["Por que a Vaga 3 recebe menos potência?", "Qual o melhor horário para carregar?", "Resumo da estação", "Quanto CO₂ evitamos?", "Como funciona o CC-CV?", "Como funciona a privacidade?"];
function explain(i) {
  const s = S.slots[i], L = S.last;
  if (s.status === "livre") return `A Vaga ${s.n} está livre. Conecte um veículo no simulador para ver o rateio.`;
  if (s.status === "pendente") return `A Vaga ${s.n} tem o cabo conectado (EVCCID ${s.evccid}) e aguarda o Pix para liberar o carregador.`;
  if (s.status === "concluida") return `A Vaga ${s.n} terminou: bateria em 100%, ${n2(s.energy)} kWh entregues, ${brl(s.valor)}.`;
  if (s.status === "pausada") return `A Vaga ${s.n} está pausada por comando (Parar). Use Iniciar para retomar.`;
  if (s.soc >= 95) return `A Vaga ${s.n} passou de 95% (SoC ${Math.floor(s.soc)}%) e entrou em tensão constante (CC-CV). Forçar potência ali só degrada a célula, então a carga caiu para ${n1(s.power)} kW e a potência liberada foi realocada para quem tem menos bateria.`;
  if (s.power < s.req - 0.05) return `O pedido total (${n1(L.req)} kW) passa do limite de entrada (${n1(L.lim)} kW). O rateio é proporcional ao quanto falta de bateria: com SoC de ${Math.floor(s.soc)}%, a Vaga ${s.n} recebe ${n1(s.power)} kW dos ${n1(s.req)} kW pedidos. Quem está mais vazio recebe mais.`;
  return `A Vaga ${s.n} recebe a potência plena de ${n1(s.power)} kW: a estação está dentro do limite.`;
}
function answer(q) {
  const n = norm(q), m = n.match(/vaga\s*0?([1-4])/), L = S.last, T = S.tot;
  if (m) return explain(+m[1] - 1);
  if (/(melhor|horario|quando|ponta|tarifa|preco|desconto|barato)/.test(n)) return `A melhor janela é das 10h às 15h: o sol gera mais (até ${CFG.solarPeak} kW) e a tarifa está fora de ponta, com desconto de 10%. Na ponta (18h às 21h) a rede fica limitada a ${CFG.peakGrid} kW e não há desconto. A tarifa também acompanha o sol: quanto mais energia solar na recarga, menor o preço. Agora são ${hh(S.h)}, ${isPeak(S.h) ? "horário de ponta" : "fora de ponta"}.`;
  if (/(resumo|status|situacao|estacao|agora)/.test(n)) return `Às ${hh(S.h)}: geração solar de ${n1(L.sol)} kW, limite de entrada de ${n1(L.lim)} kW, pedido de ${n1(L.req)} kW e ${n1(L.al)} kW alocados. ${S.slots.filter(s => s.status === "carregando").length} vaga(s) carregando. Receita simulada: ${brl(T.rev)}.`;
  if (/(co2|carbono|sustent|ambient|emiss|verde)/.test(n)) { const km = T.energy / CFG.kwhKm, gas = km / CFG.kmL * CFG.gasCO2, ele = T.grid * CFG.gridCO2 / 1000; return `Nesta sessão: ${n2(T.energy)} kWh entregues, ${n2(T.solar)} kWh de origem solar e cerca de ${Math.max(0, gas - ele).toFixed(1).replace(".", ",")} kg de CO₂ evitados contra a gasolina (estimativa). Na projeção anual: cerca de 632 kg de CO₂ da rede evitados pelo sol e cerca de 40 t contra a gasolina, também estimadas. O maior ganho é viabilizar o carro elétrico; menos pico ainda poupa obra na rede e prolonga a vida da bateria.`; }
  if (/(cc|cv|95|bateria|celula)/.test(n)) return "Acima de 95% a bateria entra em tensão constante (CC-CV) e aceita cada vez menos corrente. Forçar potência ali só degrada a célula. O sistema reduz a carga desse carro e realoca a potência para quem mais precisa: é o Peak Shaving e o Load Balancing da disciplina.";
  if (/(privacidade|lgpd|evccid|placa|camera|dado)/.test(n)) return "O veículo é identificado pelo próprio cabo, via EVCCID do padrão CCS. Sem câmera, sem leitura de placa, sem capturar dado de terceiro. No app, o login exige e-mail verificado e cada motorista só acessa os próprios dados (regras do Firebase, em linha com a LGPD). O pagamento é desacoplado da identificação.";
  if (/(receita|faturamento|ganho|lucro|payback|retorno|invest)/.test(n)) return `Receita simulada: ${brl(T.rev)}. No modelo financeiro: investimento de R$ 60.000, receita de R$ 4.455 por mês (90 kWh/dia × 30 × R$ 1,65) e retorno em cerca de 14 meses.`;
  if (/(solar|sol|geracao|nuvem)/.test(n)) { const f = forecast(); return `Geração agora: ${n1(L.sol)} kW. Em 60 minutos: ${n1(f[f.length - 1].sol)} kW. O sistema é Solar-First: carrega primeiro com o excedente do sol.`; }
  if (/(pico|disjuntor|44|40|limite)/.test(n)) return `Quatro vagas de 11 kW somam 44 kW, mas o disjuntor suporta 40 kW. O sistema limita a estação a ${CFG.limit} kW e faz o rateio por estado de carga, sem obra na rede. O limite de entrada agora é ${n1(L.lim)} kW.`;
  return 'Posso explicar o rateio de uma vaga (ex.: "por que a Vaga 3 recebe menos potência?"), o melhor horário, o CC-CV, a privacidade, o CO₂ evitado ou o faturamento.';
}
function say(role, text) { const d = document.createElement("div"); d.className = "msg " + role; d.textContent = text; const m = $("#msgs"); m.appendChild(d); m.scrollTop = m.scrollHeight; }
function ask(q) { if (!q.trim()) return; say("u", q); setTimeout(() => say("a", answer(q)), 300); }

/* ===================== Firebase (opcional) ===================== */
const FB_STATUS = { livre: "livre", pendente: "pendente", liberado: "liberado", carregando: "carregando", pausada: "pausada", concluida: "concluida" };
function loadScript(src) { return new Promise((ok, err) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => err(new Error("Falha ao carregar " + src)); document.head.appendChild(s); }); }
async function initFirebase() {
  const cfg = window.CHARGEGRID_FIREBASE; if (!cfg) return;
  try {
    const v = "10.12.2";
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${v}/firebase-database-compat.js`);
    firebase.initializeApp(cfg); S.db = firebase.database(); S.live = true;
    const P = window.CHARGEGRID_PATHS;
    $("#conn").className = "pill live"; $("#conn span").textContent = "Firebase ao vivo"; $("#simulador").style.display = "none"; document.body.style.paddingBottom = "20px";
    S.slots = [1, 2, 3, 4].map(blank); buildVagas(); $("#simulador").style.display = "none";
    S.db.ref(P.estacao).on("value", sn => { const d = sn.val() || {}; S.fb = d; });
    [1, 2, 3, 4].forEach(n => S.db.ref(`${P.vagas}/vaga${n}`).on("value", sn => {
      const d = sn.val(); if (!d) return; const s = S.slots[n - 1], prev = s.status;
      s.status = FB_STATUS[d.status] || "livre"; s.soc = +d.soc || 0; s.power = +d.potencia_kw || 0; s.energy = +d.energia_kwh || 0; s.evccid = d.evccid || "";
      if (prev !== s.status) log(`Vaga ${n}: ${STAT[s.status][0].toLowerCase()}.`, s.status === "carregando" ? "good" : "");
    }));
    log("Conectado ao Firebase: telemetria do ESP32 ao vivo.", "good");
  } catch (e) { S.live = false; log("Firebase indisponível, seguindo em simulação local: " + e.message, "warn"); }
}
function stepLive() { // em modo ao vivo a telemetria vem do banco
  const d = S.fb || {}, sol = +d.geracao_kw || 0, lim = d.limite_kw != null ? +d.limite_kw : CFG.limit;
  const reqs = S.slots.map(s => (s.status === "carregando" ? reqPower(s.soc) : 0)), al = sum(S.slots.map(s => s.power));
  const solShare = al > 0 ? Math.min(1, sol / al) : 0;
  S.slots.forEach(s => { s.req = s.status === "carregando" ? reqPower(s.soc) : 0; s.valor = s.energy * priceAt(S.h, solShare); });
  S.tot = { energy: sum(S.slots.map(s => s.energy)), solar: sum(S.slots.map(s => s.energy)) * solShare, grid: sum(S.slots.map(s => s.energy)) * (1 - solShare), rev: sum(S.slots.map(s => s.valor)) };
  S.last = { sol, lim, req: sum(reqs), al, grid: Math.max(0, al - sol), peak: isPeak(S.h), solShare, price: priceAt(S.h, solShare) };
}

/* ===================== navegação e ligações ===================== */
function route() {
  const t = (location.hash || "#dashboard").slice(1), ok = ["dashboard", "ai", "faturamento", "sustentabilidade"].includes(t) ? t : "dashboard";
  $$(".tab").forEach(s => s.classList.toggle("hidden", s.id !== "tab-" + ok));
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.tab === ok));
  S.tab = ok; window.scrollTo({ top: 0 }); renderAll(true);
}
window.addEventListener("hashchange", route);
$("#simToggle").onclick = () => { const sim = $("#simulador"), c = sim.classList.toggle("collapsed"); $("#simToggle").setAttribute("aria-expanded", String(!c)); };
/* o painel do simulador é fixo: reserva espaço no fim da página para ele nunca cobrir o conteúdo */
if (window.ResizeObserver) new ResizeObserver(() => { document.body.style.paddingBottom = ($("#simulador").offsetHeight + 24) + "px"; }).observe($("#simulador"));
$("#gStop").onclick = () => cmdAll("parar"); $("#gGo").onclick = () => cmdAll("iniciar");
$("#rateioSw").onchange = e => { S.rateio = e.target.checked; log(S.rateio ? "Rateio automático ligado: prioridade para quem tem menos bateria." : "Rateio automático desligado: divisão igual entre as vagas.", S.rateio ? "good" : "warn"); };
$("#scCrit").onclick = critical; $("#scPonta").onclick = () => { setHour(18.5); log("Horário de ponta (18:30): rede limitada a 8 kW.", "warn"); }; $("#scClear").onclick = clearAll;
$("#hora").oninput = e => setHour(+e.target.value);
$("#vel").oninput = e => { S.speed = +e.target.value; $("#vVal").textContent = S.speed + "×"; };
$("#relAuto").onchange = e => (S.relAuto = e.target.checked); $("#pause").onchange = e => (S.paused = e.target.checked);
$("#chips").innerHTML = CHIPS.map(c => `<button type="button" class="chip">${c}</button>`).join("");
$("#chips").onclick = e => { const b = e.target.closest(".chip"); if (b) ask(b.textContent); };
$("#chatForm").onsubmit = e => { e.preventDefault(); const v = $("#chatIn").value; $("#chatIn").value = ""; ask(v); };

function renderAll(force) {
  renderTop(); renderVagas();
  const t = S.tab;
  if (t === "dashboard") { if (force || S.slow) draw($("#chartDash"), forecast(), 220); }
  if (t === "ai") { if (force || S.slow) { const f = renderAI(); draw($("#chartAI"), f, 260); } }
  if (t === "faturamento") renderBilling();
  if (t === "sustentabilidade") renderSus();
}
window.addEventListener("resize", () => renderAll(true));

/* ===================== início ===================== */
S.tab = "dashboard"; buildVagas(); setHour(S.h); $("#vVal").textContent = S.speed + "×";
say("a", "Oi! Sou o GoodWezinho. Pergunte sobre o rateio de potência, o melhor horário para carregar, o CC-CV, o CO₂ evitado ou o faturamento.");
log("Estação iniciada: quatro vagas de 11 kW, disjuntor de 40 kW. Modo: simulação local.");
route();
initFirebase().then(() => { if (!S.live) setTimeout(critical, 400); });
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now(), dt = Math.min(0.5, (now - last) / 1000); last = now; acc += dt;
  if (S.live) stepLive(); else if (!S.paused) step(dt);
  S.slow = acc >= 1; if (S.slow) acc = 0;
  renderAll(false);
}, 200);
})();

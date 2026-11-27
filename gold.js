(() => {
  "use strict";

  const D = window.PRICE_DATA;
  const P = window.PRICES || {};
  const G = P.gold || { local: {} };
  const R = D.gold;
  const CMAP = Object.fromEntries(D.countries.map((c) => [c.code, c]));
  const ORDER = ["ae", "th", "sg", "us", "uk"];
  const NAME = { in: "India", us: "US", ae: "Dubai (UAE)", sg: "Singapore", uk: "UK", th: "Thailand" };
  const FLAG = { in: "🇮🇳", us: "🇺🇸", ae: "🇦🇪", sg: "🇸🇬", uk: "🇬🇧", th: "🇹🇭" };
  const $ = (s) => document.querySelector(s);

  const store = {
    get(k, d) { try { const v = localStorage.getItem("pb:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pb:" + k, JSON.stringify(v)); } catch { /* ignore */ } }
  };

  const state = {
    fx: Object.assign({}, D.fallbackFx, P.fx || {}),
    fxLive: false,
    type: store.get("g:type", "jewel"),
    grams: store.get("g:grams", 20),
    making: store.get("g:making", R.defaultMaking),
    gender: store.get("g:gender", "woman"),
    months: store.get("g:months", 24),
    refund: store.get("refund", true),
    forexFee: store.get("forex", 0),
    stateCode: store.get("state", "CA")
  };

  // ---------- formatting ----------
  const fmtINR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const inr = (n) => fmtINR.format(Math.round(n));
  const SYM = { USD: "$", AED: "AED ", SGD: "S$", GBP: "£", THB: "฿", INR: "₹" };
  const f2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (cur, n) => (cur === "INR" ? inr(n) : SYM[cur] + f2.format(n));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ago(iso) {
    if (!iso) return "unknown";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  const rawRate = (cur) => (cur === "INR" ? 1 : state.fx.INR / state.fx[cur]);
  const inrPer = (cur) => (cur === "INR" ? 1 : rawRate(cur) * (1 + state.forexFee / 100));
  const usTax = () => (D.usStates.find((s) => s.code === state.stateCode) || { rate: 0 }).rate;

  // ---------- calculation ----------
  function customs(grams, type) {
    const longStay = state.months > R.jewelFreeMinMonths;
    const free = type === "jewel" && longStay ? R.jewelFreeGrams[state.gender] : 0;
    const dutiable = Math.max(0, grams - free);
    const eligible = state.months >= R.eligibleMinMonths;
    const rate = eligible ? R.eligibleRate : R.otherRate;
    return { free: Math.min(free, grams), dutiable, eligible, rate, overLimit: eligible && grams > R.eligibleMaxGrams, longStay };
  }

  function india(grams, type) {
    const g = G.local.in;
    if (!g) return null;
    const rate = type === "coin" ? g.k24 : g.k22;
    const goldVal = rate * grams;
    const making = type === "jewel" ? (goldVal * state.making) / 100 : 0;
    const gst = (goldVal * R.gstGold) / 100 + (making * R.gstMaking) / 100;
    return { rate, goldVal, making, gst, total: goldVal + making + gst };
  }

  function abroad(cc, grams, type, cu) {
    const g = G.local[cc];
    if (!g) return null;
    const c = CMAP[cc];
    const T = R.tax[cc];
    const rate = type === "coin" ? g.k24 : g.k22;
    const goldVal = rate * grams;
    const premium = type === "coin" && g.spot ? (goldVal * R.spotPremium) / 100 : 0;
    const making = type === "jewel" ? (goldVal * state.making) / 100 : 0;
    let tax = 0, taxLabel = "";
    if (type === "coin") { tax = 0; taxLabel = "No tax on investment gold"; }
    else if (cc === "us") { tax = ((goldVal + making) * usTax()) / 100; taxLabel = `Sales tax ${usTax()}%`; }
    else if (T.jewelOnMakingOnly) { tax = (making * T.jewel) / 100; taxLabel = `${T.jewel}% ${c.taxName} on making`; }
    else { tax = ((goldVal + making) * T.jewel) / 100; taxLabel = `${T.jewel}% ${c.taxName}`; }
    const gross = goldVal + premium + making + tax;
    let refund = 0;
    if (state.refund && c.refund && tax > 0 && gross >= c.refund.min) refund = Math.max(0, tax * c.refund.share - c.refund.fee);
    const netLocal = gross - refund;
    const netInr = netLocal * inrPer(g.cur);
    const duty = cu.dutiable > 0 ? ((netInr * cu.dutiable) / grams) * (cu.rate / 100) : 0;
    return { cc, c, g, rate, goldVal, premium, making, tax, taxLabel, refund, netLocal, netInr, duty, landed: netInr + duty };
  }

  // ---------- rendering ----------
  function renderHero() {
    const ind = G.local.in, ae = G.local.ae;
    if (!ind) { $("#goldHero").innerHTML = ""; return; }
    const in24 = ind.k24 * (1 + R.gstGold / 100);
    const cards = [["in", in24, "incl. 3% GST"], ["ae", ae && ae.k24 * rawRate("AED"), "before VAT"]]
      .filter((x) => x[1])
      .map(([cc, v, sub]) => `<div class="ghero"><div class="ghero__flag">${FLAG[cc]} ${NAME[cc]} · 24K</div><div class="ghero__val">${inr(v)}<small>/g</small></div><div class="ghero__sub">${sub}</div></div>`)
      .join("");
    const diff = ae ? in24 - ae.k24 * rawRate("AED") : 0;
    $("#goldHero").innerHTML = cards + (ae ? `<div class="ghero ghero--diff ${diff > 0 ? "is-cheaper" : ""}"><div class="ghero__flag">Dubai vs India</div><div class="ghero__val">${diff > 0 ? "−" : "+"}${inr(Math.abs(diff))}<small>/g</small></div><div class="ghero__sub">${(Math.abs(diff) / in24 * 100).toFixed(1)}% ${diff > 0 ? "cheaper in Dubai" : "dearer in Dubai"} before customs</div></div>` : "");
    $("#spotText").innerHTML = G.spotUsdOz ? `Gold <strong>$${Math.round(G.spotUsdOz).toLocaleString("en-US")}</strong>/oz` : "Gold —";
    $("#spotDot").classList.toggle("is-live", !!G.spotUsdOz && !G.spotStale);
    $("#goldFresh").innerHTML = G.t ? `<span class="rate-pill__dot ${Date.now() - new Date(G.t) < 2 * 86400e3 ? "is-live" : ""}"></span> Gold rates checked ${ago(G.t)} · updated every 6 hours` : "";
  }

  function renderRates() {
    const ind = G.local.in;
    const in24 = ind ? ind.k24 * (1 + R.gstGold / 100) : null;
    const rows = ["in", ...ORDER].filter((cc) => G.local[cc]).map((cc) => {
      const g = G.local[cc];
      const r24 = g.k24 * rawRate(g.cur);
      const r22 = g.k22 * rawRate(g.cur);
      const vs = cc === "in" || !in24 ? "" : r24 < in24 ? `<span class="is-good">${((in24 - r24) / in24 * 100).toFixed(1)}% cheaper</span>` : `<span class="is-bad">${((r24 - in24) / in24 * 100).toFixed(1)}% dearer</span>`;
      return `<tr${cc === "in" ? ' class="strong"' : ""}>
        <td>${FLAG[cc]} ${NAME[cc]}${g.spot ? ' <small class="muted">(intl. price)</small>' : ""}${g.stale ? ' <small class="muted">(last known)</small>' : ""}</td>
        <td>${money(g.cur, g.k24)}${cc === "in" ? "" : `<br><small class="muted">${inr(r24)}</small>`}</td>
        <td>${money(g.cur, g.k22)}${cc === "in" ? "" : `<br><small class="muted">${inr(r22)}</small>`}</td>
        <td>${cc === "in" ? "Base (+3% GST = " + inr(in24) + ")" : vs}</td></tr>`;
    }).join("");
    $("#ratesTable").innerHTML = `<thead><tr><th>Country</th><th>24K (999)</th><th>22K (916)</th><th>24K vs India</th></tr></thead><tbody>${rows}</tbody>`;
    $("#ratesNote").innerHTML = `Rupee amounts at today's mid-market exchange rate, before local taxes and making charges. ${G.spotUsdOz ? `International gold price: $${G.spotUsdOz.toLocaleString("en-US")}/oz.` : ""} Sources: ${["in", "ae", "th"].filter((c) => G.local[c]).map((c) => `<a href="${esc(G.local[c].src)}" target="_blank" rel="noopener">${NAME[c]}</a>`).join(", ")}, <a href="https://gold-api.com/" target="_blank" rel="noopener">international price</a>.`;
  }

  function renderCustomsBox(cu, grams, type) {
    const lines = [];
    if (type === "coin") lines.push(`🪙 Coins and bars get <b>no duty-free allowance</b> — all ${grams} g is dutiable.`);
    else if (cu.longStay) lines.push(`✅ ${cu.free} g of jewellery is <b>duty-free</b> (${state.gender === "woman" ? "women: 40 g" : "men/others: 20 g"} after 1+ year abroad).`);
    else lines.push(`ℹ️ The duty-free jewellery allowance needs <b>more than 1 year</b> abroad — not available on this trip.`);
    if (cu.dutiable > 0) lines.push(cu.eligible
      ? `🧾 ${cu.dutiable} g is dutiable at the concessional <b>~${cu.rate}%</b> (abroad 6+ months), payable in <b>foreign currency</b> at the airport.`
      : `⚠️ ${cu.dutiable} g is dutiable at the baggage rate of <b>~${cu.rate}%</b> (abroad under 6 months).`);
    else lines.push(`🎉 Nothing to pay at customs.`);
    if (cu.overLimit) lines.push(`⛔ The concessional route allows at most <b>1 kg</b> per passenger — above that, gold can be seized.`);
    if (cu.dutiable > 0) lines.push(`📣 Declare it at the <b>red channel</b>. Undeclared gold can be confiscated with a penalty.`);
    $("#customsBox").innerHTML = `<div class="customs-box__title">🛃 India customs for ${grams} g</div>${lines.map((l) => `<div class="customs-box__line">${l}</div>`).join("")}`;
  }

  function renderResults() {
    const grams = Math.max(0, +state.grams || 0);
    const type = state.type;
    $("#makingField").hidden = type !== "jewel";
    if (!grams || !G.local.in) { $("#results").innerHTML = `<div class="spark__empty">Enter a weight to compare.</div>`; $("#customsBox").innerHTML = ""; return; }
    const cu = customs(grams, type);
    renderCustomsBox(cu, grams, type);
    const ind = india(grams, type);
    const rows = ORDER.map((cc) => abroad(cc, grams, type, cu)).filter(Boolean).sort((a, b) => a.landed - b.landed);
    const best = rows[0];
    const item = (r) => {
      const save = ind.total - r.landed;
      return `<details class="gres${r === best && save > 0 ? " is-best" : ""}">
        <summary>
          <span class="gres__c">${FLAG[r.cc]} ${NAME[r.cc]}${r === best && save > 0 ? ' <span class="crown crown--inline">Best</span>' : ""}</span>
          <span class="gres__v">${inr(r.landed)}</span>
          <span class="gres__d ${save > 0 ? "is-good" : "is-bad"}">${save > 0 ? "Save " : "+"}${inr(Math.abs(save))}</span>
        </summary>
        <div class="row"><span>Gold ${type === "coin" ? "24K" : "22K"} · ${grams} g × ${money(r.g.cur, r.rate)}</span><span>${money(r.g.cur, r.goldVal)}</span></div>
        ${r.premium ? `<div class="row"><span>Dealer premium (~${R.spotPremium}%)</span><span>+ ${money(r.g.cur, r.premium)}</span></div>` : ""}
        ${r.making ? `<div class="row"><span>Making charges (${state.making}%)</span><span>+ ${money(r.g.cur, r.making)}</span></div>` : ""}
        <div class="row"><span>${esc(r.taxLabel)}</span><span>${r.tax ? "+ " + money(r.g.cur, r.tax) : "—"}</span></div>
        ${r.refund ? `<div class="row"><span>Tourist VAT refund</span><span class="is-good">− ${money(r.g.cur, r.refund)}</span></div>` : ""}
        <div class="row"><span>You pay</span><span>${money(r.g.cur, r.netLocal)} = ${inr(r.netInr)}</span></div>
        <div class="row"><span>India customs duty${cu.dutiable ? ` (~${cu.rate}% on ${cu.dutiable} g)` : ""}</span><span>${r.duty ? "+ " + inr(r.duty) : "₹0"}</span></div>
        <div class="row row--total"><span>Landed cost</span><span>${inr(r.landed)}</span></div>
        <div class="row row--muted"><span>${esc(R.tax[r.cc].note)}</span><span></span></div>
      </details>`;
    };
    $("#results").innerHTML = `
      <div class="gres gres--india">
        <div class="gres__head"><span class="gres__c">🇮🇳 Buy in India</span><span class="gres__v">${inr(ind.total)}</span></div>
        <div class="row"><span>Gold ${type === "coin" ? "24K" : "22K"} · ${grams} g × ${inr(ind.rate)}</span><span>${inr(ind.goldVal)}</span></div>
        ${ind.making ? `<div class="row"><span>Making charges (${state.making}%)</span><span>+ ${inr(ind.making)}</span></div>` : ""}
        <div class="row"><span>GST (3% on gold${ind.making ? ", 5% on making" : ""})</span><span>+ ${inr(ind.gst)}</span></div>
      </div>
      <div class="gres__label">Buy abroad &amp; bring it home <small>tap a country for details</small></div>
      ${rows.map(item).join("")}
      ${best && ind.total - best.landed <= 0 ? `<div class="note"><span>💡</span><span>With customs duty, buying in India works out cheaper for this amount. ${cu.eligible ? "" : "Short trips pay the high baggage rate — the saving usually only works within the duty-free allowance."}</span></div>` : ""}`;
  }

  async function renderHistory() {
    let h = {};
    try { h = await (await fetch("history.json", { cache: "no-cache" })).json(); } catch { /* offline */ }
    const rows = ["in", "ae", "th"].map((cc) => [cc, h[`gold|24K|${cc}`]]).filter(([, s]) => s);
    const box = $("#goldHistory");
    if (!rows.length || rows.every(([, s]) => s.length < 2)) {
      box.innerHTML = `<div class="spark__empty">Not enough history yet — a rate is recorded every day, so this chart fills in over the coming weeks.</div>`;
      return;
    }
    box.innerHTML = rows.map(([cc, s]) => {
      const cur = G.local[cc] ? G.local[cc].cur : "INR";
      if (s.length < 2) return `<div class="spark__row"><div class="spark__label">${FLAG[cc]} ${NAME[cc]}</div><div class="spark__empty">Collecting data…</div></div>`;
      const W = 320, H = 70, pad = 4, vals = s.map((x) => x[1]);
      const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
      const pts = s.map((x, i) => `${(pad + (i * (W - 2 * pad)) / (s.length - 1)).toFixed(1)},${(H - pad - ((x[1] - min) * (H - 2 * pad)) / span).toFixed(1)}`).join(" ");
      const ch = s[s.length - 1][1] - s[0][1];
      return `<div class="spark__row"><div class="spark__label">${FLAG[cc]} ${NAME[cc]} · 24K per gram</div>
        <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
        <div class="spark__meta"><span>${s[0][0]}</span><span>Low ${money(cur, min)} · High ${money(cur, max)}</span><span class="${ch < 0 ? "is-good" : ch > 0 ? "is-bad" : ""}">${ch === 0 ? "No change" : (ch < 0 ? "↓ " : "↑ ") + money(cur, Math.abs(ch))}</span></div></div>`;
    }).join("");
  }

  function renderAll() { renderHero(); renderRates(); renderResults(); }

  // ---------- inputs ----------
  function seg(id, key, cast = (x) => x) {
    const el = $(id);
    const sync = () => el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(cast(b.dataset.v) === state[key])));
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state[key] = cast(b.dataset.v);
      store.set("g:" + key, state[key]);
      sync();
      renderResults();
    });
    sync();
  }

  function bind() {
    seg("#typeSeg", "type");
    seg("#genderSeg", "gender");
    seg("#staySeg", "months", Number);

    const g = $("#grams");
    g.value = state.grams;
    g.addEventListener("input", () => { state.grams = parseFloat(g.value) || 0; store.set("g:grams", state.grams); renderResults(); });
    $("#quickGrams").innerHTML = [8, 10, 20, 40, 50, 100].map((n) => `<button type="button" data-g="${n}">${n} g</button>`).join("");
    $("#quickGrams").addEventListener("click", (e) => {
      const b = e.target.closest("[data-g]");
      if (!b) return;
      state.grams = +b.dataset.g; g.value = state.grams; store.set("g:grams", state.grams); renderResults();
    });

    const m = $("#making");
    m.value = state.making;
    m.addEventListener("input", () => { state.making = Math.max(0, parseFloat(m.value) || 0); store.set("g:making", state.making); renderResults(); });

    const rt = $("#refundToggle");
    rt.checked = state.refund;
    rt.addEventListener("change", () => { state.refund = rt.checked; store.set("refund", rt.checked); renderResults(); });

    const fi = $("#forexInput");
    fi.value = state.forexFee;
    fi.addEventListener("input", () => { state.forexFee = Math.max(0, parseFloat(fi.value) || 0); store.set("forex", state.forexFee); renderResults(); });

    const sel = $("#stateSelect");
    sel.innerHTML = D.usStates.map((s) => `<option value="${s.code}">${esc(s.name)} — ${s.rate}%</option>`).join("");
    sel.value = state.stateCode;
    sel.addEventListener("change", () => { state.stateCode = sel.value; store.set("state", sel.value); renderResults(); });

    const saved = store.get("theme", null);
    const sys = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = saved || sys;
    $("#themeToggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      store.set("theme", next);
    });
    $("#year").textContent = new Date().getFullYear();
  }

  async function fetchRates() {
    const cached = store.get("fx", null);
    if (cached && Date.now() - cached.t < 6 * 3600e3) { Object.assign(state.fx, cached.r); renderAll(); }
    try {
      const json = await (await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" })).json();
      if (json && json.rates && json.rates.INR) {
        const r = {};
        for (const k of Object.keys(D.fallbackFx)) if (json.rates[k]) r[k] = json.rates[k];
        store.set("fx", { r, t: Date.now() });
        Object.assign(state.fx, r);
        renderAll();
      }
    } catch { /* keep build-time rates */ }
  }

  bind();
  renderAll();
  renderHistory();
  fetchRates();
})();

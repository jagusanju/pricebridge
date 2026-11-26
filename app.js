(() => {
  "use strict";

  const D = window.PRICE_DATA;
  const P = window.PRICES || { products: [], generatedAt: null };
  const PRODUCTS = P.products;
  const $ = (s, el = document) => el.querySelector(s);

  // ---------- Freshness ----------
  function ago(iso) {
    if (!iso) return "unknown";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  const OLD = 3 * 86400e3;
  function badgeHTML(p, v) {
    const checks = [v.usdChecked, v.inrChecked].filter(Boolean).sort();
    if (!checks.length) return `<span class="badge badge--manual" title="Entered by hand — not checked automatically">Manual price</span>`;
    const t = checks[0];
    if (v.stale || Date.now() - new Date(t) > OLD)
      return `<span class="badge badge--stale" title="Last successful check">Checked ${ago(t)}</span>`;
    if (checks.length === 1) {
      const live = v.inrChecked ? "India" : "US";
      return `<span class="badge badge--partial" title="${live} price is read from the official store; the other is entered by hand">${live} live · ${ago(t)}</span>`;
    }
    return `<span class="badge badge--live" title="Read from the official stores">Live · ${ago(t)}</span>`;
  }
  function srcRow(label, url, checked, manual) {
    if (!url) return "";
    const h = host(url) + (/\/in(\/|$)/.test(new URL(url).pathname) ? "/in" : "");
    const when = manual ? " · entered by hand" : checked ? ` · ${ago(checked)}` : "";
    return `<div class="row"><span>${label}</span><span><a href="${esc(url)}" target="_blank" rel="noopener">${esc(h)} ↗</a>${when}</span></div>`;
  }
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  function mediaHTML(p, cls = "media") {
    return `<div class="${cls}">
      ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <div class="media__fallback">${ICONS[p.category] || ICONS.phone}</div>
    </div>`;
  }

  // ---------- Safe storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pb:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pb:" + k, JSON.stringify(v)); } catch { /* ignore */ } }
  };

  // ---------- State ----------
  const state = {
    rate: store.get("manualRate", null) || D.fallbackRate,
    liveRate: null,
    manualRate: store.get("manualRate", null),
    stateCode: store.get("state", "CA"),
    forexFee: store.get("forex", 0),
    customs: store.get("customs", false),
    category: "all",
    query: "",
    sort: store.get("sort", "savings"),
    variant: {},          // productId -> variant index
    compare: []           // [{id, v}]
  };

  // ---------- Formatting ----------
  const fmtINR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  const inr = (n) => fmtINR.format(Math.round(n));
  const usd = (n) => fmtUSD.format(n);
  const pct = (n) => `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(1)}%`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Icons ----------
  const ICONS = {
    phone: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
    tablet: '<svg viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
    laptop: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="11" rx="2"/><path d="M2 19h20"/></svg>',
    tv: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    wearable: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/></svg>'
  };
  const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
  const CLOSE = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const CHART = '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';

  // ---------- Core calculation ----------
  function taxRate() {
    const s = D.usStates.find((x) => x.code === state.stateCode);
    return s ? s.rate : 0;
  }

  function calc(p, vi) {
    const v = p.variants[vi ?? state.variant[p.id] ?? 0];
    const tr = taxRate();
    const usTax = v.usd * tr / 100;
    const usTotal = v.usd + usTax;
    const fx = state.rate * (1 + state.forexFee / 100);
    const usInrPreTax = v.usd * fx;
    const usTaxInr = usTax * fx;
    const usInr = usTotal * fx;
    let duty = 0, dutiable = 0;
    if (state.customs) {
      dutiable = Math.max(0, usInr - D.customs.allowanceInr);
      duty = dutiable * D.customs.dutyRate / 100;
    }
    const landed = usInr + duty;
    const inBase = v.inr / (1 + p.gst / 100);
    const gstAmt = v.inr - inBase;
    const diff = v.inr - landed;            // +ve => cheaper in US
    const diffPct = (diff / v.inr) * 100;
    return { v, tr, usTax, usTotal, usInrPreTax, usTaxInr, usInr, dutiable, duty, landed, inBase, gstAmt, diff, diffPct, fx };
  }

  function verdictHTML(c, cls = "verdict") {
    if (Math.abs(c.diffPct) < 1) return `<div class="${cls} ${cls}--even"><span>About the same price</span></div>`;
    if (c.diff > 0) return `<div class="${cls} ${cls}--us"><span>Save ${inr(c.diff)} buying in US</span><span class="verdict__pct">${pct(c.diffPct)}</span></div>`;
    return `<div class="${cls} ${cls}--in"><span>India is ${inr(-c.diff)} cheaper</span><span class="verdict__pct">${pct(-c.diffPct)}</span></div>`;
  }

  // ---------- Rendering ----------
  function visibleProducts() {
    const q = state.query.trim().toLowerCase();
    let list = PRODUCTS.filter((p) =>
      (state.category === "all" || p.category === state.category) &&
      (!q || `${p.brand} ${p.name} ${p.category} ${p.variants.map((v) => v.label).join(" ")}`.toLowerCase().includes(q))
    );
    const withCalc = list.map((p) => ({ p, c: calc(p) }));
    const sorters = {
      savings: (a, b) => b.c.diff - a.c.diff,
      savingsPct: (a, b) => b.c.diffPct - a.c.diffPct,
      priceAsc: (a, b) => a.c.v.inr - b.c.v.inr,
      priceDesc: (a, b) => b.c.v.inr - a.c.v.inr,
      name: (a, b) => a.p.name.localeCompare(b.p.name)
    };
    return withCalc.sort(sorters[state.sort] || sorters.savings);
  }

  function cardHTML({ p, c }, i) {
    const vi = state.variant[p.id] ?? 0;
    const inCompare = state.compare.some((x) => x.id === p.id);
    const usWins = c.diff > 0 && Math.abs(c.diffPct) >= 1;
    const inWins = c.diff < 0 && Math.abs(c.diffPct) >= 1;
    return `
    <article class="card" style="animation-delay:${Math.min(i, 12) * 30}ms" data-id="${p.id}">
      ${mediaHTML(p)}
      <div class="card__head">
        <div class="card__title">
          <div class="card__brand">${esc(p.brand)}</div>
          <h3 class="card__name">${esc(p.name)}</h3>
          ${badgeHTML(p, c.v)}
        </div>
        <button class="compare-check" data-action="compare" aria-pressed="${inCompare}" aria-label="${inCompare ? "Remove from" : "Add to"} comparison" title="Compare">${inCompare ? CHECK : PLUS}</button>
      </div>
      ${p.variants.length > 1 ? `<div class="variants" role="group" aria-label="Variant">
        ${p.variants.map((v, j) => `<button class="variant" data-action="variant" data-v="${j}" aria-pressed="${j === vi}">${esc(v.label)}</button>`).join("")}
      </div>` : `<div class="variants"><span class="variant" aria-pressed="true">${esc(p.variants[0].label)}</span></div>`}
      <div class="prices">
        <div class="price ${inWins ? "is-winner" : ""}">
          ${inWins ? '<span class="crown">Best</span>' : ""}
          <div class="price__flag">🇮🇳 India</div>
          <div class="price__val">${inr(c.v.inr)}</div>
          <div class="price__sub">incl. ${p.gst}% GST</div>
        </div>
        <div class="price ${usWins ? "is-winner" : ""}">
          ${usWins ? '<span class="crown">Best</span>' : ""}
          <div class="price__flag">🇺🇸 US</div>
          <div class="price__val">${inr(c.landed)}</div>
          <div class="price__sub">${usd(c.usTotal)} incl. tax${state.customs && c.duty > 0 ? " + duty" : ""}</div>
        </div>
      </div>
      ${verdictHTML(c)}
      <div class="card__foot">
        <button class="btn btn--block" data-action="detail">${CHART} Full breakdown</button>
      </div>
    </article>`;
  }

  function renderGrid() {
    const items = visibleProducts();
    $("#grid").innerHTML = items.map(cardHTML).join("");
    $("#empty").hidden = items.length > 0;
  }

  function renderStats() {
    const all = PRODUCTS.map((p) => calc(p, 0));
    const cheaperUS = all.filter((c) => c.diff > 0).length;
    const avg = all.reduce((s, c) => s + c.diffPct, 0) / all.length;
    $("#stats").innerHTML = `
      <div class="stat"><b>${PRODUCTS.length}</b> products</div>
      <div class="stat"><b>${cheaperUS}/${all.length}</b> cheaper in US</div>
      <div class="stat">Avg. ${avg >= 0 ? "US saving" : "India saving"} <b>${Math.abs(avg).toFixed(1)}%</b></div>`;
  }

  function renderChips() {
    const counts = PRODUCTS.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {});
    $("#chips").innerHTML = D.categories.map((c) => `
      <button class="chip" role="tab" data-cat="${c.id}" aria-selected="${state.category === c.id}">
        ${esc(c.label)}<span>${c.id === "all" ? PRODUCTS.length : counts[c.id] || 0}</span>
      </button>`).join("");
  }

  function renderRate() {
    $("#rateText").textContent = "₹" + state.rate.toFixed(2);
    $("#rateDot").classList.toggle("is-live", !state.manualRate && !!state.liveRate);
    $("#ratePill").title = state.manualRate ? "Using your custom rate" : state.liveRate ? "Live mid-market rate" : "Offline — using fallback rate";
    if (document.activeElement !== $("#rateInput")) $("#rateInput").value = state.rate.toFixed(2);
  }

  function renderAll() {
    renderRate();
    renderStats();
    renderGrid();
    renderTray();
  }

  // ---------- Detail sheet ----------
  function detailHTML(p) {
    const c = calc(p);
    const st = D.usStates.find((x) => x.code === state.stateCode);
    const vi = state.variant[p.id] ?? 0;
    const tone = Math.abs(c.diffPct) < 1 ? "verdict--even" : c.diff > 0 ? "verdict--us" : "verdict--in";
    return `
      <div class="grabber"></div>
      ${mediaHTML(p, "media media--sheet")}
      <div class="sheet__head">
        <div>
          <div class="card__brand">${esc(p.brand)}</div>
          <h2 id="detailTitle">${esc(p.name)}</h2>
        </div>
        <button class="icon-btn sheet__close" data-close aria-label="Close">${CLOSE}</button>
      </div>

      ${p.variants.length > 1 ? `<div class="variants" style="margin-bottom:14px">
        ${p.variants.map((v, j) => `<button class="variant" data-action="variant" data-id="${p.id}" data-v="${j}" aria-pressed="${j === vi}">${esc(v.label)}</button>`).join("")}
      </div>` : ""}

      <div class="big-verdict ${tone}">
        <strong>${Math.abs(c.diffPct) < 1 ? "≈ Same" : inr(Math.abs(c.diff))}</strong>
        <span>${Math.abs(c.diffPct) < 1 ? "No meaningful difference" : c.diff > 0 ? `cheaper in the US (${pct(c.diffPct)})` : `cheaper in India (${pct(-c.diffPct)})`}</span>
      </div>

      <div class="breakdown">
        <div class="breakdown__title">🇺🇸 Buying in the US <small>${esc(st ? st.name : "")}</small></div>
        <div class="row"><span>${p.basis === "store" ? "Store price" : "List price"} (pre-tax)</span><span>${usd(c.v.usd)}</span></div>
        <div class="row"><span>Sales tax (${c.tr}%)</span><span>+ ${usd(c.usTax)}</span></div>
        <div class="row"><span>Total in USD</span><span>${usd(c.usTotal)}</span></div>
        <div class="row row--muted"><span>Rate ₹${state.rate.toFixed(2)}${state.forexFee ? ` + ${state.forexFee}% forex fee` : ""}</span><span>₹${c.fx.toFixed(2)} / $</span></div>
        <div class="row"><span>Total in INR</span><span>${inr(c.usInr)}</span></div>
        ${state.customs ? `
          <div class="row row--muted"><span>Duty-free allowance</span><span>− ${inr(Math.min(c.usInr, D.customs.allowanceInr))}</span></div>
          <div class="row"><span>Customs duty (${D.customs.dutyRate}% on ${inr(c.dutiable)})</span><span>+ ${inr(c.duty)}</span></div>` : ""}
        <div class="row row--total"><span>${state.customs ? "Landed cost in India" : "Total cost"}</span><span>${inr(c.landed)}</span></div>
      </div>

      <div class="breakdown">
        <div class="breakdown__title">🇮🇳 Buying in India <small>${p.basis === "store" ? "store price" : "MRP"} incl. GST</small></div>
        <div class="row"><span>Base price (excl. GST)</span><span>${inr(c.inBase)}</span></div>
        <div class="row"><span>GST (${p.gst}%)</span><span>+ ${inr(c.gstAmt)}</span></div>
        <div class="row row--total"><span>${p.basis === "store" ? "Store price" : "MRP"}</span><span>${inr(c.v.inr)}</span></div>
      </div>

      <div class="breakdown">
        <div class="breakdown__title">⚖️ Like-for-like (before taxes)</div>
        <div class="row"><span>US base price in INR</span><span>${inr(c.usInrPreTax)}</span></div>
        <div class="row"><span>India base price</span><span>${inr(c.inBase)}</span></div>
        <div class="row row--total"><span>India premium on base price</span><span>${pct(((c.inBase - c.usInrPreTax) / c.usInrPreTax) * 100)}</span></div>
      </div>

      <div class="breakdown">
        <div class="breakdown__title">🔗 Price sources ${badgeHTML(p, c.v)}</div>
        ${srcRow("US price", c.v.usdSrc || p.sourceUS, c.v.usdChecked, c.v.usdManual)}
        ${srcRow("India price", c.v.inrSrc || p.sourceIN, c.v.inrChecked, c.v.inrManual)}
        ${p.basis === "store" ? `<div class="row row--muted"><span>Compared on the current selling price at each official store</span><span></span></div>` : ""}
        ${c.v.usdList ? `<div class="row row--muted"><span>US list price (MSRP)</span><span>${usd(c.v.usdList)}</span></div>` : ""}
        ${c.v.inrList ? `<div class="row row--muted"><span>India MRP</span><span>${inr(c.v.inrList)}</span></div>` : ""}
        ${c.v.usdSale ? `<div class="row row--muted"><span>US sale price right now</span><span>${usd(c.v.usdSale)}</span></div>` : ""}
        ${c.v.inrSale ? `<div class="row row--muted"><span>India sale price right now</span><span>${inr(c.v.inrSale)}</span></div>` : ""}
        ${c.v.usdOutOfStock ? `<div class="row row--muted"><span>⚠️ Currently out of stock on the US store</span><span></span></div>` : ""}
        ${c.v.inrOutOfStock ? `<div class="row row--muted"><span>⚠️ Currently out of stock on the India store</span><span></span></div>` : ""}
        ${(c.v.usdManual || c.v.inrManual || p.mode === "manual") ? `<div class="row row--muted"><span>Prices marked “entered by hand” are not checked automatically and may be out of date — check the store before buying.</span><span></span></div>` : ""}
      </div>

      ${p.note ? `<div class="note"><span>💡</span><span><b>Good to know:</b> ${esc(p.note)}</span></div>` : ""}
      ${!state.customs && c.usInr > D.customs.allowanceInr ? `<div class="note"><span>🧳</span><span><b>Carrying it home?</b> This exceeds the ₹50,000 duty-free allowance — turn on <b>Add India customs duty</b> to see the real landed cost (≈ ${inr(c.usInr + (c.usInr - D.customs.allowanceInr) * D.customs.dutyRate / 100)}).</span></div>` : ""}
    `;
  }

  let detailId = null;
  function openDetail(id) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return;
    detailId = id;
    $("#detailBody").innerHTML = detailHTML(p);
    const dlg = $("#detailDialog");
    if (!dlg.open) dlg.showModal();
  }

  // ---------- Compare ----------
  function toggleCompare(id) {
    const i = state.compare.findIndex((x) => x.id === id);
    if (i >= 0) state.compare.splice(i, 1);
    else {
      if (state.compare.length >= 4) return toast("You can compare up to 4 products");
      state.compare.push({ id });
    }
    renderGrid();
    renderTray();
  }

  function renderTray() {
    const tray = $("#tray");
    tray.hidden = state.compare.length === 0;
    $("#trayCount").textContent = `(${state.compare.length})`;
    $("#trayItems").innerHTML = state.compare.map(({ id }) => {
      const p = PRODUCTS.find((x) => x.id === id);
      return `<span class="tray__item">${esc(p.name)}<button data-remove="${id}" aria-label="Remove ${esc(p.name)}">×</button></span>`;
    }).join("");
  }

  function openCompare() {
    if (state.compare.length < 2) return toast("Add at least 2 products to compare");
    const rows = state.compare.map(({ id }) => {
      const p = PRODUCTS.find((x) => x.id === id);
      return { p, c: calc(p) };
    });
    const cell = (fn) => rows.map(fn).map((v) => `<td>${v}</td>`).join("");
    $("#compareBody").innerHTML = `
      <div class="grabber"></div>
      <div class="sheet__head">
        <div><h2 id="compareTitle">Side-by-side comparison</h2>
        <div class="price__sub">${esc(D.usStates.find((s) => s.code === state.stateCode)?.name || "")} sales tax · ₹${state.rate.toFixed(2)}/$${state.customs ? " · incl. customs" : ""}</div></div>
        <button class="icon-btn sheet__close" data-close aria-label="Close">${CLOSE}</button>
      </div>
      <div class="table-wrap">
        <table class="cmp">
          <thead><tr><th></th>${rows.map(({ p, c }) => `<th>${esc(p.name)}<br><small style="font-weight:500;color:var(--text-3)">${esc(c.v.label)}</small></th>`).join("")}</tr></thead>
          <tbody>
            <tr><td>US list price</td>${cell(({ c }) => usd(c.v.usd))}</tr>
            <tr><td>US sales tax</td>${cell(({ c }) => usd(c.usTax))}</tr>
            <tr><td>US total (USD)</td>${cell(({ c }) => usd(c.usTotal))}</tr>
            <tr><td>US total (INR)</td>${cell(({ c }) => inr(c.usInr))}</tr>
            ${state.customs ? `<tr><td>Customs duty</td>${cell(({ c }) => inr(c.duty))}</tr>` : ""}
            <tr class="strong"><td>US landed cost</td>${cell(({ c }) => inr(c.landed))}</tr>
            <tr><td>India base price</td>${cell(({ c }) => inr(c.inBase))}</tr>
            <tr><td>India GST</td>${cell(({ p, c }) => `${inr(c.gstAmt)} <small style="color:var(--text-3)">(${p.gst}%)</small>`)}</tr>
            <tr class="strong"><td>India MRP</td>${cell(({ c }) => inr(c.v.inr))}</tr>
            <tr class="strong"><td>You save buying in US</td>${rows.map(({ c }) => `<td class="${c.diff > 0 ? "is-good" : "is-bad"}">${c.diff > 0 ? "" : "−"}${inr(Math.abs(c.diff))}<br><small>${pct(c.diffPct)}</small></td>`).join("")}</tr>
          </tbody>
        </table>
      </div>`;
    $("#compareDialog").showModal();
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("is-show"), 2400);
  }

  // ---------- Live exchange rate ----------
  async function fetchRate() {
    const cached = store.get("liveRate", null);
    if (cached && Date.now() - cached.t < 6 * 3600 * 1000) applyLive(cached.r);
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
      const json = await res.json();
      const r = json && json.rates && json.rates.INR;
      if (r) { store.set("liveRate", { r, t: Date.now() }); applyLive(r); }
    } catch {
      if (!state.liveRate) renderRate();
    }
  }
  function applyLive(r) {
    state.liveRate = r;
    if (!state.manualRate) { state.rate = r; renderAll(); }
  }

  // ---------- Theme ----------
  function initTheme() {
    const saved = store.get("theme", null);
    const sys = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = saved || sys;
    $("#themeToggle").addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      store.set("theme", next);
    });
  }

  // ---------- Events ----------
  function bind() {
    // Settings
    const sel = $("#stateSelect");
    sel.innerHTML = D.usStates.map((s) => `<option value="${s.code}">${esc(s.name)} — ${s.rate}%</option>`).join("");
    sel.value = state.stateCode;
    sel.addEventListener("change", () => { state.stateCode = sel.value; store.set("state", sel.value); renderAll(); });

    const ri = $("#rateInput");
    ri.addEventListener("input", () => {
      const v = parseFloat(ri.value);
      if (v > 0) { state.manualRate = v; state.rate = v; store.set("manualRate", v); renderAll(); }
    });
    ri.addEventListener("blur", renderRate);
    $("#rateReset").addEventListener("click", () => {
      state.manualRate = null; store.set("manualRate", null);
      state.rate = state.liveRate || D.fallbackRate;
      renderAll();
      $("#rateInput").value = state.rate.toFixed(2);
      toast(state.liveRate ? "Using live exchange rate" : "Live rate unavailable — using fallback");
    });

    const fi = $("#forexInput");
    fi.value = state.forexFee;
    fi.addEventListener("input", () => { state.forexFee = Math.max(0, parseFloat(fi.value) || 0); store.set("forex", state.forexFee); renderAll(); });

    const ct = $("#customsToggle");
    ct.checked = state.customs;
    ct.addEventListener("change", () => { state.customs = ct.checked; store.set("customs", ct.checked); renderAll(); });

    const so = $("#sortSelect");
    so.value = state.sort;
    so.addEventListener("change", () => { state.sort = so.value; store.set("sort", so.value); renderGrid(); });

    // Search
    const si = $("#search");
    let st;
    si.addEventListener("input", () => { clearTimeout(st); st = setTimeout(() => { state.query = si.value; renderGrid(); }, 120); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); si.focus(); }
    });

    // Chips
    $("#chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      state.category = b.dataset.cat;
      renderChips();
      renderGrid();
    });

    // Cards (delegated)
    $("#grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.closest(".card").dataset.id;
      const act = btn.dataset.action;
      if (act === "variant") { state.variant[id] = +btn.dataset.v; renderGrid(); renderTray(); }
      else if (act === "compare") toggleCompare(id);
      else if (act === "detail") openDetail(id);
    });

    // Detail sheet
    $("#detailDialog").addEventListener("click", (e) => {
      const dlg = e.currentTarget;
      if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
      const v = e.target.closest('[data-action="variant"]');
      if (v) { state.variant[v.dataset.id] = +v.dataset.v; openDetail(v.dataset.id); renderGrid(); }
    });
    $("#detailDialog").addEventListener("close", () => { detailId = null; });

    // Compare
    $("#compareDialog").addEventListener("click", (e) => {
      if (e.target === e.currentTarget || e.target.closest("[data-close]")) e.currentTarget.close();
    });
    $("#trayCompare").addEventListener("click", openCompare);
    $("#trayClear").addEventListener("click", () => { state.compare = []; renderGrid(); renderTray(); });
    $("#trayItems").addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove]");
      if (b) toggleCompare(b.dataset.remove);
    });

    const gen = P.generatedAt ? new Date(P.generatedAt) : null;
    $("#updated").textContent = gen ? gen.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
    $("#freshness").innerHTML = gen
      ? `<span class="rate-pill__dot ${Date.now() - gen < 2 * 86400e3 ? "is-live" : ""}"></span> Prices checked ${ago(P.generatedAt)} from official Apple, Samsung, LG &amp; Sony stores`
      : "Price data not loaded — run scripts/update_prices.py";
    $("#year").textContent = new Date().getFullYear();
  }

  // ---------- Init ----------
  initTheme();
  bind();
  renderChips();
  renderAll();
  fetchRate();
})();

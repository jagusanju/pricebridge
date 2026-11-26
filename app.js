(() => {
  "use strict";

  const D = window.PRICE_DATA;
  const P = window.PRICES || { products: [], generatedAt: null };
  const PRODUCTS = P.products;
  const COUNTRIES = D.countries;
  const CMAP = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
  const INDIA = { code: "in", name: "India", short: "India", flag: "🇮🇳", cur: "INR", sym: "₹" };
  const $ = (s, el = document) => el.querySelector(s);

  // ---------- Safe storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("pb:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pb:" + k, JSON.stringify(v)); } catch { /* private mode etc. */ } }
  };

  // ---------- State ----------
  const state = {
    fx: Object.assign({}, D.fallbackFx, P.fx || {}),
    fxLive: false,
    country: store.get("country", "best"),
    stateCode: store.get("state", "CA"),
    forexFee: store.get("forex", 0),
    customs: store.get("customs", false),
    refund: store.get("refund", true),
    category: "all",
    query: "",
    sort: store.get("sort", "savings"),
    variant: {},
    compare: [],
    basket: store.get("basket", []),        // [{id, label, cc}]
    travellers: store.get("travellers", 1),
    watch: store.get("watch", {}),          // {"id|label": {inr, best, t}}
    history: null
  };
  if (state.country !== "best" && !CMAP[state.country]) state.country = "best";

  // ---------- Formatting ----------
  const fmtINR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const inr = (n) => fmtINR.format(Math.round(n));
  const SYM = { USD: "$", AED: "AED ", SGD: "S$", GBP: "£", THB: "฿" };
  const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(cur, n) {
    if (cur === "INR") return inr(n);
    const whole = Math.abs(n - Math.round(n)) < 0.005;
    return (SYM[cur] || cur + " ") + (whole ? fmt0 : fmt2).format(n);
  }
  const pct = (n) => `${Math.abs(n).toFixed(1)}%`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cinfo = (cc) => (cc === "in" ? INDIA : CMAP[cc]);

  function ago(iso) {
    if (!iso) return "unknown";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

  // ---------- Icons ----------
  const ICONS = {
    phone: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
    tablet: '<svg viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
    laptop: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="11" rx="2"/><path d="M2 19h20"/></svg>',
    tv: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    wearable: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/></svg>'
  };
  const I = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-8.6C1.3 8.4 3.2 5 6.5 5c2 0 3.3 1.1 4 2.3h3C14.2 6.1 15.5 5 17.5 5c3.3 0 5.2 3.4 3.7 6.4C19 15.6 12 20 12 20z"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.5 11h-11z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v12M7 8l5-5 5 5"/></svg>'
  };

  // ---------- Core calculation ----------
  const usTaxRate = () => (D.usStates.find((x) => x.code === state.stateCode) || { rate: 0 }).rate;
  function inrPer(cur) {
    if (cur === "INR") return 1;
    return (state.fx.INR / state.fx[cur]) * (1 + state.forexFee / 100);
  }

  function calcCountry(p, v, cc) {
    const e = v.p[cc];
    if (!e || cc === "in") return null;
    const c = CMAP[cc];
    const local = e.a;
    let tax, gross, vatPart = 0;
    if (!c.taxIncluded) { tax = (local * usTaxRate()) / 100; gross = local + tax; }
    else { vatPart = (local * c.vat) / (100 + c.vat); tax = vatPart; gross = local; }
    let refund = 0, refundBlocked = false;
    if (state.refund && c.refund) {
      if (gross >= c.refund.min) refund = Math.max(0, vatPart * c.refund.share - c.refund.fee);
      else refundBlocked = true;
    }
    const netLocal = gross - refund;
    const rate = inrPer(c.cur);
    const netInr = netLocal * rate;
    const duty = state.customs ? (Math.max(0, netInr - D.customs.allowanceInr) * D.customs.dutyRate) / 100 : 0;
    return { cc, c, e, local, tax, gross, vatPart, refund, refundBlocked, netLocal, rate, netInr, duty, landed: netInr + duty,
      preTaxInr: (c.taxIncluded ? local - vatPart : local) * rate };
  }

  function variantIndex(p) { return Math.min(state.variant[p.id] ?? 0, p.variants.length - 1); }

  function calc(p, vi = variantIndex(p), cc = state.country) {
    const v = p.variants[vi];
    const inrPrice = v.p.in.a;
    const inBase = inrPrice / (1 + p.gst / 100);
    const all = COUNTRIES.map((c) => calcCountry(p, v, c.code)).filter(Boolean).sort((a, b) => a.landed - b.landed);
    const best = all[0] || null;
    const t = cc === "best" ? best : all.find((x) => x.cc === cc) || null;
    const diff = t ? inrPrice - t.landed : null;
    return { p, v, vi, inr: inrPrice, inBase, gstAmt: inrPrice - inBase, all, best, t, diff, diffPct: t ? (diff / inrPrice) * 100 : null };
  }

  // ---------- Freshness badges ----------
  const OLD = 3 * 86400e3;
  function badgeHTML(entries) {
    const es = entries.filter(Boolean);
    const live = es.filter((e) => e.c && !e.m);
    if (!live.length) return `<span class="badge badge--manual" title="Entered by hand — not checked automatically">Manual price</span>`;
    const t = live.map((e) => e.c).sort()[0];
    if (live.some((e) => e.stale) || Date.now() - new Date(t) > OLD)
      return `<span class="badge badge--stale" title="Last successful check">Checked ${ago(t)}</span>`;
    if (live.length < es.length) return `<span class="badge badge--partial" title="One price is entered by hand">Partly live · ${ago(t)}</span>`;
    return `<span class="badge badge--live" title="Read from the official stores">Live · ${ago(t)}</span>`;
  }

  // ---------- Compatibility ----------
  function compatFor(p, cc) {
    return (p.compat || []).filter((x) => x.cc === "*" || x.cc === cc || (Array.isArray(x.cc) && x.cc.includes(cc)));
  }

  // ---------- Media ----------
  function mediaHTML(p, cls = "media") {
    return `<div class="${cls}">
      ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      <div class="media__fallback">${ICONS[p.category] || ICONS.phone}</div>
    </div>`;
  }

  // ---------- Watchlist ----------
  const wkey = (p, v) => `${p.id}|${v.label}`;
  function watchDrop(r) {
    const w = state.watch[wkey(r.p, r.v)];
    if (!w) return null;
    const drops = [];
    if (r.inr < w.inr - 1) drops.push(`India ↓ ${inr(w.inr - r.inr)}`);
    if (r.best && w.best && r.best.landed < w.best * 0.99) drops.push(`Abroad ↓ ${inr(w.best - r.best.landed)}`);
    return drops.length ? drops.join(" · ") : null;
  }
  function toggleWatch(p, vi) {
    const r = calc(p, vi);
    const k = wkey(p, r.v);
    if (state.watch[k]) { delete state.watch[k]; toast("Removed from your watchlist"); }
    else { state.watch[k] = { inr: r.inr, best: r.best ? r.best.landed : null, t: Date.now() }; toast("Watching — we'll flag any price drop when you come back"); }
    store.set("watch", state.watch);
  }

  // ---------- Verdict ----------
  function verdictHTML(r) {
    if (!r.t) return `<div class="verdict verdict--even"><span>No ${esc(state.country === "best" ? "foreign" : CMAP[state.country].short)} price to compare</span></div>`;
    const where = r.t.c.short;
    if (Math.abs(r.diffPct) < 1) return `<div class="verdict verdict--even"><span>About the same as in ${esc(where)}</span></div>`;
    if (r.diff > 0) return `<div class="verdict verdict--us"><span>Save ${inr(r.diff)} buying in ${esc(where)}</span><span class="verdict__pct">${pct(r.diffPct)}</span></div>`;
    return `<div class="verdict verdict--in"><span>India is ${inr(-r.diff)} cheaper</span><span class="verdict__pct">${pct(-r.diffPct)}</span></div>`;
  }

  // ---------- Grid ----------
  function visibleProducts() {
    const q = state.query.trim().toLowerCase();
    const list = PRODUCTS.filter((p) => {
      if (state.category === "watching") { if (!p.variants.some((v) => state.watch[wkey(p, v)])) return false; }
      else if (state.category !== "all" && p.category !== state.category) return false;
      return !q || `${p.brand} ${p.name} ${p.category} ${p.variants.map((v) => v.label).join(" ")}`.toLowerCase().includes(q);
    }).map((p) => calc(p));
    const sav = (r) => (r.t ? r.diff : -Infinity);
    const sorters = {
      savings: (a, b) => sav(b) - sav(a),
      savingsPct: (a, b) => (b.t ? b.diffPct : -1e9) - (a.t ? a.diffPct : -1e9),
      priceAsc: (a, b) => a.inr - b.inr,
      priceDesc: (a, b) => b.inr - a.inr,
      name: (a, b) => a.p.name.localeCompare(b.p.name)
    };
    return list.sort(sorters[state.sort] || sorters.savings);
  }

  function cardHTML(r, i) {
    const { p, v, t } = r;
    const vi = r.vi;
    const inCompare = state.compare.includes(p.id);
    const watched = !!state.watch[wkey(p, v)];
    const drop = watchDrop(r);
    const abroadWins = t && r.diff > 0 && Math.abs(r.diffPct) >= 1;
    const indiaWins = t && r.diff < 0 && Math.abs(r.diffPct) >= 1;
    const warns = t ? compatFor(p, t.cc).filter((x) => x.level !== "ok").length : 0;
    return `
    <article class="card${drop ? " card--drop" : ""}" style="animation-delay:${Math.min(i, 12) * 30}ms" data-id="${p.id}">
      ${mediaHTML(p)}
      ${drop ? `<div class="drop-flag">🔔 Price drop since you saved it: ${esc(drop)}</div>` : ""}
      <div class="card__head">
        <div class="card__title">
          <div class="card__brand">${esc(p.brand)}</div>
          <h3 class="card__name">${esc(p.name)}</h3>
          ${badgeHTML([v.p.in, t && t.e])}
        </div>
        <div class="card__tools">
          <button class="mini-btn${watched ? " is-on" : ""}" data-action="watch" aria-pressed="${watched}" aria-label="${watched ? "Stop watching" : "Watch price"}" title="Watch price">${I.heart}</button>
          <button class="mini-btn${inCompare ? " is-on" : ""}" data-action="compare" aria-pressed="${inCompare}" aria-label="${inCompare ? "Remove from" : "Add to"} comparison" title="Compare">${inCompare ? I.check : I.plus}</button>
        </div>
      </div>
      ${p.variants.length > 1 ? `<div class="variants" role="group" aria-label="Variant">
        ${p.variants.map((x, j) => `<button class="variant" data-action="variant" data-v="${j}" aria-pressed="${j === vi}">${esc(x.label)}</button>`).join("")}
      </div>` : `<div class="variants"><span class="variant" aria-pressed="true">${esc(v.label)}</span></div>`}
      <div class="prices">
        <div class="price ${indiaWins ? "is-winner" : ""}">
          ${indiaWins ? '<span class="crown">Best</span>' : ""}
          <div class="price__flag">🇮🇳 India</div>
          <div class="price__val">${inr(r.inr)}</div>
          <div class="price__sub">incl. ${p.gst}% GST</div>
        </div>
        <div class="price ${abroadWins ? "is-winner" : ""}">
          ${abroadWins ? '<span class="crown">Best</span>' : ""}
          ${t ? `<div class="price__flag">${t.c.flag} ${esc(t.c.short)}</div>
          <div class="price__val">${inr(t.landed)}</div>
          <div class="price__sub">${esc(money(t.c.cur, t.netLocal))}${t.refund ? " after refund" : t.c.taxIncluded ? " incl. tax" : " + tax"}${t.duty ? " + duty" : ""}</div>`
          : `<div class="price__flag">${state.country === "best" ? "🌍 Abroad" : `${CMAP[state.country].flag} ${esc(CMAP[state.country].short)}`}</div><div class="price__val price__val--na">—</div><div class="price__sub">Not compared here</div>`}
        </div>
      </div>
      ${verdictHTML(r)}
      ${state.country !== "best" && r.best && t && r.best.cc !== t.cc && r.best.landed < t.landed - 500
        ? `<div class="hint">🌍 Even cheaper in ${r.best.c.flag} ${esc(r.best.c.short)}: ${inr(r.best.landed)}</div>` : ""}
      ${warns ? `<div class="hint hint--warn">⚠️ ${warns} thing${warns > 1 ? "s" : ""} to know before buying in ${esc(t.c.short)}</div>` : ""}
      <div class="card__foot">
        <button class="btn btn--block" data-action="detail">${I.chart} Full breakdown</button>
        <button class="btn btn--icon" data-action="basket" title="Add to trip basket" aria-label="Add to trip basket" ${t ? "" : "disabled"}>${I.bag}</button>
      </div>
    </article>`;
  }

  function renderGrid() {
    const items = visibleProducts();
    $("#grid").innerHTML = items.map(cardHTML).join("");
    const empty = !items.length;
    $("#empty").hidden = !empty;
    if (empty && state.category === "watching") {
      $("#emptyTitle").textContent = "Nothing on your watchlist yet";
      $("#emptyText").textContent = "Tap ♥ on any product to watch its price — we'll flag drops when you come back.";
    } else {
      $("#emptyTitle").textContent = "No products found";
      $("#emptyText").textContent = "Try a different search or category.";
    }
  }

  function renderStats() {
    const rs = PRODUCTS.map((p) => calc(p, 0)).filter((r) => r.t);
    const cheaper = rs.filter((r) => r.diff > 0).length;
    const avg = rs.length ? rs.reduce((s, r) => s + r.diffPct, 0) / rs.length : 0;
    const where = state.country === "best" ? "abroad" : `in ${CMAP[state.country].short}`;
    $("#stats").innerHTML = `
      <div class="stat"><b>${PRODUCTS.length}</b> products</div>
      <div class="stat"><b>${cheaper}/${rs.length}</b> cheaper ${esc(where)}</div>
      <div class="stat">Avg. saving ${esc(where)} <b>${avg.toFixed(1)}%</b></div>`;
  }

  function renderChips() {
    const counts = PRODUCTS.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
    counts.watching = PRODUCTS.filter((p) => p.variants.some((v) => state.watch[wkey(p, v)])).length;
    $("#chips").innerHTML = D.categories.map((c) => `
      <button class="chip" role="tab" data-cat="${c.id}" aria-selected="${state.category === c.id}">
        ${esc(c.label)}<span>${c.id === "all" ? PRODUCTS.length : counts[c.id] || 0}</span>
      </button>`).join("");
  }

  function renderCountryChips() {
    const opts = [{ code: "best", flag: "🌍", short: "Cheapest" }, ...COUNTRIES];
    $("#countryChips").innerHTML = opts.map((c) => `
      <button class="cchip" role="tab" data-cc="${c.code}" aria-selected="${state.country === c.code}">
        <span class="cchip__flag">${c.flag}</span>${esc(c.short)}
      </button>`).join("");
    $("#stateControl").classList.toggle("is-dim", !(state.country === "us" || state.country === "best"));
  }

  function renderRate() {
    const cur = state.country === "best" ? "USD" : CMAP[state.country].cur;
    const r = state.fx.INR / state.fx[cur];
    $("#rateText").innerHTML = `${esc(money(cur, 1))} = <strong>₹${r.toFixed(cur === "THB" ? 3 : 2)}</strong>`;
    $("#rateDot").classList.toggle("is-live", state.fxLive);
    $("#ratePill").title = state.fxLive ? "Live mid-market rate" : "Rate from the last price update";
  }

  function renderRules() {
    $("#rulesTable").innerHTML = `
      <thead><tr><th>Country</th><th>Tax in shop price</th><th>Tourist refund</th><th>Notes</th></tr></thead>
      <tbody>
        <tr><td>🇮🇳 India</td><td>18% GST included</td><td>—</td><td>MRP always includes GST</td></tr>
        ${COUNTRIES.map((c) => `<tr><td>${c.flag} ${esc(c.name)}</td>
          <td>${c.taxIncluded ? `${c.vat}% ${c.taxName} included` : "Sales tax added at checkout (0–10% by state)"}</td>
          <td>${c.refund ? `✅ ~${Math.round((c.vat / (100 + c.vat)) * c.refund.share * 100 * 10) / 10}% of price` : "❌ None"}</td>
          <td>${esc(c.refundNote)}</td></tr>`).join("")}
      </tbody>`;
  }

  function renderAll() {
    renderRate();
    renderCountryChips();
    renderStats();
    renderGrid();
    renderTray();
    renderBasketCount();
  }

  // ---------- Price history chart ----------
  async function loadHistory() {
    if (state.history) return state.history;
    try { state.history = await (await fetch("history.json", { cache: "no-cache" })).json(); }
    catch { state.history = {}; }
    return state.history;
  }
  function sparkSVG(series, cur) {
    if (!series || series.length < 2) return `<div class="spark__empty">Not enough history yet — we record a price every day, so this chart fills in over time.</div>`;
    const W = 320, H = 70, pad = 4;
    const vals = series.map((x) => x[1]);
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = series.map((x, i) => `${(pad + (i * (W - 2 * pad)) / (series.length - 1)).toFixed(1)},${(H - pad - ((x[1] - min) * (H - 2 * pad)) / span).toFixed(1)}`).join(" ");
    const last = series[series.length - 1], first = series[0];
    const change = last[1] - first[1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price history"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <div class="spark__meta"><span>${esc(first[0])}</span><span>Low ${esc(money(cur, min))} · High ${esc(money(cur, max))}</span><span class="${change < 0 ? "is-good" : change > 0 ? "is-bad" : ""}">${change === 0 ? "No change" : (change < 0 ? "↓ " : "↑ ") + esc(money(cur, Math.abs(change)))}</span></div>`;
  }
  async function fillHistory(p, v, cc) {
    const h = await loadHistory();
    const el = $("#historyBox");
    if (!el || el.dataset.key !== `${p.id}|${v.label}|${cc}`) return;
    const rows = [["in", "🇮🇳 India"], [cc, `${CMAP[cc].flag} ${CMAP[cc].short}`]];
    el.innerHTML = rows.map(([c, name]) => `<div class="spark__row"><div class="spark__label">${esc(name)}</div>${sparkSVG(h[`${p.id}|${v.label}|${c}`], cinfo(c).cur)}</div>`).join("");
  }

  // ---------- Detail sheet ----------
  let detail = null; // {id, cc}
  function srcRow(label, e) {
    if (!e || !e.s) return "";
    const h = host(e.s) + (/\/(in|ae|sg|uk|th(-en)?)(\/|$)/.exec(new URL(e.s).pathname)?.[0]?.replace(/\/$/, "") || "");
    const when = e.m ? " · entered by hand" : e.c ? ` · ${ago(e.c)}${e.stale ? " (last known)" : ""}` : "";
    return `<div class="row"><span>${esc(label)}</span><span><a href="${esc(e.s)}" target="_blank" rel="noopener">${esc(h)} ↗</a>${esc(when)}</span></div>`;
  }

  function detailHTML(p, cc) {
    const r = calc(p, variantIndex(p), cc);
    const t = r.t;
    const vi = r.vi;
    const tone = !t || Math.abs(r.diffPct) < 1 ? "verdict--even" : r.diff > 0 ? "verdict--us" : "verdict--in";
    const watched = !!state.watch[wkey(p, r.v)];
    const rank = [{ cc: "in", landed: r.inr, local: r.inr, cur: "INR" }, ...r.all.map((x) => ({ cc: x.cc, landed: x.landed, local: x.local, cur: x.c.cur, manual: x.e.m }))]
      .sort((a, b) => a.landed - b.landed);
    const compat = t ? compatFor(p, t.cc) : [];
    return `
      <div class="grabber"></div>
      ${mediaHTML(p, "media media--sheet")}
      <div class="sheet__head">
        <div>
          <div class="card__brand">${esc(p.brand)}</div>
          <h2 id="detailTitle">${esc(p.name)}</h2>
        </div>
        <div class="sheet__actions">
          <button class="icon-btn" data-act="share" aria-label="Share this comparison" title="Share">${I.share}</button>
          <button class="icon-btn${watched ? " is-on" : ""}" data-act="watch" aria-label="Watch price" title="Watch price">${I.heart}</button>
          <button class="icon-btn" data-close aria-label="Close">${I.close}</button>
        </div>
      </div>

      ${p.variants.length > 1 ? `<div class="variants" style="margin-bottom:14px">
        ${p.variants.map((x, j) => `<button class="variant" data-act="variant" data-v="${j}" aria-pressed="${j === vi}">${esc(x.label)}</button>`).join("")}
      </div>` : ""}

      <div class="breakdown breakdown--rank">
        <div class="breakdown__title">🌍 Where is it cheapest? <small>landed cost in ₹ · tap a country</small></div>
        ${rank.map((x, i) => {
          const ci = cinfo(x.cc);
          const sel = t && x.cc === t.cc;
          const d = x.cc === "in" ? "" : r.inr - x.landed;
          return `<button class="rank${sel ? " is-sel" : ""}${x.cc === "in" ? " is-india" : ""}" data-act="cc" data-cc="${x.cc}" ${x.cc === "in" ? "disabled" : ""}>
            <span class="rank__n">${i + 1}</span>
            <span class="rank__c">${ci.flag} ${esc(ci.short)}${x.manual ? ' <small>(manual)</small>' : ""}</span>
            <span class="rank__local">${esc(money(x.cur, x.local))}</span>
            <span class="rank__inr">${inr(x.landed)}</span>
            <span class="rank__d ${d > 0 ? "is-good" : d < 0 ? "is-bad" : ""}">${x.cc === "in" ? "India" : (d > 0 ? "−" : "+") + inr(Math.abs(d))}</span>
          </button>`;
        }).join("")}
      </div>

      ${t ? `
      <div class="big-verdict ${tone}">
        <strong>${Math.abs(r.diffPct) < 1 ? "≈ Same" : inr(Math.abs(r.diff))}</strong>
        <span>${Math.abs(r.diffPct) < 1 ? "No meaningful difference" : r.diff > 0 ? `cheaper in ${esc(t.c.name)} (${pct(r.diffPct)})` : `cheaper in India (${pct(-r.diffPct)})`}</span>
      </div>

      <div class="breakdown">
        <div class="breakdown__title">${t.c.flag} Buying in ${esc(t.c.name)} <small>${t.c.code === "us" ? esc((D.usStates.find((s) => s.code === state.stateCode) || {}).name || "") : ""}</small></div>
        <div class="row"><span>${p.basis === "store" ? "Store price" : "List price"}${t.c.taxIncluded ? ` (incl. ${t.c.vat}% ${t.c.taxName})` : " (pre-tax)"}</span><span>${esc(money(t.c.cur, t.local))}</span></div>
        ${t.c.taxIncluded
          ? `<div class="row row--muted"><span>…of which ${t.c.taxName}</span><span>${esc(money(t.c.cur, t.vatPart))}</span></div>`
          : `<div class="row"><span>Sales tax (${usTaxRate()}%)</span><span>+ ${esc(money(t.c.cur, t.tax))}</span></div>`}
        ${t.refund ? `<div class="row"><span>Tourist ${t.c.taxName} refund</span><span class="is-good">− ${esc(money(t.c.cur, t.refund))}</span></div>` : ""}
        ${t.refundBlocked ? `<div class="row row--muted"><span>Below the minimum spend for a tourist refund</span><span></span></div>` : ""}
        <div class="row"><span>You pay</span><span>${esc(money(t.c.cur, t.netLocal))}</span></div>
        <div class="row row--muted"><span>Rate ${esc(money(t.c.cur, 1))} = ₹${(state.fx.INR / state.fx[t.c.cur]).toFixed(2)}${state.forexFee ? ` + ${state.forexFee}% card fee` : ""}</span><span>× ${t.rate.toFixed(2)}</span></div>
        <div class="row"><span>In rupees</span><span>${inr(t.netInr)}</span></div>
        ${state.customs ? `<div class="row"><span>Customs duty (${D.customs.dutyRate}% above ₹50,000)</span><span>+ ${inr(t.duty)}</span></div>` : ""}
        <div class="row row--total"><span>${state.customs ? "Landed cost in India" : "Total cost"}</span><span>${inr(t.landed)}</span></div>
      </div>` : `<div class="note"><span>ℹ️</span><span>No foreign price to compare for this variant.</span></div>`}

      <div class="breakdown">
        <div class="breakdown__title">🇮🇳 Buying in India <small>${p.basis === "store" ? "store price" : "MRP"} incl. GST</small></div>
        <div class="row"><span>Base price (excl. GST)</span><span>${inr(r.inBase)}</span></div>
        <div class="row"><span>GST (${p.gst}%)</span><span>+ ${inr(r.gstAmt)}</span></div>
        <div class="row row--total"><span>${p.basis === "store" ? "Store price" : "MRP"}</span><span>${inr(r.inr)}</span></div>
        ${r.v.p.in.sale ? `<div class="row"><span>💳 On sale right now (official store)</span><span class="is-good">${inr(r.v.p.in.sale)}</span></div>` : ""}
        ${r.v.p.in.l ? `<div class="row row--muted"><span>MRP</span><span>${inr(r.v.p.in.l)}</span></div>` : ""}
      </div>

      ${compat.length ? `<div class="breakdown">
        <div class="breakdown__title">🔌 Will it work in India? <small>${t.c.flag} ${esc(t.c.short)} model</small></div>
        ${compat.map((x) => `<div class="compat compat--${x.level}"><span>${x.level === "ok" ? "✅" : x.level === "no" ? "⛔" : "⚠️"}</span><span>${esc(x.text)}</span></div>`).join("")}
      </div>` : ""}

      ${t ? `<div class="breakdown">
        <div class="breakdown__title">📈 Price history <small>official store price</small></div>
        <div class="spark-box" id="historyBox" data-key="${esc(`${p.id}|${r.v.label}|${t.cc}`)}"><div class="spark__empty">Loading…</div></div>
      </div>` : ""}

      ${(p.offers && p.offers.length) ? `<div class="breakdown">
        <div class="breakdown__title">🏷️ Offers in India</div>
        ${p.offers.map((o) => `<div class="row"><span>${esc(o.text)}</span><span>${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(host(o.url))} ↗</a>` : ""}</span></div>`).join("")}
      </div>` : ""}

      <div class="breakdown">
        <div class="breakdown__title">🔗 Price sources ${badgeHTML([r.v.p.in, t && t.e])}</div>
        ${srcRow("India price", r.v.p.in)}
        ${t ? srcRow(`${t.c.short} price`, t.e) : ""}
        ${p.basis === "store" ? `<div class="row row--muted"><span>Compared on the current selling price at each official store</span><span></span></div>` : ""}
        ${t && t.e.l ? `<div class="row row--muted"><span>${esc(t.c.short)} list price</span><span>${esc(money(t.c.cur, t.e.l))}</span></div>` : ""}
        ${t && t.e.sale ? `<div class="row row--muted"><span>${esc(t.c.short)} sale price right now</span><span>${esc(money(t.c.cur, t.e.sale))}</span></div>` : ""}
        ${t && t.e.oos ? `<div class="row row--muted"><span>⚠️ Currently out of stock in ${esc(t.c.short)}</span><span></span></div>` : ""}
        ${(t && t.e.m) || r.v.p.in.m ? `<div class="row row--muted"><span>Prices marked “entered by hand” aren't checked automatically — confirm with the store before buying.</span><span></span></div>` : ""}
      </div>

      ${t ? `<div class="note note--refund"><span>🧾</span><span>${esc(t.c.refundNote)}</span></div>` : ""}
      ${p.note ? `<div class="note"><span>💡</span><span><b>Good to know:</b> ${esc(p.note)}</span></div>` : ""}
      ${t && !state.customs && t.netInr > D.customs.allowanceInr ? `<div class="note"><span>🧳</span><span><b>Carrying it home?</b> This is above the ₹50,000 duty-free allowance — with customs duty it would cost about ${inr(t.netInr + ((t.netInr - D.customs.allowanceInr) * D.customs.dutyRate) / 100)}.</span></div>` : ""}

      ${t ? `<div class="sheet__cta"><button class="btn btn--primary btn--block" data-act="basket">${I.bag} Add to trip basket (${t.c.flag} ${esc(t.c.short)})</button></div>` : ""}
    `;
  }

  function openDetail(id, cc) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return;
    const r = calc(p);
    const target = cc || (state.country === "best" ? r.best && r.best.cc : state.country);
    detail = { id, cc: target || "best" };
    $("#detailBody").innerHTML = detailHTML(p, detail.cc);
    const dlg = $("#detailDialog");
    if (!dlg.open) dlg.showModal();
    const v = p.variants[variantIndex(p)];
    if (detail.cc && CMAP[detail.cc]) fillHistory(p, v, detail.cc);
    setHash(p, v, detail.cc);
  }

  // ---------- Share links ----------
  function shareURL(p, v, cc) {
    const u = new URL(location.href);
    u.hash = `p=${encodeURIComponent(p.id)}&v=${encodeURIComponent(v.label)}${cc && cc !== "best" ? `&c=${cc}` : ""}`;
    return u.toString();
  }
  function setHash(p, v, cc) {
    try { history.replaceState(null, "", shareURL(p, v, cc)); } catch { /* ignore */ }
  }
  function clearHash() {
    try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ }
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const id = h.get("p");
    if (!id) return;
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return;
    const vi = p.variants.findIndex((v) => v.label === h.get("v"));
    if (vi >= 0) state.variant[id] = vi;
    const cc = h.get("c");
    openDetail(id, CMAP[cc] ? cc : undefined);
  }
  async function share(p) {
    const r = calc(p, variantIndex(p), detail.cc);
    const url = shareURL(p, r.v, detail.cc);
    const text = r.t
      ? `${p.name} ${r.v.label}: ${inr(r.inr)} in India vs ${inr(r.t.landed)} in ${r.t.c.short} — ${r.diff > 0 ? `save ${inr(r.diff)}` : `India is ${inr(-r.diff)} cheaper`}.`
      : `${p.name} price in India vs abroad`;
    if (navigator.share) { try { await navigator.share({ title: `${p.name} — PriceBridge`, text, url }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast("Link copied — paste it in WhatsApp or anywhere"); }
    catch { prompt("Copy this link:", url); }
  }

  // ---------- Compare ----------
  function toggleCompare(id) {
    const i = state.compare.indexOf(id);
    if (i >= 0) state.compare.splice(i, 1);
    else {
      if (state.compare.length >= 4) return toast("You can compare up to 4 products");
      state.compare.push(id);
    }
    renderGrid();
    renderTray();
  }
  function renderTray() {
    $("#tray").hidden = !state.compare.length;
    $("#trayCount").textContent = `(${state.compare.length})`;
    $("#trayItems").innerHTML = state.compare.map((id) => {
      const p = PRODUCTS.find((x) => x.id === id);
      return `<span class="tray__item">${esc(p.name)}<button data-remove="${id}" aria-label="Remove ${esc(p.name)}">×</button></span>`;
    }).join("");
  }
  function openCompare() {
    if (state.compare.length < 2) return toast("Add at least 2 products to compare");
    const rows = state.compare.map((id) => calc(PRODUCTS.find((x) => x.id === id)));
    const cell = (r, cc) => {
      const x = r.all.find((a) => a.cc === cc);
      if (!x) return `<td class="is-na">—</td>`;
      const isBest = r.best && r.best.cc === cc;
      return `<td class="${isBest ? "is-good" : ""}">${inr(x.landed)}${isBest ? " ★" : ""}</td>`;
    };
    $("#compareBody").innerHTML = `
      <div class="grabber"></div>
      <div class="sheet__head">
        <div><h2 id="compareTitle">Side-by-side comparison</h2>
        <div class="price__sub">Landed cost in ₹${state.refund ? " · with tourist refunds" : ""}${state.customs ? " · incl. customs" : ""} · ★ cheapest</div></div>
        <div class="sheet__actions"><button class="icon-btn" data-close aria-label="Close">${I.close}</button></div>
      </div>
      <div class="table-wrap">
        <table class="cmp">
          <thead><tr><th></th>${rows.map((r) => `<th>${esc(r.p.name)}<br><small style="font-weight:500;color:var(--text-3)">${esc(r.v.label)}</small></th>`).join("")}</tr></thead>
          <tbody>
            <tr class="strong"><td>🇮🇳 India</td>${rows.map((r) => `<td>${inr(r.inr)}</td>`).join("")}</tr>
            ${COUNTRIES.map((c) => `<tr><td>${c.flag} ${esc(c.short)}</td>${rows.map((r) => cell(r, c.code)).join("")}</tr>`).join("")}
            <tr class="strong"><td>Best saving</td>${rows.map((r) => r.best ? `<td class="${r.inr - r.best.landed > 0 ? "is-good" : "is-bad"}">${r.inr - r.best.landed > 0 ? "" : "−"}${inr(Math.abs(r.inr - r.best.landed))}<br><small>${r.best.c.flag} ${esc(r.best.c.short)}</small></td>` : "<td>—</td>").join("")}</tr>
          </tbody>
        </table>
      </div>`;
    $("#compareDialog").showModal();
  }

  // ---------- Trip basket ----------
  function addToBasket(p, vi, cc) {
    const r = calc(p, vi, cc);
    if (!r.t) return toast("No foreign price to add");
    state.basket.push({ id: p.id, label: r.v.label, cc: r.t.cc });
    store.set("basket", state.basket);
    renderBasketCount();
    toast(`Added ${p.name} (${r.t.c.flag} ${r.t.c.short}) to your trip basket`);
  }
  function renderBasketCount() {
    const n = state.basket.length;
    const el = $("#basketCount");
    el.hidden = !n;
    el.textContent = n;
  }
  function basketLines() {
    return state.basket.map((b, i) => {
      const p = PRODUCTS.find((x) => x.id === b.id);
      if (!p) return null;
      const vi = Math.max(0, p.variants.findIndex((v) => v.label === b.label));
      const v = p.variants[vi];
      const saveCustoms = state.customs;
      state.customs = false; // basket applies customs to the whole trip, not per item
      const x = calcCountry(p, v, b.cc);
      state.customs = saveCustoms;
      return x ? { i, b, p, v, x, inrPrice: v.p.in.a } : null;
    }).filter(Boolean);
  }
  function basketHTML() {
    const lines = basketLines();
    const abroad = lines.reduce((s, l) => s + l.x.netInr, 0);
    const india = lines.reduce((s, l) => s + l.inrPrice, 0);
    const allowance = D.customs.allowanceInr * state.travellers;
    const dutiable = Math.max(0, abroad - allowance);
    const duty = (dutiable * D.customs.dutyRate) / 100;
    const total = abroad + duty;
    const save = india - total;
    return `
      <div class="grabber"></div>
      <div class="sheet__head">
        <div><h2 id="basketTitle">🧳 Trip basket</h2><div class="price__sub">Everything you plan to bring home — duty is worked out on the total</div></div>
        <div class="sheet__actions"><button class="icon-btn" data-close aria-label="Close">${I.close}</button></div>
      </div>
      ${!lines.length ? `<div class="empty"><div class="empty__icon">🛍️</div><h3>Your basket is empty</h3><p>Use the bag button on any product to add it with the country you'd buy it in.</p></div>` : `
      <div class="basket">
        ${lines.map((l) => `
          <div class="bline">
            <div class="bline__main">
              <div class="bline__name">${esc(l.p.name)} <small>${esc(l.v.label)}</small></div>
              <select class="bline__cc" data-bi="${l.i}" aria-label="Country for ${esc(l.p.name)}">
                ${COUNTRIES.filter((c) => l.v.p[c.code]).map((c) => `<option value="${c.code}" ${c.code === l.b.cc ? "selected" : ""}>${c.flag} ${esc(c.short)} — ${esc(money(c.cur, l.v.p[c.code].a))}</option>`).join("")}
              </select>
            </div>
            <div class="bline__price"><b>${inr(l.x.netInr)}</b><small>India ${inr(l.inrPrice)}</small></div>
            <button class="mini-btn" data-bremove="${l.i}" aria-label="Remove">${I.close}</button>
          </div>`).join("")}
      </div>
      <div class="breakdown">
        <div class="row"><span>Adults travelling (each gets ₹50,000 duty-free)</span>
          <span class="stepper"><button data-trav="-1" aria-label="Fewer travellers">−</button><b>${state.travellers}</b><button data-trav="1" aria-label="More travellers">+</button></span></div>
        <div class="row"><span>Bought abroad (after tax${state.refund ? " & refunds" : ""})</span><span>${inr(abroad)}</span></div>
        <div class="row row--muted"><span>Duty-free allowance</span><span>− ${inr(Math.min(abroad, allowance))}</span></div>
        <div class="row"><span>Customs duty (${D.customs.dutyRate}% on ${inr(dutiable)})</span><span>+ ${inr(duty)}</span></div>
        <div class="row row--total"><span>Total landed cost</span><span>${inr(total)}</span></div>
        <div class="row"><span>Same items bought in India</span><span>${inr(india)}</span></div>
      </div>
      <div class="big-verdict ${save > 0 ? "verdict--us" : "verdict--in"}">
        <strong>${inr(Math.abs(save))}</strong>
        <span>${save > 0 ? "saved by buying abroad" : "cheaper to buy everything in India"}</span>
      </div>
      <div class="note"><span>ℹ️</span><span>Each adult's allowance only covers goods in their own baggage, and one person's allowance can't be pooled. Declare items above the allowance at the red channel. Laptops and phones in use are usually treated as personal effects — rules are simplified here.</span></div>
      <div class="sheet__cta"><button class="btn btn--ghost btn--block" data-bclear>Empty basket</button></div>`}
    `;
  }
  function openBasket() {
    $("#basketBody").innerHTML = basketHTML();
    const d = $("#basketDialog");
    if (!d.open) d.showModal();
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("is-show"), 2800);
  }

  // ---------- Live exchange rates ----------
  async function fetchRates() {
    const cached = store.get("fx", null);
    if (cached && Date.now() - cached.t < 6 * 3600e3) applyRates(cached.r);
    try {
      const json = await (await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" })).json();
      if (json && json.rates && json.rates.INR) {
        const r = {};
        for (const k of Object.keys(D.fallbackFx)) if (json.rates[k]) r[k] = json.rates[k];
        store.set("fx", { r, t: Date.now() });
        applyRates(r);
      }
    } catch { renderRate(); }
  }
  function applyRates(r) {
    Object.assign(state.fx, r);
    state.fxLive = true;
    renderAll();
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

  // ---------- Watch alerts on return ----------
  function checkWatchDrops() {
    const drops = [];
    for (const p of PRODUCTS) for (let vi = 0; vi < p.variants.length; vi++) {
      if (!state.watch[wkey(p, p.variants[vi])]) continue;
      const d = watchDrop(calc(p, vi));
      if (d) drops.push(`${p.name}: ${d}`);
    }
    if (drops.length) setTimeout(() => toast(`🔔 Price drop on ${drops.length} watched item${drops.length > 1 ? "s" : ""} — ${drops[0]}`), 900);
  }

  // ---------- Events ----------
  function bind() {
    const sel = $("#stateSelect");
    sel.innerHTML = D.usStates.map((s) => `<option value="${s.code}">${esc(s.name)} — ${s.rate}%</option>`).join("");
    sel.value = state.stateCode;
    sel.addEventListener("change", () => { state.stateCode = sel.value; store.set("state", sel.value); renderAll(); });

    const fi = $("#forexInput");
    fi.value = state.forexFee;
    fi.addEventListener("input", () => { state.forexFee = Math.max(0, parseFloat(fi.value) || 0); store.set("forex", state.forexFee); renderAll(); });

    const ct = $("#customsToggle");
    ct.checked = state.customs;
    ct.addEventListener("change", () => { state.customs = ct.checked; store.set("customs", ct.checked); renderAll(); });

    const rt = $("#refundToggle");
    rt.checked = state.refund;
    rt.addEventListener("change", () => { state.refund = rt.checked; store.set("refund", rt.checked); renderAll(); });

    const so = $("#sortSelect");
    so.value = state.sort;
    so.addEventListener("change", () => { state.sort = so.value; store.set("sort", so.value); renderGrid(); });

    const si = $("#search");
    let st;
    si.addEventListener("input", () => { clearTimeout(st); st = setTimeout(() => { state.query = si.value; renderGrid(); }, 120); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); si.focus(); }
    });

    $("#countryChips").addEventListener("click", (e) => {
      const b = e.target.closest(".cchip");
      if (!b) return;
      state.country = b.dataset.cc;
      store.set("country", state.country);
      renderAll();
    });

    $("#chips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      state.category = b.dataset.cat;
      renderChips();
      renderGrid();
    });

    $("#grid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const id = btn.closest(".card").dataset.id;
      const p = PRODUCTS.find((x) => x.id === id);
      const act = btn.dataset.action;
      if (act === "variant") { state.variant[id] = +btn.dataset.v; renderGrid(); }
      else if (act === "compare") toggleCompare(id);
      else if (act === "detail") openDetail(id);
      else if (act === "basket") addToBasket(p, variantIndex(p), state.country);
      else if (act === "watch") { toggleWatch(p, variantIndex(p)); renderChips(); renderGrid(); }
    });

    // Detail sheet
    const dd = $("#detailDialog");
    dd.addEventListener("click", (e) => {
      if (e.target === dd || e.target.closest("[data-close]")) return dd.close();
      const b = e.target.closest("[data-act]");
      if (!b || !detail) return;
      const p = PRODUCTS.find((x) => x.id === detail.id);
      const act = b.dataset.act;
      if (act === "variant") { state.variant[p.id] = +b.dataset.v; openDetail(p.id, detail.cc); renderGrid(); }
      else if (act === "cc") openDetail(p.id, b.dataset.cc);
      else if (act === "share") share(p);
      else if (act === "watch") { toggleWatch(p, variantIndex(p)); openDetail(p.id, detail.cc); renderChips(); renderGrid(); }
      else if (act === "basket") addToBasket(p, variantIndex(p), detail.cc);
    });
    dd.addEventListener("close", () => { detail = null; clearHash(); });

    // Compare
    const cd = $("#compareDialog");
    cd.addEventListener("click", (e) => { if (e.target === cd || e.target.closest("[data-close]")) cd.close(); });
    $("#trayCompare").addEventListener("click", openCompare);
    $("#trayClear").addEventListener("click", () => { state.compare = []; renderGrid(); renderTray(); });
    $("#trayItems").addEventListener("click", (e) => { const b = e.target.closest("[data-remove]"); if (b) toggleCompare(b.dataset.remove); });

    // Basket
    $("#basketBtn").addEventListener("click", openBasket);
    const bd = $("#basketDialog");
    bd.addEventListener("click", (e) => {
      if (e.target === bd || e.target.closest("[data-close]")) return bd.close();
      const rm = e.target.closest("[data-bremove]");
      const tr = e.target.closest("[data-trav]");
      if (rm) state.basket.splice(+rm.dataset.bremove, 1);
      else if (tr) state.travellers = Math.min(9, Math.max(1, state.travellers + +tr.dataset.trav));
      else if (e.target.closest("[data-bclear]")) state.basket = [];
      else return;
      store.set("basket", state.basket); store.set("travellers", state.travellers);
      renderBasketCount(); openBasket();
    });
    bd.addEventListener("change", (e) => {
      const s = e.target.closest(".bline__cc");
      if (!s) return;
      state.basket[+s.dataset.bi].cc = s.value;
      store.set("basket", state.basket);
      openBasket();
    });

    window.addEventListener("hashchange", readHash);

    const gen = P.generatedAt ? new Date(P.generatedAt) : null;
    $("#updated").textContent = gen ? gen.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
    $("#freshness").innerHTML = gen
      ? `<span class="rate-pill__dot ${Date.now() - gen < 2 * 86400e3 ? "is-live" : ""}"></span> Prices checked ${ago(P.generatedAt)} from official Apple, Samsung, LG &amp; Sony stores in 6 countries`
      : "Price data not loaded — run scripts/update_prices.py";
    $("#year").textContent = new Date().getFullYear();
  }

  // ---------- Init ----------
  initTheme();
  bind();
  renderChips();
  renderRules();
  renderAll();
  readHash();
  checkWatchDrops();
  fetchRates();
})();

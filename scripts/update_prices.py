#!/usr/bin/env python3
"""
PriceBridge price updater
-------------------------
Reads catalog.json, fetches current prices + product images from official
stores in India, the US, the UAE, Singapore, the UK and Thailand, and writes:

  prices.js       product prices the website loads (window.PRICES)
  history.json    daily price history per product / variant / country
  p/<id>/         one static, search-engine friendly page per product
  sitemap.xml     list of all pages for search engines

    python3 scripts/update_prices.py

Uses only the Python standard library (3.8+). If a store can't be read, the
last known price is kept and marked as stale, so one failure never breaks the site.
"""
import html as htmlmod
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "catalog.json")
OUTPUT = os.path.join(ROOT, "prices.js")
HISTORY = os.path.join(ROOT, "history.json")
SITE = "https://pricebridge.co.in"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
STORAGE_RE = re.compile(r"\b(\d+(?:GB|TB))\b")

COUNTRIES = ["in", "us", "ae", "sg", "uk", "th"]
APPLE_PREFIX = {"in": "/in", "us": "", "ae": "/ae", "sg": "/sg", "uk": "/uk", "th": "/th-en"}
CURRENCY = {"in": "INR", "us": "USD", "ae": "AED", "sg": "SGD", "uk": "GBP", "th": "THB"}
COUNTRY_NAME = {"in": "India", "us": "US", "ae": "Dubai (UAE)", "sg": "Singapore", "uk": "UK", "th": "Thailand"}

_cache = {}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def fetch(url):
    if url in _cache:
        return _cache[url]
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode("utf-8", "ignore")
            _cache[url] = body
            time.sleep(0.7)  # be polite to the stores
            return body
        except Exception as e:  # noqa: BLE001
            last = e
            if "404" in str(e):
                break
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch failed for {url}: {last}")


def clean(s):
    """Apple uses non-breaking spaces/hyphens in product names."""
    return s.replace("\xa0", " ").replace("‑", "-").replace("‐", "-")


def first_number(s):
    s = re.sub(r"<[^>]*>|\\\"", " ", s)
    m = re.search(r"(\d[\d,]*(?:\.\d+)?)", s)
    return float(m.group(1).replace(",", "")) if m else None


def og_image(page, size=(800, 420)):
    m = re.search(r'og:image"\s+content="([^"]+)', page) or re.search(r'content="([^"]+)"\s+property="og:image', page)
    if not m:
        return None
    url = m.group(1).replace("&amp;", "&")
    if url.startswith("//"):
        url = "https:" + url
    url = re.sub(r"wid=\d+", f"wid={size[0]}", url)
    return re.sub(r"hei=\d+", f"hei={size[1]}", url)


def labels_of(p):
    return [v if isinstance(v, str) else v["label"] for v in p["variants"]]


# ================================================================ Apple
def apple_url(path, cc):
    return "https://www.apple.com" + APPLE_PREFIX[cc] + path


def apple_metrics(src, p, cc):
    url = apple_url(src["path"], cc)
    page = fetch(url)
    m = re.search(r'<script type="application/json" id="metrics">(.*?)</script>', page, re.S)
    if not m:
        raise RuntimeError("no product list on page")
    by_storage = {}
    for item in json.loads(m.group(1))["data"].get("products", []):
        name = clean(item.get("name", ""))
        if not all(r in name for r in src.get("require", [])) or any(x in name for x in src.get("exclude", [])):
            continue
        sm = STORAGE_RE.search(name)
        price = (item.get("price") or {}).get("fullPrice")
        if sm and price:
            by_storage.setdefault(sm.group(1), []).append(float(price))
    out = {lab: {"a": min(by_storage[lab])} for lab in labels_of(p) if lab in by_storage}
    return out, url, og_image(page)


def apple_pricekey(src, p, cc):
    url = apple_url(src["path"], cc)
    page = fetch(url)
    table = {}
    for m in re.finditer(r'"([\w\-]+)":\{"(?:amount|comparativeDisplayPrice)":(\d[\d.]*|"(?:[^"\\]|\\.)*")', page):
        n = first_number(m.group(2))
        if n:
            table.setdefault(m.group(1), n)
    out = {}
    for v in p["variants"]:
        rx = re.compile(v["key"])
        hits = [pr for k, pr in table.items() if rx.search(k)]
        if hits:
            out[v["label"]] = {"a": min(hits)}
    return out, url, og_image(page)


def apple_product(src, p, cc):
    url = apple_url(src["path"], cc)
    page = fetch(url)
    m = re.search(r'"currentPrice":\{"amount":"([^"]+)"', page)
    out = {}
    if m and first_number(m.group(1)):
        out[labels_of(p)[0]] = {"a": first_number(m.group(1))}
    return out, url, og_image(page)


# ================================================================ Samsung
SAMSUNG_IMG = re.compile(r'"image"\s*:\s*\[?\s*"((?:https:)?//images\.samsung\.com/[^"]+)"')


def samsung(src, p, cc):
    url = f"https://www.samsung.com/{cc}/smartphones/{src['slug']}/buy/"
    page = fetch(url)
    labels = labels_of(p)
    out = {}
    if cc == "us":
        pairs = []
        for m in re.finditer(r'"msrpPrice":([\d.]+),"currentPrice":([\d.]+)', page):
            pr = (float(m.group(1)), float(m.group(2)))
            if pr not in pairs:
                pairs.append(pr)
        pairs.sort()
        if len(pairs) != len(labels):
            raise RuntimeError(f"expected {len(labels)} US variants, found {len(pairs)}")
        for lab, (msrp, cur) in zip(labels, pairs):
            out[lab] = {"a": msrp}
            if cur < msrp:
                out[lab]["sale"] = cur
    else:
        rx = re.compile(r'"(\d+ ?[GT]B)[^"]{0,25}","subLinkUseYn":"[YN]","modelCode":"(' + re.escape(src["model"]) +
                        r'[A-Z0-9]*)"[^{}]{0,400}?"price":"([\d.]+)"(?:[^{}]{0,80}?"promotionPrice":"([\d.]*)")?')
        for storage, _mc, price, promo in rx.findall(page):
            lab = storage.replace(" ", "")
            if lab in labels and lab not in out:
                out[lab] = {"a": float(price)}
                if promo and float(promo) < float(price):
                    out[lab]["sale"] = float(promo)
        if not out:
            raise RuntimeError("no prices found")
    m = SAMSUNG_IMG.search(page)
    img = None
    if m:
        img = ("https:" + m.group(1)) if m.group(1).startswith("//") else m.group(1)
        img = img.split("?")[0] + "?$650_519_PNG$"
    return out, url, img


PARSERS = {"apple_metrics": apple_metrics, "apple_pricekey": apple_pricekey,
           "apple_product": apple_product, "samsung": samsung}


# ================================================================ store-price products (TVs, Sony)
def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def jsonld_offer(spec):
    page = fetch(spec["url"])
    want = (spec.get("sku") or "").upper()
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', page, re.S):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        for node in _walk(data):
            if "Product" not in str(node.get("@type")):
                continue
            ids = {str(node.get(k) or "").upper() for k in ("sku", "mpn")}
            if want and not any(i.startswith(want) for i in ids if i):
                continue
            offer = node.get("offers")
            if isinstance(offer, list):
                offer = offer[0] if offer else None
            if not isinstance(offer, dict) or not offer.get("price") or float(offer["price"]) <= 0:
                continue
            price = float(offer["price"])
            mrp = None
            specs = offer.get("priceSpecification") or []
            for ps in specs if isinstance(specs, list) else [specs]:
                if "Strikethrough" in str(ps.get("priceType")) and float(ps.get("price") or 0) > price:
                    mrp = float(ps["price"])
            img = node.get("image")
            img = img[0] if isinstance(img, list) else (img.get("url") if isinstance(img, dict) else img)
            if img and img.startswith("//"):
                img = "https:" + img
            return {"price": price, "list": mrp, "image": img,
                    "inStock": "InStock" in str(offer.get("availability", "InStock"))}
    raise RuntimeError(f"no matching product data for {want or spec['url']}")


def shopify(spec):
    data = json.loads(fetch(spec["url"].rstrip("/") + ".json"))["product"]
    v = data["variants"][0]
    price = float(v["price"])
    cap = float(v["compare_at_price"]) if v.get("compare_at_price") else 0
    return {"price": price, "list": cap if cap > price else None,
            "image": (data.get("image") or {}).get("src"), "inStock": v.get("available", True) is not False}


STORE_PARSERS = {"jsonld": jsonld_offer, "shopify": shopify}


# ================================================================ build
def load_previous():
    try:
        txt = open(OUTPUT, encoding="utf-8").read()
        return json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
    except Exception:  # noqa: BLE001
        return {"products": []}


def fetch_fx():
    try:
        rates = json.loads(fetch("https://open.er-api.com/v6/latest/USD"))["rates"]
        return {c: rates[c] for c in CURRENCY.values()}
    except Exception:  # noqa: BLE001
        return None


def build_scraped(p, old_vars, stamp, problems):
    src = p["source"]
    parser = PARSERS[src["type"]]
    got, image, sources = {}, None, {}
    for cc in COUNTRIES:
        if cc not in p.get("countries", COUNTRIES):
            continue
        try:
            out, url, img = parser(src, p, cc)
            got[cc] = out
            sources[cc] = url
            image = image or (img if cc in ("us", "in") else None) or image
            if not image and img:
                image = img
        except Exception as e:  # noqa: BLE001
            problems.append(f"{p['id']} [{cc}]: {e}")
    variants = []
    for v in p["variants"]:
        label = v if isinstance(v, str) else v["label"]
        shown = label + p.get("suffix", "")
        prev = old_vars.get(shown, {}).get("p", {})
        prices = {}
        for cc in COUNTRIES:
            hit = got.get(cc, {}).get(label)
            if hit:
                prices[cc] = dict(hit, c=stamp, s=sources[cc])
            elif prev.get(cc, {}).get("c"):
                prices[cc] = dict(prev[cc], stale=True)  # keep last known price
        if "in" not in prices:
            problems.append(f"{p['id']} {label}: no India price - variant skipped")
            continue
        if len(prices) < 2:
            continue
        variants.append({"label": shown, "p": prices})
    return variants, image


def build_store(p, old_vars, stamp, problems):
    variants, image = [], None
    for var in p["variants"]:
        prev = old_vars.get(var["label"], {}).get("p", {})
        prices = {}
        for cc in COUNTRIES:
            spec = var.get(cc)
            if not spec:
                continue
            if spec.get("url"):
                try:
                    r = STORE_PARSERS[spec.get("type", "jsonld")](spec)
                    e = {"a": r["price"], "c": stamp, "s": spec["url"]}
                    if r.get("list"):
                        e["l"] = r["list"]
                    if not r.get("inStock", True):
                        e["oos"] = True
                    prices[cc] = e
                    image = image or r.get("image")
                    continue
                except Exception as ex:  # noqa: BLE001
                    problems.append(f"{p['id']} {var['label']} [{cc}]: {ex}")
                    if prev.get(cc, {}).get("c"):
                        prices[cc] = dict(prev[cc], stale=True)
                        continue
            if spec.get("manual") is not None:
                prices[cc] = {"a": spec["manual"], "m": True, "s": spec.get("page")}
        if "in" in prices and len(prices) >= 2:
            variants.append({"label": var["label"], "p": prices})
        else:
            problems.append(f"{p['id']} {var['label']}: not enough prices - variant skipped")
    return variants, image


def update_history(products, stamp):
    try:
        hist = json.load(open(HISTORY, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        hist = {}
    day = stamp[:10]
    for p in products:
        for v in p["variants"]:
            for cc, e in v["p"].items():
                if e.get("m") or e.get("stale"):
                    continue
                key = f"{p['id']}|{v['label']}|{cc}"
                series = hist.setdefault(key, [])
                if series and series[-1][0] == day:
                    series[-1][1] = e["a"]
                else:
                    series.append([day, e["a"]])
                del series[:-400]
    with open(HISTORY, "w", encoding="utf-8") as f:
        json.dump(hist, f, separators=(",", ":"))


# ---------------------------------------------------------------- SEO pages
def money(cc, a):
    sym = {"INR": "₹", "USD": "$", "AED": "AED ", "SGD": "S$", "GBP": "£", "THB": "฿"}[CURRENCY[cc]]
    if cc == "in":
        s = f"{a:,.0f}"
        # Indian digit grouping
        n = str(int(round(a)))
        s = n[-3:]
        n = n[:-3]
        while n:
            s = n[-2:] + "," + s
            n = n[:-2]
        return "₹" + s
    return f"{sym}{a:,.2f}".replace(".00", "")


def write_pages(products, fx, stamp):
    e = htmlmod.escape
    urls = [SITE + "/"]
    for p in products:
        v = p["variants"][0]
        rows, best = [], None
        for cc in COUNTRIES:
            if cc not in v["p"]:
                continue
            a = v["p"][cc]["a"]
            approx = a / fx[CURRENCY[cc]] * fx["INR"] if fx else None
            rows.append((cc, a, approx))
            if cc != "in" and approx and (best is None or approx < best[2]):
                best = (cc, a, approx)
        in_price = v["p"]["in"]["a"]
        title = f"{p['name']} price: India vs US, Dubai, Singapore, UK & Thailand | PriceBridge"
        if best:
            desc = (f"{p['name']} {v['label']} costs {money('in', in_price)} in India. "
                    f"Cheapest abroad: {COUNTRY_NAME[best[0]]} at {money(best[0], best[1])} (≈ {money('in', best[2])} before tax and duty). "
                    f"Compare with GST, sales tax, tourist refunds and customs duty.")
        else:
            desc = f"{p['name']} price in India and abroad, with all taxes and customs duty."
        table = "".join(
            f"<tr><td>{e(COUNTRY_NAME[cc])}</td><td>{e(money(cc, a))}</td><td>{e(money('in', x)) if x and cc != 'in' else '—'}</td></tr>"
            for cc, a, x in rows)
        ld = {"@context": "https://schema.org", "@type": "Product", "name": p["name"], "brand": {"@type": "Brand", "name": p["brand"]},
              "image": p.get("image"), "description": desc,
              "offers": {"@type": "AggregateOffer", "priceCurrency": "INR", "lowPrice": round(min(x for _, _, x in rows if x) if fx else in_price),
                         "highPrice": round(max(x for _, _, x in rows if x) if fx else in_price), "offerCount": len(rows)}}
        page = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{SITE}/p/{p['id']}/">
<meta property="og:type" content="product"><meta property="og:site_name" content="PriceBridge">
<meta property="og:title" content="{e(p['name'])} — India vs abroad price">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{SITE}/p/{p['id']}/">
<meta property="og:image" content="{e(p.get('image') or SITE + '/og-image.png')}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False)}</script>
<style>body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7fb;color:#0f1222}}
main{{max-width:760px;margin:0 auto;padding:28px 16px}}a.btn{{display:inline-block;background:#6d5efc;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:600}}
table{{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;margin:18px 0}}td,th{{padding:12px 14px;border-bottom:1px solid #e3e6ef;text-align:left}}
img{{max-width:100%;border-radius:16px;background:#f5f5f7}}small{{color:#8a90a6}}
@media (prefers-color-scheme:dark){{body{{background:#0b0d12;color:#f2f4fa}}table{{background:#14171f}}td,th{{border-color:#252a37}}}}</style>
</head><body><main>
<p><a href="/">← PriceBridge</a></p>
<h1>{e(p['name'])} price: India vs abroad</h1>
{f'<img src="{e(p["image"])}" alt="{e(p["name"])}" width="800" height="420">' if p.get('image') else ''}
<p>{e(desc)}</p>
<table><tr><th>Country</th><th>Store price ({e(v['label'])})</th><th>≈ in rupees</th></tr>{table}</table>
<p><a class="btn" href="/#p={e(p['id'])}">See full breakdown with taxes &amp; customs →</a></p>
<p><small>Prices from official stores, checked {stamp[:16].replace('T', ' ')} UTC. Foreign prices include local VAT/GST except the US, where sales tax is added at checkout. Rupee amounts use the mid-market exchange rate.</small></p>
</main></body></html>
"""
        d = os.path.join(ROOT, "p", p["id"])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        urls.append(f"{SITE}/p/{p['id']}/")
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for u in urls:
            f.write(f"  <url><loc>{u}</loc><lastmod>{stamp[:10]}</lastmod><changefreq>daily</changefreq></url>\n")
        f.write("</urlset>\n")


def main():
    catalog = json.load(open(CATALOG, encoding="utf-8"))
    prev = {p["id"]: p for p in load_previous().get("products", [])}
    stamp = now_iso()
    products, problems = [], []

    for p in catalog["products"]:
        old_vars = {v["label"]: v for v in prev.get(p["id"], {}).get("variants", []) if "p" in v}
        if p.get("basis") == "store":
            variants, image = build_store(p, old_vars, stamp, problems)
        else:
            variants, image = build_scraped(p, old_vars, stamp, problems)
        if not variants:
            problems.append(f"{p['id']}: no comparable variants - product skipped")
            continue
        base = {k: p[k] for k in ("id", "name", "brand", "category", "gst", "note", "compat", "offers") if k in p}
        base.update(basis=p.get("basis", "list"), image=image or prev.get(p["id"], {}).get("image") or p.get("image"),
                    variants=variants)
        products.append(base)
        v0 = variants[0]
        print(f"  ✓ {p['name']} ({v0['label']}): " + "  ".join(
            f"{cc.upper()} {e['a']:g}{'*' if e.get('m') else ''}{'~' if e.get('stale') else ''}" for cc, e in v0["p"].items()))

    fx = fetch_fx()
    out = {"generatedAt": stamp, "fx": fx, "products": products, "problems": problems}
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by scripts/update_prices.py - do not edit by hand. Edit catalog.json instead. */\n")
        f.write("window.PRICES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    update_history(products, stamp)
    if fx:
        write_pages(products, fx, stamp)
    print(f"\nWrote {len(products)} products (* = entered by hand, ~ = last known price)")
    if problems:
        print("Problems:\n  - " + "\n  - ".join(problems))
    return 0 if products else 1


if __name__ == "__main__":
    sys.exit(main())

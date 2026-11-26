#!/usr/bin/env python3
"""
PriceBridge price updater
-------------------------
Reads catalog.json, fetches current prices + product images from official
stores (apple.com, apple.com/in, samsung.com/us, samsung.com/in) and writes
prices.js, which the website loads.

    python3 scripts/update_prices.py

Uses only the Python standard library (3.8+). If a store can't be read, the
last known price from the previous prices.js is kept and marked as stale, so
one failure never breaks the site.
"""
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
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
STORAGE_RE = re.compile(r"\b(\d+(?:GB|TB))\b")

_cache = {}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def fetch(url):
    if url in _cache:
        return _cache[url]
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=40) as r:
                html = r.read().decode("utf-8", "ignore")
            _cache[url] = html
            time.sleep(1)  # be polite to the stores
            return html
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch failed for {url}: {last}")


def og_image(html, size=(800, 420)):
    m = re.search(r'og:image"\s+content="([^"]+)', html) or re.search(r'content="([^"]+)"\s+property="og:image', html)
    if not m:
        return None
    url = m.group(1).replace("&amp;", "&")
    if url.startswith("//"):
        url = "https:" + url
    url = re.sub(r"wid=\d+", f"wid={size[0]}", url)
    url = re.sub(r"hei=\d+", f"hei={size[1]}", url)
    return url


def clean(s):
    """Apple uses non-breaking spaces/hyphens in product names."""
    return s.replace("\xa0", " ").replace("‑", "-").replace("‐", "-")


def variant_labels(p):
    return [v if isinstance(v, str) else v["label"] for v in p["variants"]]


# ---------------------------------------------------------------- Apple
def apple_url(path, country):
    return "https://www.apple.com" + ("/in" if country == "in" else "") + path


def apple_metrics(src, p, country):
    """Product list embedded as <script id="metrics"> on Apple buy pages."""
    url = apple_url(src["path"], country)
    html = fetch(url)
    m = re.search(r'<script type="application/json" id="metrics">(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError("no metrics block")
    prods = json.loads(m.group(1))["data"].get("products", [])
    by_storage = {}
    for item in prods:
        name = clean(item.get("name", ""))
        if not all(r in name for r in src.get("require", [])):
            continue
        if any(x in name for x in src.get("exclude", [])):
            continue
        sm = STORAGE_RE.search(name)
        price = (item.get("price") or {}).get("fullPrice")
        if sm and price:
            by_storage.setdefault(sm.group(1), set()).add(float(price))
    out = {}
    for label in variant_labels(p):
        prices = by_storage.get(label)
        if prices:
            out[label] = min(prices)
    return out, url, og_image(html)


def _num(s):
    return float(re.sub(r"[^\d.]", "", s))


def apple_pricekey(src, p, country):
    """Mac / Watch pages: {"13inch-silver-10-8":{"amount":1299.00 ...}} (US) or
    {"13inch-silver-10-8":{"comparativeDisplayPrice":"From <span>₹149900.00 ...}} (IN)."""
    url = apple_url(src["path"], country)
    html = fetch(url)
    table = {}
    for m in re.finditer(r'"([\w\-]+)":\{"(?:amount|comparativeDisplayPrice)":"?([^,}]{1,80})', html):
        key, raw = m.group(1), m.group(2)
        nm = re.search(r"(?:₹|\$|^)\s*([\d,]+(?:\.\d+)?)", raw)
        if nm:
            table.setdefault(key, _num(nm.group(1)))
    out = {}
    for v in p["variants"]:
        rx = re.compile(v["key"])
        hits = [price for k, price in table.items() if rx.search(k)]
        if hits:
            out[v["label"]] = min(hits)
    return out, url, og_image(html)


def apple_product(src, p, country):
    """Single product page: "currentPrice":{"amount":"$249.00"}."""
    url = apple_url(src["path"], country)
    html = fetch(url)
    m = re.search(r'"currentPrice":\{"amount":"[^\d]*([\d,]+(?:\.\d+)?)"', html)
    out = {}
    if m:
        out[variant_labels(p)[0]] = _num(m.group(1))
    return out, url, og_image(html)


# ---------------------------------------------------------------- Samsung
def samsung(src, p, country):
    url = src[country]
    html = fetch(url)
    labels = variant_labels(p)
    sale = {}
    if country == "us":
        pairs = []
        for m in re.finditer(r'"msrpPrice":([\d.]+),"currentPrice":([\d.]+)', html):
            pair = (float(m.group(1)), float(m.group(2)))
            if pair not in pairs:
                pairs.append(pair)
        pairs.sort()
        if len(pairs) != len(labels):
            raise RuntimeError(f"expected {len(labels)} US variants, found {len(pairs)}")
        out = {lab: pr[0] for lab, pr in zip(labels, pairs)}
        sale = {lab: pr[1] for lab, pr in zip(labels, pairs) if pr[1] < pr[0]}
    else:
        prefix = re.escape(src.get("inModelPrefix", ""))
        found = {}
        for m in re.finditer(r'"modelCode":"(' + prefix + r'[A-Z0-9]*)"[^{}]{0,300}?"price":"(\d+)","promotionPrice":"(\d*)"', html):
            found.setdefault(float(m.group(2)), float(m.group(3) or m.group(2)))
        tiers = sorted(found.items())
        if len(tiers) < 1:
            raise RuntimeError("no India prices found")
        # India may sell fewer storage tiers than the US; map from the smallest up
        out = {lab: t[0] for lab, t in zip(labels, tiers)}
        sale = {lab: t[1] for lab, t in zip(labels, tiers) if t[1] < t[0]}
    m = re.search(r'"image"\s*:\s*\[?\s*"((?:https:)?//images\.samsung\.com/[^"]+)"', html)
    img = ("https:" + m.group(1) if m.group(1).startswith("//") else m.group(1)) if m else og_image(html)
    if img and "images.samsung.com" in img:
        img = img.split("?")[0] + "?$650_519_PNG$"
    return out, url, img, sale


PARSERS = {"apple_metrics": apple_metrics, "apple_pricekey": apple_pricekey,
           "apple_product": apple_product, "samsung": samsung}


# ---------------------------------------------------------------- main
def load_previous():
    try:
        txt = open(OUTPUT, encoding="utf-8").read()
        return json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
    except Exception:  # noqa: BLE001
        return {"products": []}


def main():
    catalog = json.load(open(CATALOG, encoding="utf-8"))
    prev = {p["id"]: p for p in load_previous().get("products", [])}
    stamp = now_iso()
    products, problems = [], []

    for p in catalog["products"]:
        base = {k: p[k] for k in ("id", "name", "brand", "category", "gst", "note") if k in p}
        old = prev.get(p["id"], {})
        old_vars = {v["label"]: v for v in old.get("variants", [])}

        if "manual" in p:
            base.update(mode="manual", verified=p["manual"].get("verified"),
                        sourceUS=p["manual"].get("sourceUS"), sourceIN=p["manual"].get("sourceIN"),
                        image=p.get("image"))
            base["variants"] = [{"label": v["label"], "usd": v["usd"], "inr": v["inr"]} for v in p["variants"]]
            products.append(base)
            continue

        src = p["source"]
        parser = PARSERS[src["type"]]
        result = {"us": ({}, None, None, {}), "in": ({}, None, None, {})}
        for cc in ("us", "in"):
            try:
                r = parser(src, p, cc)
                result[cc] = r if len(r) == 4 else (*r, {})
            except Exception as e:  # noqa: BLE001
                problems.append(f"{p['id']} [{cc}]: {e}")

        us_p, us_url, us_img, us_sale = result["us"]
        in_p, in_url, in_img, in_sale = result["in"]
        base.update(mode="live", sourceUS=us_url or old.get("sourceUS"), sourceIN=in_url or old.get("sourceIN"),
                    image=us_img or in_img or old.get("image"))
        variants = []
        for label in variant_labels(p):
            ov = old_vars.get(label, {})
            usd, inr = us_p.get(label), in_p.get(label)
            v = {"label": label + p.get("suffix", "")}
            ov = old_vars.get(v["label"], ov)
            v["usd"] = usd if usd is not None else ov.get("usd")
            v["inr"] = inr if inr is not None else ov.get("inr")
            v["usdChecked"] = stamp if usd is not None else ov.get("usdChecked")
            v["inrChecked"] = stamp if inr is not None else ov.get("inrChecked")
            if label in us_sale:
                v["usdSale"] = us_sale[label]
            if label in in_sale:
                v["inrSale"] = in_sale[label]
            if v["usd"] is None or v["inr"] is None:
                problems.append(f"{p['id']} {label}: missing {'US' if v['usd'] is None else 'India'} price")
                continue  # not sold in both countries - skip variant
            if usd is None or inr is None:
                v["stale"] = True
            variants.append(v)
        if not variants:
            problems.append(f"{p['id']}: no comparable variants, product skipped")
            continue
        base["variants"] = variants
        products.append(base)
        print(f"  ✓ {p['name']}: " + ", ".join(f"{v['label']} ${v['usd']:g} / ₹{v['inr']:,.0f}" for v in variants))

    out = {"generatedAt": stamp, "products": products, "problems": problems}
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write("/* Generated by scripts/update_prices.py - do not edit by hand. Edit catalog.json instead. */\n")
        f.write("window.PRICES = " + json.dumps(out, ensure_ascii=False, indent=1) + ";\n")
    print(f"\nWrote {len(products)} products to prices.js")
    if problems:
        print("Problems:\n  - " + "\n  - ".join(problems))
    # fail the CI job only if nothing could be fetched at all
    return 1 if not any(p.get("mode") == "live" for p in products) else 0


if __name__ == "__main__":
    sys.exit(main())

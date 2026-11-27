# PriceBridge — Is it cheaper to buy it abroad?

**Live site: https://pricebridge.co.in**

Compares iPhone, iPad, Mac, Apple Watch, AirPods, Galaxy, smart TV and headphone prices in **India** against the **US, Dubai (UAE), Singapore, the UK and Thailand** — with GST, VAT, US sales tax, tourist tax refunds, live exchange rates and Indian customs duty.

## Features
- **6 countries, live prices** read from the official Apple, Samsung, LG and Sony stores every 6 hours, with "Live · checked X ago" badges and links to the source pages
- **🌍 Cheapest mode** — every product shows the cheapest country automatically; the detail view ranks all six countries
- **Full tax breakdown** — US sales tax by state; VAT/GST included abroad; India MRP split into base price + GST
- **Tourist tax refunds** (toggle) — UAE (87% of 5% VAT − AED 3.60), Singapore (eTRS, ~95% of 9% GST), Thailand (~76% of 7% VAT). The UK and US have none
- **Trip basket** — add several items from different countries; customs duty is worked out on the total, with ₹75,000 allowance per adult traveller (Baggage Rules 2026)
- **"Will it work in India?"** — eSIM-only iPhones, keyboard layouts, plugs, TV voltage/tuners, warranty rules per country
- **Price history charts** — a daily price point per product, variant and country (`history.json`)
- **Watchlist + price-drop alerts** — tap ♥; when you come back, dropped prices are flagged (stored in your browser)
- **Shareable links** — `pricebridge.co.in/#p=iphone-18-pro&v=256GB&c=ae` opens that exact comparison; the share button uses the phone's share sheet (WhatsApp etc.)
- **Official sale prices** — Samsung/LG/Sony sale and MRP prices shown in the breakdown; optional `offers` per product in `catalog.json`
- **SEO** — one static page per product (`/p/<id>/`) with prices in the title/description and Product structured data, `sitemap.xml`, `robots.txt`, social preview image (`og-image.png`)
- Compare up to 4 products side by side, search (`/`), filters, sorting, light/dark mode, phone → desktop layouts

## 🪙 Gold page (`gold.html`)
- Today's 24K and 22K gold rates per gram in India, Dubai, Thailand, Singapore, the US and the UK, with the rupee equivalent and % difference
- **Calculator:** jewellery (22K, with making charges) or coins/bars (24K), weight, who's carrying it, and time spent abroad → cost in each country with local VAT/sales tax, tourist VAT refunds, and **Indian customs duty**
- **Customs rules modelled** (simplified, in `data.js → gold`):
  - Duty-free jewellery: 40 g (women) / 20 g (others), only after 1+ year abroad — Baggage Rules 2026, from 2 Feb 2026. Coins and bars get no allowance
  - Abroad 6+ months ("eligible passenger"): up to 1 kg at the concessional rate (15% since the 13 May 2026 duty rise), paid in foreign currency
  - Otherwise: baggage rate ~38.5%
  - India: 3% GST on gold, 5% on making charges
- **Rate sources:** IBJA (India, excl. GST), Dubai City of Gold suggested retail (excl. VAT), Gold Traders Association (Thailand, 96.5% bar → 24K), international price from gold-api.com (US, UK, Singapore + ~3% dealer premium for coins)
- Daily 24K rate history, and a search-friendly summary page at `/p/gold/`

**Also changed in Feb 2026:** the general duty-free allowance for other goods rose from ₹50,000 to **₹75,000** (Baggage Rules 2026) — the electronics calculator uses the new figure.

## How prices stay up to date
```
catalog.json  ──►  scripts/update_prices.py  ──►  prices.js, history.json, p/*, sitemap.xml  ──►  website
(what to track)    (reads official stores)        (generated)
```
- **Automatic:** `.github/workflows/update-prices.yml` runs every 6 hours on GitHub Actions and commits the results; GitHub Pages redeploys.
- **Manual:** `python3 scripts/update_prices.py`
- If a store can't be read, the last known price is kept (badge turns amber) — one failure never breaks the site.

### Where each price comes from
| Products | India | US | UAE / Singapore / UK / Thailand |
|---|---|---|---|
| iPhone, iPad, Mac, Watch, AirPods | apple.com/in | apple.com | apple.com/ae, /sg, /uk, /th-en |
| Galaxy S26 Ultra, Z Fold8, Z Flip8 | samsung.com/in | samsung.com/us | samsung.com/ae, /sg, /uk, /th |
| LG OLED C6 | lg.com/in | lg.com/us | — |
| Samsung QN90F TV | entered by hand | samsung.com/us | — |
| Sony BRAVIA 8 II, WH-1000XM6 | shopatsc.com (Sony India) | entered by hand (Sony US blocks automated access) | — |

TVs are compared with the US only — carrying a TV home from Dubai or Bangkok is rarely practical.

**Price basis:** Apple and Samsung phones/tablets/laptops are compared on official list price (MRP in India). TVs and Sony products on each official store's current selling price, with the MRP shown alongside.

## Adding a product
Add an entry to `catalog.json`:
```json
{
  "id": "iphone-17e", "name": "iPhone 17e", "brand": "Apple", "category": "phone", "gst": 18,
  "source": { "type": "apple_metrics", "path": "/shop/buy-iphone/iphone-17e", "require": ["iPhone 17e "] },
  "variants": ["256GB", "512GB"],
  "compat": [{ "cc": "us", "level": "warn", "text": "US iPhones are eSIM-only." }],
  "offers": [{ "text": "₹4,000 instant discount with HDFC cards", "url": "https://www.apple.com/in/shop/..." }]
}
```
Source types: `apple_metrics` (iPhone, iPad), `apple_pricekey` (Mac, Watch — regex on price keys), `apple_product` (single-price items), `samsung` (`slug` + `model` prefix). For `"basis": "store"` products, each variant lists `us`/`in` pages: `jsonld` (schema.org product data; `sku` picks the size), `shopify`, or `{"manual": price}`.
`compat.cc` is a country code (`us`, `ae`, `sg`, `uk`, `th`), a list, or `"*"`; `level` is `ok`, `warn` or `no`.

Country tax/refund rules, customs rules and categories are in `data.js`.

## Run locally
```bash
python3 -m http.server 5173
```
Then open http://localhost:5173.

## Deploying
GitHub Pages serves the `main` branch with the custom domain in `CNAME` (DNS at Hostinger: four A records to GitHub Pages + `www` CNAME to jagusanju.github.io). When you change `styles.css`, `app.js` or `data.js`, bump the `?v=` number on its link in `index.html` so browsers fetch the new file.

## Not included (need an account in your name)
- **Email price alerts** — needs an email service (e.g. Buttondown, Resend) and a small backend; the on-site watchlist works without one
- **Visitor analytics** — e.g. GoatCounter or Cloudflare Web Analytics (free, privacy-friendly) — add their snippet to `index.html`
- **Affiliate links** — Amazon Associates, Flipkart Affiliate

## Notes
- Tourist refund and customs rules are simplified; check official guidance before travelling.
- Product images are © their manufacturers and load from the manufacturers' servers.
- Store page formats change occasionally; the updater's output lists any page it couldn't read.

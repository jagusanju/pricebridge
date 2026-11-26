# PriceBridge — India vs US electronics price comparison

**Live site: https://pricebridge.co.in**

A fast, responsive website comparing iPhone, iPad, Mac, Galaxy, Apple Watch, AirPods and smart TV prices between India and the US — with GST, US sales tax, live exchange rate and Indian customs duty.

## Features
- **Prices read automatically from official stores** — Apple, Samsung, LG and Sony (US and India) — with a "Live · checked X ago" badge on every product and links to the source pages
- **Official product images** pulled from the same pages
- **Full tax breakdown**: US list price + state sales tax, India MRP split into base price + GST
- **Live USD→INR rate** (open.er-api.com, cached 6 h), manual override, offline fallback
- **India customs duty** toggle (₹50,000 duty-free allowance, 38.5% above it) and **card forex fee**
- Current **sale prices** shown when the store is running a discount (Samsung)
- Variants, compare up to 4 products, search (`/`), filters, sorting, light/dark mode, phone → desktop layouts

## How prices stay up to date
Browsers aren't allowed to read apple.com or samsung.com directly from another website, so prices are fetched by a small script and saved to `prices.js`:

```
catalog.json  ──►  scripts/update_prices.py  ──►  prices.js  ──►  website
(what to track)    (reads official stores)        (generated)
```

- **Automatic:** `.github/workflows/update-prices.yml` runs the script **every 6 hours** on GitHub Actions and commits the new `prices.js`. Your host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) redeploys on each commit.
- **Manual:** run it yourself any time:

```bash
python3 scripts/update_prices.py
```

- If a store can't be read, the last known price is kept and the badge turns amber ("Checked 2 d ago") instead of breaking the site.
- **TVs and Sony products** are compared on each official store's *current selling price* (LG US/India, Samsung US, Sony India via shopatsc.com), with the MRP shown alongside. Two stores can't be read automatically — Sony US blocks automated access and Samsung India doesn't publish TV prices in its pages — so those prices are hand-entered in `catalog.json` (`{"manual": value}`) and labelled "entered by hand" on the site.

## Adding a product
Add an entry to `catalog.json`. For Apple, point `path` at the store "buy" page and filter product names:

```json
{
  "id": "iphone-17e", "name": "iPhone 17e", "brand": "Apple", "category": "phone", "gst": 18,
  "source": { "type": "apple_metrics", "path": "/shop/buy-iphone/iphone-17e", "require": ["iPhone 17e "] },
  "variants": ["256GB", "512GB"]
}
```

Source types: `apple_metrics` (iPhone, iPad), `apple_pricekey` (Mac, Watch — match price keys with a regex), `apple_product` (single-price items like AirPods), `samsung` (US + India phone pages). For store-price products (`"basis": "store"`), each variant gives a `us` and `in` page: `jsonld` (any page with schema.org product data — LG, Samsung; add `sku` to pick the size) or `shopify` (Sony India). `category` is one of `phone`, `tablet`, `laptop`, `tv`, `wearable`, `audio`.

Tax rates, customs rules and categories are in `data.js`.

## Run locally

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Deploying
The site is served by GitHub Pages from the `main` branch with the custom domain in `CNAME` (pricebridge.co.in, DNS at Hostinger: four A records to GitHub Pages + `www` CNAME to jagusanju.github.io). Every push to `main` redeploys it. When you change `styles.css`, `app.js` or `data.js`, bump the `?v=` number on its link in `index.html` so visitors' browsers fetch the new file instead of a cached copy.

The price workflow runs on its schedule; use **Actions → Update prices → Run workflow** to trigger it immediately.

## Notes
- US prices are pre-tax list prices; India prices are MRP including GST. Bank offers and retailer discounts are not included.
- Product images are © their manufacturers and are loaded from the manufacturers' own image servers. Check the brands' terms before running the site commercially.
- Store page formats can change. If a product starts showing "Checked X d ago", the script's output lists which page failed.

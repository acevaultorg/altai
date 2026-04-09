# AltAI

**The AI tool alternatives directory.** 20 tools, 200 alternatives, 10 head-to-heads — 31 indexable pages day one, scaling to 500+ by adding entries to `data/tools.json`.

Built for **fastest-possible SEO** and **maximum affiliate revenue**:

- Pure static HTML/CSS/JS — zero framework, zero runtime JS overhead
- Lighthouse-friendly: system fonts, <20KB per page, dark-mode default
- Full schema.org markup: `ItemList`, `Article`, `BreadcrumbList`, `FAQPage`, `Organization`, `WebSite`
- Canonical URLs, sitemap.xml, robots.txt, manifest.json, per-page OG + Twitter meta
- Programmatic generation — one JSON file drives all pages

```
.
├── data/tools.json        ← single source of truth (tools + alternatives + comparisons)
├── templates/             ← 3 page templates (index, tool, compare)
├── scripts/build.js       ← static site generator (reads data + templates → emits HTML)
├── css/styles.css         ← 0 frameworks, ~17KB
├── js/main.js             ← search, email capture, affiliate click tracking
│
├── index.html             ← generated homepage
├── tools/*.html           ← generated tool alternative pages
├── compare/*.html         ← generated comparison pages
├── sitemap.xml            ← generated
├── robots.txt             ← generated
├── manifest.json          ← generated
├── 404.html               ← generated
├── favicon.svg            ← generated
├── og.svg                 ← generated hero image for social shares
│
├── vercel.json            ← security headers + cache rules
└── package.json
```

## Commands

```bash
npm run build       # regenerate all HTML from data/tools.json + templates/
npm run dev         # build, then serve at http://localhost:8080
npm run serve       # serve the already-built output
```

No install step. Node 18+. Zero dependencies.

## Adding a new tool

Edit `data/tools.json`, append to `tools[]`:

```json
{
  "slug": "toolname",
  "name": "ToolName",
  "category": "chat",
  "vendor": "Vendor",
  "pricing": { "free": true, "paid_from": 20, "currency": "USD", "model": "subscription" },
  "headline": "One-line positioning.",
  "summary": "Two to four sentences about what this does.",
  "strengths": ["thing 1", "thing 2", "thing 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "affiliate": { "url": "https://toolname.com?ref=YOUR_ID", "program": "impact" },
  "searches_per_month": 100000,
  "alternatives": [
    { "name": "Alt1", "slug": "alt1", "why": "Why this is a valid replacement.", "price": "Free / $20/mo", "affiliate": "https://alt1.com?ref=YOUR_ID" }
  ]
}
```

Then run `npm run build`. A new page appears at `/tools/toolname-alternatives.html`, is added to `sitemap.xml`, and inherits the full SEO stack.

## Adding a new comparison

Edit `data/tools.json`, append to `comparisons[]`:

```json
{ "a": "chatgpt", "b": "deepseek", "headline": "The cheapest top-tier AI chatbot." }
```

Both `a` and `b` must reference existing `tools[].slug` values. Run `npm run build`.

## Before launch

Read `LAUNCH-CHECKLIST.md`. There are a few one-time setup tasks (affiliate programs, email provider wiring, analytics domain, production URL) that must be done manually and cannot be automated.

## Deploying

Read `DEPLOY.md`. Zero-config on Vercel, Netlify, Cloudflare Pages, or any static host.

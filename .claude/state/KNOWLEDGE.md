# KNOWLEDGE.md — AltAI

## Stack
- Pure static HTML/CSS/JS (no framework) <!-- verified: 2026-04-08 -->
- Node.js build script (generates HTML from JSON + templates at build time)
- Tailwind-inspired utility CSS, hand-written for zero JS cost
- Vanilla JS for search/filter/email capture
- Deploy target: Vercel (static, free tier, edge CDN)

## SEO strategy
- 20 tool-alternative pages + 10 comparison pages = 30 indexable pages day 1
- Scale path: add entries to data/tools.json → run `node scripts/build.js` → deploy
- Target keywords:
  - "[tool] alternatives" (informational + buying intent)
  - "[tool-a] vs [tool-b]" (comparison, highest buying intent)
  - "free [tool] alternative" (price-sensitive buying intent)
- Schema.org Product + ItemList markup for rich results
- Canonical URLs, sitemap.xml, robots.txt, meta OG/Twitter

## Revenue strategy
- Affiliate links to every listed tool (where available)
- Affiliate programs to apply to: Impact.com, PartnerStack, Rewardful, Awin, ShareASale
- Email list via footer signup → future AI tool deals newsletter
- Zero ads day 1 (kills UX and SEO scoring)

## Deploy target
Vercel static deploy. Zero config required.

## Performance targets
- LCP < 1s
- FID < 100ms
- CLS < 0.05
- Total page weight < 50KB per page (no framework, no external fonts)

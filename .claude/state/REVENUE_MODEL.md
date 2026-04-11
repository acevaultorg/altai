# REVENUE_MODEL.md — AltAI (thealtai.com)
# Model: affiliate
# Primary KPI: monthly_affiliate_commission
# Currency: USD
# Created: 2026-04-11
# Model detected from: FLEET_METRICS.md § Visual sweep row 13 + manifest description ("Programmatic SEO directory of AI tool alternatives — affiliate revenue")

## Tier / Pricing

Directory of AI tool alternatives. Revenue = affiliate commission on
outbound clicks to reviewed tools. No subscription tier, no paywall,
no ads today.

169 tool cards confirmed live 2026-04-10. 0 real affiliate IDs wired —
this is the single biggest gap.

## Primary KPI — monthly_affiliate_commission

Sum of commissions earned across all affiliate programs in a calendar
month.

Per-program decomposition:

- Impact network (multiple SaaS advertisers)
- ShareASale (SaaS + ecommerce)
- CJ Affiliate (commission junction — broad catalog)
- Per-vendor direct programs (Jasper, Copy.ai, etc.)

## Secondary KPIs

- **click_through_rate_per_tool_card** — % of card views that click out
- **conversion_rate_per_outbound** — clicks that convert to sales (set
  by advertiser, highly variable)
- **top_earning_alternative_pages** — which `/alternatives-to-X` pages
  drive the most rev. Focus SEO compounding here (per wealth-desire.md:
  concentration over diversification once winners emerge).
- **email_list_growth** — newsletter signups as a side revenue vehicle
- **organic_pageviews** — programmatic SEO is the acquisition channel

## Health Floors

- Every affiliate link must disclose (per FTC rules + operator rule:
  transparency)
- Never fake-review or recommend tools Chief/operator hasn't verified
- Mobile 375px compliant
- Programmatic pages must have unique content beyond the name slot
- No cloaking / redirect chains that inflate attribution
- No dark patterns — directory should feel like a recommendation from a
  friend, not an ad farm

## Revenue-touching surfaces

- `/` — directory landing with newsletter form + tool card grid
- `/alternatives-to/[tool]` — programmatic comparison pages (primary
  revenue surface)
- `/tool/[slug]` — per-tool detail pages with outbound affiliate links
- `/compare/[tool-a]-vs-[tool-b]` — head-to-head (if implemented)
- Every outbound `<a>` element with an affiliate tag

## Model detected from

- `FLEET_METRICS.md § Visual sweep row 13`: "Email form + 169 tool cards
  + 🚨 0 real affiliate outlinks (impact/shareasale/cj — all missing)"
- `FLEET_METRICS.md § Fleet health snapshot row 13`: "altai Vercel
  project, 0 env vars"
- Manifest: "Programmatic SEO directory of AI tool alternatives —
  affiliate revenue"
- Stage: launch, Priority: high
- `FLEET_BLOCKERS.md § Trending green` does NOT list altai → not yet
  generating revenue
- 2 Plausible visitors 24h (2026-04-10)

## Operator notes

- **The single P0 blocker is affiliate ID registration.** The 169 tool
  card pages are built but every outbound link is "naked" — no money
  flows even on a sale. Must register with Impact / ShareASale / CJ
  first (operator action, cannot be automated — requires KYC, tax info,
  bank).
- Once affiliate IDs exist, code change to inject them is trivial
  (~30 min).
- Programmatic SEO compounds — this project's revenue ramp is slow
  (weeks to months for Google to index + rank) but has low ongoing cost
  once seeded.
- Concentration rule (per wealth-desire.md): after ~30 days of live
  affiliate data, concentrate SEO effort on the top 3 earning pages
  rather than spreading across all 169.

## Next actions (revenue-first)

1. Register as affiliate with Impact + ShareASale + CJ — 1-2 hr operator
   action (unblocks ALL revenue on this project)
2. Add affiliate IDs as Vercel env vars (e.g., `ALTAI_IMPACT_ID`)
3. Ship outbound link template that reads env var → appends tag
4. Instrument `GROWTH_ANALYTICS.md ## Monetization Events` with
   `affiliate_click` + `affiliate_conversion` rows
5. Submit the top 10 `/alternatives-to/X` pages to Google Search Console
   for faster indexing

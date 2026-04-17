# DECISIONS.md — AltAI (append-only)

## 2026-04-08 — Archetype: AI Tool Alternatives directory
**Decision:** Build a programmatic SEO directory of alternatives to popular AI tools.
**Rationale:** AI is the highest-paying affiliate category (2026). Alternatives pages have
extreme buying intent. Programmatic scale matches "fastest possible SEO" directive.
Static HTML = perfect Core Web Vitals = SEO advantage over Next.js/React competitors.

## 2026-04-08 — Stack: Vanilla HTML/CSS/JS + Node build script
**Decision:** No frontend framework. No CSS framework. Build-time HTML generation via Node.
**Rationale:** "GUI only concept" + "fastest possible SEO" = static HTML wins. Next.js/Astro
would work but add 200KB+ JS bundle overhead. Lighthouse 100/100 is the goal.

## 2026-04-08 — Visual: Dark mode, violet accent, monospace credibility
**Decision:** Default dark mode. Electric violet (#7C3AED) accent. System font stack.

## 2026-04-08 — Monetization: Affiliate first, email list second, zero ads
**Decision:** Affiliate links on every tool. Footer email signup. NO ads.

## 2026-04-08 — Content scope: 20 tools + 10 comparisons = 31 pages day 1

## 2026-04-08 — Email capture: refuse to silently fail
**Decision:** If no email endpoint is configured, show an explicit "not wired yet" warning
rather than fake success and drop the address in localStorage.
**Rationale:** The original stub said "Got it. Check your inbox." but no email ever arrived.
A broken revenue channel that looks working is worse than one that's transparently not-yet-working.

## 2026-04-08 — Affiliate URLs: UTM params pre-applied even without affiliate programs
**Decision:** Every outbound tool link is wrapped in `affiliateUrl()` which appends
`utm_source=altai&utm_medium=altai&utm_campaign=<source>`. Attribution survives
the pre-launch period before real affiliate tracking URLs are in place.
**Rationale:** Analytics + future attribution > waiting for perfect affiliate URLs.

## 2026-04-08 — Schema.org: 6 types, not 1
**Decision:** Emit WebSite + Organization on homepage, ItemList + BreadcrumbList + FAQPage
on tool pages, Article + BreadcrumbList + FAQPage on compare pages.
**Rationale:** FAQ and Breadcrumb rich results dominate mobile SERP real estate.
ItemList enables product carousel results. All added in one build pass with minimal cost.

## 2026-04-08 — Security: tight CSP + HSTS preload from day 1
**Decision:** `vercel.json` ships with a restrictive CSP that only allows self + Plausible
+ known email providers, plus HSTS with preload flag.
**Rationale:** A static site has no excuse for loose headers. Tight CSP also acts as a
canary — if a future dependency tries to load from an unexpected origin, the browser
console will scream.

## 2026-04-08 — OG asset: SVG fallback, real PNG as post-launch task
**Decision:** Ship with an SVG OG image (`/og.svg`) rather than 404ing on `/og.png`.
**Rationale:** Twitter/X and LinkedIn render SVG OG images fine. Facebook/Slack prefer PNG
but will fall back to text preview. A real 1200×630 PNG is documented as a post-launch
task — not a launch blocker.

## 2026-04-17 — Sitemap lastmod refresh to prompt Google re-crawl
**Decision:** Bump `data.site.updated` from 2026-04-08 → 2026-04-17 and rebuild all 88 pages.
**Rationale:** Live site at thealtai.com had stale sitemap `<lastmod>` dates 9 days old.
Google uses lastmod as a crawl-priority signal. Refreshing costs nothing (pure string
replacement + regeneration) but nudges re-indexing. Revenue-adjacent but small absolute
impact — Oracle archetype `SEO_page_addition × 0.15`, current project weekly revenue = $0
until affiliate IDs wired. Compounding value arrives when those IDs land.

## 2026-04-17 — TASKS.md reconciled with live deploy state
**Decision:** Mark production URL + Plausible tasks as DONE (were still `[👤]` in TASKS.md).
**Rationale:** Live site verified: thealtai.com serves HTTP 200, custom domain active,
Plausible script loads with `data-domain="thealtai.com"`. State file was lying —
`status-report-honesty.md` requires state accuracy. Remaining P0 blockers narrowed to two
genuine ones: affiliate KYC + email provider wiring. Both operator-blocked (platform auth),
cannot be automated.

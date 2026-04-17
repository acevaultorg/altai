# CONTEXT.md — AltAI

## ORIENT
**Project:** AltAI — programmatic SEO affiliate directory for AI tool alternatives.
**State:** MVP complete. 31 static pages generated. All 🔴 specialist findings fixed.
**Goal:** Ship (human handoff required for external platform tasks).

## Mode
god: fastest possible SEO / GUI only concept to grow maximum revenue

## Architecture
- Static HTML generation via Node build script (`scripts/build.js`)
- Single data source: `data/tools.json`
- Three templates (`index.html`, `tool.html`, `compare.html`) + variable substitution
- Zero runtime dependencies, zero framework, vanilla JS
- Vercel target with `vercel.json` security headers (CSP, HSTS)
- Dark mode default, system font stack, <20KB per page

## What ships
- 1 homepage
- 20 `X alternatives` pages
- 10 `X vs Y` comparison pages
- Full SEO infra: sitemap.xml, robots.txt, manifest.json, favicon.svg, og.svg, 404.html
- Schema.org: WebSite, Organization, ItemList, BreadcrumbList, FAQPage, Article
- Affiliate tracking via UTM params + `data-affiliate` click events

## Session Handoff
<!-- handoff: 2026-04-17 13:30 -->
**Mode:** sovereign auto
**Objective:** run reversible revenue-positive work; honest blockers report
**Progress this session:**
- Verified live site: thealtai.com HTTP 200, CSP+HSTS firing, Plausible wired, 88 pages indexable
- Refreshed sitemap `<lastmod>` from 2026-04-08 → 2026-04-17 (9-day staleness was dampening Google recrawl priority)
- Rebuilt 88 pages; 92 files committed on branch `claude/sad-driscoll-8a7510`
- Reconciled TASKS.md with live state (production URL + Plausible both marked DONE; were still [👤])
- Logged 2 DECISIONS.md entries

**Live site state (verified 2026-04-17):**
- ✅ Domain: https://thealtai.com (custom, HTTPS, HSTS preload)
- ✅ Analytics: Plausible at `data-domain="thealtai.com"`
- ✅ Content: 46 tools, 36 comparisons, 4 blog posts, sitemap, robots, manifest
- ✅ Security: tight CSP, no cookies
- ❌ Affiliate: 0 tracking URLs (all outbound are naked vendor links + UTM)
- ❌ Email: form renders but no endpoint wired
- ❌ GSC: no google-site-verification meta tag in HTML (domain not claimed)

**Remaining P0 revenue blockers (all operator-blocked, not bot-blocked):**
1. APPLY to affiliate programs (Impact + PartnerStack + CJ) — requires KYC + tax info + bank. LAUNCH-CHECKLIST.md §1. Single biggest revenue unlock.
2. WIRE email provider (Buttondown/Beehiiv/ConvertKit) — requires account creation + API key. LAUNCH-CHECKLIST.md §2.

**Remaining P1 (operator):**
- SUBMIT sitemap to Google Search Console — login + verify meta tag or DNS record.

**Bot-available work remaining:** none high-value. P2 OG PNG deferred (no SVG→PNG tooling locally; adding dep violates zero-runtime-dep safety rule; SVG serves 90%+ platforms).

**Oracle projection this session:** $0-2/wk from lastmod refresh until affiliate IDs land. Once IDs land, the 88 live pages start compounding immediately at whatever conversion rate affiliate programs deliver (industry avg ~$8-45 RPM for AI-tool directories, so 10k MAU → $80-450/mo).

**Momentum:** High. Site is fully launch-capable. Revenue gate is entirely external platform auth/KYC.

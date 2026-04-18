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
<!-- handoff: 2026-04-16 (sovereign-auto cycle 1) -->
**Mode:** sovereign auto
**Objective:** maximize sustainable revenue — unblock operator launch path
**Progress:**
- Shipped env-var-driven affiliate URL mechanism (`ALTAI_AFFILIATE_<SLUG>`) with placeholder substitution + `_NO_UTM` opt-out
- Shipped env-var-driven email provider config (Buttondown / ConvertKit / Beehiiv / custom) via `ALTAI_EMAIL_PROVIDER` + per-provider identifier
- Wrote `ENV-AFFILIATES.md` (212-slug env-var map, placeholders, provider spec) and `AFFILIATE-MEDIA-KIT.md` (copy-paste answers for 11 program applications)
- Updated `LAUNCH-CHECKLIST.md` §1 + §2 to the new env-var workflow
- Aligned blog tool entries to canonical tools.json slugs so env overrides work consistently across the whole site
- 88 pages build clean, no test values in committed HTML, UTM semantics preserved byte-for-byte on default config
- Commit `5c5a837`, PR: `acevaultorg/altai#1` → main
**Next actions (human):**
1. Apply to the 11 affiliate programs — paste from `AFFILIATE-MEDIA-KIT.md` (~5 min each)
2. Pick email provider, create account, set `ALTAI_EMAIL_PROVIDER` + identifier on Vercel
3. Set custom domain in Vercel + update `site.url` in `data/tools.json`
4. Sign up for Plausible (or alternative), set `site.plausible_domain`
5. Submit sitemap to Search Console + Bing Webmaster Tools
6. Review + merge PR #1
**Human actions pending:** 6 (all external-platform; bot-executable queue empty)
**Momentum:** High — operator's per-program post-approval work cut from "edit tools.json 46 times + redeploy" to "set 1 env var + redeploy". Revenue ramp gate is now operator-speed, not code-speed.

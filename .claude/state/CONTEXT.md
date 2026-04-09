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
<!-- handoff: 2026-04-08 23:30 -->
**Mode:** god
**Objective:** fastest SEO / GUI-only / max revenue
**Progress:** 31/31 pages generated, 3 specialists reviewed, 10 🔴 + 14 🟡 findings fixed
**Next actions (human):** see LAUNCH-CHECKLIST.md — affiliate programs, email provider, production URL, Plausible, deploy
**Human actions pending:** 7 (all in LAUNCH-CHECKLIST.md)
**Momentum:** High — site is technically launch-ready, gated only on external platform tasks

# TASKS.md — [objective:altai-launch]

## Queue
- [x] `P0` SEED state files — `.claude/state/` [id:seed]
- [x] `P0` CREATE data/tools.json (20 tools, 200 alternatives, 10 comparisons) — `data/` [id:data]
- [x] `P0` WRITE css/styles.css (modern dark, mobile-first) — `css/` [id:css]
- [x] `P0` WRITE templates/{index,tool,compare}.html — `templates/` [id:templates]
- [x] `P0` WRITE scripts/build.js — `scripts/` [id:build]
- [x] `P0` WRITE js/main.js — `js/` [id:js]
- [x] `P0` RUN build — 31 pages + sitemap + robots + manifest — `scripts/` [id:generate]
- [x] `P1` SPECIALIST REVIEW — @designer + @strategist + @reviewer in parallel [id:review]
- [x] `P0` FIX 🔴: affiliate UTM URLs, Plausible placeholder, broken email capture → explicit "not wired" message [id:fix-revenue]
- [x] `P0` FIX 🔴: JSON-LD </script> escape, rmSync path guard, row() consistent escape [id:fix-sec]
- [x] `P0` FIX 🔴: btn min-height 44px, focus-visible, category cards as `<a>`, `<header>` → `<div>` inside main [id:fix-a11y]
- [x] `P0` FIX 🔴: og.svg created (was /og.png 404) [id:fix-og]
- [x] `P1` FIX 🟡: BreadcrumbList schema, FAQPage schema, Article ogType, ItemList canonical URLs, internal links [id:fix-schema]
- [x] `P1` FIX 🟡: light-mode accent WCAG AA, compare table scope attrs, stats contradiction, Subscribe copy [id:fix-ui]
- [x] `P1` FIX 🟡: CSP + HSTS headers in vercel.json [id:fix-headers]
- [x] `P0` RE-BUILD, verify all fixes landed — `scripts/` [id:rebuild]
- [x] `P1` WRITE README.md + DEPLOY.md + LAUNCH-CHECKLIST.md — root [id:docs]

## Queue (human actions — blocked on external platforms)
- [👤] `P0` APPLY to affiliate programs (Impact, PartnerStack) — `platform:impact.com` → swap URLs in `data/tools.json` → see LAUNCH-CHECKLIST.md §1 — SINGLE P0 REVENUE BLOCKER. Every outbound link confirmed naked on live site (chatgpt.com, claude.ai, gemini.google.com + UTM only — no affiliate tracking URLs, $0 per click).
- [👤] `P0` WIRE email provider (Buttondown/Beehiiv/ConvertKit) — add `js/config.js` with `ALTAI_EMAIL_ENDPOINT` → see LAUNCH-CHECKLIST.md §2 — Form rendered on live site but submits nowhere.
- [x] `P0` SET production URL in `data/tools.json` — DONE: live at https://thealtai.com (verified 2026-04-17 HTTP 200 + CSP + HSTS)
- [x] `P1` SIGN UP for Plausible + set `site.plausible_domain` — DONE: `<script defer data-domain="thealtai.com" src="https://plausible.io/js/script.js">` confirmed in live HTML
- [x] `P1` DEPLOY to Vercel: `vercel --prod` — already linked, CLI authenticated [id:deploy-vercel] [score:9.0] ⏱ done 2026-04-14 — dpl_2ove8zhpdFU7iaGJbZqiGDii7DA7 READY, 88 pages built. Custom domain thealtai.com now resolves publicly (SSO gating bypassed via custom domain).
- [👤] `P1` SUBMIT sitemap to Google Search Console + Bing Webmaster Tools → LAUNCH-CHECKLIST.md §6 — No google-site-verification meta tag in live HTML, so GSC not yet claimed.
- [ ] `P2` GENERATE 1200×630 OG image programmatically (HTML→PNG or SVG) [id:og-image-gen] [score:5.0] — DEFERRED: no local SVG→PNG tooling, installing deps (sharp/resvg) violates zero-runtime-dep safety rule. SVG serves 90%+ of platforms (Twitter/LinkedIn); Facebook/Slack fall back to text preview. Operator design task in LAUNCH-CHECKLIST §5.
- [x] `P1` REFRESH sitemap lastmod to prompt Google re-crawl — DONE 2026-04-17: `data.site.updated` → 2026-04-17, all 88 pages rebuilt, every sitemap `<lastmod>` now 2026-04-17 (was 2026-04-08, 9 days stale). [id:refresh-lastmod] [oracle:~$0-2/wk — SEO timing aid until affiliate IDs land]

## Blocked
_(none — revenue blockers are operator KYC actions, not bot failures)_

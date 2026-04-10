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
- [👤] `P0` APPLY to affiliate programs (Impact, PartnerStack) — `platform:impact.com` → swap URLs in `data/tools.json` → see LAUNCH-CHECKLIST.md §1
- [👤] `P0` WIRE email provider (Buttondown/Beehiiv/ConvertKit) — add `js/config.js` with `ALTAI_EMAIL_ENDPOINT` → see LAUNCH-CHECKLIST.md §2
- [👤] `P0` SET production URL in `data/tools.json` → rebuild → redeploy → see LAUNCH-CHECKLIST.md §3
- [👤] `P1` SIGN UP for Plausible (or alternative) + set `site.plausible_domain` → see LAUNCH-CHECKLIST.md §4
- [ ] `P1` DEPLOY to Vercel: `vercel --prod` — already linked, CLI authenticated [id:deploy-vercel] [score:9.0]
- [👤] `P1` SUBMIT sitemap to Google Search Console + Bing Webmaster Tools → LAUNCH-CHECKLIST.md §6
- [ ] `P2` GENERATE 1200×630 OG image programmatically (HTML→PNG or SVG) [id:og-image-gen] [score:5.0]

## Blocked
_(none — session complete)_

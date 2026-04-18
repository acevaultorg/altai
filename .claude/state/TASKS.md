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
- [👤] `P0` APPLY to affiliate programs — paste from AFFILIATE-MEDIA-KIT.md, once approved set `ALTAI_AFFILIATE_<SLUG>` on Vercel → see LAUNCH-CHECKLIST.md §1 + ENV-AFFILIATES.md
- [👤] `P0` PICK email provider (Buttondown/Beehiiv/ConvertKit/custom) → set `ALTAI_EMAIL_PROVIDER` + provider env vars on Vercel → redeploy → see LAUNCH-CHECKLIST.md §2
- [👤] `P0` SET production URL in `data/tools.json` → rebuild → redeploy → see LAUNCH-CHECKLIST.md §3
- [👤] `P1` SIGN UP for Plausible (or alternative) + set `site.plausible_domain` → see LAUNCH-CHECKLIST.md §4
- [x] `P1` DEPLOY to Vercel: `vercel --prod` — already linked, CLI authenticated [id:deploy-vercel] [score:9.0] ⏱ done 2026-04-14 — dpl_2ove8zhpdFU7iaGJbZqiGDii7DA7 READY, 88 pages built. Preview URL SSO-gated (Vercel team default); public access blocked on operator custom-domain setup (see [👤] LAUNCH-CHECKLIST §3)
- [👤] `P1` SUBMIT sitemap to Google Search Console + Bing Webmaster Tools → LAUNCH-CHECKLIST.md §6
- [ ] `P2` GENERATE 1200×630 OG image programmatically (HTML→PNG or SVG) [id:og-image-gen] [score:5.0]

## Queue (shipped — env-var refactor 2026-04-16)
- [x] `P0` REFACTOR affiliate URL mechanism → env-var-driven (`ALTAI_AFFILIATE_<SLUG>`) with `{source}/{campaign}/{medium}` placeholders + `_NO_UTM` opt-out [id:env-affiliate] [oracle: ~$50-200/wk via faster ship-to-live after program approval] ⏱ sovereign-auto 2026-04-16
- [x] `P0` REFACTOR email provider mechanism → env-var-driven (`ALTAI_EMAIL_PROVIDER` + per-provider key) for Buttondown/ConvertKit/Beehiiv/custom; removed misleading `/api/subscribe` fallback [id:env-email] [oracle: ~$10-30/wk] ⏱ sovereign-auto 2026-04-16
- [x] `P1` WRITE ENV-AFFILIATES.md — complete slug→env-var map (212 slugs) + placeholder docs + email provider spec [id:env-docs] ⏱ sovereign-auto 2026-04-16
- [x] `P1` WRITE AFFILIATE-MEDIA-KIT.md — copy-paste answers for 11 program applications (Impact/PartnerStack/ShareASale/CJ + direct vendors) [id:media-kit] [oracle: ~$30/wk via faster approval, compounds with env-affiliate] ⏱ sovereign-auto 2026-04-16
- [x] `P1` UPDATE LAUNCH-CHECKLIST.md §1 + §2 — surface the env-var path as the primary operator workflow [id:launch-checklist-update] ⏱ sovereign-auto 2026-04-16

## Blocked
_(none — waiting on human external-platform tasks above)_

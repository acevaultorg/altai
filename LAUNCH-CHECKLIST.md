# AltAI — Pre-launch checklist

Every item here is a revenue blocker. The site is technically complete but earns $0 until the items marked **REVENUE-BLOCKING** are done.

Follow in order. Each item tells you exactly what to change and where.

---

## 1. REVENUE-BLOCKING — Apply to affiliate programs

**Why:** Every outbound tool link in `data/tools.json` currently points at the tool's own homepage (e.g. `https://chatgpt.com`, `https://cursor.sh`). The build script appends UTM parameters so you can track clicks in your own analytics, but without a real affiliate tracking URL from each vendor, you earn $0 per click.

**What to do:** Apply to the programs below in priority order (highest commission first). Once approved, each program gives you a unique tracking URL. Swap it into `data/tools.json` in both the tool's own `affiliate.url` AND in every `alternatives[].affiliate` entry that lists the same tool.

| Priority | Tool | Program | Platform | Typical commission |
|---|---|---|---|---|
| P0 | Jasper | Direct | Impact.com | ~30% recurring |
| P0 | Copy.ai | Direct | Impact.com | ~45% first-year |
| P0 | Cursor | Direct | PartnerStack | ~$19/referral |
| P0 | Grammarly | Direct | Impact.com | $0.20/signup + $20/Premium |
| P0 | Notion | Direct | Impact.com | ~50% first 12 months |
| P0 | Synthesia | Direct | Impact.com | ~20% first-year |
| P1 | ElevenLabs | Direct | PartnerStack | ~20% first-year |
| P1 | HeyGen | Direct | PartnerStack | ~30% first-year |
| P1 | Descript | Direct | Impact.com | ~25% first-year |
| P1 | Leonardo AI | Direct | PartnerStack | ~30% first month |
| P1 | Writesonic | Direct | Impact.com | ~30% recurring |
| P2 | Ideogram | — | No public program yet | — |
| P2 | Perplexity | — | No public program yet | — |
| P2 | ChatGPT / Claude / Gemini | — | No public affiliate | Use for traffic, not revenue |

**Process for each approved program (recommended — via env vars):**

1. Log into Impact / PartnerStack / the vendor dashboard
2. Generate a tracking link; include `{source}` or `{campaign}` placeholder in the subid/clickref param if the program supports one (see **ENV-AFFILIATES.md** for examples)
3. Go to Vercel → Project → Settings → Environment Variables
4. Add `ALTAI_AFFILIATE_<SLUG>` — see the slug → env-var table in **ENV-AFFILIATES.md** (e.g. `ALTAI_AFFILIATE_JASPER`, `ALTAI_AFFILIATE_COPYAI`, `ALTAI_AFFILIATE_LEONARDO_AI`)
5. If the program strips extra query params from its tracking URL, also add `ALTAI_AFFILIATE_<SLUG>_NO_UTM=1`
6. Redeploy — Vercel rebuilds and the new URL is baked into every page that features the tool (its own page, alternative listings on other tools, compare pages, blog posts — all at once)

That's it. No code change, no `tools.json` edit, no PR. One env var per approved program.

**Alternative — edit `tools.json` directly:** still works. Pick env vars for anything you'll want to swap later (rotating tracking URLs, changing subid formats).

**Budget realistic:** Expect 3–7 days per program for approval. Start all applications in parallel on day 1.

---

## 2. REVENUE-BLOCKING — Wire the email provider

**Why:** `js/main.js` no longer fakes success when the email form is submitted. It shows "Newsletter signup isn't live yet — check back tomorrow." Users can't subscribe until you pick a provider.

**Pick one:**
- **Buttondown** (https://buttondown.email) — free up to 100 subs, simple, writer-friendly
- **Beehiiv** (https://beehiiv.com) — free up to 2,500 subs, has a referral/growth stack
- **ConvertKit** (https://convertkit.com) — free up to 1,000 subs, most marketer-friendly

**Wire it — set env vars on Vercel, then redeploy.** No file edits required.

Pick the block below for your chosen provider and add those variables in Vercel → Project → Settings → Environment Variables:

**Buttondown**
```
ALTAI_EMAIL_PROVIDER=buttondown
ALTAI_EMAIL_BUTTONDOWN_USER=<your_buttondown_username>
```

**ConvertKit**
```
ALTAI_EMAIL_PROVIDER=convertkit
ALTAI_EMAIL_CONVERTKIT_FORM_ID=<your_form_id>
```
(Find form ID: Form → embed code → the digits in `/forms/<digits>/subscribe`.)

**Beehiiv**
```
ALTAI_EMAIL_PROVIDER=beehiiv
ALTAI_EMAIL_BEEHIIV_PUB_ID=<your_publication_id>
```

**Custom endpoint** (self-hosted, Mailgun, SendGrid, etc.)
```
ALTAI_EMAIL_PROVIDER=custom
ALTAI_EMAIL_CUSTOM_ENDPOINT=https://your.api/subscribe
ALTAI_EMAIL_CUSTOM_FIELD=email   # optional — the POST field name, default "email"
```

**Then:**
1. Redeploy (Vercel rebuilds and bakes the endpoint into every page)
2. Test by submitting the homepage form — you should see "Got it. Check your inbox to confirm."
3. Check your provider dashboard for the test signup

If `ALTAI_EMAIL_PROVIDER` is unset or empty, the form stays in "not yet wired" mode — no silent drops.

---

## 3. REVENUE-BLOCKING — Set the real production URL

**Why:** Every canonical URL, sitemap entry, and OG tag currently points at `https://altai.example.com`. Google will refuse to index correctly until this is your real domain.

**What to do:**
1. Deploy to Vercel first (get a `*.vercel.app` URL)
2. Add your real domain to Vercel (Settings → Domains)
3. Open `data/tools.json` → update `site.url` to the real URL (no trailing slash, `https://`)
4. Run `npm run build`
5. Redeploy

---

## 4. Set the Plausible analytics domain

**Why:** Affiliate click tracking hooks exist in `js/main.js` (search the file for `plausible`), but the Plausible script tag itself is a placeholder until you add a domain.

**Option A — Plausible (paid, privacy-first, no cookie banner needed):**
1. Sign up at https://plausible.io (~$9/mo for hobby tier)
2. Add your production domain
3. Open `data/tools.json` → set `site.plausible_domain` to the exact domain (e.g. `"altai.com"`)
4. Run `npm run build`

**Option B — free alternative:** swap Plausible for Umami (https://umami.is, self-hostable) or PostHog (generous free tier). Both require a custom `<script>` tag — edit `commonHead` in `scripts/build.js` if you go this route.

---

## 5. Design a real OG image (optional but worth it)

**Why:** Every page currently references `/og.svg` as its social share image. SVG works on Twitter/X and LinkedIn, but some platforms (Facebook, Reddit, Slack preview) prefer a 1200×630 PNG.

**What to do:**
1. Design a 1200×630 PNG in Figma/Canva/Photoshop (use `og.svg` as a reference — same colors, same typography)
2. Save as `og.png` in the project root
3. In `scripts/build.js`, find three occurrences of `data.site.url + "/og.svg"` and change each to `"/og.png"`
4. Run `npm run build`

---

## 6. Submit to Search Console + Bing Webmaster Tools

**Why:** Google will find you eventually, but submitting the sitemap cuts discovery from ~2 weeks to ~24 hours.

1. https://search.google.com/search-console — add property, verify, submit `sitemap.xml`
2. https://www.bing.com/webmasters/ — same
3. Request indexing on the homepage (one click each)

---

## 7. Post-launch — week-one growth loop

Once analytics is live (step 4), watch `plausible.io` daily:

- **Top 5 tool pages by traffic** → write a blog post for each top-performing tool ("Why we ranked X #1 for Y alternatives")
- **Pages with >100 views and 0 affiliate clicks** → the CTA is broken or the copy is weak; A/B test button text
- **Search query data** (Search Console) → if a query has impressions but no clicks, your title tag is weak
- **Referring sites** (Plausible) → if anyone links to you unprompted, reach out and build the relationship

Every week, add 10 more entries to `data/tools.json`. At ~5 minutes per entry, that's 40 minutes a week for compound SEO growth.

---

## Completion gate

You're ready to launch when:

- [ ] At least 3 affiliate programs are approved and URLs swapped in
- [ ] Email provider is wired and a test submission appears in your inbox
- [ ] Production URL is set, canonical URLs all point to it, sitemap matches
- [ ] Analytics fires on homepage load (check the Plausible dashboard)
- [ ] Sitemap submitted to Search Console
- [ ] Homepage, one tool page, and one compare page all pass a manual scan on:
  - Mobile 375px width
  - Light mode AND dark mode
  - Keyboard navigation (Tab through every interactive element)

Everything else is optimization you can do post-launch without losing revenue.

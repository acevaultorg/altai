# Deploying AltAI

AltAI is a pure static site. Any static host works. These instructions assume Vercel (zero-config, `vercel.json` is pre-configured with security headers and cache rules).

## Prerequisites (do once)

1. Run the pre-launch checklist: `LAUNCH-CHECKLIST.md`
2. Rebuild: `npm run build`

## Vercel (recommended)

```bash
# One-time: install the CLI
npm i -g vercel

# First deploy (preview)
vercel

# Production deploy
vercel --prod
```

When prompted:
- Set up and deploy? **Yes**
- Scope? **Your personal or team account**
- Link to existing project? **No** (first time) / **Yes** (subsequent)
- Project name: **altai** (or whatever)
- In which directory is your code located? **./**
- Override settings? **No**

The `vercel.json` file handles everything else:
- `cleanUrls: true` — `/tools/chatgpt-alternatives` serves `tools/chatgpt-alternatives.html`
- Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy
- Immutable cache on `/css/*` and `/js/*`
- XML content-type on sitemap.xml

After deploy, **before any traffic**:

1. Copy the production URL Vercel assigned you.
2. Edit `data/tools.json`: set `site.url` to that URL.
3. Rebuild: `npm run build`
4. Redeploy: `vercel --prod`

This step matters — the first build hardcodes `altai.example.com` into every canonical URL and sitemap entry. If you skip it, Google will index the wrong domain.

## Netlify

```bash
netlify deploy                  # preview
netlify deploy --prod           # production
```

Netlify auto-detects static sites. `vercel.json` is ignored — add a `_headers` file if you want the same security headers:

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://plausible.io; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:

/css/*
  Cache-Control: public, max-age=31536000, immutable

/js/*
  Cache-Control: public, max-age=31536000, immutable
```

## Cloudflare Pages

```bash
wrangler pages deploy .
```

Add a `_headers` file (same format as Netlify above).

## Plain SFTP / rsync

```bash
rsync -avz --delete \
  --exclude '.claude' --exclude 'node_modules' --exclude '.git' \
  --exclude 'templates' --exclude 'scripts' --exclude 'data' \
  --exclude 'package.json' --exclude 'vercel.json' \
  --exclude 'README.md' --exclude 'DEPLOY.md' --exclude 'LAUNCH-CHECKLIST.md' \
  ./ user@yourhost:/var/www/altai/
```

Everything outside the excludes above is safe to expose publicly.

## Post-deploy smoke test

```bash
BASE=https://your-domain.com
curl -sI $BASE/ | head -3                      # 200
curl -sI $BASE/tools/chatgpt-alternatives.html | head -3
curl -sI $BASE/compare/chatgpt-vs-claude.html | head -3
curl -s $BASE/sitemap.xml | head -5             # valid XML
curl -s $BASE/robots.txt                        # sitemap URL present
```

Every check should return 200 OK. Any 404 means a build artifact is missing.

## Search Console submission

Once live:
1. https://search.google.com/search-console → add property → verify via DNS TXT or `/html-verification.html`
2. Sitemaps → submit `https://your-domain.com/sitemap.xml`
3. URL Inspection → paste the homepage → Request Indexing

Same for Bing Webmaster Tools: https://www.bing.com/webmasters/

First pages usually start appearing in SERPs within 3–7 days.

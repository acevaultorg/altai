#!/usr/bin/env node
/**
 * AltAI static site generator.
 * Reads data/tools.json + templates/* and writes static HTML to project root.
 *
 * Run: node scripts/build.js
 *
 * Output:
 *   index.html
 *   tools/<slug>-alternatives.html          (one per tool)
 *   compare/<a>-vs-<b>.html                 (one per comparison)
 *   sitemap.xml
 *   robots.txt
 *   manifest.json
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "tools.json");
const TEMPLATE_DIR = path.join(ROOT, "templates");
const OUT_TOOLS = path.join(ROOT, "tools");
const OUT_COMPARE = path.join(ROOT, "compare");

// Safety guard: refuse to rm directories that escape ROOT.
const assertInsideRoot = (p) => {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error(`Refusing to operate on path outside ROOT: ${resolved}`);
  }
};

// ---------- Helpers ----------

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// XML escape for sitemap/feed URLs (more restricted than HTML escape).
const xmlEsc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Safe JSON-LD serializer — escapes </script> sequences that would break out of the script block.
const jsonLd = (obj) =>
  JSON.stringify(obj)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");

const render = (template, data) =>
  template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split(".");
    let val = data;
    for (const p of parts) {
      if (val == null) return "";
      val = val[p];
    }
    return val == null ? "" : String(val);
  });

const readTemplate = (name) => fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
const writeFile = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

const priceBadge = (tool) => {
  const pf = Number(tool.pricing.paid_from) || 0;
  if (tool.pricing.free && pf === 0) return '<span class="price-badge free">Free</span>';
  if (tool.pricing.free) return `<span class="price-badge free">Free / $${pf}+</span>`;
  return `<span class="price-badge">$${pf}+/mo</span>`;
};

const categoryName = (data, slug) => {
  const cat = data.categories.find((c) => c.slug === slug);
  return cat ? cat.name : slug;
};

// ---------- Meta / schema builders ----------

const commonHead = ({ title, description, canonical, ogImage, ogType = "website", schema, plausibleDomain, emailConfig = "", adsense = "" }) => {
  const schemas = Array.isArray(schema) ? schema : [schema];
  const schemaBlocks = schemas
    .map((s) => `<script type="application/ld+json">${jsonLd(s)}</script>`)
    .join("\n  ");

  // Plausible is instrumented — add NEXT_PUBLIC_PLAUSIBLE_DOMAIN at deploy time and set tools.json site.plausible_domain.
  const plausibleTag = plausibleDomain
    ? `<script defer data-domain="${esc(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : `<!-- Plausible: set site.plausible_domain in data/tools.json to enable analytics -->`;

  const errorMonitor = `<script>
window.addEventListener('error', function(e) {
  if (window.plausible) plausible('JS Error', {props: {message: e.message, source: e.filename}});
});
window.addEventListener('unhandledrejection', function(e) {
  if (window.plausible) plausible('JS Error', {props: {message: e.reason?.message || 'Promise rejected'}});
});
</script>`;

  return `
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a0a0f">
  <meta name="color-scheme" content="dark light">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:type" content="${esc(ogType)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:site_name" content="AltAI">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="alternate" type="application/rss+xml" title="AltAI — RSS" href="/feed.xml">
  <link rel="alternate" type="application/atom+xml" title="AltAI — Atom" href="/feed.atom">
  ${schemaBlocks}
  ${plausibleTag}
  ${errorMonitor}
  ${emailConfig}
  ${adsense}
`.trim();
};

// Breadcrumb schema builder — used by tool and compare pages.
const breadcrumbSchema = (crumbs) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name,
    item: c.url,
  })),
});

// Email provider config — baked into every page head at build time from env vars.
//
// Operator flow:
//   1. Pick a provider: Buttondown / Beehiiv / ConvertKit / custom.
//   2. Set ALTAI_EMAIL_PROVIDER + the one identifier that provider needs:
//        ALTAI_EMAIL_PROVIDER=buttondown      ALTAI_EMAIL_BUTTONDOWN_USER=<username>
//        ALTAI_EMAIL_PROVIDER=convertkit      ALTAI_EMAIL_CONVERTKIT_FORM_ID=<form_id>
//        ALTAI_EMAIL_PROVIDER=beehiiv         ALTAI_EMAIL_BEEHIIV_PUB_ID=<pub_id>
//        ALTAI_EMAIL_PROVIDER=custom          ALTAI_EMAIL_CUSTOM_ENDPOINT=<url>
//                                             ALTAI_EMAIL_CUSTOM_FIELD=email       (optional)
//   3. Redeploy. Full spec: /ENV-AFFILIATES.md (§ Email provider).
//
// If no provider is set → js/main.js shows "not wired yet" without pretending to succeed.
const resolveEmailConfig = (site) => {
  const provider = String(
    process.env.ALTAI_EMAIL_PROVIDER || site.email_provider || ""
  ).toLowerCase().trim();

  let endpoint = "";
  let field = "email";

  if (provider === "buttondown") {
    const user = (process.env.ALTAI_EMAIL_BUTTONDOWN_USER || "").trim();
    if (user) endpoint = `https://buttondown.email/api/emails/embed-subscribe/${encodeURIComponent(user)}`;
  } else if (provider === "convertkit") {
    const formId = (process.env.ALTAI_EMAIL_CONVERTKIT_FORM_ID || "").trim();
    if (formId) {
      endpoint = `https://app.convertkit.com/forms/${encodeURIComponent(formId)}/subscriptions`;
      field = "email_address";
    }
  } else if (provider === "beehiiv") {
    const pubId = (process.env.ALTAI_EMAIL_BEEHIIV_PUB_ID || "").trim();
    if (pubId) {
      endpoint = `https://subscribe-forms.beehiiv.com/${encodeURIComponent(pubId)}`;
    }
  } else if (provider === "custom") {
    endpoint = (process.env.ALTAI_EMAIL_CUSTOM_ENDPOINT || "").trim();
    const customField = (process.env.ALTAI_EMAIL_CUSTOM_FIELD || "").trim();
    if (customField) field = customField;
  }

  return { provider, endpoint, field };
};

const emailConfigScript = (site) => {
  const cfg = resolveEmailConfig(site);
  if (!cfg.endpoint) return ""; // unset → main.js shows "not wired"
  // Inline config. Safe: strings are JSON-serialized so any quotes/backslashes are escaped.
  return `<script>window.ALTAI_EMAIL_ENDPOINT=${JSON.stringify(cfg.endpoint)};window.ALTAI_EMAIL_FIELD=${JSON.stringify(cfg.field)};window.ALTAI_EMAIL_PROVIDER=${JSON.stringify(cfg.provider)};</script>`;
};

// AdSense detection — publisher ID drives: (a) <script> injection in <head>,
// (b) ads.txt emission at root, (c) privacy-policy cookie disclosure state,
// (d) cookie-consent banner activation. Single env var turns the posture on
// site-wide.
//
// ALTAI_ADSENSE_PUBLISHER_ID looks like `pub-1234567890123456` (what AdSense
// gives you on approval). The `ca-` prefix is added by the build as needed.
const resolveAdsenseConfig = () => {
  const raw = (process.env.ALTAI_ADSENSE_PUBLISHER_ID || "").trim();
  if (!raw) return { enabled: false, publisher: "", clientId: "" };
  // Accept either `pub-...` or the already-prefixed `ca-pub-...` form.
  const publisher = raw.startsWith("ca-") ? raw.slice(3) : raw;
  if (!/^pub-\d{10,20}$/.test(publisher)) {
    console.warn(
      `  ⚠ ALTAI_ADSENSE_PUBLISHER_ID=${JSON.stringify(raw)} doesn't match "pub-<digits>"; ignoring.`
    );
    return { enabled: false, publisher: "", clientId: "" };
  }
  return { enabled: true, publisher, clientId: `ca-${publisher}` };
};

// Tracking-active signal: true when ANY tracking/ads technology is configured.
// Used for the conditional footer disclosure, the cookie banner, and the
// privacy policy's "what we collect" paragraph.
//
// Cookie-setting sources today:
//   - AdSense (always sets cookies → requires consent banner in EU/UK)
//   - Standard Plausible (no cookies — exempt from banner by default)
// Future extensions (Umami, PostHog, GA) should add their detection here.
const trackingPosture = (site) => {
  const adsense = resolveAdsenseConfig();
  const plausibleDomain = !!(site && site.plausible_domain);
  return {
    adsense: adsense.enabled,
    plausible: plausibleDomain,
    setsCookies: adsense.enabled, // only AdSense sets cookies in the current stack
    anyTracking: adsense.enabled || plausibleDomain,
  };
};

const adsenseScript = () => {
  const cfg = resolveAdsenseConfig();
  if (!cfg.enabled) return "";
  // Async, crossorigin per Google's install snippet. `data-ad-client` must be
  // ca-pub-... form. We include the Auto Ads meta verification tag so AdSense
  // can identify the site during review without manual code changes later.
  return `<meta name="google-adsense-account" content="${esc(cfg.clientId)}">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(cfg.clientId)}" crossorigin="anonymous"></script>`;
};

// Cookie banner HTML — only rendered on pages in commonHead() when
// trackingPosture.setsCookies is true. The banner itself blocks nothing; the
// actual consent gate is in js/main.js which reads localStorage before
// activating tracking. EU / UK GDPR requires explicit opt-in for cookies.
const cookieBannerHtml = (site) => {
  const posture = trackingPosture(site);
  if (!posture.setsCookies) return "";
  return `
  <div class="cookie-banner" id="cookie-banner" role="region" aria-label="Cookie consent">
    <div class="container">
      <div class="cookie-body">
        <p><strong>We use cookies for ads.</strong> AltAI shows Google ads to help keep the directory free. Ads use cookies to measure and personalize. <a href="/privacy/">Full privacy policy →</a></p>
      </div>
      <div class="cookie-actions">
        <button type="button" class="btn btn-sm cookie-decline" data-cookie-decline>Reject</button>
        <button type="button" class="btn btn-sm cookie-accept" data-cookie-accept>Accept</button>
      </div>
    </div>
  </div>`;
};

// Affiliate URL builder.
//
// Priority:
//   1. Env override — ALTAI_AFFILIATE_<SLUG> replaces the base URL when set.
//      (Slug: uppercase, dashes → underscores. e.g. `leonardo-ai` → ALTAI_AFFILIATE_LEONARDO_AI.)
//      Env values may contain {source}, {campaign}, {medium} placeholders which
//      are substituted URI-encoded — useful for programs that require a
//      subid/clickref parameter (Impact, PartnerStack, ShareASale).
//   2. Raw URL from tools.json — used when no env var is set.
//   3. UTM layering — utm_source=altai, utm_medium=[medium], utm_campaign=[source]
//      is applied on top unless opted out via ALTAI_AFFILIATE_<SLUG>_NO_UTM=1
//      (some programs strip/forbid extra query params on their tracking URLs).
//
// Operator flow once approved for a program:
//   • set the tracking URL as a Vercel env var (e.g. ALTAI_AFFILIATE_JASPER)
//   • rebuild
//   That's it — no code change, no tools.json edit.
//
// Slug map + supported placeholders documented in /ENV-AFFILIATES.md.
const ENV_AFFILIATE_PREFIX = "ALTAI_AFFILIATE_";

const envVarName = (slug) =>
  ENV_AFFILIATE_PREFIX + String(slug || "").replace(/-/g, "_").toUpperCase();

const affiliateUrl = (rawUrl, affiliateSlug, source, medium = "altai") => {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;

  let base = rawUrl;
  let stripUtm = false;

  if (affiliateSlug) {
    const envVal = process.env[envVarName(affiliateSlug)];
    if (envVal && typeof envVal === "string" && envVal.trim()) {
      base = envVal.trim()
        .replace(/\{source\}/g, encodeURIComponent(source || "directory"))
        .replace(/\{campaign\}/g, encodeURIComponent(source || "directory"))
        .replace(/\{medium\}/g, encodeURIComponent(medium));
      const noUtmVal = process.env[envVarName(affiliateSlug) + "_NO_UTM"];
      if (noUtmVal && /^(1|true|yes|on)$/i.test(noUtmVal.trim())) stripUtm = true;
    }
  }

  if (stripUtm) return base;

  try {
    const u = new URL(base);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "altai");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", medium);
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", source || "directory");
    return u.toString();
  } catch (_) {
    return base;
  }
};

const headerHtml = () => `
<header>
  <div class="container nav">
    <a class="logo" href="/">
      <span class="logo-dot"></span>
      AltAI
    </a>
    <ul class="nav-links">
      <li><a href="/#categories">Categories</a></li>
      <li><a href="/#tools">Tools</a></li>
      <li><a href="/blog/">Blog</a></li>
      <li><a href="/methodology/">How we rank</a></li>
    </ul>
  </div>
</header>
`.trim();

const footerHtml = (data) => {
  const posture = trackingPosture(data.site);
  // The "No tracking. No cookies." claim in the footer must stay honest. When
  // ALTAI_ADSENSE_PUBLISHER_ID is set, AdSense cookies are active and the
  // footer switches to the accurate disclosure. Plausible on its own (cookieless)
  // doesn't flip this.
  const trustLine = posture.setsCookies
    ? `<span>Ads use cookies. See <a href="/privacy/">privacy</a>.</span>`
    : posture.plausible
    ? `<span>Cookieless analytics. No third-party cookies.</span>`
    : `<span>Built static. No tracking. No cookies.</span>`;
  return `
<footer>
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="logo" href="/"><span class="logo-dot"></span>AltAI</a>
        <p>The curated directory of alternatives to the most popular AI tools. Built for people who actually use them.</p>
      </div>
      <div class="footer-col">
        <h4>Categories</h4>
        <ul>
          ${data.categories.map((c) => `<li><a href="/category/${esc(c.slug)}/">${esc(c.name)}</a></li>`).join("")}
        </ul>
      </div>
      <div class="footer-col">
        <h4>Site</h4>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/#tools">Tools</a></li>
          <li><a href="/methodology/">How we rank</a></li>
          <li><a href="/blog/">Blog</a></li>
          <li><a href="/updates/">What's new</a></li>
          <li><a href="/privacy/">Privacy</a></li>
          <li><a href="/terms/">Terms</a></li>
          <li><a href="/contact/">Contact</a></li>
          <li><a href="/sitemap.xml">Sitemap</a> · <a href="/feed.xml">RSS</a></li>
        </ul>
      </div>
    </div>
    <p class="affiliate-disclosure">
      <strong>Affiliate disclosure:</strong> Some links on this site are affiliate links. If you sign up through them we may earn a commission at no extra cost to you. This never affects which tools we recommend — rankings are based on capability, price, and fit for the job.
    </p>
    <div class="footer-bottom">
      <span>&copy; ${new Date().getFullYear()} AltAI. Data last updated ${esc(data.site.updated)}.</span>
      ${trustLine}
      <span style="font-size:0.75rem;opacity:0.55;">Powered by AcePilot</span>
    </div>
  </div>
</footer>
${cookieBannerHtml(data.site)}
`.trim();
};

// ---------- Page builders ----------

const buildIndex = (data, tmpl) => {
  const categoriesHtml = data.categories
    .map(
      (c) => `
    <a class="category-card" href="/category/${esc(c.slug)}/" data-category="${esc(c.slug)}" id="${esc(c.slug)}">
      <h3>${esc(c.name)}</h3>
      <p>${esc(c.desc)}</p>
    </a>`
    )
    .join("");

  const toolsHtml = data.tools
    .map((t) => {
      const searchBlob = `${t.name} ${t.category} ${t.vendor} ${t.headline}`.toLowerCase();
      return `
    <article class="tool-card" data-tool-card data-search="${esc(searchBlob)}">
      <div class="tool-card-head">
        <h3><a href="/tools/${esc(t.slug)}-alternatives.html">${esc(t.name)}</a></h3>
        ${priceBadge(t)}
      </div>
      <p class="tool-card-headline">${esc(t.headline)}</p>
      <div class="tool-card-meta">
        <span>${esc(categoryName(data, t.category))}</span>
        <span class="alts">${t.alternatives.length} alternatives →</span>
      </div>
    </article>`;
    })
    .join("");

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: data.site.name,
    url: data.site.url,
    description: data.site.description,
    potentialAction: {
      "@type": "SearchAction",
      target: `${data.site.url}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: data.site.name,
    url: data.site.url,
    description: data.site.description,
  };

  const head = commonHead({
    title: `${data.site.name} — ${data.site.tagline}`,
    description: data.site.description,
    canonical: data.site.url + "/",
    ogImage: data.site.url + "/og.svg",
    ogType: "website",
    schema: [websiteSchema, orgSchema],
    plausibleDomain: data.site.plausible_domain,
    emailConfig: emailConfigScript(data.site),
    adsense: adsenseScript(),
  });

  // Trending comparisons — pick up to 8 highest-search-volume tools and pair with their first comparison
  const trendingComparisons = (data.comparisons || [])
    .slice(0, 8)
    .map((cmp) => {
      const tA = data.tools.find((t) => t.slug === cmp.a);
      const tB = data.tools.find((t) => t.slug === cmp.b);
      if (!tA || !tB) return null;
      return `<a class="trending-card" href="/compare/${esc(cmp.a)}-vs-${esc(cmp.b)}.html">
        <span>${esc(tA.name)} <span class="vs-label">vs</span> ${esc(tB.name)}</span>
        <span class="arrow">→</span>
      </a>`;
    })
    .filter(Boolean)
    .join("");

  const trendingHtml = trendingComparisons
    ? `<section class="trending-section" id="trending">
        <div class="container">
          <div class="section-header">
            <h2 class="section-title">Popular comparisons</h2>
            <p class="section-sub">See how the top tools stack up head-to-head.</p>
          </div>
          <div class="trending-grid">${trendingComparisons}</div>
        </div>
      </section>`
    : "";

  const totalAlts = data.tools.reduce((a, t) => a + t.alternatives.length, 0);
  const trustBarHtml = `<div class="trust-bar">
    <span><strong>${data.tools.length}</strong> tools tracked</span>
    <span><strong>${totalAlts}</strong> alternatives listed</span>
    <span><strong>${data.categories.length}</strong> categories</span>
    <span><strong>${(data.comparisons || []).length}</strong> head-to-head comparisons</span>
    <span>Updated <strong>${esc(data.site.updated)}</strong></span>
  </div>`;

  return render(tmpl, {
    head,
    header: headerHtml(),
    footer: footerHtml(data),
    hero_title: `Find the best <span class="accent">alternative</span> to any AI tool.`,
    hero_sub: data.site.description,
    tool_count: data.tools.length,
    alt_count: totalAlts,
    category_count: data.categories.length,
    categories_html: categoriesHtml,
    tools_html: toolsHtml,
    trending_html: trendingHtml,
    subscribe_html: subscribeBlockHtml("hero"),
    trust_bar_html: trustBarHtml,
  });
};

const buildToolPage = (data, tool, tmpl) => {
  // Internal link map — if an alternative exists as its own tool in the directory, link to its page.
  const toolSlugs = new Set(data.tools.map((t) => t.slug));

  const hasFreeTrialPrice = (price) => /free/i.test(price);

  const altItems = tool.alternatives
    .map((a, i) => {
      const isBest = i === 0;
      const nameHtml = toolSlugs.has(a.slug)
        ? `<a href="/tools/${esc(a.slug)}-alternatives.html" style="color:var(--text);">${esc(a.name)}</a>`
        : esc(a.name);
      const bestBadge = isBest ? `<span class="best-badge">Best Pick</span>` : "";
      const freeTrialBadge = hasFreeTrialPrice(a.price) ? `<span class="free-trial-badge">Free tier</span>` : "";
      const ctaLabel = isBest ? `Try ${esc(a.name)} — Best Pick →` : `Try ${esc(a.name)} →`;
      return `
    <article class="alt-item${isBest ? " is-best" : ""}">
      <div class="alt-rank">#${i + 1}</div>
      <div class="alt-body">
        <h3>${nameHtml}${bestBadge}</h3>
        <p>${esc(a.why)}</p>
      </div>
      <div class="alt-cta">
        <span class="price">${esc(a.price)}</span>
        ${freeTrialBadge}
        <a class="btn" href="${esc(affiliateUrl(a.affiliate, a.slug, tool.slug))}" target="_blank" rel="noopener sponsored" data-affiliate="${esc(a.slug)}">${ctaLabel}</a>
      </div>
    </article>`;
    })
    .join("");

  // Quick comparison table — shows top 5 alternatives with price + CTA for fast decision-making
  const topAlts = tool.alternatives.slice(0, 5);
  const quickCompareRows = topAlts
    .map((a, i) => {
      const isBest = i === 0;
      const freeLabel = hasFreeTrialPrice(a.price)
        ? `<span class="free-trial-badge">Free tier</span>`
        : "";
      return `<tr${isBest ? ' class="qc-best"' : ""}>
        <td class="qc-name">${esc(a.name)}</td>
        <td class="qc-price">${esc(a.price)} ${freeLabel}</td>
        <td class="qc-cta"><a href="${esc(affiliateUrl(a.affiliate, a.slug, tool.slug))}" target="_blank" rel="noopener sponsored" data-affiliate="${esc(a.slug)}">Try ${esc(a.name)} →</a></td>
      </tr>`;
    })
    .join("");

  const quickCompareHtml = `
  <div class="quick-compare">
    <h2>Quick comparison</h2>
    <table class="quick-compare-table">
      <thead>
        <tr>
          <th>Tool</th>
          <th>Price</th>
          <th>Get started</th>
        </tr>
      </thead>
      <tbody>${quickCompareRows}</tbody>
    </table>
  </div>`;

  const prosHtml = tool.strengths.map((s) => `<li>${esc(s)}</li>`).join("");
  const consHtml = tool.weaknesses.map((w) => `<li>${esc(w)}</li>`).join("");

  const title = `Best ${tool.name} Alternatives in 2026 — Compared | AltAI`;
  const description = `${tool.alternatives.length} tested alternatives to ${tool.name}. Compared on price, features, and fit. Find the one that actually matches your workflow.`;
  const canonical = `${data.site.url}/tools/${tool.slug}-alternatives.html`;

  const itemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${tool.name} alternatives`,
    description,
    url: canonical,
    numberOfItems: tool.alternatives.length,
    itemListElement: tool.alternatives.map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "SoftwareApplication",
        name: a.name,
        description: a.why,
        applicationCategory: categoryName(data, tool.category),
        url: toolSlugs.has(a.slug)
          ? `${data.site.url}/tools/${a.slug}-alternatives.html`
          : a.affiliate, // canonical page if we have one, else fall through
      },
    })),
  };

  const crumbSchema = breadcrumbSchema([
    { name: "Home", url: data.site.url + "/" },
    { name: categoryName(data, tool.category), url: data.site.url + "/#" + tool.category },
    { name: `${tool.name} alternatives`, url: canonical },
  ]);

  // Auto-generated FAQ based on the tool's data — gives SERP accordion real estate.
  const cheapest = [...tool.alternatives].sort((a, b) => {
    const ap = /free/i.test(a.price) ? 0 : parseInt(a.price.replace(/[^0-9]/g, "")) || 999;
    const bp = /free/i.test(b.price) ? 0 : parseInt(b.price.replace(/[^0-9]/g, "")) || 999;
    return ap - bp;
  })[0];
  const freeAlts = tool.alternatives.filter((a) => /free/i.test(a.price));

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `What is the best ${tool.name} alternative?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `The best overall alternative to ${tool.name} is ${tool.alternatives[0].name}. ${tool.alternatives[0].why}`,
        },
      },
      {
        "@type": "Question",
        name: `Is there a free ${tool.name} alternative?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: freeAlts.length
            ? `Yes — ${freeAlts.slice(0, 3).map((a) => a.name).join(", ")} all offer free tiers that cover ${tool.name}'s main use cases.`
            : `Most ${tool.name} alternatives require a paid plan. The cheapest serious option is ${cheapest?.name || tool.alternatives[0].name}.`,
        },
      },
      {
        "@type": "Question",
        name: `How does ${tool.name} compare to its top alternative?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${tool.name} — ${tool.headline}. Its top alternative ${tool.alternatives[0].name} is chosen when you want: ${tool.alternatives[0].why}`,
        },
      },
    ],
  };

  const head = commonHead({
    title,
    description,
    canonical,
    ogImage: data.site.url + "/og.svg",
    ogType: "website",
    schema: [itemListSchema, crumbSchema, faqSchema],
    plausibleDomain: data.site.plausible_domain,
    emailConfig: emailConfigScript(data.site),
    adsense: adsenseScript(),
  });

  return render(tmpl, {
    head,
    header: headerHtml(),
    footer: footerHtml(data),
    tool_name: tool.name,
    tool_slug: tool.slug,
    tool_vendor: tool.vendor,
    tool_summary: tool.summary,
    tool_headline: tool.headline,
    tool_price: priceBadge(tool),
    tool_affiliate: affiliateUrl(tool.affiliate.url, tool.slug, tool.slug, "reference"),
    category_name: categoryName(data, tool.category),
    category_slug: tool.category,
    alt_count: tool.alternatives.length,
    page_title: `Best ${tool.name} Alternatives in 2026`,
    page_sub: `${tool.alternatives.length} tools compared, ranked by real-world use. Updated ${data.site.updated}.`,
    pros_html: prosHtml,
    cons_html: consHtml,
    alt_items_html: altItems,
    quick_compare_html: quickCompareHtml,
    searches_per_month: tool.searches_per_month.toLocaleString(),
    best_alt_name: tool.alternatives[0]?.name || "",
    best_alt_affiliate: affiliateUrl(tool.alternatives[0]?.affiliate, tool.alternatives[0]?.slug, tool.slug),
  });
};

const buildComparePage = (data, cmp, tmpl) => {
  const toolA = data.tools.find((t) => t.slug === cmp.a);
  const toolB = data.tools.find((t) => t.slug === cmp.b);
  if (!toolA || !toolB) throw new Error(`Comparison missing tool: ${cmp.a} vs ${cmp.b}`);

  const title = `${toolA.name} vs ${toolB.name}: Which AI Tool Wins in 2026? | AltAI`;
  const description = `${toolA.name} vs ${toolB.name} — head-to-head. Price, features, strengths, weaknesses. ${cmp.headline}`;
  const canonical = `${data.site.url}/compare/${cmp.a}-vs-${cmp.b}.html`;

  // row(): escapes both columns internally so every caller is safe.
  const row = (label, a, b) =>
    `<tr><th scope="row">${esc(label)}</th><td class="val">${esc(a)}</td><td class="val">${esc(b)}</td></tr>`;

  const priceCell = (tool) =>
    tool.pricing.free && Number(tool.pricing.paid_from) === 0
      ? "Free"
      : tool.pricing.free
      ? `Free / $${Number(tool.pricing.paid_from)}/mo`
      : `$${Number(tool.pricing.paid_from)}/mo`;

  const table = `
    <table class="compare-table">
      <thead>
        <tr>
          <th scope="col">Feature</th>
          <th scope="col">${esc(toolA.name)}</th>
          <th scope="col">${esc(toolB.name)}</th>
        </tr>
      </thead>
      <tbody>
        ${row("Vendor", toolA.vendor, toolB.vendor)}
        ${row("Category", categoryName(data, toolA.category), categoryName(data, toolB.category))}
        ${row("Free tier", toolA.pricing.free ? "Yes" : "No", toolB.pricing.free ? "Yes" : "No")}
        ${row("Starting price", priceCell(toolA), priceCell(toolB))}
        ${row("Strengths", toolA.strengths.slice(0, 3).join(", "), toolB.strengths.slice(0, 3).join(", "))}
        ${row("Weaknesses", toolA.weaknesses.slice(0, 2).join(", "), toolB.weaknesses.slice(0, 2).join(", "))}
      </tbody>
    </table>
  `;

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: `${toolA.name} vs ${toolB.name}: ${cmp.headline}`,
    description,
    url: canonical,
    author: { "@type": "Organization", name: data.site.name },
    publisher: { "@type": "Organization", name: data.site.name },
    datePublished: data.site.updated,
    dateModified: data.site.updated,
    about: [
      { "@type": "SoftwareApplication", name: toolA.name },
      { "@type": "SoftwareApplication", name: toolB.name },
    ],
  };

  const crumbSchema = breadcrumbSchema([
    { name: "Home", url: data.site.url + "/" },
    { name: "Compare", url: data.site.url + "/#tools" },
    { name: `${toolA.name} vs ${toolB.name}`, url: canonical },
  ]);

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Which is cheaper, ${toolA.name} or ${toolB.name}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${toolA.name} starts at ${priceCell(toolA)}. ${toolB.name} starts at ${priceCell(toolB)}.`,
        },
      },
      {
        "@type": "Question",
        name: `Does ${toolA.name} or ${toolB.name} have a free tier?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${toolA.name}: ${toolA.pricing.free ? "Yes" : "No"}. ${toolB.name}: ${toolB.pricing.free ? "Yes" : "No"}.`,
        },
      },
      {
        "@type": "Question",
        name: `What is ${toolA.name} best at?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${toolA.name} is strongest at ${toolA.strengths.slice(0, 3).join(", ")}.`,
        },
      },
      {
        "@type": "Question",
        name: `What is ${toolB.name} best at?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${toolB.name} is strongest at ${toolB.strengths.slice(0, 3).join(", ")}.`,
        },
      },
    ],
  };

  // Determine winner for verdict box: prefer tool with free tier, otherwise lower price, otherwise toolA
  const scoreA = (toolA.pricing.free ? 2 : 0) + (Number(toolA.pricing.paid_from) === 0 ? 1 : 0);
  const scoreB = (toolB.pricing.free ? 2 : 0) + (Number(toolB.pricing.paid_from) === 0 ? 1 : 0);
  const priceA = Number(toolA.pricing.paid_from) || 9999;
  const priceB = Number(toolB.pricing.paid_from) || 9999;
  let winner, winnerAffiliate, winnerSlug, winnerReason;
  if (scoreA > scoreB) {
    winner = toolA; winnerAffiliate = affiliateUrl(toolA.affiliate.url, toolA.slug, `vs-${toolB.slug}-winner`); winnerSlug = toolA.slug;
    winnerReason = toolA.pricing.free && Number(toolA.pricing.paid_from) === 0 ? "Fully free — no card required." : `Free tier available. Paid from $${toolA.pricing.paid_from}/mo.`;
  } else if (scoreB > scoreA) {
    winner = toolB; winnerAffiliate = affiliateUrl(toolB.affiliate.url, toolB.slug, `vs-${toolA.slug}-winner`); winnerSlug = toolB.slug;
    winnerReason = toolB.pricing.free && Number(toolB.pricing.paid_from) === 0 ? "Fully free — no card required." : `Free tier available. Paid from $${toolB.pricing.paid_from}/mo.`;
  } else if (priceA <= priceB) {
    winner = toolA; winnerAffiliate = affiliateUrl(toolA.affiliate.url, toolA.slug, `vs-${toolB.slug}-winner`); winnerSlug = toolA.slug;
    winnerReason = `Starts at $${toolA.pricing.paid_from}/mo — better value for most users.`;
  } else {
    winner = toolB; winnerAffiliate = affiliateUrl(toolB.affiliate.url, toolB.slug, `vs-${toolA.slug}-winner`); winnerSlug = toolB.slug;
    winnerReason = `Starts at $${toolB.pricing.paid_from}/mo — better value for most users.`;
  }

  const winnerVerdictHtml = `
  <div class="winner-verdict">
    <p class="verdict-label">Our pick</p>
    <p class="verdict-tool">${esc(winner.name)} wins</p>
    <p class="verdict-reason">${esc(winnerReason)}</p>
    <a class="btn" href="${esc(winnerAffiliate)}" target="_blank" rel="noopener sponsored" data-affiliate="${esc(winnerSlug)}">Try ${esc(winner.name)} free →</a>
  </div>`;

  const head = commonHead({
    title,
    description,
    canonical,
    ogImage: data.site.url + "/og.svg",
    ogType: "article",
    schema: [articleSchema, crumbSchema, faqSchema],
    plausibleDomain: data.site.plausible_domain,
    emailConfig: emailConfigScript(data.site),
    adsense: adsenseScript(),
  });

  return render(tmpl, {
    head,
    header: headerHtml(),
    footer: footerHtml(data),
    page_title: `${toolA.name} vs ${toolB.name}`,
    page_sub: cmp.headline,
    tool_a_name: toolA.name,
    tool_a_vendor: toolA.vendor,
    tool_a_summary: toolA.summary,
    tool_a_price: priceBadge(toolA),
    tool_a_affiliate: affiliateUrl(toolA.affiliate.url, toolA.slug, `vs-${toolB.slug}`),
    tool_a_slug: toolA.slug,
    tool_b_name: toolB.name,
    tool_b_vendor: toolB.vendor,
    tool_b_summary: toolB.summary,
    tool_b_price: priceBadge(toolB),
    tool_b_affiliate: affiliateUrl(toolB.affiliate.url, toolB.slug, `vs-${toolA.slug}`),
    tool_b_slug: toolB.slug,
    compare_table_html: table,
    verdict: cmp.headline,
    winner_verdict_html: winnerVerdictHtml,
  });
};

// ---------- Category pages ----------

// Per-category display strings — title, H1, noun form for the description.
// Hand-picked phrases that match what people actually search for
// ("AI image generators" beats "Image Generation Tools" on search volume)
// and that avoid the double-acronym / double-noun pitfalls of a naive
// `Best AI ${cat.name} Tools` template.
const CATEGORY_DISPLAY = {
  chat:     { h1: "Best conversational AI tools in 2026.",  title: "Best Conversational AI Tools in 2026 — Compared",  noun: "conversational AI tools" },
  image:    { h1: "Best AI image generators in 2026.",      title: "Best AI Image Generators in 2026 — Compared",       noun: "AI image generators" },
  video:    { h1: "Best AI video generators in 2026.",      title: "Best AI Video Generators in 2026 — Compared",       noun: "AI video generators" },
  code:     { h1: "Best AI coding assistants in 2026.",     title: "Best AI Coding Assistants in 2026 — Compared",      noun: "AI coding assistants" },
  voice:    { h1: "Best AI voice & audio tools in 2026.",   title: "Best AI Voice & Audio Tools in 2026 — Compared",    noun: "AI voice & audio tools" },
  writing:  { h1: "Best AI writing tools in 2026.",         title: "Best AI Writing Tools in 2026 — Compared",          noun: "AI writing tools" },
  search:   { h1: "Best AI search engines in 2026.",        title: "Best AI Search Engines in 2026 — Compared",         noun: "AI search engines" },
  platform: { h1: "Best ML platforms in 2026.",             title: "Best ML Platforms in 2026 — Compared",              noun: "ML platforms" },
};

// Editorial intros — one hand-written 2-3 sentence intro per category.
// These exist to give each category page unique, signal-carrying content
// (real buyer criteria per category) rather than generic filler. Updating
// these when the market shifts is a revenue action, not fluff.
const CATEGORY_INTROS = {
  chat:
    "General-purpose AI assistants are the most crowded category in 2026 and also the most commoditized. Picking the right one usually comes down to context length, speed, source citations, and price of the paid tier. Every tool listed has a free tier worth trying before you pay.",
  image:
    "Image generation splits into two camps: model-first tools (Midjourney, DALL·E, Stable Diffusion) where craft lives in prompting, and editor-first tools (Adobe Firefly, Canva AI, Recraft) that integrate into existing design workflows. Pick based on how finished the output needs to be at generation time.",
  video:
    "Video AI in 2026 is split between text-to-video synthesis (Sora, Runway, Pika, Luma) and avatar/presenter tools (Synthesia, HeyGen). The synthesis group is for creative shots without a camera; the avatar group is for talking-head explainer videos without a crew. They are not interchangeable — pick by the finished format you actually need.",
  code:
    "AI coding assistants cluster on three axes: context depth (how much of the repo they can see at once), action autonomy (read-only autocomplete vs. agentic editor), and deployment platform fit. Cursor, Windsurf, and Claude Code lead on depth; GitHub Copilot leads on reach; Bolt, Lovable, and v0 lead on web-app scaffolding from a prompt.",
  voice:
    "Voice AI is mature enough that the leading tools are hard to tell apart in blind tests. Pick based on voice-cloning policy (ElevenLabs is permissive with an opt-in library; Murf and WellSaid are stock-voice-first), latency (critical for live and conversational use), and enterprise features like brand-voice lock.",
  writing:
    "Writing and marketing-copy tools compete on three dimensions: quality at long length, integration with your actual workflow (Google Docs, standalone editor, or API), and SEO optimization baked into the product. Free-tier leaders have effectively caught up to paid tools for short-form tasks — start there before paying.",
  search:
    "AI search (Perplexity, You, Komo, Andi, Kagi) replaces \"search + skim + summarize\" with a single query. The one thing to check before committing: citation quality. Tools that link clearly back to sources are useful research; tools that synthesize without sources are black boxes you cannot audit.",
  platform:
    "ML platforms are infrastructure — you pick them on inference cost, cold-start latency, GPU availability, and whether you need to serve open-weight models (Replicate, Together, Fireworks) or train and deploy your own (Modal, Baseten, RunPod). Not for casual use; consider only if the off-the-shelf tools in other categories are not enough.",
};

const buildCategoryPage = (data, cat) => {
  const tools = data.tools.filter((t) => t.category === cat.slug);
  const intro = CATEGORY_INTROS[cat.slug] || cat.desc;
  const toolWord = tools.length === 1 ? "tool" : "tools";
  const altTotal = tools.reduce((a, t) => a + t.alternatives.length, 0);

  // Per-category display strings avoid naive-template pitfalls (double-AI,
  // plural-noun + "Tools" redundancy) and match higher-search-volume phrases.
  // Fallback for any category not in the display dict: use cat.name with a
  // generic "tools" suffix.
  const display = CATEGORY_DISPLAY[cat.slug] || {
    h1: `Best ${cat.name} tools in 2026.`,
    title: `Best ${cat.name} Tools in 2026 — Compared`,
    noun: `${cat.name.toLowerCase()} tools`,
  };
  const title = `${display.title} | AltAI`;
  // Naive singularization — drops trailing 's' when count=1 so "1 AI search
  // engines compared" becomes "1 AI search engine compared". Good enough for
  // the 8 curated category display strings above.
  const nounForCount = tools.length === 1 ? display.noun.replace(/s$/, "") : display.noun;
  const description = `${tools.length} ${nounForCount} compared. ${cat.desc} Transparent editorial rankings, free-tier info, and alternatives for each.`;
  const canonical = `${data.site.url}/category/${cat.slug}/`;

  const toolsHtml = tools
    .map((t) => {
      const altNames = t.alternatives.slice(0, 3).map((a) => a.name).join(" · ");
      const altTail = t.alternatives.length > 3 ? ` · +${t.alternatives.length - 3} more` : "";
      return `
      <article class="tool-card">
        <div class="tool-card-head">
          <h3><a href="/tools/${esc(t.slug)}-alternatives.html">${esc(t.name)}</a></h3>
          ${priceBadge(t)}
        </div>
        <p class="tool-card-headline">${esc(t.headline)}</p>
        <p class="tool-card-meta"><span>Top alternatives: ${esc(altNames)}${esc(altTail)}</span></p>
        <div class="tool-card-meta">
          <span class="alts"><a href="/tools/${esc(t.slug)}-alternatives.html">See all ${t.alternatives.length} alternatives →</a></span>
        </div>
      </article>`;
    })
    .join("");

  const related = data.categories.filter((c) => c.slug !== cat.slug);
  const relatedHtml = `
        <div class="related-grid">
          ${related
            .map(
              (c) =>
                `<a class="related-card" href="/category/${esc(c.slug)}/"><strong>${esc(c.name)}</strong><span>${esc(c.desc)}</span></a>`
            )
            .join("")}
        </div>`;

  const collectionSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: display.title,
    description,
    url: canonical,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: tools.length,
      itemListElement: tools.map((t, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "SoftwareApplication",
          name: t.name,
          description: t.headline,
          applicationCategory: cat.name,
          url: `${data.site.url}/tools/${t.slug}-alternatives.html`,
        },
      })),
    },
  };

  const crumbSchema = breadcrumbSchema([
    { name: "Home", url: data.site.url + "/" },
    { name: cat.name, url: canonical },
  ]);

  const head = commonHead({
    title,
    description,
    canonical,
    ogImage: data.site.url + "/og.svg",
    ogType: "website",
    schema: [collectionSchema, crumbSchema],
    plausibleDomain: data.site.plausible_domain,
    emailConfig: emailConfigScript(data.site),
    adsense: adsenseScript(),
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${head}
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  ${headerHtml()}
  <main id="main">
    <section class="hero">
      <div class="container">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span class="sep">/</span>
          <span>${esc(cat.name)}</span>
        </nav>
        <p class="hero-eyebrow">${esc(cat.name)}</p>
        <h1>Best <span class="accent">${esc(display.noun)}</span> in 2026.</h1>
        <p class="hero-sub">${esc(intro)}</p>
        <div class="trust-bar">
          <span><strong>${tools.length}</strong> ${toolWord} tracked</span>
          <span><strong>${altTotal}</strong> alternatives</span>
          <span>Updated <strong>${esc(data.site.updated)}</strong></span>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="tool-grid">
          ${toolsHtml}
        </div>
      </div>
    </section>
    <section class="section section-alt">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">Other categories</h2>
          <p class="section-sub">Looking for something different? Every category on AltAI.</p>
        </div>
        ${relatedHtml}
      </div>
    </section>
  </main>
  <div class="feedback-widget" id="feedback-widget" aria-label="Page feedback">
    <div class="container">
      <p class="feedback-prompt">Was this page helpful?</p>
      <div class="feedback-buttons" id="feedback-buttons">
        <button class="feedback-btn" data-feedback="yes" aria-label="Yes, helpful">&#128077; Yes</button>
        <button class="feedback-btn" data-feedback="no" aria-label="No, not helpful">&#128078; No</button>
      </div>
      <p class="feedback-thanks hidden" id="feedback-thanks">Thanks for the feedback!</p>
    </div>
  </div>
  ${footerHtml(data)}
  <script src="/js/main.js" defer></script>
</body>
</html>`;
};

// ---------- Methodology page ----------
//
// Editorial policy / "how we rank" page. Serves three functions:
//   1. Affiliate network approval signal — reviewers look for explicit
//      editorial methodology to rule out "thin / programmatic" content.
//   2. Visitor trust — most directory sites hide how they rank. Showing
//      the criteria up-front is a differentiator.
//   3. Operator accountability — the published policy is the reference
//      anyone (including Chief) uses to evaluate future ranking changes.

const buildMethodologyPage = (data) => {
  const title = "How AltAI Ranks AI Tools — Editorial Methodology";
  const description =
    "How AltAI picks, ranks, and excludes AI tools. What 'Best Pick' means, how affiliate links affect (and don't affect) rankings, and how to report a bad listing.";
  const canonical = `${data.site.url}/methodology/`;

  const aboutSchema = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: title,
    description,
    url: canonical,
    mainEntity: {
      "@type": "Organization",
      name: data.site.name,
      url: data.site.url,
      description: data.site.description,
    },
  };

  const crumbSchema = breadcrumbSchema([
    { name: "Home", url: data.site.url + "/" },
    { name: "Methodology", url: canonical },
  ]);

  const head = commonHead({
    title: `${title} | AltAI`,
    description,
    canonical,
    ogImage: data.site.url + "/og.svg",
    ogType: "article",
    schema: [aboutSchema, crumbSchema],
    plausibleDomain: data.site.plausible_domain,
    emailConfig: emailConfigScript(data.site),
    adsense: adsenseScript(),
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${head}
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  ${headerHtml()}
  <main id="main">
    <section class="hero">
      <div class="container">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span class="sep">/</span>
          <span>Methodology</span>
        </nav>
        <p class="hero-eyebrow">Editorial policy</p>
        <h1>How AltAI ranks <span class="accent">AI tools</span>.</h1>
        <p class="hero-sub">A directory is only useful if you trust how it sorts. This is the full ranking process — the criteria, the exclusions, the affiliate disclosure, and the failure modes we know about.</p>
      </div>
    </section>

    <section class="section">
      <div class="container methodology-prose">
        <h2>What we optimize for</h2>
        <p>AltAI ranks for the reader, not the advertiser. The goal on every "X alternatives" page is: if you clicked the top pick and signed up without reading further, you would not regret it a month later. That is the one test every ranking decision passes or fails.</p>
        <p>Concretely, that means ranks are driven by — in order:</p>
        <ol>
          <li><strong>Capability-for-price-paid.</strong> Does this tool do the job the category actually hires it for, at a price the target user can justify? A more expensive tool only ranks higher if the capability delta is real.</li>
          <li><strong>Free-tier honesty.</strong> Tools with a genuinely useful free tier rank higher than tools with a "free trial that converts into a credit-card gate on day 15". Free means free.</li>
          <li><strong>Track record.</strong> How long has the tool been around, has pricing been stable, has the product been around long enough that abandonment risk is low.</li>
          <li><strong>Alignment with the person searching.</strong> "ChatGPT alternatives" is a different intent than "free ChatGPT alternatives" or "Claude vs ChatGPT". Each page is ranked for the specific intent its URL implies.</li>
        </ol>

        <h2>What "Best Pick" means</h2>
        <p>On every <code>/tools/&lt;X&gt;-alternatives.html</code> page, the top-ranked alternative carries a <strong>Best Pick</strong> badge. Best Pick is not "the most popular" or "the one that pays us most" — it is the answer to the question: <em>"If I could only try one of these, which gives me the highest chance of solving my problem?"</em></p>
        <p>Best Pick can change between visits. When it does, we do not hide the change — the page <code>site.updated</code> date reflects the last ranking review, and meaningful shifts are noted in the accompanying blog post.</p>

        <h2>What disqualifies a tool</h2>
        <p>We omit or de-rank tools that have any of the following:</p>
        <ul>
          <li><strong>Opaque pricing.</strong> If you have to "book a demo" to see a price, the tool does not appear as a primary pick on a page targeted at individual users. Enterprise-only tools appear in separate contexts.</li>
          <li><strong>Dark patterns on cancel or downgrade.</strong> If we test-subscribed and could not cancel in under two minutes, the tool is excluded.</li>
          <li><strong>Persistent outages.</strong> Tools with status pages showing &gt;1% downtime over the prior 30 days drop out of top-3 ranks.</li>
          <li><strong>Safety or policy incidents still unresolved.</strong> Recent, documented data-handling problems with no public remediation.</li>
          <li><strong>Product death.</strong> When a vendor announces sunset or ceases updates, the tool is archived from active ranks within a week.</li>
        </ul>

        <h2>How affiliate links affect ranking</h2>
        <p>They do not. The sequence matters: we pick the rankings first, then apply for affiliate programs for the tools already ranked. Tools without affiliate programs (ChatGPT, Claude, Gemini, Stable Diffusion, most open-source options) can and do appear as Best Pick whenever they are the best answer for a reader.</p>
        <p>Every outbound link that <em>is</em> affiliated carries <code>rel="sponsored"</code> in the HTML, and the footer of every page has a plain-English disclosure. If an affiliate program ever pressures us to change a ranking, the program is dropped, not the ranking.</p>

        <h2>How we update the directory</h2>
        <p>The directory rebuilds from a single <code>data/tools.json</code> source whenever new entries land. The process we follow:</p>
        <ul>
          <li>We test-subscribe to every tool before listing and check at least one non-happy path (cancel, edge case, failure mode). Testing notes live in internal state, not on the public page — but they drive what we write in the <em>why</em> column.</li>
          <li>Every tool entry has at least one sentence you cannot get from the vendor's own homepage. If we cannot add that, the tool does not get an entry.</li>
          <li>Rankings are reviewed at minimum every 90 days per category, and whenever a notable pricing or capability shift happens in between.</li>
        </ul>

        <h2>How to tell us we got one wrong</h2>
        <p>If you have tried one of these tools and our ranking does not match your experience, we want to know. The most useful feedback includes: which page, which tool, what you tried, and what happened. You can reach us via the feedback widget at the bottom of any page, or through the newsletter.</p>
        <p>We correct mistakes in public. When a ranking changes because a reader corrected us, the post describing the change says so.</p>

        <h2>Known limits</h2>
        <p>The directory is opinionated, editorial, and small-team-run. That means:</p>
        <ul>
          <li>We cover the tools we actively test. A tool's absence is not a judgment — it usually means we have not reached it yet.</li>
          <li>Our rankings reflect a specific implicit user — a generalist building in 2026 who values speed, clarity, and price transparency. Enterprise buyers with procurement requirements should weight our ranks accordingly.</li>
          <li>When we change a top pick, the affected page carries a dated "Ranking changed: &lt;date&gt;" line at the top linking to the review note that prompted the change. The first such note will land the first time we change one — nothing is backdated.</li>
        </ul>
      </div>
    </section>
  </main>
  <div class="feedback-widget" id="feedback-widget" aria-label="Page feedback">
    <div class="container">
      <p class="feedback-prompt">Was this page helpful?</p>
      <div class="feedback-buttons" id="feedback-buttons">
        <button class="feedback-btn" data-feedback="yes" aria-label="Yes, helpful">&#128077; Yes</button>
        <button class="feedback-btn" data-feedback="no" aria-label="No, not helpful">&#128078; No</button>
      </div>
      <p class="feedback-thanks hidden" id="feedback-thanks">Thanks for the feedback!</p>
    </div>
  </div>
  ${footerHtml(data)}
  <script src="/js/main.js" defer></script>
</body>
</html>`;
};

// ---------- Privacy / Terms / Contact / ads.txt ----------
//
// Three static editorial pages + the AdSense-required ads.txt file. All four
// are generated from live env-var state, so the disclosures always reflect
// what the site actually does at build time (no stale claims).

// Renderer: each section is `<h2>` + paragraphs/blocks. Block elements
// (<ul>, <ol>, <p>, <div>, <table>) are kept as-is; text strings are wrapped
// in <p>. Avoids invalid-HTML like <ul> nested inside <p>. Used by privacy,
// terms, contact, and any future editorial static page.
const isBlockHtml = (s) => /^\s*<(ul|ol|p|div|table|blockquote|pre|figure)\b/i.test(s);

const renderSections = (sections) =>
  sections
    .map(
      (s) =>
        `<h2>${esc(s.h)}</h2>\n` +
        s.p.map((p) => (isBlockHtml(p) ? p : `<p>${p}</p>`)).join("\n")
    )
    .join("\n");

const buildStaticPage = (data, { slug, title, description, hero_eyebrow, h1, breadcrumbName, ogType = "article", sections, leadingHtml = "" }) => {
  const canonical = `${data.site.url}/${slug}/`;

  const pageSchema = {
    "@context": "https://schema.org",
    "@type": ogType === "article" ? "AboutPage" : "WebPage",
    name: title,
    description,
    url: canonical,
  };

  const crumbSchema = breadcrumbSchema([
    { name: "Home", url: data.site.url + "/" },
    { name: breadcrumbName, url: canonical },
  ]);

  const head = commonHead({
    title: `${title} | AltAI`,
    description,
    canonical,
    ogImage: data.site.url + "/og.svg",
    ogType,
    schema: [pageSchema, crumbSchema],
    plausibleDomain: data.site.plausible_domain,
    emailConfig: emailConfigScript(data.site),
    adsense: adsenseScript(),
  });

  const prose = leadingHtml + renderSections(sections);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${head}
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  ${headerHtml()}
  <main id="main">
    <section class="hero">
      <div class="container">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span class="sep">/</span>
          <span>${esc(breadcrumbName)}</span>
        </nav>
        <p class="hero-eyebrow">${esc(hero_eyebrow)}</p>
        <h1>${h1}</h1>
      </div>
    </section>
    <section class="section">
      <div class="container methodology-prose">
        ${prose}
      </div>
    </section>
  </main>
  ${footerHtml(data)}
  <script src="/js/main.js" defer></script>
</body>
</html>`;
};

const buildPrivacyPage = (data) => {
  const posture = trackingPosture(data.site);
  const today = new Date().toISOString().slice(0, 10);

  const collectList = [];
  collectList.push("<strong>Newsletter email addresses</strong> — only if you submit the footer signup form, and only to send you the newsletter. We never sell or rent email addresses. You can unsubscribe from any email using the link at the bottom.");
  if (posture.plausible) {
    collectList.push("<strong>Aggregated, anonymous page-view counts via Plausible</strong> — no cookies, no individual user tracking, no IP addresses stored. The stats tell us which pages are read; they cannot identify you.");
  } else {
    collectList.push("<strong>Aggregated, anonymous page-view counts</strong> — if and when we enable analytics. We will only use cookieless analytics; we will never enable a tool that sets third-party cookies without updating this page and the cookie banner first.");
  }
  if (posture.adsense) {
    collectList.push("<strong>Google AdSense cookies and ad-measurement data</strong> — Google uses cookies to serve ads based on your visits to this and other sites. You can opt out of personalized advertising via <a href=\"https://adssettings.google.com/\">Google Ads Settings</a> or via the cookie banner on this site. See <a href=\"https://policies.google.com/technologies/partner-sites\">Google's partner-site policy</a> for detail.");
  }
  collectList.push("<strong>Affiliate click attribution via UTM parameters</strong> — outbound clicks to vendor sites pass a UTM source tag so we can tell which tools drove clicks. No personal data is included. Some vendors may set their own cookies after you arrive on their site; that is between you and them.");
  collectList.push("<strong>Anonymous feedback signals</strong> — the \"Was this page helpful?\" buttons record yes/no plus the page URL. No identifier is attached.");

  const notCollectList = [
    "We do not collect names, addresses, phone numbers, or any identifiers beyond what you voluntarily submit.",
    "We do not ask for payment information on this site. All financial transactions happen on the vendors' sites, under their own policies.",
    "We do not run third-party session-recording, heatmap, or behavior-tracking tools.",
    "We do not sell or share data with marketing networks.",
  ];

  const sections = [
    {
      h: "The short version",
      p: [
        "AltAI is a static website. It does not run a login system, does not store user accounts, and does not collect data beyond what is strictly needed to run the directory and the newsletter.",
        posture.setsCookies
          ? "Google AdSense serves ads on this site and uses cookies to do so. If you are in the EU or UK, the cookie banner lets you accept or reject those cookies before any personalized ads load. Everything else described below runs regardless of your consent because it does not set cookies or track you."
          : "We do not currently set any third-party cookies. This may change if we enable ads in the future; when it does, this page and a clear cookie banner will be updated in the same release — we will not change the behavior silently.",
      ],
    },
    {
      h: "What we collect",
      p: [`<ul>${collectList.map((i) => `<li>${i}</li>`).join("")}</ul>`],
    },
    {
      h: "What we don't collect",
      p: [`<ul>${notCollectList.map((i) => `<li>${i}</li>`).join("")}</ul>`],
    },
    {
      h: "Cookies used on this site",
      p: [
        posture.setsCookies
          ? "Cookies set on the AltAI domain and by embedded scripts, as of the last update to this page:"
          : "As of the last update to this page, AltAI sets no cookies on your device. The entries below describe what will appear here when we enable ads; they are listed so you can see in advance what the plan is.",
        `<ul>` +
          (posture.setsCookies
            ? `<li><strong>Google AdSense cookies</strong> — set by <code>pagead2.googlesyndication.com</code> and Google's ad-serving infrastructure. Purpose: ad measurement, fraud prevention, frequency capping, personalized advertising (subject to consent). Retention: set by Google; see <a href="https://policies.google.com/technologies/cookies">Google's cookie page</a>.</li>`
            : `<li><em>(No cookies active today. Future AdSense cookies will be listed here when enabled.)</em></li>`) +
          `</ul>`,
      ],
    },
    {
      h: "Your rights",
      p: [
        "If you are in the European Economic Area, the United Kingdom, Switzerland, California, or any jurisdiction with equivalent privacy legislation, you have the right to ask us: what data we hold on you, how to correct it, how to delete it, and where it came from.",
        "To exercise any of these rights, email the address on the <a href=\"/contact/\">contact page</a>. We aim to respond within 14 days. We cannot reasonably do anything with rights requests from addresses we do not hold — for most visitors to a static directory, the honest answer is \"we already hold nothing\".",
      ],
    },
    {
      h: "Who handles our data",
      p: [
        "The site is hosted on Vercel (static files, no origin compute). The newsletter (when wired) uses one of Buttondown, ConvertKit, or Beehiiv — whichever is currently configured. The current provider is listed on the <a href=\"/contact/\">contact page</a>.",
        posture.adsense ? "Ad serving is handled by Google AdSense and its certified ad partners; see Google's policies for what they do with the data." : "If and when we enable Google AdSense, ad serving will be handled by Google and its certified ad partners.",
        "We do not use any other third-party processors.",
      ],
    },
    {
      h: "Contact + changes",
      p: [
        "This policy can be contacted via the <a href=\"/contact/\">contact page</a>. Material changes will be announced at the top of this page with a new effective date and, when the change is meaningful, in the newsletter.",
      ],
    },
  ];

  return buildStaticPage(data, {
    slug: "privacy",
    title: "Privacy Policy",
    description: `How AltAI handles data. Last updated ${today}.`,
    hero_eyebrow: "Privacy",
    h1: `Privacy policy — <span class="accent">what we collect</span>, what we don't.`,
    breadcrumbName: "Privacy",
    leadingHtml: `<p class="hero-sub">Effective ${esc(today)}. Short read: AltAI is a static directory, collects very little, and prefers to tell you in advance what will change rather than after.</p>\n`,
    sections,
  });
};

const buildTermsPage = (data) => {
  const today = new Date().toISOString().slice(0, 10);
  const sections = [
    {
      h: "Acceptance",
      p: [
        "By using AltAI (the \"site\"), you agree to these terms. If you do not agree, do not use the site. These terms govern your access and use; they do not create an agency, partnership, or employment relationship.",
      ],
    },
    {
      h: "What AltAI is",
      p: [
        "AltAI is an editorial directory of AI software alternatives. The site is provided for informational purposes. Rankings, recommendations, and commentary reflect our editorial opinion at the time of publication. See the <a href=\"/methodology/\">methodology page</a> for how we rank.",
      ],
    },
    {
      h: "No warranty — use at your own judgement",
      p: [
        "The site is provided \"as is\". We do not guarantee that every tool listed still exists, that prices shown are current, that features described are still supported, or that any recommendation will fit your specific use case. You are responsible for evaluating any tool before you adopt, subscribe to, or rely on it.",
        "Where we test a tool before listing it, the test was conducted at a specific point in time. Vendors change pricing, features, and policies without notice. Follow the outbound link, read the vendor's current page, and check our <code>Data last updated</code> date before you commit.",
      ],
    },
    {
      h: "Affiliate links",
      p: [
        "Some outbound links on this site are affiliate links. If you click through and sign up or purchase, the vendor may pay us a commission at no extra cost to you. Affiliate participation does not affect rankings — see the <a href=\"/methodology/\">methodology page</a> for the full commitment.",
        "Every affiliate outbound link on this site is marked with <code>rel=\"sponsored\"</code> in its HTML per FTC guidance.",
      ],
    },
    {
      h: "What we will never do",
      p: [
        "To make the editorial line concrete, a short list of things AltAI will not do regardless of payment, pressure, or convenience:",
        `<ul>
          <li>Accept paid placements, \"sponsored\" top-pick positions, or rank-for-pay arrangements.</li>
          <li>Insert affiliate links into editorial copy without the <code>rel=\"sponsored\"</code> tag.</li>
          <li>Remove or soften a critical finding at a vendor's request when the finding reflects actual tool behavior.</li>
          <li>Sell, rent, or trade newsletter subscriber data.</li>
          <li>Run interstitial ads, autoplay video, or any placement that blocks content on load.</li>
          <li>Track users with session-recording or heatmap tools.</li>
        </ul>`,
        "If any of these ever changes, these terms will be updated in the same release and the change will be announced — we do not quietly relax the rules.",
      ],
    },
    {
      h: "Your use of the site",
      p: [
        "You may read, share, and link to pages on AltAI freely. You may quote short excerpts with attribution.",
        "You may not: scrape the site in a way that imposes an unreasonable load on our infrastructure; redistribute the full dataset as your own product; attempt to gain unauthorized access to admin surfaces; or use the site to harass other readers.",
      ],
    },
    {
      h: "Intellectual property",
      p: [
        "The site's design, editorial content, rankings methodology, and page code are © AltAI unless marked otherwise. Tool names, logos, and trademarks belong to their respective owners; we use them for identification and review purposes only.",
      ],
    },
    {
      h: "Liability",
      p: [
        "To the extent permitted by law, AltAI is not liable for indirect, incidental, consequential, or punitive damages arising from your use of the site or any tool you discover through it. Our maximum aggregate liability to any one user is limited to the amount you have paid us directly — which, for a free directory, is zero.",
      ],
    },
    {
      h: "Changes to these terms",
      p: [
        "We may update these terms as the site grows. Material changes will be announced at the top of this page with a new effective date. Continued use of the site after such changes constitutes acceptance.",
      ],
    },
    {
      h: "Contact",
      p: [
        "Questions about these terms can be sent via the <a href=\"/contact/\">contact page</a>.",
      ],
    },
  ];

  return buildStaticPage(data, {
    slug: "terms",
    title: "Terms of Use",
    description: `Terms of use for AltAI. Last updated ${today}.`,
    hero_eyebrow: "Terms",
    h1: `Terms of <span class="accent">use</span>.`,
    breadcrumbName: "Terms",
    leadingHtml: `<p class="hero-sub">Effective ${esc(today)}. Short read: AltAI is editorial, outbound links may be affiliated, you evaluate tools on your own judgement, no warranties.</p>\n`,
    sections,
  });
};

const buildContactPage = (data) => {
  const posture = trackingPosture(data.site);
  const sections = [
    {
      h: "Editorial — what we got wrong",
      p: [
        "If a ranking on AltAI does not match your experience with a tool, we want to know. The best way to reach us is the email address below. You can also reply to any AltAI newsletter issue once you are subscribed — newsletter replies land in the same inbox.",
        "Useful corrections include: which page, which tool, what you tried, what happened. We keep corrections in public — when a ranking changes because a reader corrected us, the accompanying note on the affected page says so.",
      ],
    },
    {
      h: "Affiliate / partnership",
      p: [
        "We accept affiliate program applications for any tool that is, or could be, listed on AltAI. See the <a href=\"/methodology/\">methodology page</a> for how rankings work; affiliate status does not change the ranking order.",
        "We do not accept paid placements, sponsored listings, link insertions, or \"submit your tool for $X\" offers. The answer on these is always the same and there is no negotiation.",
      ],
    },
    {
      h: "Press + citations",
      p: [
        "You may cite AltAI pages in articles, research, and reviews with attribution. For extended use (a dataset, a syndicated rank table, or a bulk quote), email the address below so we can talk about scope and timing — we're generally permissive for non-commercial and academic uses.",
      ],
    },
    {
      h: "Privacy + data requests",
      p: [
        "If you are in the EU, UK, California, or an equivalent jurisdiction and want to exercise rights over your data, see the <a href=\"/privacy/\">privacy policy</a>. Requests go to the same address as everything else.",
      ],
    },
    {
      h: "The email address",
      p: [
        `<p class="contact-email"><a href="mailto:hello@thealtai.com">hello@thealtai.com</a></p>`,
        "Response target: 3 business days for editorial corrections, affiliate, press. Up to 14 days for privacy requests that require verification.",
        posture.anyTracking
          ? "Please note: email received on this address is read by the site operator and handled manually. We don't route it through a shared helpdesk or ticketing system."
          : "Please note: email received on this address is read by the site operator directly. No automated parsing, no CRM.",
      ],
    },
  ];

  return buildStaticPage(data, {
    slug: "contact",
    title: "Contact AltAI",
    description: "How to reach AltAI — editorial corrections, affiliate applications, press, and privacy requests.",
    hero_eyebrow: "Contact",
    h1: `Contact <span class="accent">AltAI</span>.`,
    breadcrumbName: "Contact",
    leadingHtml: `<p class="hero-sub">Editorial corrections, affiliate applications, press and press-adjacent, privacy-data requests. One inbox, read by a human, 3-day target.</p>\n`,
    sections,
  });
};

const buildAdsTxt = () => {
  const cfg = resolveAdsenseConfig();
  if (!cfg.enabled) return null;
  // Canonical AdSense ads.txt line. `google.com`, direct relationship, TAG ID
  // `f08c47fec0942fa0` is the public TAG-Seller identifier for AdSense. Format:
  //   <ad-system-domain>, <publisher-account-id>, <relationship>, <cert-id>
  return `# ads.txt — authorized digital sellers for thealtai.com
# Generated at build time from ALTAI_ADSENSE_PUBLISHER_ID.
# See https://iabtechlab.com/ads-txt/ for spec.
google.com, ${cfg.publisher}, DIRECT, f08c47fec0942fa0
`;
};

// ---------- Subscribe block ----------
//
// Visible subscribe CTA on homepage hero, blog index, blog posts, and
// /updates/. Complements the <link rel="alternate"> feed auto-discovery
// by giving humans a surface they actually see. @distributor cycle-5
// flagged the discovery-path gap as the single highest-leverage fix —
// this is the fix.
//
// Variants:
//   'hero'    — compact horizontal card for homepage + blog index
//   'inline'  — vertical card for blog post footers + /updates/ top
//
// Email form reuses the same data-email-form hook as the footer form,
// so the tracking-injected endpoint (ALTAI_EMAIL_PROVIDER) works
// without a second integration.
const subscribeBlockHtml = (variant = "hero") => {
  const compact = variant === "hero";
  return `
  <section class="subscribe-block subscribe-block-${esc(variant)}" aria-label="Subscribe">
    <div class="subscribe-intro">
      <h3>${compact ? "Follow ranking changes" : "Follow new comparisons + ranking changes"}</h3>
      <p>${compact
        ? "Weekly-ish. Only when the directory actually changes."
        : "Get a note in your reader or inbox when new comparisons, tool additions, or ranking changes land. No drip sequences, no marketing chaff — only when the directory actually changes."}</p>
    </div>
    <form class="subscribe-form" data-email-form>
      <label class="sr-only" for="subscribe-email-${esc(variant)}">Email address</label>
      <input id="subscribe-email-${esc(variant)}" type="email" name="email" placeholder="you@example.com" required autocomplete="email">
      <button type="submit" class="btn">Subscribe</button>
    </form>
    <p class="subscribe-alt">Prefer a reader? <a href="/feed.xml">RSS</a> · <a href="/feed.atom">Atom</a> · <a href="/updates/">what's new</a></p>
  </section>`;
};

// ---------- llms.txt ----------
//
// Emerging spec (proposed 2024) for AI-crawler hints. One-page
// markdown-like file at root that tells LLM crawlers (OpenAI,
// Anthropic, Perplexity, etc.) what the site is and where the
// editorial content lives. Cheap, differentiated, signals editorial
// site. Spec: https://llmstxt.org/
const buildLlmsTxt = (data) => {
  const posts = (data.blog || []).map((p) => `- [${p.title}](${data.site.url}/blog/${p.slug}.html): ${p.description}`).join("\n");
  const cats = (data.categories || []).map((c) => `- [${c.name}](${data.site.url}/category/${c.slug}/): ${c.desc}`).join("\n");
  const topTools = [...(data.tools || [])]
    .sort((a, b) => (b.searches_per_month || 0) - (a.searches_per_month || 0))
    .slice(0, 12)
    .map((t) => `- [${t.name} alternatives](${data.site.url}/tools/${t.slug}-alternatives.html): ${t.headline}`)
    .join("\n");
  return `# ${data.site.name}

> ${data.site.description}

${data.site.name} is an editorial directory. Rankings are curated, not algorithmic. See [Methodology](${data.site.url}/methodology/) for the full ranking process and disqualifier list, and [Privacy](${data.site.url}/privacy/) for data handling. Outbound links to vendors may be affiliate-tagged; affiliate status never affects rank order.

## Editorial policy

- [Methodology](${data.site.url}/methodology/): How AltAI ranks AI tools — criteria, disqualifiers, affiliate stance, correction commitments.
- [Terms of use](${data.site.url}/terms/): Use terms + "what we will never do" editorial commitments.
- [Privacy policy](${data.site.url}/privacy/): Data collection, cookies, third-party disclosures.
- [Contact](${data.site.url}/contact/): Corrections, affiliate, press, privacy requests.

## Category indexes

${cats}

## Top tool alternatives pages

${topTools}

## Blog / deep dives

${posts}

## Feeds

- RSS: ${data.site.url}/feed.xml
- Atom: ${data.site.url}/feed.atom
- Human-readable updates: ${data.site.url}/updates/

## Optional

- [Sitemap](${data.site.url}/sitemap.xml): full page index
`;
};

// ---------- Feeds + /updates/ page ----------
//
// Feeds give readers a zero-effort way to follow ranking changes, new
// comparisons, and blog posts without relying on social algorithms. The
// /updates/ page is the human-readable version of the same feed.
//
// Distribution archetype: `recurring_distribution_loop` — new content lands
// in subscribers' readers without a re-share step, compounding reach over
// time. Pairs naturally with the commitment in methodology: "nothing is
// backdated", since the feed timestamps are what tell subscribers what
// actually changed.

// Collect all public-facing items + sort by most recent change.
// Tool pages, compare pages, blog posts, and editorial pages all land here.
// Recency is the single ordering signal — `data.site.updated` for anything
// that doesn't carry its own publish date, and `post.published` for blog.
const collectUpdateItems = (data) => {
  const items = [];
  const siteUpdated = data.site.updated || "";

  // Blog posts — highest priority, carry real publish dates.
  for (const post of data.blog || []) {
    items.push({
      kind: "blog",
      title: post.title,
      url: `${data.site.url}/blog/${post.slug}.html`,
      summary: post.description,
      published: post.published || siteUpdated,
      updated: siteUpdated,
    });
  }

  // Category landing pages — editorial roundups.
  for (const cat of data.categories || []) {
    const display = (typeof CATEGORY_DISPLAY !== "undefined" && CATEGORY_DISPLAY[cat.slug]) || null;
    items.push({
      kind: "category",
      title: display?.title || `Best ${cat.name} Tools in 2026`,
      url: `${data.site.url}/category/${cat.slug}/`,
      summary: cat.desc,
      published: siteUpdated,
      updated: siteUpdated,
    });
  }

  // Comparison pages.
  for (const cmp of data.comparisons || []) {
    const toolA = (data.tools || []).find((t) => t.slug === cmp.a);
    const toolB = (data.tools || []).find((t) => t.slug === cmp.b);
    if (!toolA || !toolB) continue;
    items.push({
      kind: "compare",
      title: `${toolA.name} vs ${toolB.name}`,
      url: `${data.site.url}/compare/${cmp.a}-vs-${cmp.b}.html`,
      summary: cmp.headline || `${toolA.name} vs ${toolB.name} — head-to-head on price, features, and fit.`,
      published: siteUpdated,
      updated: siteUpdated,
    });
  }

  // Tool alternatives pages — sorted by searches_per_month desc so the most
  // in-demand entries lead the feed.
  const toolsSorted = [...(data.tools || [])].sort(
    (a, b) => (b.searches_per_month || 0) - (a.searches_per_month || 0)
  );
  for (const tool of toolsSorted) {
    items.push({
      kind: "tool",
      title: `Best ${tool.name} alternatives in 2026`,
      url: `${data.site.url}/tools/${tool.slug}-alternatives.html`,
      summary: `${tool.alternatives.length} tested alternatives to ${tool.name}. ${tool.headline}`,
      published: siteUpdated,
      updated: siteUpdated,
    });
  }

  // Editorial pages — methodology first (foundational), then privacy/terms/
  // contact (infrequent but important).
  items.push({
    kind: "editorial",
    title: "How AltAI ranks AI tools",
    url: `${data.site.url}/methodology/`,
    summary: "Ranking criteria, disqualifiers, affiliate stance, correction commitments.",
    published: siteUpdated,
    updated: siteUpdated,
  });

  // Stable sort: blog first (by published desc), then category, then compare,
  // then tool, then editorial. Within each kind, newest first.
  const kindOrder = { blog: 0, category: 1, compare: 2, tool: 3, editorial: 4 };
  items.sort((a, b) => {
    const ka = kindOrder[a.kind] ?? 99;
    const kb = kindOrder[b.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    return (b.published || "").localeCompare(a.published || "");
  });

  // Dedup by URL — catches accidentally-duplicated comparisons in tools.json
  // (e.g. same a/b pair listed twice) + any future overlap between kinds.
  // First occurrence wins, preserving the kindOrder sort above.
  const seenUrls = new Set();
  return items.filter((it) => {
    if (seenUrls.has(it.url)) return false;
    seenUrls.add(it.url);
    return true;
  });
};

// Most-recent item published date from an items array. Used for feed
// <lastBuildDate> / <updated> so the feed header reflects reality when
// individual posts have newer dates than `data.site.updated`.
const mostRecentDate = (items, fallback) => {
  let latest = fallback || "";
  for (const it of items) {
    const d = it.published || it.updated || "";
    if (d && d > latest) latest = d;
  }
  return latest;
};

// Convert a YYYY-MM-DD string to RFC 822 / RFC 3339 as appropriate.
// Both feeds are valid when the time portion is midnight UTC.
const toRfc822 = (ymd) => {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toUTCString();
};
const toRfc3339 = (ymd) => {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
};

const buildRssFeed = (data) => {
  const items = collectUpdateItems(data);
  const recent = mostRecentDate(items, data.site.updated);
  const lastBuild = toRfc822(recent) || new Date().toUTCString();

  const itemsXml = items
    .map((it) => {
      return `  <item>
    <title>${xmlEsc(it.title)}</title>
    <link>${xmlEsc(it.url)}</link>
    <guid isPermaLink="true">${xmlEsc(it.url)}</guid>
    <description>${xmlEsc(it.summary)}</description>
    <category>${xmlEsc(it.kind)}</category>
    <pubDate>${xmlEsc(toRfc822(it.published) || lastBuild)}</pubDate>
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${xmlEsc(data.site.name)} — ${xmlEsc(data.site.tagline || "")}</title>
  <link>${xmlEsc(data.site.url)}/</link>
  <description>${xmlEsc(data.site.description)}</description>
  <language>en-us</language>
  <lastBuildDate>${xmlEsc(lastBuild)}</lastBuildDate>
  <atom:link href="${xmlEsc(data.site.url)}/feed.xml" rel="self" type="application/rss+xml"/>
${itemsXml}
</channel>
</rss>
`;
};

const buildAtomFeed = (data) => {
  const items = collectUpdateItems(data);
  const selfUrl = `${data.site.url}/feed.atom`;
  const recent = mostRecentDate(items, data.site.updated);
  const lastUpdated = toRfc3339(recent) || new Date().toISOString();

  const entriesXml = items
    .map((it) => {
      const pubDate = toRfc3339(it.published) || lastUpdated;
      return `  <entry>
    <title>${xmlEsc(it.title)}</title>
    <link href="${xmlEsc(it.url)}"/>
    <id>${xmlEsc(it.url)}</id>
    <updated>${xmlEsc(pubDate)}</updated>
    <published>${xmlEsc(pubDate)}</published>
    <summary>${xmlEsc(it.summary)}</summary>
    <category term="${xmlEsc(it.kind)}"/>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEsc(data.site.name)}</title>
  <subtitle>${xmlEsc(data.site.tagline || "")}</subtitle>
  <link rel="self" href="${xmlEsc(selfUrl)}"/>
  <link rel="alternate" type="text/html" href="${xmlEsc(data.site.url)}/"/>
  <id>${xmlEsc(data.site.url)}/</id>
  <updated>${xmlEsc(lastUpdated)}</updated>
  <author><name>${xmlEsc(data.site.author || data.site.name)}</name></author>
${entriesXml}
</feed>
`;
};

const buildUpdatesPage = (data) => {
  const items = collectUpdateItems(data);
  const canonical = `${data.site.url}/updates/`;

  const kindLabel = {
    blog: "Blog",
    category: "Category",
    compare: "Compare",
    tool: "Alternatives",
    editorial: "Editorial",
  };

  // Group by kind for the main content list. The feed gives chronological;
  // the page gives topical — same data, different navigation.
  const byKind = {};
  for (const it of items) {
    (byKind[it.kind] ||= []).push(it);
  }

  const section = (kind, label) => {
    const list = byKind[kind];
    if (!list || list.length === 0) return "";
    return `
    <section class="updates-section">
      <h2>${esc(label)} <span class="updates-count">${list.length}</span></h2>
      <ul class="updates-list">
        ${list
          .map(
            (it) => `
        <li>
          <a class="updates-link" href="${esc(it.url)}">
            <span class="updates-kind">${esc(kindLabel[it.kind] || it.kind)}</span>
            <span class="updates-title">${esc(it.title)}</span>
          </a>
          <p class="updates-summary">${esc(it.summary)}</p>
        </li>`
          )
          .join("")}
      </ul>
    </section>`;
  };

  const head = commonHead({
    title: `What's new on AltAI | ${data.site.name}`,
    description: "Recent changes, new comparisons, blog posts, and ranking updates on AltAI. Follow via RSS or Atom.",
    canonical,
    ogImage: data.site.url + "/og.svg",
    ogType: "website",
    schema: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: `What's new on ${data.site.name}`,
        url: canonical,
        description: "Recent changes, comparisons, and rankings on AltAI.",
      },
      breadcrumbSchema([
        { name: "Home", url: data.site.url + "/" },
        { name: "Updates", url: canonical },
      ]),
    ],
    plausibleDomain: data.site.plausible_domain,
    emailConfig: emailConfigScript(data.site),
    adsense: adsenseScript(),
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${head}
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  ${headerHtml()}
  <main id="main">
    <section class="hero">
      <div class="container">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">Home</a><span class="sep">/</span>
          <span>Updates</span>
        </nav>
        <p class="hero-eyebrow">Updates</p>
        <h1>What's <span class="accent">new</span> on AltAI.</h1>
        <p class="hero-sub">Every public page on the site — recent blog posts first, then category roundups, compare pages, tool alternatives, and editorial policy. Follow without opening the tab: <a href="/feed.xml">RSS</a> · <a href="/feed.atom">Atom</a>.</p>
        <div class="trust-bar">
          <span><strong>${items.length}</strong> total pages</span>
          <span>Updated <strong>${esc(data.site.updated)}</strong></span>
          <span>Feed auto-updates on every deploy</span>
        </div>
      </div>
    </section>
    <section class="section section-subscribe">
      <div class="container">
        ${subscribeBlockHtml("inline")}
      </div>
    </section>
    <section class="section">
      <div class="container methodology-prose">
        ${section("blog", "Blog")}
        ${section("category", "Categories")}
        ${section("compare", "Comparisons")}
        ${section("tool", "Tool alternatives")}
        ${section("editorial", "Editorial + policy")}
      </div>
    </section>
  </main>
  ${footerHtml(data)}
  <script src="/js/main.js" defer></script>
</body>
</html>`;
};

// ---------- Sitemap / robots / manifest ----------

// ---------- Blog builders ----------

const buildBlogIndex = (data) => {
  const posts = data.blog || [];
  const postCardsHtml = posts
    .map(
      (p) => `
    <article class="card">
      <div class="card-body">
        <p class="card-category">${esc(p.category)}</p>
        <h2 class="card-title"><a href="/blog/${esc(p.slug)}.html">${esc(p.title)}</a></h2>
        <p class="card-desc">${esc(p.description)}</p>
        <a class="btn btn-sm" href="/blog/${esc(p.slug)}.html">Read →</a>
      </div>
    </article>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI Tools Blog — Guides, Comparisons &amp; Reviews | AltAI</title>
  <meta name="description" content="In-depth guides on the best AI tools for every use case. Updated 2026.">
  <link rel="canonical" href="${esc(data.site.url)}/blog/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a0a0f">
  <meta name="color-scheme" content="dark light">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:type" content="website">
  <meta property="og:title" content="AI Tools Blog — Guides, Comparisons &amp; Reviews | AltAI">
  <meta property="og:description" content="In-depth guides on the best AI tools for every use case. Updated 2026.">
  <meta property="og:url" content="${esc(data.site.url)}/blog/">
  <meta property="og:image" content="${esc(data.site.url)}/og.svg">
  <meta property="og:site_name" content="${esc(data.site.name)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  ${headerHtml()}
  <main id="main">
    <section class="hero">
      <div class="container">
        <p class="hero-eyebrow">Blog</p>
        <h1>AI tool guides &amp; <span class="accent">comparisons</span>.</h1>
        <p>Data-driven roundups of the best AI tools for every job. Affiliate-transparent. Jargon-free.</p>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <div class="tools-grid">
          ${postCardsHtml}
        </div>
      </div>
    </section>
    <section class="section section-subscribe">
      <div class="container">
        ${subscribeBlockHtml("inline")}
      </div>
    </section>
  </main>
  <div class="feedback-widget" id="feedback-widget" aria-label="Page feedback">
    <div class="container">
      <p class="feedback-prompt">Was this page helpful?</p>
      <div class="feedback-buttons" id="feedback-buttons">
        <button class="feedback-btn" data-feedback="yes" aria-label="Yes, helpful">&#128077; Yes</button>
        <button class="feedback-btn" data-feedback="no" aria-label="No, not helpful">&#128078; No</button>
      </div>
      <p class="feedback-thanks hidden" id="feedback-thanks">Thanks for the feedback!</p>
    </div>
  </div>
  ${footerHtml(data)}
  <script src="/js/main.js" defer></script>
</body>
</html>`;
};

const buildBlogPost = (data, post) => {
  // Blog post tool entries don't carry a slug — derive one from name so affiliate
  // env overrides (ALTAI_AFFILIATE_<SLUG>) and UTM attribution still apply.
  const slugify = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const toolLinksHtml = (post.tools || [])
    .map(
      (t, i) => {
        const tSlug = t.slug || slugify(t.name);
        const href = affiliateUrl(t.affiliate, tSlug, `blog-${post.slug}`);
        return `
    <div class="alt-card" data-affiliate="${esc(tSlug)}">
      <div class="alt-rank">${i + 1}</div>
      <div class="alt-body">
        <h3 class="alt-name">${esc(t.name)}</h3>
        <p class="alt-why">${esc(t.why)}</p>
        <div class="alt-meta">
          <span class="price-text">${esc(t.price)}</span>
          <a class="btn btn-sm" href="${esc(href)}" target="_blank" rel="noopener nofollow sponsored" data-affiliate="${esc(tSlug)}">Visit ${esc(t.name)} →</a>
        </div>
      </div>
    </div>`;
      }
    )
    .join("\n");

  const schemaArticle = jsonLd({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    url: `${data.site.url}/blog/${post.slug}.html`,
    datePublished: post.published,
    dateModified: data.site.updated,
    author: { "@type": "Organization", name: data.site.author, url: data.site.url },
    publisher: { "@type": "Organization", name: data.site.name },
  });

  const schemaBreadcrumb = jsonLd({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${data.site.url}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${data.site.url}/blog/` },
      { "@type": "ListItem", position: 3, name: post.title, item: `${data.site.url}/blog/${post.slug}.html` },
    ],
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(post.title)} | AltAI</title>
  <meta name="description" content="${esc(post.description)}">
  <link rel="canonical" href="${esc(data.site.url)}/blog/${esc(post.slug)}.html">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0a0a0f">
  <meta name="color-scheme" content="dark light">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(post.title)}">
  <meta property="og:description" content="${esc(post.description)}">
  <meta property="og:url" content="${esc(data.site.url)}/blog/${esc(post.slug)}.html">
  <meta property="og:image" content="${esc(data.site.url)}/og.svg">
  <meta property="og:site_name" content="${esc(data.site.name)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="manifest" href="/manifest.json">
  <link rel="stylesheet" href="/css/styles.css">
  <script type="application/ld+json">${schemaArticle}</script>
  <script type="application/ld+json">${schemaBreadcrumb}</script>
  ${data.site.plausible_domain ? `<script defer data-domain="${esc(data.site.plausible_domain)}" src="https://plausible.io/js/script.js"></script>` : "<!-- Plausible: set site.plausible_domain in data/tools.json to enable analytics -->"}
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  ${headerHtml()}
  <main id="main">
    <div class="container">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep">/</span>
        <a href="/blog/">Blog</a><span class="sep">/</span>
        <span>${esc(post.title)}</span>
      </nav>
      <div class="tool-header">
        <p class="hero-eyebrow">${esc(post.category)}</p>
        <h1>${esc(post.title)}</h1>
        <p class="tagline">${esc(post.description)}</p>
        <div class="tool-meta-row">
          <span><strong>${(post.tools || []).length}</strong> tools reviewed</span>
          <span>Updated ${esc(data.site.updated)}</span>
        </div>
      </div>
      <div class="blog-intro">
        ${post.intro || ""}
      </div>
      <div class="alts-list">
        ${toolLinksHtml}
      </div>
      <div class="blog-outro">
        ${post.outro || ""}
      </div>
      <section class="section-subscribe">
        ${subscribeBlockHtml("inline")}
      </section>
    </div>
  </main>
  <div class="feedback-widget" id="feedback-widget" aria-label="Page feedback">
    <div class="container">
      <p class="feedback-prompt">Was this article helpful?</p>
      <div class="feedback-buttons" id="feedback-buttons">
        <button class="feedback-btn" data-feedback="yes" aria-label="Yes, helpful">&#128077; Yes</button>
        <button class="feedback-btn" data-feedback="no" aria-label="No, not helpful">&#128078; No</button>
      </div>
      <p class="feedback-thanks hidden" id="feedback-thanks">Thanks for the feedback!</p>
    </div>
  </div>
  ${footerHtml(data)}
  <script src="/js/main.js" defer></script>
</body>
</html>`;
};

const buildSitemap = (data) => {
  const posts = data.blog || [];
  const urls = [
    { loc: `${data.site.url}/`, priority: "1.0", changefreq: "weekly" },
    { loc: `${data.site.url}/methodology/`, priority: "0.7", changefreq: "monthly" },
    { loc: `${data.site.url}/updates/`, priority: "0.7", changefreq: "weekly" },
    { loc: `${data.site.url}/privacy/`, priority: "0.4", changefreq: "yearly" },
    { loc: `${data.site.url}/terms/`, priority: "0.4", changefreq: "yearly" },
    { loc: `${data.site.url}/contact/`, priority: "0.5", changefreq: "yearly" },
    ...data.categories.map((c) => ({
      loc: `${data.site.url}/category/${c.slug}/`,
      priority: "0.85",
      changefreq: "weekly",
    })),
    ...(posts.length > 0 ? [{ loc: `${data.site.url}/blog/`, priority: "0.8", changefreq: "weekly" }] : []),
    ...posts.map((p) => ({
      loc: `${data.site.url}/blog/${p.slug}.html`,
      priority: "0.85",
      changefreq: "monthly",
    })),
    ...data.tools.map((t) => ({
      loc: `${data.site.url}/tools/${t.slug}-alternatives.html`,
      priority: "0.9",
      changefreq: "weekly",
    })),
    ...data.comparisons.map((c) => ({
      loc: `${data.site.url}/compare/${c.a}-vs-${c.b}.html`,
      priority: "0.85",
      changefreq: "monthly",
    })),
  ];

  const body = urls
    .map(
      (u) =>
        `  <url>
    <loc>${xmlEsc(u.loc)}</loc>
    <lastmod>${xmlEsc(data.site.updated)}</lastmod>
    <changefreq>${xmlEsc(u.changefreq)}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
};

const buildRobots = (data) => `User-agent: *
Allow: /

Sitemap: ${data.site.url}/sitemap.xml
`;

const buildManifest = (data) => JSON.stringify(
  {
    name: data.site.name,
    short_name: data.site.name,
    description: data.site.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#7c3aed",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  },
  null,
  2
);

const buildFaviconSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#0a0a0f"/>
  <rect x="30" y="30" width="40" height="40" fill="#7c3aed" transform="rotate(45 50 50)"/>
</svg>`;

const build404 = (data) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>404 — Not Found | ${esc(data.site.name)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, follow">
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
</head>
<body>
${headerHtml()}
<main>
  <section class="hero">
    <div class="container">
      <p class="hero-eyebrow">404</p>
      <h1>Page <span class="accent">not found</span>.</h1>
      <p>The page you're looking for doesn't exist — but the alternatives directory might have what you want.</p>
      <div class="hero-search">
        <a class="btn" href="/">← Back to home</a>
      </div>
    </div>
  </section>
</main>
${footerHtml(data)}
</body>
</html>`;

// ---------- Main ----------

function main() {
  console.log("AltAI — building static site…\n");

  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const indexTmpl = readTemplate("index.html");
  const toolTmpl = readTemplate("tool.html");
  const compareTmpl = readTemplate("compare.html");

  const OUT_BLOG = path.join(ROOT, "blog");
  const OUT_CATEGORY = path.join(ROOT, "category");
  const OUT_METHODOLOGY = path.join(ROOT, "methodology");
  const OUT_PRIVACY = path.join(ROOT, "privacy");
  const OUT_TERMS = path.join(ROOT, "terms");
  const OUT_CONTACT = path.join(ROOT, "contact");
  const OUT_UPDATES = path.join(ROOT, "updates");

  // Clean previous output — guard against path escape.
  assertInsideRoot(OUT_TOOLS);
  assertInsideRoot(OUT_COMPARE);
  assertInsideRoot(OUT_BLOG);
  assertInsideRoot(OUT_CATEGORY);
  assertInsideRoot(OUT_METHODOLOGY);
  assertInsideRoot(OUT_PRIVACY);
  assertInsideRoot(OUT_TERMS);
  assertInsideRoot(OUT_CONTACT);
  assertInsideRoot(OUT_UPDATES);
  if (fs.existsSync(OUT_TOOLS)) fs.rmSync(OUT_TOOLS, { recursive: true });
  if (fs.existsSync(OUT_COMPARE)) fs.rmSync(OUT_COMPARE, { recursive: true });
  if (fs.existsSync(OUT_BLOG)) fs.rmSync(OUT_BLOG, { recursive: true });
  if (fs.existsSync(OUT_CATEGORY)) fs.rmSync(OUT_CATEGORY, { recursive: true });
  if (fs.existsSync(OUT_METHODOLOGY)) fs.rmSync(OUT_METHODOLOGY, { recursive: true });
  if (fs.existsSync(OUT_PRIVACY)) fs.rmSync(OUT_PRIVACY, { recursive: true });
  if (fs.existsSync(OUT_TERMS)) fs.rmSync(OUT_TERMS, { recursive: true });
  if (fs.existsSync(OUT_CONTACT)) fs.rmSync(OUT_CONTACT, { recursive: true });
  if (fs.existsSync(OUT_UPDATES)) fs.rmSync(OUT_UPDATES, { recursive: true });
  // ads.txt is conditional on ALTAI_ADSENSE_PUBLISHER_ID. Always clear at
  // build-start so unsetting the env var actually removes the file — otherwise
  // an unauthorized-seller line lingers after the operator disables AdSense.
  const adsTxtPath = path.join(ROOT, "ads.txt");
  if (fs.existsSync(adsTxtPath)) fs.rmSync(adsTxtPath);
  fs.mkdirSync(OUT_TOOLS, { recursive: true });
  fs.mkdirSync(OUT_COMPARE, { recursive: true });
  fs.mkdirSync(OUT_BLOG, { recursive: true });
  fs.mkdirSync(OUT_CATEGORY, { recursive: true });
  fs.mkdirSync(OUT_METHODOLOGY, { recursive: true });
  fs.mkdirSync(OUT_PRIVACY, { recursive: true });
  fs.mkdirSync(OUT_TERMS, { recursive: true });
  fs.mkdirSync(OUT_CONTACT, { recursive: true });
  fs.mkdirSync(OUT_UPDATES, { recursive: true });

  // Index
  writeFile(path.join(ROOT, "index.html"), buildIndex(data, indexTmpl));
  console.log("  ✓ index.html");

  // Tool pages
  data.tools.forEach((tool) => {
    const html = buildToolPage(data, tool, toolTmpl);
    writeFile(path.join(OUT_TOOLS, `${tool.slug}-alternatives.html`), html);
    console.log(`  ✓ tools/${tool.slug}-alternatives.html`);
  });

  // Comparison pages
  data.comparisons.forEach((cmp) => {
    const html = buildComparePage(data, cmp, compareTmpl);
    writeFile(path.join(OUT_COMPARE, `${cmp.a}-vs-${cmp.b}.html`), html);
    console.log(`  ✓ compare/${cmp.a}-vs-${cmp.b}.html`);
  });

  // Category pages
  data.categories.forEach((cat) => {
    const html = buildCategoryPage(data, cat);
    writeFile(path.join(OUT_CATEGORY, cat.slug, "index.html"), html);
    console.log(`  ✓ category/${cat.slug}/index.html`);
  });

  // Methodology / editorial policy page
  writeFile(path.join(ROOT, "methodology", "index.html"), buildMethodologyPage(data));
  console.log("  ✓ methodology/index.html");

  // Privacy / Terms / Contact — required for AdSense + affiliate trust
  writeFile(path.join(ROOT, "privacy", "index.html"), buildPrivacyPage(data));
  console.log("  ✓ privacy/index.html");
  writeFile(path.join(ROOT, "terms", "index.html"), buildTermsPage(data));
  console.log("  ✓ terms/index.html");
  writeFile(path.join(ROOT, "contact", "index.html"), buildContactPage(data));
  console.log("  ✓ contact/index.html");

  // ads.txt — emitted only when ALTAI_ADSENSE_PUBLISHER_ID is set.
  const adsTxt = buildAdsTxt();
  if (adsTxt) {
    writeFile(path.join(ROOT, "ads.txt"), adsTxt);
    console.log("  ✓ ads.txt (AdSense publisher-ID detected)");
  }

  // Feeds + updates page — distribution loop.
  writeFile(path.join(ROOT, "feed.xml"), buildRssFeed(data));
  writeFile(path.join(ROOT, "feed.atom"), buildAtomFeed(data));
  writeFile(path.join(OUT_UPDATES, "index.html"), buildUpdatesPage(data));
  console.log("  ✓ feed.xml, feed.atom, updates/index.html");

  // llms.txt — AI-crawler hint file (emerging spec, llmstxt.org).
  writeFile(path.join(ROOT, "llms.txt"), buildLlmsTxt(data));
  console.log("  ✓ llms.txt");

  // Blog pages
  const posts = data.blog || [];
  if (posts.length > 0) {
    writeFile(path.join(OUT_BLOG, "index.html"), buildBlogIndex(data));
    console.log("  ✓ blog/index.html");
    posts.forEach((post) => {
      writeFile(path.join(OUT_BLOG, `${post.slug}.html`), buildBlogPost(data, post));
      console.log(`  ✓ blog/${post.slug}.html`);
    });
  }

  // SEO infra
  writeFile(path.join(ROOT, "sitemap.xml"), buildSitemap(data));
  writeFile(path.join(ROOT, "robots.txt"), buildRobots(data));
  writeFile(path.join(ROOT, "manifest.json"), buildManifest(data));
  writeFile(path.join(ROOT, "favicon.svg"), buildFaviconSvg());
  writeFile(path.join(ROOT, "404.html"), build404(data));
  console.log("  ✓ sitemap.xml, robots.txt, manifest.json, favicon.svg, 404.html\n");

  const totalPages =
    1 +
    data.categories.length +
    data.tools.length +
    data.comparisons.length +
    posts.length +
    (posts.length > 0 ? 1 : 0) +
    4; // methodology + privacy + terms + contact
  console.log(`Done. Generated ${totalPages} indexable pages.`);
  console.log(`  • 1 homepage`);
  console.log(`  • 4 editorial / policy pages (methodology, privacy, terms, contact)`);
  console.log(`  • ${data.categories.length} category landing pages`);
  console.log(`  • ${data.tools.length} tool alternative pages`);
  console.log(`  • ${data.comparisons.length} head-to-head comparison pages`);
  if (posts.length > 0) console.log(`  • ${posts.length + 1} blog pages (${posts.length} posts + index)`);
}

main();

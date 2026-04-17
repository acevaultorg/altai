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

const commonHead = ({ title, description, canonical, ogImage, ogType = "website", schema, plausibleDomain, emailConfig = "" }) => {
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
  ${schemaBlocks}
  ${plausibleTag}
  ${errorMonitor}
  ${emailConfig}
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

const footerHtml = (data) => `
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
          <li><a href="/sitemap.xml">Sitemap</a></li>
        </ul>
      </div>
    </div>
    <p class="affiliate-disclosure">
      <strong>Affiliate disclosure:</strong> Some links on this site are affiliate links. If you sign up through them we may earn a commission at no extra cost to you. This never affects which tools we recommend — rankings are based on capability, price, and fit for the job.
    </p>
    <div class="footer-bottom">
      <span>&copy; ${new Date().getFullYear()} AltAI. Data last updated ${esc(data.site.updated)}.</span>
      <span>Built static. No tracking. No cookies.</span>
      <span style="font-size:0.75rem;opacity:0.55;">Powered by AcePilot</span>
    </div>
  </div>
</footer>
`.trim();

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

  // Clean previous output — guard against path escape.
  assertInsideRoot(OUT_TOOLS);
  assertInsideRoot(OUT_COMPARE);
  assertInsideRoot(OUT_BLOG);
  assertInsideRoot(OUT_CATEGORY);
  assertInsideRoot(OUT_METHODOLOGY);
  if (fs.existsSync(OUT_TOOLS)) fs.rmSync(OUT_TOOLS, { recursive: true });
  if (fs.existsSync(OUT_COMPARE)) fs.rmSync(OUT_COMPARE, { recursive: true });
  if (fs.existsSync(OUT_BLOG)) fs.rmSync(OUT_BLOG, { recursive: true });
  if (fs.existsSync(OUT_CATEGORY)) fs.rmSync(OUT_CATEGORY, { recursive: true });
  if (fs.existsSync(OUT_METHODOLOGY)) fs.rmSync(OUT_METHODOLOGY, { recursive: true });
  fs.mkdirSync(OUT_TOOLS, { recursive: true });
  fs.mkdirSync(OUT_COMPARE, { recursive: true });
  fs.mkdirSync(OUT_BLOG, { recursive: true });
  fs.mkdirSync(OUT_CATEGORY, { recursive: true });
  fs.mkdirSync(OUT_METHODOLOGY, { recursive: true });

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
    1; // methodology
  console.log(`Done. Generated ${totalPages} indexable pages.`);
  console.log(`  • 1 homepage`);
  console.log(`  • 1 methodology / editorial policy page`);
  console.log(`  • ${data.categories.length} category landing pages`);
  console.log(`  • ${data.tools.length} tool alternative pages`);
  console.log(`  • ${data.comparisons.length} head-to-head comparison pages`);
  if (posts.length > 0) console.log(`  • ${posts.length + 1} blog pages (${posts.length} posts + index)`);
}

main();

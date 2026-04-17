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

const commonHead = ({ title, description, canonical, ogImage, ogType = "website", schema, plausibleDomain, gscVerification, bingVerification }) => {
  const schemas = Array.isArray(schema) ? schema : [schema];
  const schemaBlocks = schemas
    .map((s) => `<script type="application/ld+json">${jsonLd(s)}</script>`)
    .join("\n  ");

  const plausibleTag = plausibleDomain
    ? `<script defer data-domain="${esc(plausibleDomain)}" src="https://plausible.io/js/script.js"></script>`
    : `<!-- Plausible: set site.plausible_domain in data/tools.json to enable analytics -->`;

  const gscTag = gscVerification
    ? `<meta name="google-site-verification" content="${esc(gscVerification)}">`
    : `<!-- Google Search Console: set site.gsc_verification_code in data/tools.json to auto-inject verification meta tag -->`;

  const bingTag = bingVerification
    ? `<meta name="msvalidate.01" content="${esc(bingVerification)}">`
    : `<!-- Bing Webmaster Tools: set site.bing_verification_code in data/tools.json to auto-inject verification meta tag -->`;

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
  ${gscTag}
  ${bingTag}
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

// Affiliate URL builder — appends UTM params so clicks are attributable even before a proper affiliate program is wired.
const affiliateUrl = (rawUrl, source, medium = "altai") => {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "altai");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", medium);
    if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", source || "directory");
    return u.toString();
  } catch (_) {
    return rawUrl;
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
      <li><a href="/#about">About</a></li>
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
          ${data.categories.map((c) => `<li><a href="/#${esc(c.slug)}">${esc(c.name)}</a></li>`).join("")}
        </ul>
      </div>
      <div class="footer-col">
        <h4>Site</h4>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/#tools">Tools</a></li>
          <li><a href="/sitemap.xml">Sitemap</a></li>
          <li><a href="/#about">About</a></li>
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

// Optional js/config.js — operator copies js/config.js.example to js/config.js
// and sets window.ALTAI_EMAIL_ENDPOINT (or other runtime config). Build detects
// the file; when present, every page gets a <script src="/js/config.js"> tag
// before /js/main.js so main.js reads the config on init.
const CONFIG_SCRIPT = fs.existsSync(path.join(ROOT, "js", "config.js"))
  ? `<script src="/js/config.js"></script>`
  : `<!-- js/config.js not present — copy js/config.js.example to wire an email provider -->`;

const buildIndex = (data, tmpl) => {
  const categoriesHtml = data.categories
    .map(
      (c) => `
    <a class="category-card" href="#${esc(c.slug)}" data-category="${esc(c.slug)}" id="${esc(c.slug)}">
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
    gscVerification: data.site.gsc_verification_code,
    bingVerification: data.site.bing_verification_code,
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
    config_script: CONFIG_SCRIPT,
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
        <a class="btn" href="${esc(affiliateUrl(a.affiliate, tool.slug))}" target="_blank" rel="noopener sponsored" data-affiliate="${esc(a.slug)}">${ctaLabel}</a>
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
        <td class="qc-cta"><a href="${esc(affiliateUrl(a.affiliate, tool.slug))}" target="_blank" rel="noopener sponsored" data-affiliate="${esc(a.slug)}">Try ${esc(a.name)} →</a></td>
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
    gscVerification: data.site.gsc_verification_code,
    bingVerification: data.site.bing_verification_code,
  });

  return render(tmpl, {
    config_script: CONFIG_SCRIPT,
    head,
    header: headerHtml(),
    footer: footerHtml(data),
    tool_name: tool.name,
    tool_slug: tool.slug,
    tool_vendor: tool.vendor,
    tool_summary: tool.summary,
    tool_headline: tool.headline,
    tool_price: priceBadge(tool),
    tool_affiliate: affiliateUrl(tool.affiliate.url, tool.slug, "reference"),
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
    best_alt_affiliate: affiliateUrl(tool.alternatives[0]?.affiliate, tool.slug),
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
    winner = toolA; winnerAffiliate = affiliateUrl(toolA.affiliate.url, `vs-${toolB.slug}-winner`); winnerSlug = toolA.slug;
    winnerReason = toolA.pricing.free && Number(toolA.pricing.paid_from) === 0 ? "Fully free — no card required." : `Free tier available. Paid from $${toolA.pricing.paid_from}/mo.`;
  } else if (scoreB > scoreA) {
    winner = toolB; winnerAffiliate = affiliateUrl(toolB.affiliate.url, `vs-${toolA.slug}-winner`); winnerSlug = toolB.slug;
    winnerReason = toolB.pricing.free && Number(toolB.pricing.paid_from) === 0 ? "Fully free — no card required." : `Free tier available. Paid from $${toolB.pricing.paid_from}/mo.`;
  } else if (priceA <= priceB) {
    winner = toolA; winnerAffiliate = affiliateUrl(toolA.affiliate.url, `vs-${toolB.slug}-winner`); winnerSlug = toolA.slug;
    winnerReason = `Starts at $${toolA.pricing.paid_from}/mo — better value for most users.`;
  } else {
    winner = toolB; winnerAffiliate = affiliateUrl(toolB.affiliate.url, `vs-${toolA.slug}-winner`); winnerSlug = toolB.slug;
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
    gscVerification: data.site.gsc_verification_code,
    bingVerification: data.site.bing_verification_code,
  });

  return render(tmpl, {
    config_script: CONFIG_SCRIPT,
    head,
    header: headerHtml(),
    footer: footerHtml(data),
    page_title: `${toolA.name} vs ${toolB.name}`,
    page_sub: cmp.headline,
    tool_a_name: toolA.name,
    tool_a_vendor: toolA.vendor,
    tool_a_summary: toolA.summary,
    tool_a_price: priceBadge(toolA),
    tool_a_affiliate: affiliateUrl(toolA.affiliate.url, `vs-${toolB.slug}`),
    tool_a_slug: toolA.slug,
    tool_b_name: toolB.name,
    tool_b_vendor: toolB.vendor,
    tool_b_summary: toolB.summary,
    tool_b_price: priceBadge(toolB),
    tool_b_affiliate: affiliateUrl(toolB.affiliate.url, `vs-${toolA.slug}`),
    tool_b_slug: toolB.slug,
    compare_table_html: table,
    verdict: cmp.headline,
    winner_verdict_html: winnerVerdictHtml,
  });
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
  const toolLinksHtml = (post.tools || [])
    .map(
      (t, i) => `
    <div class="alt-card" data-affiliate="${esc(t.affiliate)}">
      <div class="alt-rank">${i + 1}</div>
      <div class="alt-body">
        <h3 class="alt-name">${esc(t.name)}</h3>
        <p class="alt-why">${esc(t.why)}</p>
        <div class="alt-meta">
          <span class="price-text">${esc(t.price)}</span>
          <a class="btn btn-sm" href="${esc(t.affiliate)}" target="_blank" rel="noopener nofollow sponsored" data-affiliate="${esc(t.affiliate)}">Visit ${esc(t.name)} →</a>
        </div>
      </div>
    </div>`
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

  // Clean previous output — guard against path escape.
  assertInsideRoot(OUT_TOOLS);
  assertInsideRoot(OUT_COMPARE);
  assertInsideRoot(OUT_BLOG);
  if (fs.existsSync(OUT_TOOLS)) fs.rmSync(OUT_TOOLS, { recursive: true });
  if (fs.existsSync(OUT_COMPARE)) fs.rmSync(OUT_COMPARE, { recursive: true });
  if (fs.existsSync(OUT_BLOG)) fs.rmSync(OUT_BLOG, { recursive: true });
  fs.mkdirSync(OUT_TOOLS, { recursive: true });
  fs.mkdirSync(OUT_COMPARE, { recursive: true });
  fs.mkdirSync(OUT_BLOG, { recursive: true });

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

  const totalPages = 1 + data.tools.length + data.comparisons.length + posts.length + (posts.length > 0 ? 1 : 0);
  console.log(`Done. Generated ${totalPages} indexable pages.`);
  console.log(`  • 1 homepage`);
  console.log(`  • ${data.tools.length} tool alternative pages`);
  console.log(`  • ${data.comparisons.length} head-to-head comparison pages`);
  if (posts.length > 0) console.log(`  • ${posts.length + 1} blog pages (${posts.length} posts + index)`);
}

main();

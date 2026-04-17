/**
 * AltAI — vanilla JS. Zero dependencies.
 * Handles: homepage search, email capture (stub), no-op on tool/compare pages.
 */

(() => {
  "use strict";

  // ---------- Homepage search ----------
  const searchInput = document.getElementById("tool-search");
  const toolCards = document.querySelectorAll("[data-tool-card]");
  const noResults = document.getElementById("no-results");

  if (searchInput && toolCards.length) {
    const normalize = (s) => s.toLowerCase().trim();

    const filter = () => {
      const q = normalize(searchInput.value);
      let visible = 0;

      toolCards.forEach((card) => {
        const searchBlob = card.getAttribute("data-search") || "";
        const match = q === "" || searchBlob.includes(q);
        card.classList.toggle("hidden", !match);
        if (match) visible++;
      });

      if (noResults) {
        noResults.classList.toggle("hidden", visible > 0);
      }
    };

    searchInput.addEventListener("input", filter);

    // Keyboard shortcut: "/" focuses search
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "/" &&
        document.activeElement !== searchInput &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
      ) {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }

  // ---------- Email capture ----------
  // Configure by setting one of these globals in a <script> on the page, or edit the consts below:
  //   window.ALTAI_EMAIL_ENDPOINT = "https://buttondown.email/api/emails/embed-subscribe/<user>"
  //   window.ALTAI_EMAIL_PROVIDER = "buttondown" | "convertkit" | "beehiiv" | "custom"
  // Until one is set, the form shows a "not yet wired" message so nothing gets silently dropped.
  const EMAIL_ENDPOINT = window.ALTAI_EMAIL_ENDPOINT || "/api/subscribe";

  const emailForms = document.querySelectorAll('[data-email-form]');

  const renderMessage = (form, text, kind) => {
    const p = document.createElement("p");
    p.className = kind === "success" ? "email-msg email-msg-ok" : "email-msg email-msg-warn";
    p.textContent = text;
    form.replaceWith(p);
  };

  emailForms.forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const emailInput = form.querySelector('input[type="email"]');
      const email = (emailInput?.value || "").trim();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailInput?.focus();
        return;
      }

      if (!EMAIL_ENDPOINT) {
        // Not yet wired. Don't pretend to succeed.
        renderMessage(
          form,
          "Newsletter signup isn't live yet — check back tomorrow. Thanks for your interest.",
          "warn"
        );
        return;
      }

      try {
        const formData = new FormData();
        formData.append("email", email);
        const res = await fetch(EMAIL_ENDPOINT, { method: "POST", body: formData, mode: "no-cors" });
        renderMessage(form, "Got it. Check your inbox to confirm.", "success");

        if (typeof window.plausible === "function") {
          window.plausible("email-signup");
        }
      } catch (_) {
        renderMessage(form, "Something went wrong. Please try again.", "warn");
      }
    });
  });

  // ---------- Affiliate click tracking (ready for analytics) ----------
  document.addEventListener("click", (e) => {
    const link = e.target.closest('[data-affiliate]');
    if (!link) return;

    const tool = link.getAttribute("data-affiliate");

    if (typeof window.plausible === "function") {
      window.plausible("affiliate-click", { props: { tool } });
    }
  });

  // ---------- Feedback widget ----------
  const feedbackButtons = document.querySelectorAll(".feedback-btn[data-feedback]");
  const feedbackButtonsWrap = document.getElementById("feedback-buttons");
  const feedbackThanks = document.getElementById("feedback-thanks");

  feedbackButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.getAttribute("data-feedback");
      const page = window.location.pathname;

      if (typeof window.plausible === "function") {
        window.plausible("feedback", { props: { value, page } });
      }

      if (feedbackButtonsWrap) feedbackButtonsWrap.classList.add("hidden");
      if (feedbackThanks) feedbackThanks.classList.remove("hidden");
    });
  });

  // ---------- Social share — copy link ----------
  document.querySelectorAll('.share-btn[data-share="copy"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = window.location.href;
      const original = btn.textContent;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const ta = document.createElement("textarea");
          ta.value = url;
          ta.setAttribute("readonly", "");
          ta.style.position = "absolute";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        btn.textContent = "Copied ✓";
      } catch (_) {
        btn.textContent = "Copy failed";
      }
      setTimeout(() => { btn.textContent = original; }, 2000);
      if (typeof window.plausible === "function") {
        window.plausible("share", { props: { network: "copy", url } });
      }
    });
  });

  // ---------- Social share — outbound click analytics ----------
  document.querySelectorAll('.share-btn[data-share]:not([data-share="copy"])').forEach((link) => {
    link.addEventListener("click", () => {
      const network = link.getAttribute("data-share");
      if (typeof window.plausible === "function") {
        window.plausible("share", { props: { network, url: window.location.href } });
      }
    });
  });

  // ---------- Category card navigation ----------
  // Category cards are <a> elements linking to /#<slug>. The click handler adds a filter-and-scroll behavior
  // on the homepage without breaking the anchor link.
  document.querySelectorAll("a[data-category]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (!searchInput) return; // let the anchor navigate normally if search isn't present
      e.preventDefault();
      const name = card.querySelector("h3")?.textContent || "";
      searchInput.value = name;
      searchInput.dispatchEvent(new Event("input"));
      const toolsSection = document.getElementById("tools");
      if (toolsSection) toolsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();

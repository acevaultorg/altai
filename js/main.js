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
  // Config is injected at build time from env vars (see scripts/build.js
  // resolveEmailConfig + ENV-AFFILIATES.md § Email provider). Until a provider
  // is configured, the form shows a "not yet wired" message — never a fake
  // success, never a silent drop.
  const EMAIL_ENDPOINT = (typeof window.ALTAI_EMAIL_ENDPOINT === "string" && window.ALTAI_EMAIL_ENDPOINT.trim()) || "";
  const EMAIL_FIELD = (typeof window.ALTAI_EMAIL_FIELD === "string" && window.ALTAI_EMAIL_FIELD.trim()) || "email";

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
        formData.append(EMAIL_FIELD, email);
        await fetch(EMAIL_ENDPOINT, { method: "POST", body: formData, mode: "no-cors" });
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

  // Category cards are <a> elements linking to /category/<slug>/. They navigate
  // to dedicated category landing pages — no click-intercept needed. Users can
  // filter tools on the homepage via the search box.

  // ---------- Cookie consent ----------
  // The banner is rendered server-side only when AdSense is enabled
  // (trackingPosture.setsCookies in scripts/build.js). JS here just handles
  // accept/reject + persists the choice. Once the user has chosen, the banner
  // stays hidden on future visits regardless of route.
  //
  // Storage keys:
  //   altai_consent = "accept" | "reject"   (persistent, localStorage)
  //   altai_consent_at = ISO timestamp       (audit trail)
  const consentBanner = document.getElementById("cookie-banner");
  if (consentBanner) {
    const existing = (() => {
      try { return window.localStorage.getItem("altai_consent"); }
      catch (_) { return null; } // privacy-mode browsers → null; banner stays visible
    })();

    if (existing === "accept" || existing === "reject") {
      consentBanner.hidden = true;
    } else {
      // Show the banner. It is rendered in-DOM but starts visible; we ensure it
      // is not hidden in case CSS defaults hide it.
      consentBanner.hidden = false;
    }

    const persist = (value) => {
      try {
        window.localStorage.setItem("altai_consent", value);
        window.localStorage.setItem("altai_consent_at", new Date().toISOString());
      } catch (_) { /* no-op */ }
      consentBanner.hidden = true;
      if (typeof window.plausible === "function") {
        window.plausible("consent", { props: { value } });
      }
    };

    const acceptBtn = consentBanner.querySelector("[data-cookie-accept]");
    const declineBtn = consentBanner.querySelector("[data-cookie-decline]");
    if (acceptBtn) acceptBtn.addEventListener("click", () => persist("accept"));
    if (declineBtn) declineBtn.addEventListener("click", () => persist("reject"));
  }
})();

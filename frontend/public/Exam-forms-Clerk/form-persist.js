/* ─────────────────────────────────────────────────────────────────────────
   form-persist.js — cross-page field persistence for the practice exam forms.

   Auto-saves EVERY form field (text, select, radio, checkbox, multi-select,
   textarea, hidden) to the browser's localStorage as the user types, and
   restores everything when a page loads — so moving between the multi-step
   pages (Basic Info → Photo → Details → Preview → …) never loses data, and
   the data also survives a full browser refresh / tab re-open.

   Namespaced per exam (derived from the folder in the URL) so the IBPS PO and
   IBPS Clerk replicas keep separate saved copies.

   Transient security fields (captcha, OTP boxes) and file inputs are never
   persisted.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  // Namespace: keep each exam's saved data separate.
  var NS = /Exam-forms-Clerk/i.test(location.pathname) ? "IBPS-CLERK" : "IBPS-PO";
  var PREFIX = "examform:" + NS + ":";

  // Fields we must NOT persist (regenerated / verified per session).
  var SKIP_IDS = {
    txtCode: 1, security_check: 1, captchaImg: 1,
    otpverify: 1, emailotpverify: 1, otpMobile: 1, otpEmail: 1
  };
  function isSkipped(el) {
    if (!el) return true;
    if (el.type === "file" || el.type === "password" || el.type === "submit" || el.type === "button") return true;
    if (el.id && SKIP_IDS[el.id]) return true;
    if (el.classList && (el.classList.contains("otp-box") || el.classList.contains("email-otp-box"))) return true;
    return false;
  }

  function keyFor(el) {
    // Prefer id; fall back to name. Radios share a name so they group correctly.
    if (el.type === "radio") return el.name ? "name:" + el.name : null;
    if (el.id) return "id:" + el.id;
    if (el.name) return "name:" + el.name;
    return null;
  }

  function save(el) {
    if (isSkipped(el)) return;
    var k = keyFor(el);
    if (!k) return;
    try {
      if (el.type === "checkbox") {
        localStorage.setItem(PREFIX + k, el.checked ? "1" : "0");
      } else if (el.type === "radio") {
        if (el.checked) localStorage.setItem(PREFIX + k, el.value);
      } else if (el.multiple) {
        var vals = Array.prototype.filter.call(el.options, function (o) { return o.selected; })
          .map(function (o) { return o.value; });
        localStorage.setItem(PREFIX + k, JSON.stringify(vals));
      } else {
        localStorage.setItem(PREFIX + k, el.value);
      }
    } catch (e) { /* storage full / disabled — ignore */ }
  }

  function restore(el, fireEvents) {
    if (isSkipped(el)) return;
    var k = keyFor(el);
    if (!k) return;
    var raw;
    try { raw = localStorage.getItem(PREFIX + k); } catch (e) { return; }
    if (raw === null || raw === undefined) return;

    var changed = false;
    if (el.type === "checkbox") {
      var want = raw === "1";
      if (el.checked !== want) { el.checked = want; changed = true; }
    } else if (el.type === "radio") {
      if (el.value === raw && !el.checked) { el.checked = true; changed = true; }
    } else if (el.multiple) {
      var arr;
      try { arr = JSON.parse(raw) || []; } catch (e) { arr = []; }
      Array.prototype.forEach.call(el.options, function (o) {
        var sel = arr.indexOf(o.value) !== -1;
        if (o.selected !== sel) { o.selected = sel; changed = true; }
      });
    } else {
      // For a <select>, only apply if the option exists (may be populated later).
      if (el.tagName === "SELECT") {
        var exists = Array.prototype.some.call(el.options, function (o) { return o.value === raw; });
        if (!exists) return;
      }
      if (el.value !== raw) { el.value = raw; changed = true; }
    }

    if (changed && fireEvents) {
      // Let the page's own handlers react (uppercase, state→district, toggles…).
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function allFields() {
    return Array.prototype.slice.call(
      document.querySelectorAll("input, select, textarea")
    );
  }

  function restoreAll(fireEvents) {
    allFields().forEach(function (el) { restore(el, fireEvents); });
  }

  function bindAutosave() {
    document.addEventListener("input", function (e) {
      if (e.target && e.target.matches("input, select, textarea")) save(e.target);
    }, true);
    document.addEventListener("change", function (e) {
      if (e.target && e.target.matches("input, select, textarea")) save(e.target);
    }, true);
  }

  function init() {
    // Pass 1: restore simple fields and fire events so dependent selects
    // (state → district, state → exam-centre) get populated.
    restoreAll(true);
    // Pass 2 & 3: re-restore after dependent selects have been populated by
    // the page's own change handlers (which may run synchronously or async).
    setTimeout(function () { restoreAll(true); }, 60);
    setTimeout(function () { restoreAll(true); }, 300);
    bindAutosave();

    // Expose a manual clear (used after final submission if desired).
    window.examFormPersist = {
      ns: NS,
      clear: function () {
        try {
          Object.keys(localStorage).forEach(function (k) {
            if (k.indexOf(PREFIX) === 0) localStorage.removeItem(k);
          });
        } catch (e) {}
      },
      saveAll: function () { allFields().forEach(save); }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

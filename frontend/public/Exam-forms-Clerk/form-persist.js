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
    otpverify: 1, emailotpverify: 1, otpMobile: 1, otpEmail: 1,
    // Sensitive ID fields are always mock-filled fresh by the page; never persist.
    txtAadhaar: 1, txtPan: 1, txtIdProofNo: 1
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

  // ── Server sync (DynamoDB via the backend) ────────────────────────────────
  // Best-effort: POSTs the accumulated snapshot to the backend, which holds the
  // AWS credentials server-side and writes to DynamoDB. Failures are ignored so
  // a storage outage never disrupts the practice run.
  var API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "/api"
    : "https://tools-api.adda247.com/api";

  function collectSnapshot() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) out[k.slice(PREFIX.length)] = localStorage.getItem(k);
      }
    } catch (e) {}
    return out;
  }

  // The portal's Name + Phone gate (src/practiceUser.js) stores the visitor's
  // identity here, shared across this same-origin iframe. Every form attempt is
  // tracked under it, even before the form's own mobile field is filled.
  function getPortalUser() {
    try {
      var u = JSON.parse(localStorage.getItem("adda_practice_user"));
      if (u && u.name && u.phone) return u;
    } catch (e) {}
    return null;
  }

  function deriveIdentifier(snap) {
    // Prefer a 10-digit mobile; fall back to a composed/entered email.
    var mob = snap["id:txtmobile"] || snap["id:mobile"] || "";
    if (/^\d{10}$/.test(mob)) return mob;
    try {
      var sm = sessionStorage.getItem("ibps_mobile");
      if (/^\d{10}$/.test(sm || "")) return sm;
    } catch (e) {}
    var local = snap["id:txtemail"] || "";
    var domain = snap["id:seldomain"] || "";
    if (domain === "Others") domain = snap["id:txtothdomain"] || "";
    if (local && domain) return (local + "@" + domain).toLowerCase();
    try {
      var se = sessionStorage.getItem("ibps_email");
      if (se && se.indexOf("@") !== -1) return se.toLowerCase();
    } catch (e) {}
    // Fall back to the portal gate phone so the attempt is still tracked.
    var portal = getPortalUser();
    if (portal) return portal.phone;
    return "";
  }

  var syncTimer = null;
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1500);
  }
  function syncNow() {
    var snap = collectSnapshot();
    var identifier = deriveIdentifier(snap);
    if (!identifier) return; // nothing to key on yet
    // Stamp the portal identity (name + phone) onto the payload so the backend
    // can store a directly-readable candidate name/phone per submission.
    var portal = getPortalUser();
    var data = {};
    for (var k in snap) if (Object.prototype.hasOwnProperty.call(snap, k)) data[k] = snap[k];
    if (portal) { data.name = portal.name; data.phone = portal.phone; }
    try {
      fetch(API_BASE + "/exam-forms/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // fire-and-forget; keepalive lets it survive a page navigation
        keepalive: true,
        body: JSON.stringify({
          examId: NS,
          identifier: identifier,
          step: location.pathname.split("/").pop() || "index.html",
          data: data
        })
      }).catch(function () { /* best-effort — ignore */ });
    } catch (e) { /* ignore */ }
  }

  // ── Progress bar ──────────────────────────────────────────────────────────
  // Rendered here (not in the page markup) so every page shows the same 7-step
  // icon bar and the progression PERSISTS: the furthest step reached is stored,
  // so navigating BACK keeps earlier steps green instead of un-completing them.
  var STEPS = [
    { file: "index.html",            label: "Basic Information", icon: "bi-ui-checks" },
    { file: "otp_verification.html", label: "Verification",      icon: "bi-ui-checks" },
    { file: "photo_signature.html",  label: "Photo & Signature", icon: "bi-images" },
    { file: "details.html",          label: "Details",           icon: "bi-file-earmark-text-fill" },
    { file: "preview.html",          label: "Preview",           icon: "bi-eye-fill" },
    { file: "uploads.html",          label: "Uploads",           icon: "bi-file-earmark-arrow-up-fill" },
    { file: "payment.html",          label: "Payment",           icon: "bi-currency-rupee" }
  ];
  var MAXSTEP_KEY = PREFIX + "__maxstep";

  function injectProgressCSS() {
    if (document.getElementById("examProgressCSS")) return;
    var css = ""
      + ".progressbar li .step-circle{width:46px!important;height:46px!important;border:2px solid #e2e8f0!important;background:#fff!important;color:#94a3b8!important;font-size:19px!important;box-shadow:0 1px 3px rgba(0,0,0,.08)!important;transition:all .25s ease!important;}"
      + ".progressbar li:after{top:23px!important;height:3px!important;background:#e2e8f0!important;}"
      + ".progressbar li span{font-size:13px!important;margin-top:2px;display:inline-block;}"
      + ".progressbar li.completed{color:#43a047!important;}"
      + ".progressbar li.completed .step-circle{background:linear-gradient(135deg,#9ccc65,#43a047)!important;border-color:#43a047!important;color:#fff!important;box-shadow:0 2px 6px rgba(67,160,71,.35)!important;}"
      + ".progressbar li.completed:after{background:linear-gradient(90deg,#9ccc65,#43a047)!important;}"
      + ".progressbar li.active{color:#4c56c0!important;font-weight:700!important;}"
      + ".progressbar li.active .step-circle{background:linear-gradient(135deg,#5b6cf0,#3b46b5)!important;border-color:#4c56c0!important;color:#fff!important;box-shadow:0 0 0 5px rgba(76,86,192,.18),0 2px 8px rgba(76,86,192,.35)!important;}"
      + ".progressbar li.active:after{background:linear-gradient(90deg,#9ccc65,#43a047)!important;}";
    var st = document.createElement("style");
    st.id = "examProgressCSS";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function currentStepIndex() {
    var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].file === file) return i;
    return 0;
  }

  function renderProgress() {
    var ul = document.querySelector("ul.progressbar");
    if (!ul) return;
    injectProgressCSS();

    var cur = currentStepIndex();
    var maxReached = parseInt(localStorage.getItem(MAXSTEP_KEY) || "0", 10);
    if (isNaN(maxReached)) maxReached = 0;
    if (cur > maxReached) { maxReached = cur; try { localStorage.setItem(MAXSTEP_KEY, String(maxReached)); } catch (e) {} }

    var html = "";
    for (var i = 0; i < STEPS.length; i++) {
      var s = STEPS[i];
      var cls, href;
      if (i === cur) { cls = "active"; href = "#"; }
      else if (i < cur || i <= maxReached) { cls = "completed"; href = s.file; } // reached — navigable back, stays green
      else { cls = ""; href = "javascript:void(0);"; }
      html += '<li class="' + cls + '"><a href="' + href + '">'
            + '<div class="step-circle"><i class="bi ' + s.icon + '"></i></div>'
            + '<span>' + s.label + '</span></a></li>';
    }
    ul.innerHTML = html;
  }

  function init() {
    renderProgress();

    // Pass 1: restore simple fields and fire events so dependent selects
    // (state → district, state → exam-centre) get populated.
    restoreAll(true);
    // Pass 2 & 3: re-restore after dependent selects have been populated by
    // the page's own change handlers (which may run synchronously or async).
    setTimeout(function () { restoreAll(true); }, 60);
    setTimeout(function () { restoreAll(true); }, 300);
    bindAutosave();

    // Sync to the backend on load and (debounced) whenever a field changes.
    setTimeout(syncNow, 800);
    document.addEventListener("input", function (e) {
      if (e.target && e.target.matches("input, select, textarea")) scheduleSync();
    }, true);
    document.addEventListener("change", function (e) {
      if (e.target && e.target.matches("input, select, textarea")) scheduleSync();
    }, true);
    // Flush once more as the page is being left.
    window.addEventListener("pagehide", syncNow);

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
      saveAll: function () { allFields().forEach(save); },
      sync: syncNow
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

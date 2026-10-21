(function () {
  // Replace SUPABASE_PROJECT_REF with your project reference
  // (Supabase dashboard > Project Settings > General).
  var ENDPOINT = "https://fknccqedpavcsbppgidg.supabase.co/functions/v1/newsletter-signup";

  var form = document.getElementById("newsletter-form");
  if (!form) {
    console.error("[newsletter] form #newsletter-form not found");
    return;
  }

  var emailEl = document.getElementById("newsletter-email");
  var consentEl = document.getElementById("newsletter-consent");
  var submitEl = document.getElementById("newsletter-submit");
  var statusEl = document.getElementById("newsletter-status");

  function setStatus(text, state) {
    statusEl.textContent = text;
    statusEl.setAttribute("data-state", state || "");
  }

  var params = new URLSearchParams(window.location.search);

  // Pre-fill the email field from a link like https://jordanelias.de/?email=name%40example.com#newsletter
  // The consent box is never ticked automatically: the visitor still has to agree and press Subscribe.
  var prefill = (params.get("email") || "").trim();
  if (prefill && prefill.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefill)) {
    emailEl.value = prefill;
    var formSection = document.getElementById("newsletter");
    if (formSection) formSection.scrollIntoView({ behavior: "smooth" });
    // Remove the address from the visible URL.
    params.delete("email");
    var rest = params.toString();
    history.replaceState(null, "", window.location.pathname + (rest ? "?" + rest : "") + window.location.hash);
  }

  // Messages after redirects from the confirm function (/?newsletter=...)
  var messages = {
    confirmed: ["You're subscribed. Thanks for confirming!", "ok"],
    invalid: ["That confirmation link is invalid or has expired. Please sign up again.", "error"],
    error: ["Something went wrong confirming your subscription. Please try again later.", "error"]
  };
  var result = new URLSearchParams(window.location.search).get("newsletter");
  if (result && messages[result]) {
    setStatus(messages[result][0], messages[result][1]);
    var section = document.getElementById("newsletter");
    if (section) section.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", window.location.pathname + window.location.hash);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    var email = emailEl.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("Please enter a valid email address.", "error");
      emailEl.focus();
      return;
    }
    if (!consentEl.checked) {
      setStatus("Please tick the box to agree to receive updates.", "error");
      return;
    }

    submitEl.disabled = true;
    setStatus("Sending…", "");

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        consent: true,
        website: form.elements["website"].value
      })
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (r) {
        if (r.ok) {
          form.reset();
          setStatus("Almost done! Check your inbox for a confirmation email.", "ok");
        } else {
          console.error("[newsletter] signup failed", r.status, r.data);
          setStatus(r.data.error || "Something went wrong. Please try again.", "error");
        }
      })
      .catch(function (err) {
        console.error("[newsletter] network error", err);
        setStatus("Network error. Please try again.", "error");
      })
      .then(function () {
        submitEl.disabled = false;
      });
  });
})();

// public/js/reset.js — reset-password form with the same real-time
// password feedback as the signup page (see public/js/signup.js).
// Rules mirror src/lib/password-validator.js; the server remains the
// source of truth, this is instant client-side guidance only.
const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const form = document.getElementById("reset-form");

const newPassInput = document.getElementById("newPassword");
const toggleNewPassBtn = document.getElementById("toggle-new-password");
const chkLength = document.getElementById("chk-length");
const chkCases = document.getElementById("chk-cases");
const chkNumSym = document.getElementById("chk-numsym");

function updateCheckitem(el, isPass) {
  if (!el) return;
  if (isPass) {
    el.classList.add("pass");
    el.classList.remove("fail");
  } else {
    el.classList.remove("pass");
  }
}

function passwordChecks() {
  const p = newPassInput ? newPassInput.value || "" : "";
  const hasLength = p.length >= 8;
  const hasCases = /[a-z]/.test(p) && /[A-Z]/.test(p);
  const hasNumSym = /[0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p);

  // Reset carries no business-name/subdomain/email context (unlike
  // signup), so there is no identity-similarity item here — the server
  // still enforces its own minimum (8+ chars) on this endpoint.
  updateCheckitem(chkLength, hasLength);
  updateCheckitem(chkCases, hasCases);
  updateCheckitem(chkNumSym, hasNumSym);

  return hasLength && hasCases && hasNumSym;
}

if (newPassInput) {
  newPassInput.addEventListener("input", passwordChecks);
}

if (toggleNewPassBtn && newPassInput) {
  toggleNewPassBtn.addEventListener("click", () => {
    const isPass = newPassInput.type === "password";
    newPassInput.type = isPass ? "text" : "password";
    toggleNewPassBtn.innerHTML = isPass
      ? `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
      : `<svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  });
}

if (!token) {
  form.style.display = "none";
  document.getElementById("reset-invalid").style.display = "block";
} else {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("reset-error");
    const submitBtn = document.getElementById("reset-submit");
    errorEl.style.display = "none";

    if (!passwordChecks()) {
      errorEl.textContent = "Password must be 8+ characters with uppercase, lowercase, number, and symbol.";
      errorEl.style.display = "block";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "UPDATING...";

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: document.getElementById("newPassword").value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reset password.");

      form.style.display = "none";
      document.getElementById("reset-success").style.display = "block";
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "SET NEW PASSWORD";
    }
  });
}

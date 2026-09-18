// src/lib/password-validator.js
// Password strength and identity-similarity validation module

function validatePassword(password, metadata = {}) {
  if (!password || typeof password !== "string") {
    return { valid: false, error: "Password is required." };
  }
  if (password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters long." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must include at least one lowercase letter." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must include at least one uppercase letter." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must include at least one number." };
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return { valid: false, error: "Password must include at least one special symbol (e.g. !@#$%^&*)." };
  }

  const normalize = (str) => (str ? String(str).toLowerCase().replace(/[^a-z0-9]/g, "") : "");
  const passNormalized = normalize(password);

  const cleanBusiness = normalize(metadata.businessName);
  if (cleanBusiness && cleanBusiness.length >= 3 && passNormalized.includes(cleanBusiness)) {
    return { valid: false, error: "Password must not contain your business name." };
  }

  const cleanSubdomain = normalize(metadata.subdomain);
  if (cleanSubdomain && cleanSubdomain.length >= 3 && passNormalized.includes(cleanSubdomain)) {
    return { valid: false, error: "Password must not contain your store subdomain." };
  }

  if (metadata.email) {
    const emailUser = normalize(String(metadata.email).split("@")[0]);
    if (emailUser && emailUser.length >= 3 && passNormalized.includes(emailUser)) {
      return { valid: false, error: "Password must not contain your email username." };
    }
  }

  return { valid: true };
}

module.exports = { validatePassword };

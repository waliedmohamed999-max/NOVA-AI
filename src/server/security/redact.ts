/** Removes tokens, keys, codes, passwords and secrets from anything stored or logged. */
export function redact(s: string | null, max = 500) {
  if (!s) return null;
  return s
    .replace(/(access_token|client_secret|refresh_token|token|key|code|secret|password)=([^&\s"]+)/gi, "$1=[redacted]")
    .replace(/\b(password|passwd|pwd|pass)\s*[:：]\s*\S+/gi, "$1: [redacted]")
    .replace(/(كلمة السر|كلمة المرور|كلمه السر|كلمه المرور|الباسورد|باسورد)\s*[:：]?\s*\S+/g, "$1 [redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [redacted]")
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "$1_$2_[redacted]")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "whsec_[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/\bEAA[A-Za-z0-9]{20,}/g, "EAA[redacted]")
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, "ya29.[redacted]")
    .slice(0, max);
}

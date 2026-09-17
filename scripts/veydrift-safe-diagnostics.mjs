const redacted = "[redacted]";
const sensitiveKey = /(?:^|[_\-\s])(?:authorization|auth|cookie|credential|password|passwd|secret|token|api[_\-]?key|private[_\-]?key|signing[_\-]?key|mnemonic|seed)(?:$|[_\-\s])/i;
const opaqueContainers = new Set(["config", "configuration", "env", "environment", "header", "headers", "secret", "secrets", "variable", "variables"]);
const publicHashKeys = new Set(["commithash", "gitsha", "runtimecodehash", "transactionhash", "upgradetransactionhash"]);
const normalizedSensitiveKeyTokens = [
  "authorization", "cookie", "credential", "credentials", "password", "passwd", "secret", "token",
  "apikey", "privatekey", "signingkey", "mnemonic", "seed"
];
const normalizedOpaqueContainerTokens = ["configuration", "environment", "config", "header", "variables"];

function normalizedKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key) {
  const normalized = normalizedKey(key);
  return sensitiveKey.test(key) || normalizedSensitiveKeyTokens.some((token) => normalized.includes(token));
}

function isOpaqueContainerKey(key, value) {
  const normalized = normalizedKey(key);
  return opaqueContainers.has(normalized) || (
    value !== null
    && typeof value === "object"
    && normalizedOpaqueContainerTokens.some((token) => normalized.includes(token))
  );
}

export function publicDiagnosticUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "[redacted-url]";
  }
}

export function safeDiagnosticText(value, maxChars = 2_048, preserveHash = false) {
  let text = value instanceof Error ? value.message : String(value);
  text = text.replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g, redacted);
  text = text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (url) => publicDiagnosticUrl(url));
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${redacted}`);
  text = text.replace(
    /((?:["']?)(?:authorization|cookie|password|passwd|secret|token|credential|api[_-]?key|private[_-]?key|signing[_-]?key|[A-Z0-9_-]*(?:TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|SIGNING[_-]?KEY|API[_-]?KEY|CREDENTIAL)[A-Z0-9_-]*)(?:["']?)\s*[:=]\s*(?:["']?))[^\s,;"'}]+/gi,
    `$1${redacted}`
  );
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/gi, redacted);
  text = text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, redacted);
  if (!preserveHash) text = text.replace(/\b0x[0-9a-f]{64}\b/gi, redacted);
  return text.length > maxChars ? `${text.slice(0, maxChars)}…[truncated]` : text;
}

export function sanitizeDiagnosticValue(value, key = "", depth = 0, seen = new WeakSet()) {
  if (depth > 8) return "[max-depth]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return safeDiagnosticText(value, 2_048, publicHashKeys.has(normalizedKey(key)));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: safeDiagnosticText(value.message),
      ...(value.stack ? { stack: safeDiagnosticText(value.stack) } : {})
    };
  }
  if (typeof value !== "object") return safeDiagnosticText(value);
  if (seen.has(value)) return "[cycle]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, 100).map((child) => sanitizeDiagnosticValue(child, key, depth + 1, seen));
      if (value.length > 100) items.push(`[${value.length - 100} more items]`);
      return items;
    }
    const output = {};
    const entries = Object.entries(value);
    for (const [index, [childKey, child]] of entries.entries()) {
      if (index >= 100) {
        output["[truncated]"] = `${entries.length - index} more fields`;
        break;
      }
      output[childKey] = isSensitiveKey(childKey) || isOpaqueContainerKey(childKey, child)
        ? redacted
        : sanitizeDiagnosticValue(child, childKey, depth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function pickDiagnosticPaths(value, paths) {
  const output = {};
  for (const path of paths) {
    let current = value;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) {
        current = undefined;
        break;
      }
      current = current[part];
    }
    if (["string", "number", "boolean"].includes(typeof current) || current === null) {
      output[path] = sanitizeDiagnosticValue(current, path.split(".").at(-1));
    }
  }
  return output;
}

import { describe, expect, test } from "bun:test";

import { safeDiagnosticText, sanitizeDiagnosticValue } from "./safeDiagnostics";

const privateKey = `0x${"ab".repeat(32)}`;
const bearer = "synthetic-bearer-canary-1234567890";
const password = "synthetic-password-canary-1234567890";
const queryKey = "synthetic-query-canary-1234567890";
const opaque = "synthetic-opaque-canary-1234567890";
const canaries = [privateKey, bearer, password, queryKey, opaque];

function expectNoCanaries(value: unknown): void {
  const output = JSON.stringify(value);
  for (const canary of canaries) expect(output).not.toContain(canary);
}

describe("safe diagnostics", () => {
  test("redacts nested env/config values, case variants, headers, private keys, and credential URLs", () => {
    const output = sanitizeDiagnosticValue({
      status: "running",
      Environment: {
        Signing_Private_Key: privateKey,
        AUTHORIZATION: `Bearer ${bearer}`,
        nested: [{ "Api-Key": queryKey }, { opaque }]
      },
      config: { arbitrary: opaque },
      releasePrivateKey: privateKey,
      deploymentSigningKey: password,
      providerApiKey: queryKey,
      endpoint: `https://user:${password}@rpc.invalid/v2/path?apiKey=${queryKey}`
    });

    expectNoCanaries(output);
    expect(output).toMatchObject({ status: "running", Environment: "[redacted]", config: "[redacted]" });
    expect(output).toMatchObject({ endpoint: "https://rpc.invalid" });
  });

  test("preserves useful hashes only in explicit hash fields", () => {
    const output = sanitizeDiagnosticValue({
      status: "healthy",
      transactionHash: privateKey,
      error: `failed with private_key=${privateKey}`
    });

    expect(output).toMatchObject({ status: "healthy", transactionHash: privateKey });
    expect(JSON.stringify((output as Record<string, unknown>).error)).not.toContain(privateKey);
  });

  test("sanitizes before truncating error text", () => {
    const output = safeDiagnosticText(
      `Authorization: Bearer ${bearer} https://user:${password}@rpc.invalid/path?token=${queryKey} private_key=${privateKey} ${"x".repeat(5000)}`,
      160
    );

    expectNoCanaries(output);
    expect(output).toContain("https://rpc.invalid");
    expect(output).toEndWith("…[truncated]");
  });
});

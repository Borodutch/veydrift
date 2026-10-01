# VEY-KANEO-920 — Runtime-config public delivery investigation

## Verdict and limits

The affected Vancouver **managed-egress client still fails the unchanged 500 ms smoke requirement**. This is not a fleet chronology regression. No application performance fix, contract change, service/config change or deployment is justified by these measurements.

The dominant measured delay is **before the client receives response headers**, not reading/parsing the 2,091-byte body. Origin loopback and logged handler durations are small during the sampled window. The affected client uses a mandatory local egress proxy; its curl DNS/TCP/TLS spans terminate locally, not at Cloudflare/origin. Consequently these results cannot isolate proxy queueing, upstream connection setup, network transit, Cloudflare, ingress queueing or pre-handler scheduling. **Proxy causality is not proved.** Fresh-connection production-public curl also has two slow outliers, so this is not established as exclusively Vancouver-specific. Do not label the passing production warm smoke a universal public latency pass.

Remaining blocker to full root-cause/remediation acceptance: correlated upstream/proxy/ingress timing, and an authorized independent affected-region public measurement outside this instrumented agent. Do not disable/bypass the managed egress safeguard. The diagnostic patch is reviewable independently; the latency incident is not resolved.

## Measurements

UTC 2026-10-01 02:01–02:11 (Vancouver 2026-09-30 19:01–19:11). Nearest-rank p95; with 12 samples p95 equals max. Different transports/connection reuse are named, not treated as interchangeable controls.

| Path / workload | Count | p50 ms | p95 / max ms | Result |
| --- | ---: | ---: | ---: | --- |
| Vancouver curl, fresh process/connection through managed egress | 12 | 461.79 | 1733.87 | 12 HTTP 200; 6 above 500 ms |
| Production-host curl, fresh process/connection to public URL | 12 | 96.38 | 1799.04 | 12 HTTP 200; 2 above 500 ms |
| Production-container Bun fetch, public URL, sequential/reusable | 12 | 26.55 | 137.42 | 12 HTTP 200 and runtime feature checks true |
| Production-container Bun fetch, loopback port 4000 | 12 | 1.95 | 10.87 | 12 HTTP 200 and runtime feature checks true |
| Backend runtime-config handler log sample | 85 | 4 | 6 / 7 | all HTTP 200, complete 2,091-byte bodies |

Cold curl cumulative phase milestones (p50 / p95 ms):

| Client | DNS | TCP connected | TLS complete | First byte | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Vancouver managed egress | 0.09 / 0.16 | 0.32 / 0.41 | 4.56 / 21.64 | 461.65 / 1730.77 | 461.79 / 1733.87 |
| Production public | 0.87 / 1.50 | 7.11 / 7.58 | 52.32 / 68.34 | 96.29 / 1798.98 | 96.38 / 1799.04 |

Vancouver CONNECT=200, loopback peer and managed egress certificate issuer confirmed locally; those spans **do not expose upstream DNS/TCP/TLS**. Production CONNECT=0. Per-sample first-byte minus pretransfer p95: Vancouver 1726.14 ms, production 1750.41 ms. Body-transfer p95: Vancouver 7.32 ms, production 0.09 ms. These are client intervals, never handler measurements.

Preserved default smoke, 12 rounds × (runtime-config plus three concurrent noisy reads), no threshold override:

- Original release baseline: **933 ms, failed** ([evidence](release-baseline.json)).
- Original postactivation Vancouver: **4184 ms, failed** ([evidence](release-failed-client.json)).
- Original production-region public: **36 ms, passed** ([evidence](release-regional.json)).
- Investigation unchanged Vancouver: **1288 ms, failed** ([evidence](smoke-vancouver-before.json)).
- Investigation production public: **29 ms, passed** ([evidence](smoke-production.json)).
- Instrumented Vancouver: **1834 ms, failed** ([evidence](smoke-vancouver-final.json)). Maximum fetch-response-ready 1833.29 ms, body read 0.60 ms. All health/runtime/galaxy/rankings functional checks and all runtime/noisy HTTP statuses pass. This is new affected-region evidence, **not an improvement claim**.

Evidence includes [Vancouver curl](vancouver-managed-egress.json), [production curl](production-curl-retry.json), [origin/public paired fetch](origin-public-paired.json), and [handler records](runtime-handler-logs.json). Logs are bounded to last 10 minutes / tail 10,000 at collection; matching records span 01:54:18.987–02:02:21.746 UTC. 248 non-JSON lines skipped explicitly; 85 matching runtime records retained. This is not full-service traffic aggregation or exact per-request correlation, and does not rule out intermittent saturation outside that window or before handler entry.

An initial remote-curl JSON formatting attempt was unparsable and discarded, **not counted as zero-latency success**. Its local artifact remains under artifacts/vey920/production-public.json; the numeric-format retry above is authoritative.

## Review correction and retest

The first instrumented report above redacted the two proxy-presence booleans because their names included “Environment”. Original `smoke-vancouver-final.json` is preserved unchanged. The fix uses `proxySettingsPresent` / `proxyBypassSettingsPresent` and asserts their types in the final serialized CLI output; sanitizer behavior is unchanged. A fresh [review-correction sample](smoke-vancouver-reviewed.json) confirms true/false respectively and still **fails at 594 ms p95**, response-ready max593.59 ms/body-read max0.58 ms. Variability is not evidence of a performance correction: this change only renames diagnostics.

27 focused tests plus docs checks pass. Backend typecheck passes. The broader local backend suite has1005 passes and one failure in the unchanged smart-wallet RPC loopback fixture; focused retry and exact-base936007ec reproduction both have11 passes/one same failure. No wallet code or gas constraint was changed to make it pass. Hosted CI remains a separate gate.

## Bounded corrective change

Improve smoke evidence rather than guess at application optimization:

- Keep default 500 ms, existing workload/percentile and failure exit status.
- Record monotonic total, response-ready and body-read times, UTC start, decoded UTF-8 bytes and individual runtime samples. Fetch response-ready is an approximation of header arrival; it is not wire-level first-byte timing.
- Retain HTTP status if a body fails or deadline expires; distinguish actual deadline abort from a peer error merely containing “abort”. Null spans mean unobserved/incomplete, not zero.
- Report runtime and proxy-environment presence as booleans, never environment values or credentials. Environment presence is not proof fetch used a proxy.
- Keep existing sanitizer and body/header allowlist. Add regression fixtures for phases, failure evidence, privacy, timeout, unchanged 500 ms gate and CI wiring.

No server deployment is needed for script-only diagnostics. Existing production services should not be redeployed for this PR.

## Reproduce safely

Run the unchanged functional/performance gate on each authorized host; save output **and exit status**, even on failure:

~~~sh
node scripts/veydrift-postdeploy-smoke.mjs --api-url https://api.veydrift.com
node --test scripts/veydrift-delivery-timing.test.mjs scripts/veydrift-safe-diagnostics.test.mjs scripts/ci-run-scoped-checks.test.mjs
~~~

Use the managed backend container's existing Bun runtime for the regional comparison, without editing it. For cold-connection phases use up to 12 sequential curl GETs (10-second maximum each), preserving current proxy/TLS policy:

~~~sh
curl --silent --show-error --max-time 10 -o /dev/null \
  -w 'status=%{http_code} dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ready=%{time_pretransfer} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download} connectStatus=%{http_connect}\n' \
  https://api.veydrift.com/runtime-config
~~~

Pair with authorized origin-loopback reads and bounded structured handler logs. Never subtract unrelated percentiles to claim a per-request server/network split. Obtain correlation and upstream spans before choosing caching, transport or saturation changes.

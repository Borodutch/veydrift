import { describe, expect, test } from "bun:test";
import {
  createForwardingFetch,
  createRequestLoggingFetch,
  DEFAULT_MAX_WORKER_COUNT,
  resolveWorkerAssignment,
  resolveWorkerCount,
  resolveWriterInternalPort,
  roleForIndex,
  WORKER_COUNT_ENV,
  WORKER_INDEX_ENV,
  WORKER_ROLE_ENV,
  WRITER_INTERNAL_PORT_ENV
} from "./workerPool";

describe("resolveWorkerCount", () => {
  test("uses the host CPU count up to the default memory-bounded cap when no override is set", () => {
    expect(resolveWorkerCount({}, 2)).toBe(2);
    expect(resolveWorkerCount({}, 12)).toBe(DEFAULT_MAX_WORKER_COUNT);
  });

  test("floors fractional CPU counts and never returns less than 1", () => {
    expect(resolveWorkerCount({}, 12.9)).toBe(DEFAULT_MAX_WORKER_COUNT);
    expect(resolveWorkerCount({}, 0)).toBe(1);
    expect(resolveWorkerCount({}, Number.NaN)).toBe(1);
  });

  test("honors a positive integer override even above the default cap", () => {
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "3" }, 16)).toBe(3);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "1" }, 16)).toBe(1);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "12" }, 16)).toBe(12);
  });

  test("ignores blank or invalid overrides and falls back to the capped default", () => {
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "" }, 12)).toBe(DEFAULT_MAX_WORKER_COUNT);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "   " }, 12)).toBe(DEFAULT_MAX_WORKER_COUNT);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "0" }, 12)).toBe(DEFAULT_MAX_WORKER_COUNT);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "-2" }, 12)).toBe(DEFAULT_MAX_WORKER_COUNT);
    expect(resolveWorkerCount({ [WORKER_COUNT_ENV]: "abc" }, 12)).toBe(DEFAULT_MAX_WORKER_COUNT);
  });
});

describe("roleForIndex", () => {
  test("worker 0 is the single writer, the rest are readers", () => {
    expect(roleForIndex(0)).toBe("writer");
    expect(roleForIndex(1)).toBe("reader");
    expect(roleForIndex(7)).toBe("reader");
  });
});

describe("resolveWorkerAssignment", () => {
  test("a process without a role env is the supervisor sized to the pool", () => {
    expect(resolveWorkerAssignment({}, 12)).toEqual({ kind: "supervisor", workerCount: DEFAULT_MAX_WORKER_COUNT });
    expect(resolveWorkerAssignment({ [WORKER_COUNT_ENV]: "2" }, 16)).toEqual({
      kind: "supervisor",
      workerCount: 2
    });
  });

  test("a spawned writer worker is identified with its index", () => {
    expect(
      resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "writer", [WORKER_INDEX_ENV]: "0" }, 4)
    ).toEqual({ kind: "worker", role: "writer", index: 0 });
  });

  test("a spawned reader worker is identified with its index", () => {
    expect(
      resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "reader", [WORKER_INDEX_ENV]: "3" }, 4)
    ).toEqual({ kind: "worker", role: "reader", index: 3 });
  });

  test("defaults a worker index to 0 when missing or malformed", () => {
    expect(resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "reader" }, 4)).toEqual({
      kind: "worker",
      role: "reader",
      index: 0
    });
    expect(
      resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "reader", [WORKER_INDEX_ENV]: "nope" }, 4)
    ).toEqual({ kind: "worker", role: "reader", index: 0 });
  });

  test("an unrecognized role env is treated as the supervisor", () => {
    expect(resolveWorkerAssignment({ [WORKER_ROLE_ENV]: "bogus" }, 12)).toEqual({
      kind: "supervisor",
      workerCount: DEFAULT_MAX_WORKER_COUNT
    });
  });
});

describe("resolveWriterInternalPort", () => {
  test("defaults to the main port + 1", () => {
    expect(resolveWriterInternalPort({}, 4000)).toBe(4001);
    expect(resolveWriterInternalPort({}, 80)).toBe(81);
  });

  test("honors a valid override", () => {
    expect(resolveWriterInternalPort({ [WRITER_INTERNAL_PORT_ENV]: "5050" }, 4000)).toBe(5050);
  });

  test("ignores invalid overrides and falls back to main port + 1", () => {
    expect(resolveWriterInternalPort({ [WRITER_INTERNAL_PORT_ENV]: "" }, 4000)).toBe(4001);
    expect(resolveWriterInternalPort({ [WRITER_INTERNAL_PORT_ENV]: "0" }, 4000)).toBe(4001);
    expect(resolveWriterInternalPort({ [WRITER_INTERNAL_PORT_ENV]: "99999" }, 4000)).toBe(4001);
    expect(resolveWriterInternalPort({ [WRITER_INTERNAL_PORT_ENV]: "nope" }, 4000)).toBe(4001);
  });
});

describe("createForwardingFetch", () => {
  test("serves read-only methods locally without forwarding", async () => {
    let forwarded = false;
    const local = async (request: Request) =>
      new Response(`local:${request.method}`, { status: 200 });
    const fetchImpl = (async () => {
      forwarded = true;
      return new Response("upstream", { status: 200 });
    }) as unknown as typeof fetch;

    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const response = await handler(new Request("http://localhost/debug/config", { method }));
      expect(response.status).toBe(200);
    }
    expect(forwarded).toBe(false);
  });

  test("forwards mutating requests to the writer with method, path, query and body", async () => {
    const calls: Array<{ url: string; method: string; body: string; signature: string | null }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const body = init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : "";
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body,
        signature: new Headers(init?.headers).get("x-alchemy-signature")
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json", "access-control-allow-origin": "https://test.veydrift.com" }
      });
    }) as unknown as typeof fetch;

    const local = async () => new Response("should-not-run", { status: 500 });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(
      new Request("http://localhost/webhooks/alchemy?x=1", {
        method: "POST",
        headers: { "content-type": "application/json", "x-alchemy-signature": "abc" },
        body: JSON.stringify({ event: "log" })
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://127.0.0.1:4001/webhooks/alchemy?x=1");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe(JSON.stringify({ event: "log" }));
    expect(calls[0]?.signature).toBe("abc");
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test.veydrift.com");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("forwards the SSE chain event stream to the writer", async () => {
    const calls: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return new Response("event: sync-status\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }) as unknown as typeof fetch;

    const local = async () => new Response("reader-has-no-chain-sync", { status: 503 });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(new Request("http://localhost/chain/events?client=ui"));

    expect(calls).toEqual([{ url: "http://127.0.0.1:4001/chain/events?client=ui", body: undefined }]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    await expect(response.text()).resolves.toBe("event: sync-status\n\n");
  });

  test("serves health readiness reads locally on readers", async () => {
    const calls: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return Response.json({ error: "writer should not receive health" }, { status: 503 });
    }) as unknown as typeof fetch;

    const local = async () => Response.json({ ok: true, readiness: { ready: true } });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(new Request("http://localhost/health"));

    expect(calls).toEqual([]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  test("serves runtime-config bootstrap reads locally on readers", async () => {
    const calls: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return Response.json({ error: "writer should not receive runtime-config" }, { status: 503 });
    }) as unknown as typeof fetch;

    const local = async () => Response.json({
      backend: { worker: { role: "reader" } },
      apiUrl: "https://api-test.veydrift.com",
      chainId: 84532
    });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(new Request("http://localhost/runtime-config"));

    expect(calls).toEqual([]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      backend: { worker: { role: "reader" } },
      apiUrl: "https://api-test.veydrift.com",
      chainId: 84532
    });
  });

  test("serves runtime-config bootstrap reads before initializing the local reader handler", async () => {
    const calls: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return Response.json({ error: "writer should not receive runtime-config" }, { status: 503 });
    }) as unknown as typeof fetch;

    let localInitialized = false;
    const local = async () => {
      localInitialized = true;
      return Response.json({ error: "reader handler should not initialize" }, { status: 503 });
    };
    const bootstrap = (request: Request) => {
      return new URL(request.url).pathname === "/runtime-config"
        ? Response.json({ backend: { worker: { role: "reader" } } })
        : undefined;
    };
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl, bootstrap);

    const response = await handler(new Request("http://localhost/runtime-config"));

    expect(localInitialized).toBe(false);
    expect(calls).toEqual([]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ backend: { worker: { role: "reader" } } });
  });

  test("logs runtime-config bootstrap responses at the reader boundary", async () => {
    const originalInfo = console.info;
    const logs: unknown[][] = [];
    console.info = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      const local = async () => Response.json({ error: "reader handler should not initialize" }, { status: 503 });
      const bootstrap = (request: Request) => {
        return new URL(request.url).pathname === "/runtime-config"
          ? Response.json({ backend: { worker: { role: "reader" } } })
          : undefined;
      };
      const handler = createRequestLoggingFetch(
        createForwardingFetch(local, "http://127.0.0.1:4001", fetch, bootstrap),
        "reader"
      );

      const response = await handler(new Request("http://localhost/runtime-config?source=test"));

      expect(response.status).toBe(200);
      expect(logs).toHaveLength(1);
      const log = logs[0];
      expect(log).toBeDefined();
      expect(log![0]).toBe("veydrift-api-request");
      const entry = JSON.parse(String(log![1])) as {
        durationMs: number;
        method: string;
        path: string;
        status: number;
        workerRole: string;
      };
      expect(entry).toMatchObject({
        method: "GET",
        path: "/runtime-config?source=test",
        status: 200,
        workerRole: "reader"
      });
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      console.info = originalInfo;
    }
  });

  test("serves health bootstrap reads before initializing the local reader handler", async () => {
    const calls: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return Response.json({ error: "writer should not receive health" }, { status: 503 });
    }) as unknown as typeof fetch;

    let localInitialized = false;
    const local = async () => {
      localInitialized = true;
      return Response.json({ error: "reader handler should not initialize" }, { status: 503 });
    };
    const bootstrap = (request: Request) => {
      return new URL(request.url).pathname === "/health"
        ? Response.json({ ok: true, backend: { worker: { role: "reader" } } })
        : undefined;
    };
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl, bootstrap);

    const response = await handler(new Request("http://localhost/health"));

    expect(localInitialized).toBe(false);
    expect(calls).toEqual([]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, backend: { worker: { role: "reader" } } });
  });

  test("serves indexed gameplay reads locally on reader workers", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    const local = async () => {
      return Response.json({ ok: true, worker: "reader" });
    };
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    for (const path of [
      "/highscores?limit=10",
      "/universe/galaxies/6/systems/9",
      "/wallet/0x1111111111111111111111111111111111111111/infrastructure",
      "/raid-finder/debris"
    ]) {
      const response = await handler(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
    }

    expect(calls).toEqual([]);
  });

  test("keeps runtime-config local when the writer is busy", async () => {
    const fetchImpl = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      return Response.json({ error: "late writer response" }, { status: 503 });
    }) as unknown as typeof fetch;

    const local = async () => Response.json({
      backend: { worker: { role: "reader" } },
      apiUrl: "https://api-test.veydrift.com",
      chainId: 84532
    });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(new Request("http://localhost/runtime-config"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      backend: { worker: { role: "reader" } },
      apiUrl: "https://api-test.veydrift.com",
      chainId: 84532
    });
  });

  test("keeps health local when the writer is busy", async () => {
    const fetchImpl = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      return Response.json({ error: "late writer response" }, { status: 503 });
    }) as unknown as typeof fetch;

    const local = async () => Response.json({
      ok: true,
      backend: { worker: { role: "reader" } },
      readiness: { ready: true }
    });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      backend: { worker: { role: "reader" } },
      readiness: { ready: true }
    });
  });

  test("keeps bootstrap reads local while a writer-owned read is waiting on the writer", async () => {
    let releaseWriter!: () => void;
    const writerReady = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const fetchImpl = (async () => {
      await writerReady;
      return Response.json({ rankings: {} });
    }) as unknown as typeof fetch;

    const local = async () => Response.json({ error: "reader handler should not initialize" }, { status: 503 });
    const bootstrap = (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/runtime-config") return Response.json({ backend: { worker: { role: "reader" } } });
      if (pathname === "/health") return Response.json({ ok: true, backend: { worker: { role: "reader" } } });
      return undefined;
    };
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl, bootstrap);

    const indexedRead = handler(new Request("http://localhost/chain/events"));
    await Promise.resolve();

    const runtime = await handler(new Request("http://localhost/runtime-config"));
    const health = await handler(new Request("http://localhost/health"));

    expect(runtime.status).toBe(200);
    expect(health.status).toBe(200);
    await expect(runtime.json()).resolves.toMatchObject({ backend: { worker: { role: "reader" } } });
    await expect(health.json()).resolves.toMatchObject({ ok: true, backend: { worker: { role: "reader" } } });

    releaseWriter();
    await expect(indexedRead.then((response) => response.json())).resolves.toEqual({ rankings: {} });
  });

  test("aborts the writer SSE request when the client cancels the forwarded stream", async () => {
    let upstreamCanceled = false;
    let fetchAborted = false;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => {
        fetchAborted = true;
      });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("event: sync-status\n\n"));
          },
          cancel() {
            upstreamCanceled = true;
          }
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }
      );
    }) as unknown as typeof fetch;

    const local = async () => new Response("reader-has-no-chain-sync", { status: 503 });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(new Request("http://localhost/chain/events"));
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    await expect(reader!.read()).resolves.toMatchObject({ done: false });
    await reader!.cancel("client navigated away");

    expect(fetchAborted).toBe(true);
    expect(upstreamCanceled).toBe(true);
  });

  test("aborts the writer SSE request when the original browser request aborts", async () => {
    let fetchAborted = false;
    const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => {
        fetchAborted = true;
      });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("event: sync-status\n\n"));
          }
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        }
      );
    }) as unknown as typeof fetch;

    const local = async () => new Response("reader-has-no-chain-sync", { status: 503 });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);
    const abortController = new AbortController();

    const response = await handler(new Request("http://localhost/chain/events", {
      signal: abortController.signal
    }));
    expect(response.status).toBe(200);

    abortController.abort();

    expect(fetchAborted).toBe(true);
  });

  test("does not try to consume a body when forwarding bodyless writer-only reads", async () => {
    const fetchImpl = (async () =>
      new Response("event: sync-status\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })) as unknown as typeof fetch;
    const local = async () => new Response("reader-has-no-chain-sync", { status: 503 });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const request = {
      headers: new Headers(),
      method: "GET",
      url: "http://localhost/chain/events",
      arrayBuffer: () => {
        throw new Error("GET forwarding must not read a request body");
      }
    } as unknown as Request;

    const response = await handler(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("event: sync-status\n\n");
  });

  test("returns 502 writer_unavailable when forwarding fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const local = async () => new Response("local", { status: 200 });
    const handler = createForwardingFetch(local, "http://127.0.0.1:4001", fetchImpl);

    const response = await handler(new Request("http://localhost/webhooks/alchemy", { method: "POST" }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "writer_unavailable" });
  });
});

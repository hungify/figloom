import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { capture } from "../src/index.ts";

// Real HTTP server (not a data: URL): cookies, headers, basic auth, and query params all
// need a real origin/request to prove they actually reached the network layer, not just
// that Playwright didn't throw.
function serve(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    // Explicit Content-Type removes any MIME-sniffing ambiguity for the browser — without
    // it, whether inline <script> tags execute is not guaranteed to be consistent.
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

// Every case renders a marker element only when the server (or, for localStorage, the page
// itself) observed the expected auth signal — capture() then either succeeds (element
// present) or rejects with READY_SELECTOR_NOT_FOUND (absent), reusing existing capture()
// semantics instead of adding new instrumentation.
const MARKER_HTML = '<div data-testid="marker">ok</div>';
const EMPTY_HTML = "<div>no marker</div>";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-target-auth-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let activeServer: { url: string; close: () => Promise<void> } | undefined;
afterEach(async () => {
  await activeServer?.close();
  activeServer = undefined;
});

let counter = 0;
function outPath(): string {
  counter += 1;
  return path.join(tmp, `case-${counter}`, "actual.png");
}

describe("target auth declarative fields", () => {
  it("extraHeaders reach the server", async () => {
    activeServer = await serve((req, res) => {
      res.end(req.headers["x-api-key"] === "secret" ? MARKER_HTML : EMPTY_HTML);
    });
    const ok = await capture({
      url: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      extraHeaders: { "X-Api-Key": "secret" },
    });
    expect(ok.ok).toBe(true);

    const missing = await capture({
      url: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      timeoutMs: 2_000,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("READY_SELECTOR_NOT_FOUND");
  });

  it("cookies reach the server", async () => {
    activeServer = await serve((req, res) => {
      res.end(req.headers.cookie?.includes("session=abc123") ? MARKER_HTML : EMPTY_HTML);
    });
    const result = await capture({
      url: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      cookies: [{ name: "session", value: "abc123", domain: "127.0.0.1" }],
    });
    expect(result.ok).toBe(true);
  });

  it("basicAuth reaches the server", async () => {
    activeServer = await serve((req, res) => {
      const expected = `Basic ${Buffer.from("user:pass").toString("base64")}`;
      // The browser only ever sends credentials after a real 401 challenge — Chromium
      // never sends Authorization on a bare first request.
      if (req.headers.authorization !== expected) {
        res.setHeader("WWW-Authenticate", 'Basic realm="test"');
        res.statusCode = 401;
        res.end(EMPTY_HTML);
        return;
      }
      res.end(MARKER_HTML);
    });
    const result = await capture({
      url: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      basicAuth: { username: "user", password: "pass" },
    });
    expect(result.ok).toBe(true);
  });

  it("queryParams are appended to the navigated URL", async () => {
    activeServer = await serve((req, res) => {
      const query = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
      res.end(query.get("token") === "xyz" ? MARKER_HTML : EMPTY_HTML);
    });
    const result = await capture({
      url: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      queryParams: { token: "xyz" },
    });
    expect(result.ok).toBe(true);
  });

  it("queryParams are merged into expectedUrl before comparison", async () => {
    activeServer = await serve((_req, res) => res.end(MARKER_HTML));
    const result = await capture({
      url: activeServer.url,
      expectedUrl: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      queryParams: { token: "xyz" },
      samples: 2,
    });
    expect(result.ok).toBe(true);
  });

  it("localStorage is seeded before the page's own script runs", async () => {
    activeServer = await serve((_req, res) => {
      // Explicit <body> first: a bare <script> with no preceding body content parses into
      // <head>, where document.body is still null when it executes.
      res.end(`
        <body><script>
          if (localStorage.getItem("flag") === "seeded") {
            document.body.innerHTML = '${MARKER_HTML}';
          }
        </script></body>
      `);
    });
    const result = await capture({
      url: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      localStorage: { flag: "seeded" },
    });
    expect(result.ok).toBe(true);
  });

  it("authenticate hook runs, with page access, before navigation to the target URL", async () => {
    activeServer = await serve((req, res) => {
      res.end(req.headers.cookie?.includes("authed=true") ? MARKER_HTML : EMPTY_HTML);
    });
    let calledBeforeGoto = false;
    const result = await capture({
      url: activeServer.url,
      outPath: outPath(),
      viewportSize: { width: 320, height: 200 },
      readySelector: "[data-testid=marker]",
      authenticate: async (page) => {
        calledBeforeGoto = page.url() === "about:blank";
        await page.context().addCookies([
          { name: "authed", value: "true", domain: "127.0.0.1", path: "/" },
        ]);
      },
    });
    expect(calledBeforeGoto).toBe(true);
    expect(result.ok).toBe(true);
  });
});

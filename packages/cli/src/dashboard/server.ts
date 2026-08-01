import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { DashboardEvent, DashboardRun } from "@figloom/contracts";

export interface DashboardSource {
  snapshot: () => DashboardRun | Promise<DashboardRun>;
  files: () => Map<string, string> | Promise<Map<string, string>>;
  subscribe?: (listener: (event: DashboardEvent) => void) => () => void;
}

export interface DashboardServer {
  url: string;
  close: () => Promise<void>;
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

async function sendFile(filePath: string): Promise<Response> {
  try {
    const data = await fs.readFile(filePath);
    return new Response(data, {
      headers: {
        "content-type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
        "cache-control": path.extname(filePath) === ".html" ? "no-store" : "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response("Not found", { status: 404 });
    throw error;
  }
}

function contained(root: string, requestPath: string): string | undefined {
  const candidate = path.resolve(root, requestPath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : undefined;
}

export async function startDashboardServer(options: {
  source: DashboardSource;
  hostname?: string;
  port?: number;
  clientRoot?: string;
}): Promise<DashboardServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  const clientRoot = options.clientRoot ?? fileURLToPath(new URL("../../dist/dashboard", import.meta.url));
  await fs.access(path.join(clientRoot, "index.html")).catch(() => {
    throw new Error(`Dashboard build missing: ${clientRoot}. Run pnpm --filter @figloom/dashboard build.`);
  });
  const app = new Hono();

  app.get("/api/run", async (context) => context.json(await options.source.snapshot(), 200, { "cache-control": "no-store" }));
  app.get("/api/meta", (context) => context.json({ live: Boolean(options.source.subscribe) }, 200, { "cache-control": "no-store" }));
  app.get("/api/contracts", async (context) => {
    const id = context.req.query("id");
    const result = (await options.source.snapshot()).contracts.find((contract) => contract.id === id);
    return result ? context.json(result) : context.json({ error: "Contract not found" }, 404);
  });
  app.get("/artifacts/*", async (context) => {
    const requested = context.req.path.slice("/artifacts/".length);
    const files = await options.source.files();
    const filePath = files.get(requested) ?? files.get(decodeURIComponent(requested));
    return filePath ? sendFile(filePath) : context.json({ error: "Artifact not found" }, 404);
  });
  app.get("/events", (context) => {
    if (!options.source.subscribe) return context.json({ error: "Live events unavailable for archived run." }, 404);
    return streamSSE(context, async (stream) => {
      let chain = Promise.resolve();
      const unsubscribe = options.source.subscribe!((event) => {
        chain = chain.then(() => stream.writeSSE({
          id: String(event.sequence),
          event: "run",
          data: JSON.stringify(event),
        })).catch(() => undefined);
      });
      chain = chain.then(async () => {
        const snapshot = await options.source.snapshot();
        await stream.writeSSE({
          id: "sync",
          event: "run",
          data: JSON.stringify({
            sequence: 0,
            runId: snapshot.runId,
            status: snapshot.status,
            timestamp: snapshot.updatedAt,
          } satisfies DashboardEvent),
        });
      }).catch(() => undefined);
      const heartbeat = setInterval(() => {
        chain = chain.then(() => stream.writeSSE({ event: "heartbeat", data: "{}" })).catch(() => undefined);
      }, 15_000);
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });
  app.get("*", async (context) => {
    const requested = context.req.path === "/" ? "index.html" : context.req.path.slice(1);
    const candidate = contained(clientRoot, requested);
    if (candidate) {
      try {
        if ((await fs.stat(candidate)).isFile()) return sendFile(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return sendFile(path.join(clientRoot, "index.html"));
  });

  const server = await new Promise<ServerType>((resolve, reject) => {
    const instance = serve({ fetch: app.fetch, hostname, port: options.port ?? 0 }, () => resolve(instance));
    instance.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve dashboard server address.");
  return {
    url: `http://${hostname}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

export async function waitForDashboardShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

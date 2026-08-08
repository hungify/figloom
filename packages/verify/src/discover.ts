import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { DEFAULT_DISCOVERY_DIR, discoveredContractSchema, type BaselineSource, type ContractScope, type DiscoveredContract } from "@figloom/contracts";

export { DEFAULT_DISCOVERY_DIR };

export interface VisualContractOptions {
  id: string;
  baseline: BaselineSource;
  /** Defaults to "{width}x{height}" when omitted. */
  viewportName?: string;
  /** Defaults to full-page scope. */
  scope?: ContractScope;
  pageReason?: string;
  expectedUrl?: string;
  readySelector?: string;
  auth?: "none" | "storageState";
  projectRoot?: string;
  /** Relative to projectRoot. Default: DEFAULT_DISCOVERY_DIR. */
  discoveryDir?: string;
}

/** Minimal page surface — url + viewport only; no Playwright type dependency. */
export type VisualContractPage = {
  url: () => string;
  viewportSize: () => { width: number; height: number } | null;
};

export async function visualContract(
  page: VisualContractPage,
  options: VisualContractOptions,
): Promise<DiscoveredContract> {
  const viewportSize = page.viewportSize();
  if (!viewportSize) {
    throw new Error(
      "visualContract: page has no viewport size — set one via test.use({ viewport }) or newPage({ viewport }).",
    );
  }

  const record = discoveredContractSchema.parse({
    id: options.id,
    url: page.url(),
    viewport: {
      name: options.viewportName ?? `${viewportSize.width}x${viewportSize.height}`,
      width: viewportSize.width,
      height: viewportSize.height,
    },
    baseline: options.baseline,
    scope: options.scope ?? {
      kind: "page",
      pageReason: options.pageReason ?? "Full page recorded from an existing e2e test via visualContract().",
    },
    ...(options.expectedUrl ? { expectedUrl: options.expectedUrl } : {}),
    ...(options.readySelector ? { readySelector: options.readySelector } : {}),
    ...(options.auth ? { auth: options.auth } : {}),
    recordedAt: new Date().toISOString(),
  });

  const dir = path.resolve(options.projectRoot ?? process.cwd(), options.discoveryDir ?? DEFAULT_DISCOVERY_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const safeId = record.id.replaceAll(/[^a-z0-9.-]/gi, "_");
  const uniqueSuffix = crypto.randomBytes(6).toString("hex");
  const filePath = path.join(dir, `${safeId}.${process.pid}.${uniqueSuffix}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);

  return record;
}

export interface DiscoveredContractFile {
  filePath: string;
  record: DiscoveredContract;
}

export function readDiscoveredContracts(dir: string): DiscoveredContractFile[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries.map((name) => {
    const filePath = path.join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`Cannot parse discovered contract ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      return { filePath, record: discoveredContractSchema.parse(parsed) };
    } catch (error) {
      throw new Error(`Invalid discovered contract ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

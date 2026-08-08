import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_DISCOVERY_DIR,
  MAX_CONTRACTS_PER_REQUEST,
  SCHEMA_VERSION,
  VISUAL_CONTRACT_FILE,
  verificationRequestSchema,
  visualArtifactPath,
  type DiscoveredContract,
  type VerificationRequest,
} from "@figloom/contracts";
import { readDiscoveredContracts, type DiscoveredContractFile } from "@figloom/verify";

export { DEFAULT_DISCOVERY_DIR };

export interface DiscoverOptions {
  projectRoot: string;
  discoveryDir?: string;
  keepDiscovery?: boolean;
}

export interface DiscoverGroupResult {
  feature: string;
  outputPath: string;
  request: VerificationRequest;
}

export interface DiscoverResult {
  discoveredCount: number;
  groups: DiscoverGroupResult[];
}

function featureFor(url: string): string {
  const segment = new URL(url).pathname.split("/").find((part) => part.length > 0);
  return segment ?? "root";
}

export function hostSegments(url: string): string[] {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase().replaceAll(/[^a-z0-9.-]/g, "_");
  return parsed.port ? [hostname, parsed.port] : [hostname];
}

export function queryPathSegment(url: string): string | undefined {
  const entries = [...new URL(url).searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return undefined;
  const digest = crypto
    .createHash("sha256")
    .update(entries.map(([key, value]) => `${key}=${value}`).join("&"))
    .digest("hex")
    .slice(0, 8);
  return `q-${digest}`;
}

function targetFingerprint(record: DiscoveredContract): string {
  return JSON.stringify({
    expectedUrl: record.expectedUrl ?? null,
    readySelector: record.readySelector ?? null,
    auth: record.auth ?? null,
  });
}

function assertCompatibleTargets(records: DiscoveredContract[]): void {
  const first = targetFingerprint(records[0]!);
  for (const record of records.slice(1)) {
    if (targetFingerprint(record) === first) continue;
    throw new Error(
      `Incompatible target settings for ${records[0]!.url}: recordings in one URL group must share the same expectedUrl, readySelector, and auth. ` +
        `Split recordings or clear discovery and re-record with a consistent target configuration.`,
    );
  }
}

function buildRequest(records: DiscoveredContract[]): VerificationRequest {
  assertCompatibleTargets(records);
  const url = records[0]!.url;
  const expectedUrl = records[0]!.expectedUrl;
  const readySelector = records[0]!.readySelector;
  const auth = records[0]!.auth;
  const feature = featureFor(url);
  const querySegment = queryPathSegment(url);
  const idSuffix = (record: DiscoveredContract) =>
    record.id.startsWith(`${feature}.`) ? record.id.slice(feature.length + 1) : record.id;

  return verificationRequestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    target: {
      kind: "web",
      url,
      ...(expectedUrl ? { expectedUrl } : {}),
      ...(readySelector ? { readySelector } : {}),
      ...(auth ? { auth } : {}),
    },
    contracts: records.map((record) => ({
      id: record.id,
      baseline: record.baseline,
      viewport: record.viewport,
      outDir: visualArtifactPath(
        ...hostSegments(url),
        feature,
        ...(querySegment ? [querySegment] : []),
        idSuffix(record).replaceAll(".", "/"),
      ),
      scope: record.scope,
    })),
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export function runDiscover(options: DiscoverOptions): DiscoverResult {
  const discoveryDir = path.resolve(options.projectRoot, options.discoveryDir ?? DEFAULT_DISCOVERY_DIR);
  const files = readDiscoveredContracts(discoveryDir);
  if (files.length === 0) return { discoveredCount: 0, groups: [] };

  const byUrl = new Map<string, DiscoveredContractFile[]>();
  for (const file of files) {
    const list = byUrl.get(file.record.url);
    if (list) list.push(file);
    else byUrl.set(file.record.url, [file]);
  }

  const groups: DiscoverGroupResult[] = [];
  for (const [url, sameUrlFiles] of byUrl) {
    const seenIds = new Map<string, string>();
    for (const file of sameUrlFiles) {
      const previousFilePath = seenIds.get(file.record.id);
      if (previousFilePath) {
        throw new Error(
          `Duplicate discovered contract id "${file.record.id}" for ${url}: ${previousFilePath} and ${file.filePath}. ` +
            `Likely a stale recording from a prior run — clear ${discoveryDir} and rerun the e2e suite before discovering again.`,
        );
      }
      seenIds.set(file.record.id, file.filePath);
    }

    const feature = featureFor(url);
    const querySegment = queryPathSegment(url);
    const batches = chunk(sameUrlFiles, MAX_CONTRACTS_PER_REQUEST);
    batches.forEach((batch, batchIndex) => {
      const request = buildRequest(batch.map((file) => file.record));
      const batchSuffix = batches.length > 1 ? `-${batchIndex + 1}` : "";
      const basename = `${feature}${querySegment ? `.${querySegment}` : ""}${batchSuffix}`;
      const outputPath = path.resolve(
        options.projectRoot,
        visualArtifactPath(...hostSegments(url), `${basename}.${VISUAL_CONTRACT_FILE}`),
      );
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(request, null, 2)}\n`);
      groups.push({ feature, outputPath, request });
    });
  }

  if (!options.keepDiscovery) {
    for (const file of files) fs.rmSync(file.filePath, { force: true });
  }

  return { discoveredCount: files.length, groups };
}

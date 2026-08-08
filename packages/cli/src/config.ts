import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvFiles } from "@figloom/verify";

export interface FigloomConfig {
  storageStatePath?: string;
  envFile?: string | string[];
}

export interface ResolvedFigloomConfig extends FigloomConfig {
  configPath?: string;
  resolvedStorageStatePath?: string;
}

const CONFIG_NAMES = [
  "figloom.config.ts",
  "figloom.config.mts",
  "figloom.config.js",
  "figloom.config.mjs",
] as const;

const KNOWN_KEYS = new Set(["storageStatePath", "envFile"]);

export function defineConfig(config: FigloomConfig): FigloomConfig {
  return config;
}

function assertProjectRelativePath(value: string, label: string): void {
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new Error(`figloom.config ${label} must be project-relative without parent traversal.`);
  }
}

function normalizeEnvFile(value: unknown): string | string[] | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    if (!value.trim()) throw new Error("figloom.config envFile must be a non-empty string.");
    assertProjectRelativePath(value, "envFile");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error("figloom.config envFile must not be an empty array.");
    for (const entry of value) {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new Error("figloom.config envFile array entries must be non-empty strings.");
      }
      assertProjectRelativePath(entry, "envFile");
    }
    return value as string[];
  }
  throw new Error("figloom.config envFile must be a string or string array.");
}

export async function loadFigloomConfig(projectRoot: string): Promise<ResolvedFigloomConfig> {
  const root = path.resolve(projectRoot);
  const matches = CONFIG_NAMES
    .map((name) => path.join(root, name))
    .filter((filePath) => fs.existsSync(filePath));

  if (matches.length === 0) return {};
  if (matches.length > 1) {
    throw new Error(`Multiple Figloom config files found: ${matches.join(", ")}. Keep exactly one.`);
  }

  const configPath = matches[0]!;
  const imported = await import(pathToFileURL(configPath).href);
  const value: unknown = imported.default;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${configPath} must default-export a Figloom config object.`);
  }

  const config = value as Record<string, unknown>;
  const unknownKeys = Object.keys(config).filter((key) => !KNOWN_KEYS.has(key));
  if (unknownKeys.length) {
    throw new Error(`Unknown Figloom config option${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys.join(", ")}.`);
  }

  const envFile = normalizeEnvFile(config.envFile);
  if (envFile) loadEnvFiles(root, envFile);

  const storageStatePath = config.storageStatePath;
  if (storageStatePath != null && (typeof storageStatePath !== "string" || !storageStatePath.trim())) {
    throw new Error("figloom.config storageStatePath must be a non-empty string.");
  }
  if (typeof storageStatePath === "string") {
    assertProjectRelativePath(storageStatePath, "storageStatePath");
    return {
      configPath,
      storageStatePath,
      ...(envFile ? { envFile } : {}),
      resolvedStorageStatePath: path.resolve(root, storageStatePath),
    };
  }

  return {
    configPath,
    ...(envFile ? { envFile } : {}),
  };
}

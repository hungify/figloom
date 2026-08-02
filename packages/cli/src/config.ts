import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export interface FigloomConfig {
  storageStatePath?: string;
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

export function defineConfig(config: FigloomConfig): FigloomConfig {
  return config;
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
  const unknownKeys = Object.keys(config).filter((key) => key !== "storageStatePath");
  if (unknownKeys.length) {
    throw new Error(`Unknown Figloom config option${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys.join(", ")}.`);
  }

  const storageStatePath = config.storageStatePath;
  if (storageStatePath != null && (typeof storageStatePath !== "string" || !storageStatePath.trim())) {
    throw new Error("figloom.config storageStatePath must be a non-empty string.");
  }
  if (typeof storageStatePath === "string") {
    if (path.isAbsolute(storageStatePath) || storageStatePath.split(/[\\/]/).includes("..")) {
      throw new Error("figloom.config storageStatePath must be project-relative without parent traversal.");
    }
    return {
      configPath,
      storageStatePath,
      resolvedStorageStatePath: path.resolve(root, storageStatePath),
    };
  }

  return { configPath };
}

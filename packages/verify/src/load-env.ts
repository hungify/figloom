import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_ENV_FILES = [".env.local", ".env"] as const;

export interface LoadProjectEnvOptions {
  files?: string[];
}

export function loadProjectEnv(
  projectRoot: string = process.cwd(),
  options?: LoadProjectEnvOptions,
): string[] {
  return loadEnvFiles(projectRoot, options?.files ?? [...DEFAULT_ENV_FILES], { required: false });
}

export function loadEnvFiles(
  projectRoot: string,
  envFile: string | string[],
  options?: { required?: boolean },
): string[] {
  const root = path.resolve(projectRoot);
  const names = Array.isArray(envFile) ? envFile : [envFile];
  const required = options?.required ?? true;
  const loaded: string[] = [];

  for (const name of names) {
    if (!name.trim()) throw new Error("envFile entries must be non-empty strings.");
    if (path.isAbsolute(name) || name.split(/[\\/]/).includes("..")) {
      throw new Error("envFile must be project-relative without parent traversal.");
    }
    const file = path.resolve(root, name);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      throw new Error(`envFile escapes project root: ${name}`);
    }
    if (!fs.existsSync(file)) {
      if (required) throw new Error(`envFile not found: ${name}`);
      continue;
    }
    applyEnvFile(file);
    loaded.push(file);
  }
  return loaded;
}

function applyEnvFile(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

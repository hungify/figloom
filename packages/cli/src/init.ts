import * as fs from "node:fs";
import * as path from "node:path";

import * as p from "@clack/prompts";

const CONFIG_FILES = [
  "figloom.config.ts",
  "figloom.config.mts",
  "figloom.config.js",
  "figloom.config.mjs",
] as const;
const AUTH_STATE_PATH = ".figloom/auth/user.json";
const AUTH_GITIGNORE = "*\n!.gitignore\n";
const CONFIG_SOURCE = `import { defineConfig } from "figloom-verify";

export default defineConfig({
  // Authenticated screens only:
  // storageStatePath: "${AUTH_STATE_PATH}",
});
`;

export interface ProjectInitResult {
  configPath: string;
  authStatePath: string;
  authGitignorePath: string;
}

export function initializeProject(
  projectRoot: string,
  force = false,
): ProjectInitResult {
  const root = path.resolve(projectRoot);
  const existingConfigPaths = CONFIG_FILES
    .map((name) => path.join(root, name))
    .filter((filePath) => fs.existsSync(filePath));
  if (existingConfigPaths.length > 1) {
    throw new Error(`Multiple Figloom config files found: ${existingConfigPaths.join(", ")}. Keep exactly one.`);
  }
  const configPath = existingConfigPaths[0] ?? path.join(root, CONFIG_FILES[0]);
  const authStatePath = path.join(root, AUTH_STATE_PATH);
  const authGitignorePath = path.join(path.dirname(authStatePath), ".gitignore");

  if (existingConfigPaths.length === 1 && !force) {
    throw new Error(`Refusing to overwrite existing file: ${configPath}. Pass --force to replace it.`);
  }

  fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
  fs.writeFileSync(configPath, CONFIG_SOURCE, "utf8");
  if (!fs.existsSync(authGitignorePath)) {
    fs.writeFileSync(authGitignorePath, AUTH_GITIGNORE, "utf8");
  }

  return { configPath, authStatePath, authGitignorePath };
}

export async function runProjectInit(options: {
  projectRoot: string;
  force?: boolean;
}): Promise<void> {
  p.intro("Initialize Figloom");
  const result = initializeProject(options.projectRoot, options.force);
  p.note(
    [
      `Config: ${path.relative(options.projectRoot, result.configPath)}`,
      "Authenticated screens (optional):",
      `  save Playwright state to ${path.relative(options.projectRoot, result.authStatePath)}`,
      "  then uncomment storageStatePath in figloom.config.ts",
      "Auth state directory is ignored by Git.",
      "",
      "Next: figloom contract create",
    ].join("\n"),
    "Project ready",
  );
  p.outro("Figloom initialized");
}

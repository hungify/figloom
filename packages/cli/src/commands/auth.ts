import * as fs from "node:fs";
import * as path from "node:path";

import * as p from "@clack/prompts";
import type { Command } from "commander";

import { recordStorageState } from "@figloom/verify";
import { loadFigloomConfig } from "../config.ts";
import { subcommand } from "./shared.ts";

interface AuthOptions {
  url: string;
  projectRoot?: string;
}

function validateHttpUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return;
  } catch {
    // Use shared error below.
  }
  throw new Error("Auth URL must use http:// or https://.");
}

async function confirm(message: string): Promise<void> {
  const answer = await p.confirm({ message, initialValue: true });
  if (p.isCancel(answer) || !answer) throw new Error("Auth capture cancelled.");
}

async function authCommand(options: AuthOptions): Promise<void> {
  validateHttpUrl(options.url);
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const config = await loadFigloomConfig(projectRoot);
  if (!config.resolvedStorageStatePath) {
    throw new Error(
      "storageStatePath is not configured. Uncomment it in figloom.config.ts before running figloom auth.",
    );
  }

  p.intro("Record Playwright login state");
  if (fs.existsSync(config.resolvedStorageStatePath)) {
    await confirm(`Replace existing auth state at ${config.storageStatePath}?`);
  }

  const result = await recordStorageState({
    url: options.url,
    outputPath: config.resolvedStorageStatePath,
    waitForUser: () => confirm("Finish login in browser, then save session?"),
  });
  p.note(
    [`Final URL: ${result.finalUrl}`, `Saved: ${config.storageStatePath}`, "Session file remains ignored by Git."].join("\n"),
    "Auth ready",
  );
  p.outro("Use target.auth=storageState for protected screens.");
}

export function registerAuthCommand(program: Command): void {
  program.addCommand(
    subcommand("auth", "Open Playwright for login and save browser session state.")
      .requiredOption("--url <url>", "login URL")
      .option("--project-root <dir>", "target project root")
      .action(authCommand),
  );
}

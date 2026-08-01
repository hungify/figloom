import * as path from "node:path";

import * as p from "@clack/prompts";
import { FIGMA_NODE_ID } from "@figloom/contracts";
import {
  createInitRequest,
  writeInitRequest,
  type InitAnswers,
} from "./init/scaffold.ts";

export { createInitRequest, writeInitRequest } from "./init/scaffold.ts";

type BaselineAnswers = InitAnswers["baseline"];

function cancelled(value: unknown): value is symbol {
  if (!p.isCancel(value)) return false;
  p.cancel("Setup cancelled.");
  process.exitCode = 1;
  return true;
}

function validateHttpUrl(value: string | undefined): string | undefined {
  if (value == null) return "Required.";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return undefined;
  } catch {
    // Return shared validation message below.
  }
  return "Enter an http:// or https:// URL.";
}

function positiveInteger(value: string | undefined): string | undefined {
  if (value == null) return "Required.";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? undefined : "Enter a positive integer.";
}

function required(value: string | undefined): string | undefined {
  return value?.trim() ? undefined : "Required.";
}

async function text(options: Parameters<typeof p.text>[0]): Promise<string | undefined> {
  const value = await p.text(options);
  return cancelled(value) ? undefined : value;
}

async function select<T extends string>(options: Parameters<typeof p.select<T>>[0]): Promise<T | undefined> {
  const value = await p.select<T>(options);
  return cancelled(value) ? undefined : value;
}

export async function runInit(options: {
  projectRoot: string;
  outputPath?: string;
  force?: boolean;
}): Promise<void> {
  p.intro("Figloom visual verification setup");

  const targetUrl = await text({
    message: "Target application URL",
    placeholder: "http://127.0.0.1:3000",
    initialValue: "http://127.0.0.1:3000",
    validate: validateHttpUrl,
  });
  if (!targetUrl) return;

  const contractId = await text({
    message: "Contract ID",
    placeholder: "home.desktop",
    initialValue: "home.desktop",
    validate: (value) =>
      /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value ?? "")
        ? undefined
        : "Use lowercase letters, numbers, dots, or hyphens.",
  });
  if (!contractId) return;

  const baselineKind = await select<"figma" | "web">({
    message: "Baseline source",
    options: [
      { value: "figma", label: "Figma frame" },
      { value: "web", label: "Reference website" },
    ],
  });
  if (!baselineKind) return;

  let baseline: BaselineAnswers;
  if (baselineKind === "figma") {
    const fileKey = await text({ message: "Figma file key", validate: required });
    if (!fileKey) return;
    const nodeId = await text({
      message: "Figma node ID",
      placeholder: "153:5181",
      validate: (value) => FIGMA_NODE_ID.test(value ?? "") ? undefined : "Enter a Figma node ID such as 153:5181.",
    });
    if (!nodeId) return;
    baseline = { kind: "figma", fileKey, nodeId };
  } else {
    const url = await text({ message: "Reference website URL", validate: validateHttpUrl });
    if (!url) return;
    const revision = await text({
      message: "Reference revision",
      placeholder: "git:a1b2c3d",
      validate: required,
    });
    if (!revision) return;
    baseline = { kind: "web", url, revision };
  }

  const viewportPreset = await select<"desktop" | "mobile" | "custom">({
    message: "Viewport",
    options: [
      { value: "desktop", label: "Desktop", hint: "1440 × 1024" },
      { value: "mobile", label: "Mobile", hint: "390 × 844" },
      { value: "custom", label: "Custom" },
    ],
  });
  if (!viewportPreset) return;

  let viewport: InitAnswers["viewport"];
  if (viewportPreset === "custom") {
    const name = await text({ message: "Viewport name", placeholder: "tablet", validate: required });
    if (!name) return;
    const width = await text({ message: "Viewport width", validate: positiveInteger });
    if (!width) return;
    const height = await text({ message: "Viewport height", validate: positiveInteger });
    if (!height) return;
    viewport = { name, width: Number(width), height: Number(height) };
  } else {
    viewport = viewportPreset === "desktop"
      ? { name: "desktop", width: 1440, height: 1024 }
      : { name: "mobile", width: 390, height: 844 };
  }

  const scopeKind = await select<"page" | "region">({
    message: "Capture scope",
    options: [
      { value: "page", label: "Full page" },
      { value: "region", label: "Element or region" },
    ],
  });
  if (!scopeKind) return;

  let scope: InitAnswers["scope"];
  if (scopeKind === "page") {
    const pageReason = await text({
      message: "Why does baseline represent complete page?",
      placeholder: "Baseline node represents complete page.",
      initialValue: "Baseline node represents complete page.",
      validate: required,
    });
    if (!pageReason) return;
    scope = { kind: "page", pageReason };
  } else {
    const selector = await text({ message: "CSS selector", placeholder: "[data-testid=card]", validate: required });
    if (!selector) return;
    const width = await text({ message: "Expected region width", validate: positiveInteger });
    if (!width) return;
    const height = await text({ message: "Expected region height", validate: positiveInteger });
    if (!height) return;
    scope = { kind: "region", selector, expectSize: { width: Number(width), height: Number(height) } };
  }

  const request = createInitRequest({ targetUrl, contractId, baseline, viewport, scope });
  const outputPath = path.resolve(options.projectRoot, options.outputPath ?? ".figloom/visual-contract.json");
  writeInitRequest(outputPath, request, options.force);
  p.outro(`Created ${outputPath}`);
}

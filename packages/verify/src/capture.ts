import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";

import {
  DEFAULT_CAPTURE_TIMEOUT_MS,
  DEVICE_SCALE_FACTOR,
  NETWORK_IDLE_BEST_EFFORT_MS,
  NETWORK_IDLE_BUFFER_MS,
  SELECTOR_TIMEOUT_MS,
} from "./constants.ts";
import type { ComputedTextStyle, RejectResult } from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

const NO_ANIMATION_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`;

export interface CaptureOptions {
  url: string;
  expectedUrl?: string;
  readySelector?: string;
  storageStatePath?: string;
  outPath: string;
  viewportSize: { width: number; height: number };
  selector?: string;
  fullPage?: boolean;
  hideDevtoolsChrome?: boolean;
  devtoolsMarker?: string;
  samples?: number;
  persistStabilitySamples?: boolean;
  timeoutMs?: number;
  maskSelectors?: string[];
  /** Applied before navigation each capture. Independent of storageStatePath. */
  cookies?: Array<{ name: string; value: string; domain: string; path?: string }>;
  extraHeaders?: Record<string, string>;
  localStorage?: Record<string, string>;
  queryParams?: Record<string, string>;
  basicAuth?: { username: string; password: string };
  /** Pre-navigation login hook (OAuth/2FA); not expressible in JSON contract. */
  authenticate?: (page: Page) => Promise<void>;
}

export interface CaptureSuccess {
  ok: true;
  capturePaths: string[];
  ephemeralSamplePaths: string[];
  capturedAt: string;
  elementRect: { width: number; height: number } | null;
  computedStyle: ComputedTextStyle | null;
  warnings: string[];
}

export type CaptureOutcome = CaptureSuccess | RejectResult;

export async function capture(options: CaptureOptions): Promise<CaptureOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  const warnings: string[] = [];

  if (options.storageStatePath && !fs.existsSync(options.storageStatePath)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "STORAGE_STATE_NOT_FOUND",
      message: `Playwright storage state not found: ${options.storageStatePath}.`,
    };
  }

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      args: [`--force-device-scale-factor=${DEVICE_SCALE_FACTOR}`, "--disable-gpu"],
    });
    const page = await browser.newPage({
      viewport: options.viewportSize,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      ...(options.storageStatePath ? { storageState: options.storageStatePath } : {}),
      ...(options.extraHeaders ? { extraHTTPHeaders: options.extraHeaders } : {}),
      ...(options.basicAuth ? { httpCredentials: options.basicAuth } : {}),
    });

    if (options.cookies?.length) {
      await page.context().addCookies(
        options.cookies.map((cookie) => ({ ...cookie, path: cookie.path ?? "/" })),
      );
    }
    if (options.localStorage) {
      await page.addInitScript((entries: Array<[string, string]>) => {
        for (const [key, value] of entries) window.localStorage.setItem(key, value);
      }, Object.entries(options.localStorage));
    }
    await options.authenticate?.(page);

    const navigateUrl = appendQueryParams(options.url, options.queryParams);
    const expectedUrl = options.expectedUrl
      ? appendQueryParams(options.expectedUrl, options.queryParams)
      : options.expectedUrl;

    await page.goto(navigateUrl, { waitUntil: "load", timeout: timeoutMs });

    try {
      await page.reload({ waitUntil: "load", timeout: timeoutMs });
    } catch {
      warnings.push(
        "server-freshness: could not confirm server rebuild completed (reload failed); capture may be stale.",
      );
    }
    await settle(
      page,
      warnings,
      options.hideDevtoolsChrome ?? false,
      options.devtoolsMarker ?? "TANSTACK",
    );
    const targetReject = await validateTarget(page, { ...options, expectedUrl });
    if (targetReject) return targetReject;

    if (options.selector) {
      const reject = await resolveSelector(page, options.selector);
      if (reject) return reject;
    }

    const maskLocators = options.maskSelectors?.map((selector) => page.locator(selector));

    const capturedAt = new Date().toISOString();
    const capturePaths: string[] = [];
    const ephemeralSamplePaths: string[] = [];
    const samples = Math.max(1, options.samples ?? 1);
    const ext = path.extname(options.outPath) || ".png";
    let sampleDir: string | null = null;
    if (samples > 1 && !options.persistStabilitySamples) {
      sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "fidelity-stab-"));
    }
    let elementRect: { width: number; height: number } | null = null;
    let computedStyle: ComputedTextStyle | null = null;

    for (let i = 0; i < samples; i++) {
      let outPath: string;
      if (i === 0) {
        outPath = options.outPath;
      } else if (sampleDir) {
        outPath = path.join(sampleDir, `capture-${String(i + 1).padStart(2, "0")}${ext}`);
        ephemeralSamplePaths.push(outPath);
      } else {
        outPath = path.join(
          path.dirname(options.outPath),
          `capture-${String(i + 1).padStart(2, "0")}${ext}`,
        );
      }

      if (i > 0) {
        try {
          await page.reload({ waitUntil: "load", timeout: timeoutMs });
        } catch {
          warnings.push(`stability sample ${i + 1}: reload failed; sampled without reload.`);
        }
        await settle(
          page,
          warnings,
          options.hideDevtoolsChrome ?? false,
          options.devtoolsMarker ?? "TANSTACK",
        );
        const sampleTargetReject = await validateTarget(page, { ...options, expectedUrl });
        if (sampleTargetReject) return sampleTargetReject;
      }

      if (options.selector) {
        const loc = page.locator(options.selector);
        try {
          await loc.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
        } catch {
          return {
            schemaVersion: SCHEMA_VERSION,
            ok: false,
            error: "SELECTOR_NOT_FOUND",
            message: `Selector matched an element that never became visible within ${SELECTOR_TIMEOUT_MS}ms.`,
          };
        }
        if (i === 0) {
          const box = await loc.boundingBox();
          if (box) elementRect = { width: box.width, height: box.height };
          try {
            computedStyle = await readComputedTextStyle(loc);
          } catch {
            warnings.push("could not read computed style (execution context may have been destroyed).");
          }
        }
        await loc.screenshot({ path: outPath, animations: "disabled", mask: maskLocators });
      } else {
        await page.screenshot({
          path: outPath,
          fullPage: options.fullPage ?? false,
          animations: "disabled",
          mask: maskLocators,
        });
      }
      capturePaths.push(outPath);
    }

    return {
      ok: true,
      capturePaths,
      ephemeralSamplePaths,
      capturedAt,
      elementRect,
      computedStyle,
      warnings,
    };
  } finally {
    await browser?.close();
  }
}

function appendQueryParams(url: string, params: Record<string, string> | undefined): string {
  if (!params || Object.keys(params).length === 0) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) parsed.searchParams.set(key, value);
  return parsed.toString();
}

async function validateTarget(page: Page, options: CaptureOptions): Promise<RejectResult | null> {
  if (options.expectedUrl) {
    const actual = new URL(page.url()).href;
    const expected = new URL(options.expectedUrl).href;
    if (actual !== expected) {
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        error: "TARGET_URL_MISMATCH",
        message: `Playwright reached ${actual}; expected ${expected}. Check auth state, redirects, and feature flags.`,
      };
    }
  }

  if (options.readySelector) {
    const locator = page.locator(options.readySelector);
    try {
      await locator.first().waitFor({
        state: "visible",
        timeout: options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS,
      });
    } catch {
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        error: "READY_SELECTOR_NOT_FOUND",
        message: `Screen readiness selector did not become visible: ${options.readySelector}.`,
      };
    }
    const matchCount = await locator.count();
    if (matchCount !== 1) {
      return {
        schemaVersion: SCHEMA_VERSION,
        ok: false,
        error: "READY_SELECTOR_AMBIGUOUS",
        message: `Screen readiness selector matched ${matchCount} elements; provide a unique selector.`,
        matchCount,
      };
    }
  }

  return null;
}

async function readComputedTextStyle(loc: ReturnType<Page["locator"]>): Promise<ComputedTextStyle> {
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    const parsePx = (value: string): number => {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    };
    const parseColor = (
      value: string,
    ): { r: number; g: number; b: number; a: number } | null => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!context) return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      if (r == null || g == null || b == null || alpha == null) return null;
      return { r, g, b, a: alpha / 255 };
    };
    return {
      fontFamily: cs.fontFamily,
      fontWeight: Number.parseFloat(cs.fontWeight) || 400,
      fontSizePx: parsePx(cs.fontSize),
      lineHeightPx: cs.lineHeight === "normal" ? null : parsePx(cs.lineHeight),
      letterSpacingPx: cs.letterSpacing === "normal" ? 0 : parsePx(cs.letterSpacing),
      color: parseColor(cs.color),
      backgroundColor: parseColor(cs.backgroundColor),
    };
  });
}

async function resolveSelector(page: Page, selector: string): Promise<RejectResult | null> {
  const locator = page.locator(selector);
  try {
    await locator.first().waitFor({ state: "attached", timeout: SELECTOR_TIMEOUT_MS });
  } catch {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "SELECTOR_NOT_FOUND",
      message: `Selector matched 0 elements within ${SELECTOR_TIMEOUT_MS}ms.`,
    };
  }
  const matchCount = await locator.count();
  if (matchCount === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "SELECTOR_NOT_FOUND",
      message: "Selector matched 0 elements in the rendered page.",
    };
  }
  if (matchCount > 1) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "SELECTOR_AMBIGUOUS",
      message: `Selector matched ${matchCount} elements; provide a unique selector or nth-match index.`,
      matchCount,
    };
  }
  return null;
}

async function settle(
  page: Page,
  warnings: string[],
  hideDevtoolsChromeEnabled: boolean,
  devtoolsMarker: string,
): Promise<void> {
  await page
    .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_BEST_EFFORT_MS })
    .catch(() => {
      warnings.push(
        `network did not become idle within ${NETWORK_IDLE_BEST_EFFORT_MS}ms; capture may include pending requests.`,
      );
    });
  try {
    await page.addStyleTag({ content: NO_ANIMATION_CSS });
  } catch {
    warnings.push("could not inject no-animation CSS.");
  }
  try {
    await page.evaluate(async () => {
      if ("fonts" in document) {
        await (document as Document & { fonts: FontFaceSet }).fonts.ready;
      }
    });
  } catch {
    warnings.push("could not confirm fonts ready (execution context may have been destroyed).");
  }
  if (hideDevtoolsChromeEnabled) {
    try {
      await hideDevtoolsChrome(page, devtoolsMarker);
    } catch {
      warnings.push("could not hide devtools chrome (execution context may have been destroyed).");
    }
  }
  await page.waitForTimeout(NETWORK_IDLE_BUFFER_MS);
}

async function hideDevtoolsChrome(page: Page, marker: string): Promise<void> {
  await page.evaluate((markerText) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const hide: HTMLElement[] = [];
    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement;
      const ownText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (ownText.toUpperCase().startsWith(markerText)) {
        hide.push(el);
      }
    }
    for (const el of hide) {
      let node: HTMLElement | null = el;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (style.position === "fixed" || style.position === "sticky") {
          node.style.setProperty("display", "none", "important");
          break;
        }
        node = node.parentElement;
      }
    }
  }, marker.toUpperCase());
}

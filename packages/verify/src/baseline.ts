import * as fs from "node:fs";
import * as path from "node:path";

import { capture, type CaptureOptions, type CaptureOutcome } from "./capture.ts";
import { JSON_INDENT_SPACES } from "./constants.ts";
import type {
  BaselineSource,
  FigmaBaselineSource,
  VerificationContract,
  WebBaselineSource,
} from "@figloom/contracts";
import { fetchGold, type FetchGoldOptions, type FetchGoldOutcome } from "./fetch-gold.ts";
import { getProfile } from "./profiles.ts";
import { assessStability } from "./stability.ts";
import { checkGoldStaleness } from "./staleness.ts";
import type { ProfileName, ResolvedBaseline } from "./types.ts";

export interface BaselineResolveOptions<TSource extends BaselineSource = BaselineSource> {
  source: TSource;
  contract: VerificationContract;
  outDir: string;
  profile: ProfileName;
  stabilitySamples: number;
}

export type BaselineResolveOutcome =
  | { ok: true; baseline: ResolvedBaseline }
  | { ok: false; error: string; message: string };

export interface BaselineProvider<TSource extends BaselineSource = BaselineSource> {
  readonly kind: TSource["kind"];
  resolve(options: BaselineResolveOptions<TSource>): Promise<BaselineResolveOutcome>;
}

export interface WebBaselineMeta {
  kind: "web";
  url: string;
  revision: string;
  capturedAt: string;
  viewport: string;
  viewportSize: { width: number; height: number };
  selector: string | null;
  pageReason: string | null;
  stability: "stable" | "borderline" | "unknown";
}

type CaptureFn = (options: CaptureOptions) => Promise<CaptureOutcome>;
type FetchGoldFn = (options: FetchGoldOptions) => Promise<FetchGoldOutcome>;

export class FigmaBaselineProvider implements BaselineProvider<FigmaBaselineSource> {
  readonly kind = "figma" as const;

  constructor(
    private readonly fetchImpl: FetchGoldFn = fetchGold,
    private readonly stalenessImpl: typeof checkGoldStaleness = checkGoldStaleness,
  ) {}

  async resolve(
    options: BaselineResolveOptions<FigmaBaselineSource>,
  ): Promise<BaselineResolveOutcome> {
    const baselinePath = path.join(options.outDir, "figma-gold.png");
    const fetched = await this.fetchImpl({
      fileKey: options.source.fileKey,
      nodeId: options.source.nodeId,
      outPath: baselinePath,
      scale: options.source.scale,
      canvasFill: options.source.canvasFill,
    });
    if (!fetched.fetched) {
      return { ok: false, error: "BASELINE_FETCH_FAILED", message: fetched.message };
    }
    const stalenessWarnings = await this.stalenessImpl(baselinePath);
    return {
      ok: true,
      baseline: {
        evidence: {
          kind: "figma",
          path: path.resolve(fetched.goldPath),
          metaPath: path.resolve(fetched.metaPath),
          fileKey: fetched.meta.fileKey,
          nodeId: fetched.meta.nodeId,
          fetchedAt: fetched.meta.fetchedAt,
          lastModified: fetched.meta.lastModified,
        },
        warnings: [...fetched.warnings, ...stalenessWarnings],
      },
    };
  }
}

export class WebBaselineProvider implements BaselineProvider<WebBaselineSource> {
  readonly kind = "web" as const;

  constructor(private readonly captureImpl: CaptureFn = capture) {}

  async resolve(
    options: BaselineResolveOptions<WebBaselineSource>,
  ): Promise<BaselineResolveOutcome> {
    const baselinePath = path.join(options.outDir, "web-baseline.png");
    const metaPath = path.join(options.outDir, "web-baseline.meta.json");
    invalidateWebBaseline(baselinePath, metaPath);
    const captured = await this.captureImpl({
      url: options.source.url,
      outPath: baselinePath,
      viewportSize: {
        width: options.contract.viewport.width,
        height: options.contract.viewport.height,
      },
      selector: options.contract.scope.kind === "region" ? options.contract.scope.selector : undefined,
      fullPage: options.profile === "page",
      samples: options.stabilitySamples,
      timeoutMs: options.contract.timeoutMs,
      hideDevtoolsChrome: options.contract.hideDevtoolsChrome,
      devtoolsMarker: options.contract.devtoolsMarker,
      maskSelectors: options.contract.maskSelectors,
    });
    if (!captured.ok) {
      return { ok: false, error: captured.error, message: captured.message };
    }

    const profile = getProfile(options.profile);
    const stability = assessStability(captured.capturePaths, profile.stabilityMaxDiffRatio);
    cleanupSamples(captured.ephemeralSamplePaths);
    const meta: WebBaselineMeta = {
      kind: "web",
      url: options.source.url,
      revision: options.source.revision,
      capturedAt: captured.capturedAt,
      viewport: options.contract.viewport.name,
      viewportSize: {
        width: options.contract.viewport.width,
        height: options.contract.viewport.height,
      },
      selector: options.contract.scope.kind === "region" ? options.contract.scope.selector : null,
      pageReason: options.contract.scope.kind === "page" ? options.contract.scope.pageReason : null,
      stability: stability.stability,
    };
    writeJsonAtomic(metaPath, meta);
    return {
      ok: true,
      baseline: {
        evidence: {
          kind: "web",
          path: path.resolve(baselinePath),
          metaPath: path.resolve(metaPath),
          url: meta.url,
          revision: meta.revision,
          capturedAt: meta.capturedAt,
          stability: meta.stability,
        },
        warnings: captured.warnings,
      },
    };
  }
}

export function createBaselineProvider(source: BaselineSource): BaselineProvider {
  return source.kind === "figma" ? new FigmaBaselineProvider() : new WebBaselineProvider();
}

function invalidateWebBaseline(baselinePath: string, metaPath: string): void {
  for (const filePath of [baselinePath, metaPath]) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function cleanupSamples(samplePaths: string[]): void {
  for (const samplePath of samplePaths) {
    try {
      fs.unlinkSync(samplePath);
    } catch {
    }
  }
  const first = samplePaths[0];
  if (!first) return;
  try {
    fs.rmdirSync(path.dirname(first));
  } catch {
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`);
  fs.renameSync(temporary, filePath);
}

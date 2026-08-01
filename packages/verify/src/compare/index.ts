import * as path from "node:path";

import type { PNG } from "pngjs";

import { CLUSTER_GRID, EXPECT_SIZE_TOLERANCE_PX, RESIDUAL_CLUSTER_BLOCK, ROUND4_FACTOR } from "../constants.ts";
import { getProfile } from "../profiles.ts";
import type { CompareOptions, CompareOutcome, TopIssue } from "../types.ts";
import { areaGap } from "./area-gap.ts";
import { avgDeltaE2000 } from "./delta-e.ts";
import {
  clusterFails,
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  PIXEL_THRESHOLD,
  pixelCompare,
} from "./pixel.ts";
import { detectBorderColor, padTo, readPng, writePng } from "./png.ts";
import { ssimCompare } from "./ssim.ts";

export { areaGap } from "./area-gap.ts";
export { avgDeltaE2000 } from "./delta-e.ts";
export {
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  pixelCompare,
  worstGridMatchRatio,
} from "./pixel.ts";
export {
  compositeOnCanvas,
  detectBorderColor,
  makeSolidPng,
  padTo,
  parseHexRgb,
  readPng,
  resizeNearest,
  writePng,
} from "./png.ts";
export { ssimCompare } from "./ssim.ts";

const MAX_AREA_GAP_PERCENT = 100;

export function compare(
  goldPath: string,
  actualPath: string,
  outDir: string,
  options: CompareOptions,
): CompareOutcome {
  const profile = getProfile(options.profile);

  let gold: PNG
  let actual: PNG
  try {
    gold = readPng(goldPath);
    actual = readPng(actualPath);
  } catch (err) {
    return {
      pass: false,
      fidelityScore: 0,
      matchRatio: null, ssim: null, avgDeltaE: null,
      areaGapPercent: MAX_AREA_GAP_PERCENT, clusterFail: false,
      diffPixels: null, totalPixels: null,
      goldSize: { width: 0, height: 0 },
      actualSize: { width: 0, height: 0 },
      resizedForCompare: false,
      topIssues: [{ severity: "high", kind: "pixel", message: `Cannot read PNG: ${err instanceof Error ? err.message : String(err)}`, hint: "Check gold and actual paths", repairCandidate: false }],
      warnings: [],
      diffPath: null,
    }
  }

  const topIssues: TopIssue[] = [];
  const warnings: string[] = [];

  if (options.expectSize) {
    const { width, height } = options.expectSize;
    const dw = Math.abs(actual.width - width);
    const dh = Math.abs(actual.height - height);
    if (dw > EXPECT_SIZE_TOLERANCE_PX || dh > EXPECT_SIZE_TOLERANCE_PX) {
      topIssues.push({
        severity: "high",
        kind: "expect-size",
        message: `actual is ${actual.width}x${actual.height}, expected ${width}x${height} (+/-${EXPECT_SIZE_TOLERANCE_PX}px)`,
        hint: "Check the captured element's CSS size against the Figma frame spec.",
        repairCandidate: true,
      });
    }
  }

  const gap = areaGap(gold, actual);
  if (gap.areaGapPercent > profile.maxAreaGapPercent) {
    topIssues.push({
      severity: "high",
      kind: "size",
      message:
        `per-axis size gap ${gap.areaGapPercent.toFixed(2)}% exceeds ` +
        `${profile.maxAreaGapPercent}% (gold ${gap.goldSize.width}x${gap.goldSize.height}, ` +
        `actual ${gap.actualSize.width}x${gap.actualSize.height})`,
      hint: "Fix the element's rendered size first; pixel/SSIM/deltaE were skipped as they would only reflect the size skew.",
      repairCandidate: true,
    });
    return {
      pass: false,
      fidelityScore: rankScore({ areaGapPercent: gap.areaGapPercent }),
      matchRatio: null,
      ssim: null,
      avgDeltaE: null,
      areaGapPercent: gap.areaGapPercent,
      clusterFail: false,
      diffPixels: null,
      totalPixels: null,
      goldSize: gap.goldSize,
      actualSize: gap.actualSize,
      resizedForCompare: false,
      topIssues,
      warnings,
      diffPath: null,
    };
  }

  const width = Math.max(gold.width, actual.width);
  const height = Math.max(gold.height, actual.height);
  const resizedForCompare = gold.width !== actual.width || gold.height !== actual.height;
  const fillColor = detectBorderColor(gold)
  const goldAligned = padTo(gold, width, height, fillColor);
  const actualAligned = padTo(actual, width, height, fillColor);

  const pixel = pixelCompare(goldAligned, actualAligned, PIXEL_THRESHOLD, false);
  const diffPath = path.join(outDir, "diff.png");
  writePng(diffPath, pixel.diff);

  const ssim = ssimCompare(goldAligned, actualAligned);

  const bbox = diffBoundingBox(pixel.diff)
  let avgDeltaE = 0
  if (bbox) {
    avgDeltaE = avgDeltaE2000(goldAligned, actualAligned, bbox)
  } else {
    avgDeltaE = 0 // Identical images; skip compute
  }

  const clusterOn = options.clusterCheck ?? profile.cluster;
  const clusterFail =
    clusterOn && clusterFails(pixel.matchRatio, pixel.worstCellMatchRatio, profile.minMatch);

  if (pixel.matchRatio < profile.minMatch) {
    topIssues.push({
      severity: "high",
      kind: "pixel",
      message: `matchRatio ${(pixel.matchRatio * 100).toFixed(2)}% below ${(profile.minMatch * 100).toFixed(2)}% (${pixel.diffPixels}/${pixel.totalPixels} px differ)`,
      hint: "Inspect diff.png for red regions.",
      repairCandidate: false,
    });
  }
  if (profile.maxDiffPixels !== null && pixel.diffPixels > profile.maxDiffPixels) {
    topIssues.push({
      severity: "high",
      kind: "pixel",
      message: `diffPixels ${pixel.diffPixels} exceeds budget ${profile.maxDiffPixels}`,
      hint: "Component-level budget: localize the change via diff.png.",
      repairCandidate: false,
    });
  }
  if (ssim < profile.minSSIM) {
    topIssues.push({
      severity: "medium",
      kind: "ssim",
      message: `SSIM ${ssim.toFixed(4)} below ${profile.minSSIM} (structural mismatch: layout/spacing/shape)`,
      repairCandidate: false,
    });
  }
  if (avgDeltaE > profile.maxAvgDeltaE) {
    topIssues.push({
      severity: "medium",
      kind: "color",
      message: `avg deltaE2000 ${avgDeltaE.toFixed(2)} over diff region exceeds ${profile.maxAvgDeltaE} (color/token mismatch)`,
      hint: "Check color tokens against Figma variables.",
      repairCandidate: false,
    });
  }
  if (clusterFail) {
    topIssues.push({
      severity: "high",
      kind: "cluster",
      message: `worst ${CLUSTER_GRID}x${CLUSTER_GRID} grid cell matchRatio ${(pixel.worstCellMatchRatio * 100).toFixed(2)}%; localized region is broken while the page average passes`,
      hint: "Full-page ratio is diluted; verify the failing region with a content-crop run.",
      repairCandidate: false,
    });
  }

  const expectSizeFail = topIssues.some((i) => i.kind === "expect-size");
  const pass =
    !expectSizeFail &&
    pixel.matchRatio >= profile.minMatch &&
    (profile.maxDiffPixels === null || pixel.diffPixels <= profile.maxDiffPixels) &&
    ssim >= profile.minSSIM &&
    avgDeltaE <= profile.maxAvgDeltaE &&
    !clusterFail;

  const realDiffs = countRealDiffPixels(pixel.diff);
  const residualBox = diffBoundingBox(pixel.diff);
  const largestCluster = largestRealDiffCluster(pixel.diff);
  if (pass && largestCluster && largestCluster.pixels >= RESIDUAL_CLUSTER_BLOCK && residualBox) {
    const msg =
      `pass=true but largest residual cluster has ${largestCluster.pixels}/${realDiffs} red px ` +
      `in bbox ${largestCluster.bbox.x0},${largestCluster.bbox.y0}-${largestCluster.bbox.x1},${largestCluster.bbox.y1}; ` +
      `inspect diff.png (CTA / inputs / icons may still be wrong).`;
    warnings.push(msg);
    topIssues.push({
      severity: "medium",
      kind: "residual",
      message: msg,
      hint: "Do not claim done on pass alone. Prefer content-crop (component/strict + selector) if this is a full-page run.",
      repairCandidate: false,
    });
  } else if (pass && realDiffs > 0 && residualBox) {
    topIssues.push({
      severity: "low",
      kind: "residual",
      message: `${realDiffs} dispersed residual red diff px; largest cluster ${largestCluster?.pixels ?? 0} (bbox ${residualBox.x0},${residualBox.y0}-${residualBox.x1},${residualBox.y1})`,
      hint: "Read diff.png before claiming visual done.",
      repairCandidate: false,
    });
  }

  return {
    pass,
    fidelityScore: rankScore({
      areaGapPercent: gap.areaGapPercent,
      matchRatio: pixel.matchRatio,
      ssim,
      avgDeltaE,
    }),
    matchRatio: pixel.matchRatio,
    ssim,
    avgDeltaE,
    areaGapPercent: gap.areaGapPercent,
    clusterFail,
    diffPixels: pixel.diffPixels,
    totalPixels: pixel.totalPixels,
    goldSize: gap.goldSize,
    actualSize: gap.actualSize,
    resizedForCompare,
    topIssues,
    warnings,
    diffPath,
  };
}

const RANK_SIZE_SCORE_ONLY_WEIGHT = 0.5;
const RANK_MATCH_RATIO_WEIGHT = 0.45;
const RANK_SSIM_WEIGHT = 0.3;
const RANK_COLOR_SCORE_WEIGHT = 0.15;
const RANK_SIZE_SCORE_WEIGHT = 0.1;
const RANK_DELTA_E_CLAMP = 10;

function rankScore(signals: {
  areaGapPercent: number;
  matchRatio?: number;
  ssim?: number;
  avgDeltaE?: number;
}): number {
  const sizeScore = Math.max(0, 1 - signals.areaGapPercent / MAX_AREA_GAP_PERCENT);
  if (signals.matchRatio === undefined) {
    return round4(RANK_SIZE_SCORE_ONLY_WEIGHT * sizeScore);
  }
  const colorScore = 1 - Math.min(signals.avgDeltaE ?? 0, RANK_DELTA_E_CLAMP) / RANK_DELTA_E_CLAMP;
  return round4(
    RANK_MATCH_RATIO_WEIGHT * signals.matchRatio +
      RANK_SSIM_WEIGHT * (signals.ssim ?? 0) +
      RANK_COLOR_SCORE_WEIGHT * colorScore +
      RANK_SIZE_SCORE_WEIGHT * sizeScore,
  );
}

function round4(n: number): number {
  return Math.round(n * ROUND4_FACTOR) / ROUND4_FACTOR;
}

import { resolveToken } from "../fetch-gold.ts";
import {
  ALPHA_TOLERANCE,
  COLOR_CHANNEL_TOLERANCE,
  FONT_SIZE_TOLERANCE_PX,
  LETTER_SPACING_TOLERANCE_PX,
  LINE_HEIGHT_TOLERANCE_PX,
} from "../constants.ts";
import { getNodeMetadata } from "../figma-api.ts";
import type { ComputedTextStyle, TopIssue } from "../types.ts";

export interface StyleGateInput {
  fileKey: string;
  nodeId: string;
  domStyle: ComputedTextStyle;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface StyleGateOutcome {
  pass: boolean | null;
  topIssues: TopIssue[];
  warnings: string[];
}

function figmaFillToRgba(
  color: { r: number; g: number; b: number; a?: number },
  opacity = 1,
): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  return {
    r: Math.round(color.r * 255),
    g: Math.round(color.g * 255),
    b: Math.round(color.b * 255),
    a: (color.a ?? 1) * opacity,
  };
}

function colorsMatch(
  a: { r: number; g: number; b: number; a: number },
  b: { r: number; g: number; b: number; a: number },
): boolean {
  return (
    Math.abs(a.r - b.r) <= COLOR_CHANNEL_TOLERANCE &&
    Math.abs(a.g - b.g) <= COLOR_CHANNEL_TOLERANCE &&
    Math.abs(a.b - b.b) <= COLOR_CHANNEL_TOLERANCE &&
    Math.abs(a.a - b.a) <= ALPHA_TOLERANCE
  );
}

export async function styleGate(input: StyleGateInput): Promise<StyleGateOutcome> {
  const token = resolveToken(input.token);
  if (!token) {
    return {
      pass: null,
      topIssues: [],
      warnings: ["style-gate skipped: no Figma token to fetch the current node style."],
    };
  }

  const meta = await getNodeMetadata(input.fileKey, input.nodeId, token, {
    fetchImpl: input.fetchImpl,
    cache: input.fetchImpl == null,
  });
  if ("error" in meta) {
    return {
      pass: null,
      topIssues: [],
      warnings: [
        `style-gate skipped for this run (${meta.error}); visual verdict already computed against gold on disk.`,
      ],
    };
  }
  if (!meta.typeStyle && !meta.fills) {
    return {
      pass: null,
      topIssues: [],
      warnings: ["style-gate skipped: node has no comparable style or fill data."],
    };
  }

  const topIssues: TopIssue[] = [];
  const warnings: string[] = [];
  const { domStyle } = input;

  if (meta.typeStyle) {
    const spec = meta.typeStyle;
    if (spec.fontWeight != null && spec.fontWeight !== domStyle.fontWeight) {
      topIssues.push({
        severity: "medium",
        kind: "style-typography",
        message: `fontWeight: Figma spec is ${spec.fontWeight}, rendered is ${domStyle.fontWeight}.`,
        hint: "Check the font-weight CSS declaration or the linked font file's available weights.",
        repairCandidate: true,
      });
    }
    if (
      spec.fontSize != null &&
      Math.abs(spec.fontSize - domStyle.fontSizePx) > FONT_SIZE_TOLERANCE_PX
    ) {
      topIssues.push({
        severity: "medium",
        kind: "style-typography",
        message: `fontSize: Figma spec is ${spec.fontSize}px, rendered is ${domStyle.fontSizePx}px.`,
        hint: "Check the font-size CSS declaration against the Figma text style.",
        repairCandidate: true,
      });
    }
    if (
      spec.lineHeightPx != null &&
      domStyle.lineHeightPx != null &&
      Math.abs(spec.lineHeightPx - domStyle.lineHeightPx) > LINE_HEIGHT_TOLERANCE_PX
    ) {
      topIssues.push({
        severity: "low",
        kind: "style-typography",
        message: `lineHeight: Figma spec is ${spec.lineHeightPx}px, rendered is ${domStyle.lineHeightPx}px.`,
        hint: "Check the line-height CSS declaration against the Figma text style.",
        repairCandidate: true,
      });
    }
    if (
      spec.letterSpacing != null &&
      Math.abs(spec.letterSpacing - domStyle.letterSpacingPx) > LETTER_SPACING_TOLERANCE_PX
    ) {
      topIssues.push({
        severity: "low",
        kind: "style-typography",
        message: `letterSpacing: Figma spec is ${spec.letterSpacing}px, rendered is ${domStyle.letterSpacingPx}px.`,
        hint: "Check the letter-spacing CSS declaration against the Figma text style.",
        repairCandidate: true,
      });
    }
  }

  const solidFill = meta.fills?.find((fill) => fill.type === "SOLID" && fill.visible !== false);
  if (solidFill && solidFill.type === "SOLID") {
    const specColor = figmaFillToRgba(solidFill.color, solidFill.opacity ?? 1);
    const cssProperty = meta.nodeType === "TEXT" ? "color" : "backgroundColor";
    const renderedColor = domStyle[cssProperty];
    if (!renderedColor) {
      warnings.push(
        `style-gate skipped ${cssProperty}: browser color could not be normalized to sRGB.`,
      );
    } else if (!colorsMatch(specColor, renderedColor)) {
      topIssues.push({
        severity: "medium",
        kind: "style-color",
        message:
          `${cssProperty}: Figma spec is rgba(${specColor.r}, ${specColor.g}, ${specColor.b}, ${specColor.a}), ` +
          `rendered is rgba(${renderedColor.r}, ${renderedColor.g}, ${renderedColor.b}, ${renderedColor.a}).`,
        hint: `Check the ${cssProperty} CSS declaration against the Figma fill or design token.`,
        repairCandidate: true,
      });
    }
  } else if (meta.fills && meta.fills.length > 0) {
    warnings.push(
      "style-gate skipped color check: node has no visible SOLID fill (gradient, image, or hidden fills are not compared).",
    );
  }

  return { pass: topIssues.length === 0, topIssues, warnings };
}

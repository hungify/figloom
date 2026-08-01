import { describe, expect, it } from "vitest";

import { styleGate } from "../src/index.ts";
import type { ComputedTextStyle } from "../src/index.ts";

function figmaOk(document: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        lastModified: "2026-07-17T13:39:46Z",
        nodes: { "153:5181": { document } },
      }),
      { status: 200 },
    )) as typeof fetch;
}

const base = { fileKey: "abc", nodeId: "153:5181", token: "t" };

const matchingDomStyle: ComputedTextStyle = {
  fontFamily: "Inter",
  fontWeight: 500,
  fontSizePx: 16,
  lineHeightPx: 24,
  letterSpacingPx: 0,
  color: { r: 17, g: 17, b: 17, a: 1 },
  backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
};

const textNodeDoc = {
  type: "TEXT",
  style: {
    fontWeight: 500,
    fontSize: 16,
    lineHeightPx: 24,
    letterSpacing: 0,
  },
  fills: [{ type: "SOLID", visible: true, color: { r: 17 / 255, g: 17 / 255, b: 17 / 255, a: 1 } }],
};

describe("style gate (Figma REST style vs live computed style)", () => {
  it("matching typography and color -> pass", async () => {
    const r = await styleGate({
      ...base,
      domStyle: matchingDomStyle,
      fetchImpl: figmaOk(textNodeDoc),
    });
    expect(r.pass).toBe(true);
    expect(r.topIssues).toHaveLength(0);
  });

  it("fontWeight mismatch -> hard-fail with style-typography", async () => {
    const r = await styleGate({
      ...base,
      domStyle: { ...matchingDomStyle, fontWeight: 400 },
      fetchImpl: figmaOk(textNodeDoc),
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues[0]?.kind).toBe("style-typography");
    expect(r.topIssues[0]?.message).toMatch(/fontWeight/);
    expect(r.topIssues[0]?.repairCandidate).toBe(true);
  });

  it("fontSize outside tolerance -> hard-fail", async () => {
    const r = await styleGate({
      ...base,
      domStyle: { ...matchingDomStyle, fontSizePx: 14 },
      fetchImpl: figmaOk(textNodeDoc),
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues.some((i) => i.message.includes("fontSize"))).toBe(true);
  });

  it("color mismatch -> hard-fail with style-color", async () => {
    const r = await styleGate({
      ...base,
      domStyle: { ...matchingDomStyle, color: { r: 200, g: 0, b: 0, a: 1 } },
      fetchImpl: figmaOk(textNodeDoc),
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues[0]?.kind).toBe("style-color");
    expect(r.topIssues[0]?.repairCandidate).toBe(true);
  });

  it("alpha mismatch fails even when RGB channels match", async () => {
    const r = await styleGate({
      ...base,
      domStyle: {
        ...matchingDomStyle,
        color: { r: 17, g: 17, b: 17, a: 0 },
      },
      fetchImpl: figmaOk(textNodeDoc),
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues[0]?.message).toMatch(/rgba/);
  });

  it("Figma paint opacity contributes to effective alpha", async () => {
    const r = await styleGate({
      ...base,
      domStyle: {
        ...matchingDomStyle,
        color: { r: 17, g: 17, b: 17, a: 0.5 },
      },
      fetchImpl: figmaOk({
        ...textNodeDoc,
        fills: [
          {
            type: "SOLID",
            visible: true,
            opacity: 0.5,
            color: { r: 17 / 255, g: 17 / 255, b: 17 / 255, a: 1 },
          },
        ],
      }),
    });
    expect(r.pass).toBe(true);
  });

  it("unavailable browser color skips color comparison with warning", async () => {
    const r = await styleGate({
      ...base,
      domStyle: { ...matchingDomStyle, color: null },
      fetchImpl: figmaOk(textNodeDoc),
    });
    expect(r.pass).toBe(true);
    expect(r.warnings[0]).toMatch(/could not be normalized/);
  });

  it("invisible fill does not produce a color issue", async () => {
    const r = await styleGate({
      ...base,
      domStyle: { ...matchingDomStyle, color: { r: 255, g: 0, b: 0, a: 1 } },
      fetchImpl: figmaOk({
        ...textNodeDoc,
        fills: [{ type: "SOLID", visible: false, color: { r: 0, g: 0, b: 0, a: 1 } }],
      }),
    });
    expect(r.topIssues.some((issue) => issue.kind === "style-color")).toBe(false);
  });

  it("line-height and letter-spacing mismatches are reported", async () => {
    const r = await styleGate({
      ...base,
      domStyle: { ...matchingDomStyle, lineHeightPx: 20, letterSpacingPx: 1 },
      fetchImpl: figmaOk(textNodeDoc),
    });
    expect(r.topIssues.some((issue) => issue.message.includes("lineHeight"))).toBe(true);
    expect(r.topIssues.some((issue) => issue.message.includes("letterSpacing"))).toBe(true);
  });

  it("non-text node fill compares against backgroundColor", async () => {
    const r = await styleGate({
      ...base,
      domStyle: {
        ...matchingDomStyle,
        color: { r: 255, g: 255, b: 255, a: 1 },
        backgroundColor: { r: 17, g: 17, b: 17, a: 1 },
      },
      fetchImpl: figmaOk({
        type: "RECTANGLE",
        fills: [{ type: "SOLID", visible: true, color: { r: 17 / 255, g: 17 / 255, b: 17 / 255, a: 1 } }],
      }),
    });
    expect(r.pass).toBe(true);
    expect(r.topIssues).toHaveLength(0);
  });

  it("non-text node background mismatch reports backgroundColor", async () => {
    const r = await styleGate({
      ...base,
      domStyle: matchingDomStyle,
      fetchImpl: figmaOk({
        type: "RECTANGLE",
        fills: [{ type: "SOLID", visible: true, color: { r: 17 / 255, g: 17 / 255, b: 17 / 255, a: 1 } }],
      }),
    });
    expect(r.pass).toBe(false);
    expect(r.topIssues[0]?.message).toMatch(/^backgroundColor:/);
  });

  it("node has no style or fills -> skip with warning", async () => {
    const r = await styleGate({
      ...base,
      domStyle: matchingDomStyle,
      fetchImpl: figmaOk({ type: "GROUP" }),
    });
    expect(r.pass).toBeNull();
    expect(r.topIssues).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/no comparable style or fill data/);
  });

  it("network error -> skip with warning, never a fail", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const r = await styleGate({ ...base, domStyle: matchingDomStyle, fetchImpl });
    expect(r.pass).toBeNull();
    expect(r.topIssues).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/style-gate skipped/);
  });

  it("no token -> skip with warning", async () => {
    const r = await styleGate({
      fileKey: "abc",
      nodeId: "153:5181",
      token: "",
      domStyle: matchingDomStyle,
    });
    expect(r.pass).toBeNull();
    expect(r.warnings[0]).toMatch(/no Figma token/);
  });
});

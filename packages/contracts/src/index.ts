import * as z from "zod";

export const SCHEMA_VERSION = 4 as const;
export const MIN_CONTRACTS_PER_REQUEST = 1;
export const MAX_CONTRACTS_PER_REQUEST = 8;
export const MIN_CONTRACT_TIMEOUT_MS = 1_000;
export const MAX_CONTRACT_TIMEOUT_MS = 120_000;
export const MIN_STABILITY_SAMPLES = 2;
export const MAX_STABILITY_SAMPLES = 5;
export const FIGMA_NODE_ID = /^(?:I\d+:\d+(?:;\d+:\d+)+|\d+:\d+)$/;

const VISUAL_ARTIFACT_DIR = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))\.figloom\/artifacts\/visual-verifications\/.+/;

export const profileSchema = z.enum(["page", "component/strict", "component/dev"]);

export const runTypeSchema = z.enum(["dev", "final"]);

export const viewportSchema = z
  .object({
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const expectSizeSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

const httpUrlSchema = z.url().refine((value) => /^https?:\/\//i.test(value), {
  message: "must use http or https",
});

export const figmaBaselineSchema = z
  .object({
    kind: z.literal("figma"),
    fileKey: z.string().min(1),
    nodeId: z.string().regex(FIGMA_NODE_ID),
    scale: z.literal(1).optional(),
    canvasFill: z.string().regex(/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/).optional(),
  })
  .strict();

export const webBaselineSchema = z
  .object({
    kind: z.literal("web"),
    url: httpUrlSchema,
    revision: z.string().trim().min(1),
  })
  .strict();

export const baselineSchema = z.discriminatedUnion("kind", [
  figmaBaselineSchema,
  webBaselineSchema,
]);

export const webTargetSchema = z
  .object({
    kind: z.literal("web"),
    url: httpUrlSchema,
    expectedUrl: httpUrlSchema.optional(),
    readySelector: z.string().trim().min(1).optional(),
    auth: z.enum(["none", "storageState"]).optional(),
  })
  .strict();

const pageScopeSchema = z
  .object({
    kind: z.literal("page"),
    pageReason: z.string().trim().min(1),
  })
  .strict();

const regionScopeSchema = z
  .object({
    kind: z.literal("region"),
    selector: z.string().trim().min(1),
    expectSize: expectSizeSchema,
  })
  .strict();

export const verificationContractSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
    baseline: baselineSchema,
    viewport: viewportSchema,
    outDir: z.string().regex(VISUAL_ARTIFACT_DIR),
    scope: z.discriminatedUnion("kind", [pageScopeSchema, regionScopeSchema]),
    profile: z.enum(["component/strict", "component/dev"]).optional(),
    stabilitySamples: z.number().int().min(MIN_STABILITY_SAMPLES).max(MAX_STABILITY_SAMPLES).optional(),
    timeoutMs: z.number().int().min(MIN_CONTRACT_TIMEOUT_MS).max(MAX_CONTRACT_TIMEOUT_MS).optional(),
    hideDevtoolsChrome: z.boolean().optional(),
    devtoolsMarker: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((contract, context) => {
    if (contract.scope.kind === "page" && contract.profile != null) {
      context.addIssue({
        code: "custom",
        path: ["profile"],
        message: "page contract must not set component profile",
      });
    }
    if (contract.devtoolsMarker != null && contract.hideDevtoolsChrome !== true) {
      context.addIssue({
        code: "custom",
        path: ["devtoolsMarker"],
        message: "devtoolsMarker requires hideDevtoolsChrome=true",
      });
    }
  });

export const verificationRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    target: webTargetSchema,
    contracts: z.array(verificationContractSchema).min(MIN_CONTRACTS_PER_REQUEST).max(MAX_CONTRACTS_PER_REQUEST),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = new Set<string>();
    request.contracts.forEach((contract, index) => {
      if (ids.has(contract.id)) {
        context.addIssue({
          code: "custom",
          path: ["contracts", index, "id"],
          message: `duplicate contract id: ${contract.id}`,
        });
      }
      ids.add(contract.id);
    });
  });

const verificationResultSchema = z
  .object({
    id: z.string().min(1),
    ok: z.boolean(),
    pass: z.boolean(),
    error: z.string().optional(),
    message: z.string().optional(),
    outDir: z.string().min(1),
  })
  .strict();

export const verificationArtifactSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    kind: z.literal("figloom.visual-verification"),
    createdAt: z.iso.datetime(),
    projectRoot: z.string().min(1),
    request: verificationRequestSchema,
    ok: z.boolean(),
    allPassed: z.boolean(),
    results: z.array(verificationResultSchema).min(MIN_CONTRACTS_PER_REQUEST).max(MAX_CONTRACTS_PER_REQUEST),
  })
  .strict()
  .superRefine((artifact, context) => {
    const requestIds = new Set(artifact.request.contracts.map((contract) => contract.id));
    const resultIds = new Set<string>();
    artifact.results.forEach((result, index) => {
      if (!requestIds.has(result.id)) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "id"],
          message: `result has no matching contract: ${result.id}`,
        });
      }
      if (resultIds.has(result.id)) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "id"],
          message: `duplicate result id: ${result.id}`,
        });
      }
      resultIds.add(result.id);
    });
    if (resultIds.size !== requestIds.size) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "results must cover every request contract exactly once",
      });
    }
    const expectedOk = artifact.results.every((result) => result.ok);
    const expectedAllPassed = artifact.results.every((result) => result.ok && result.pass);
    if (artifact.ok !== expectedOk) {
      context.addIssue({
        code: "custom",
        path: ["ok"],
        message: "ok must equal the aggregate result status",
      });
    }
    if (artifact.allPassed !== expectedAllPassed) {
      context.addIssue({
        code: "custom",
        path: ["allPassed"],
        message: "allPassed must equal the aggregate visual verdict",
      });
    }
  });

const scoreSizeSchema = z.object({
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
}).strict();

const scoreHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const visualScoreArtifactSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  ok: z.literal(true),
  pass: z.boolean(),
  fidelityScore: z.number(),
  matchRatio: z.number().min(0).max(1).nullable(),
  ssim: z.number().min(0).max(1).nullable(),
  avgDeltaE: z.number().nonnegative().nullable(),
  diffPixels: z.number().int().nonnegative().nullable(),
  goldSize: scoreSizeSchema,
  actualSize: scoreSizeSchema,
  baseline: z.object({
    kind: z.enum(["figma", "web"]),
    path: z.string().min(1),
    fileKey: z.string().optional(),
    nodeId: z.string().optional(),
    fetchedAt: z.iso.datetime().optional(),
    url: httpUrlSchema.optional(),
    revision: z.string().min(1).optional(),
  }).passthrough(),
  target: z.object({ url: httpUrlSchema }).passthrough(),
  selector: z.string().nullable(),
  stability: z.enum(["stable", "borderline", "unknown"]),
  evidenceHashes: z.object({
    baseline: scoreHashSchema,
    actual: scoreHashSchema,
    diff: scoreHashSchema.nullable(),
  }).passthrough(),
  artifacts: z.object({
    baseline: z.string().min(1),
    actual: z.string().min(1),
    diff: z.string().min(1).nullable(),
  }).passthrough(),
}).passthrough();

export type VerificationContract = z.infer<typeof verificationContractSchema>;
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
export type VerificationArtifact = z.infer<typeof verificationArtifactSchema>;
export type VisualScoreArtifact = z.infer<typeof visualScoreArtifactSchema>;
export type BaselineSource = z.infer<typeof baselineSchema>;
export type FigmaBaselineSource = z.infer<typeof figmaBaselineSchema>;
export type WebBaselineSource = z.infer<typeof webBaselineSchema>;
export type WebTarget = z.infer<typeof webTargetSchema>;

export * from "./dashboard.ts";

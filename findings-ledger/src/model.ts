import { z } from "zod";
import type { Json } from "./canonical.ts";

export const BUNDLE_FORMAT = "findings-ledger/1";

/** How a claim was obtained. Independent of how well it is corroborated. */
export const BASES = ["observed", "derived", "inferred"] as const;
export type Basis = (typeof BASES)[number];

/** How well a claim is corroborated. Computed by the ledger, never asserted. */
export const CONFIDENCES = ["L1", "L2", "L3"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const UNKNOWN_STATUSES = [
  "open",
  "narrowed",
  "resolved",
  "unresolvable",
] as const;
export type UnknownStatus = (typeof UNKNOWN_STATUSES)[number];

export const LOCATOR_TYPES = [
  "page",
  "cell",
  "row",
  "section",
  "clause",
  "timestamp",
  "other",
] as const;

const text = z.string().trim().min(1);
const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    "expected a UTC ISO-8601 timestamp",
  );

const idOf = (prefix: string) =>
  z
    .string()
    .regex(
      new RegExp(`^${prefix}_[0-9a-f]{64}$`),
      `expected ${prefix}_ followed by 64 lowercase hex characters`,
    );
export const sourceIdSchema = idOf("src");
export const findingIdSchema = idOf("fnd");
export const corroborationIdSchema = idOf("cor");
export const unknownIdSchema = idOf("unk");

export const jsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
/** Structured values attached to a finding. Always an object, never null. */
export const dataSchema = z.record(z.string(), jsonValueSchema);

// ---------------------------------------------------------------- inputs ---

export const sourceInputSchema = z
  .strictObject({
    alias: text.describe(
      "Short unique label used in reports, e.g. 'RentRoll-2026-10' or 'ProbateAtty-Dade-3'.",
    ),
    origin: text.describe(
      "Who produced it (seller, county recorder, lender, listing broker). Two sources are independent only if their origins differ.",
    ),
    medium: z
      .enum(["document", "verbal"])
      .describe(
        "'document' is a retrievable record. 'verbal' is a call, meeting or rumor.",
      ),
    sha256: sha256
      .optional()
      .describe(
        "SHA-256 of the exact file reviewed. Required for documents; omit for verbal.",
      ),
    received: isoDate
      .optional()
      .describe("Date received or heard, YYYY-MM-DD."),
    name: text
      .optional()
      .describe(
        "Real name, file name or path. Display only; never part of identity.",
      ),
    sensitive: z
      .boolean()
      .optional()
      .describe("If true, reports show the alias only and never the name."),
  })
  .superRefine((source, ctx) => {
    if (source.medium === "document" && source.sha256 === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["sha256"],
        message:
          "A document source needs the SHA-256 of the exact file reviewed, so the finding can be tied to those bytes.",
      });
    if (source.medium === "verbal" && source.sha256 !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["sha256"],
        message: "A verbal source has no file to hash; omit sha256.",
      });
  });

export const locatorSchema = z.strictObject({
  type: z.enum(LOCATOR_TYPES),
  value: text.describe("Where in the source, e.g. '4', 'B12', 'Section 7.2'."),
});

export const supportSchema = z.strictObject({
  source_id: sourceIdSchema,
  locator: locatorSchema,
  excerpt: text.describe(
    "The words or figures relied on, copied from the source. For a verbal source, the contemporaneous note.",
  ),
});
export type Support = z.infer<typeof supportSchema>;

export const coverageSchema = z.strictObject({
  scope: text.describe("What was searched, precisely enough to repeat."),
  complete: z
    .boolean()
    .describe("True only if the whole stated scope was searched."),
});

export const findingInputSchema = z.strictObject({
  statement: text.describe("The claim, in one sentence."),
  basis: z
    .enum(BASES)
    .describe(
      "observed: read directly from a source. derived: computed from other findings. inferred: a judgment not established by the sources.",
    ),
  kind: z
    .enum(["fact", "absence"])
    .optional()
    .describe(
      "Defaults to 'fact'. 'absence' claims that something was searched for and not found.",
    ),
  supports: z
    .array(supportSchema)
    .optional()
    .describe(
      "Required for observed. Source, locator and excerpt for each reliance.",
    ),
  inputs: z
    .array(findingIdSchema)
    .optional()
    .describe("Required for derived: the findings it is computed from."),
  method: text
    .optional()
    .describe(
      "Required for derived: how it was computed, so it can be repeated.",
    ),
  rationale: text
    .optional()
    .describe("Required for inferred: why this is believed."),
  coverage: coverageSchema.optional().describe("Required for absence claims."),
  limitations: z
    .array(text)
    .optional()
    .describe("Known weaknesses or caveats."),
  so_what: text
    .optional()
    .describe(
      "What it means, who it affects, and the recommended next action.",
    ),
  data: dataSchema
    .optional()
    .describe("Structured values (figures, rows) the statement rests on."),
});

export const corroborationInputSchema = z.strictObject({
  finding_id: findingIdSchema,
  support: supportSchema,
});

export const openUnknownInputSchema = z.strictObject({
  question: text.describe("What is not known, phrased as a question."),
  why_it_matters: text.optional(),
  searched: text
    .optional()
    .describe(
      "What has already been checked, so the gap is not mistaken for absence.",
    ),
  would_resolve: text.optional().describe("What evidence would settle it."),
  related_findings: z.array(findingIdSchema).optional(),
});

export const reviseUnknownInputSchema = z.strictObject({
  unknown_id: unknownIdSchema,
  status: z.enum(UNKNOWN_STATUSES),
  note: text.describe("What changed and why."),
  resolved_by: z
    .array(findingIdSchema)
    .optional()
    .describe(
      "Required when status is 'resolved': the findings that settle it.",
    ),
});

// --------------------------------------------------------------- records ---

export const sourceRecordSchema = z.strictObject({
  id: sourceIdSchema,
  alias: text,
  origin: text,
  medium: z.enum(["document", "verbal"]),
  sha256: sha256.optional(),
  received: isoDate.optional(),
  name: text.optional(),
  sensitive: z.boolean().optional(),
  recorded_at: isoTimestamp,
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const findingRecordSchema = z.strictObject({
  id: findingIdSchema,
  statement: text,
  kind: z.enum(["fact", "absence"]),
  basis: z.enum(BASES),
  supports: z.array(supportSchema),
  inputs: z.array(findingIdSchema),
  method: text.optional(),
  rationale: text.optional(),
  coverage: coverageSchema.optional(),
  limitations: z.array(text),
  so_what: text.optional(),
  data: dataSchema.optional(),
  recorded_at: isoTimestamp,
});
export type FindingRecord = z.infer<typeof findingRecordSchema>;

export const corroborationRecordSchema = z.strictObject({
  id: corroborationIdSchema,
  finding_id: findingIdSchema,
  support: supportSchema,
  recorded_at: isoTimestamp,
});
export type CorroborationRecord = z.infer<typeof corroborationRecordSchema>;

export const revisionRecordSchema = z.strictObject({
  n: z.number().int().min(1),
  status: z.enum(UNKNOWN_STATUSES),
  note: text,
  resolved_by: z.array(findingIdSchema),
  recorded_at: isoTimestamp,
});
export type RevisionRecord = z.infer<typeof revisionRecordSchema>;

export const unknownRecordSchema = z.strictObject({
  id: unknownIdSchema,
  question: text,
  why_it_matters: text.optional(),
  searched: text.optional(),
  would_resolve: text.optional(),
  related_findings: z.array(findingIdSchema),
  revisions: z.array(revisionRecordSchema).min(1),
});
export type UnknownRecord = z.infer<typeof unknownRecordSchema>;

export const bundleSchema = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  sources: z.array(sourceRecordSchema),
  findings: z.array(findingRecordSchema),
  corroborations: z.array(corroborationRecordSchema),
  unknowns: z.array(unknownRecordSchema),
  digest: sha256,
});
export type Bundle = z.infer<typeof bundleSchema>;

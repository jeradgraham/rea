import type { ZodError } from "zod";
import { canonicalJson, contentId, sha256Hex } from "./canonical.ts";
import type { Json } from "./canonical.ts";
import {
  BUNDLE_FORMAT,
  bundleSchema,
  corroborationInputSchema,
  findingInputSchema,
  openUnknownInputSchema,
  reviseUnknownInputSchema,
  sourceInputSchema,
} from "./model.ts";
import type {
  Bundle,
  Confidence,
  CorroborationRecord,
  FindingRecord,
  SourceRecord,
  Support,
  UnknownRecord,
  UnknownStatus,
} from "./model.ts";

// ---------------------------------------------------------------- result ---

export type IssueCode =
  | "invalid_input"
  | "unknown_reference"
  | "missing_support"
  | "absence_requires_coverage"
  | "rule_violation"
  | "conflict"
  | "invalid_transition"
  | "not_found"
  | "integrity";

export interface Issue {
  readonly code: IssueCode;
  readonly message: string;
  readonly path?: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Issue };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (
  code: IssueCode,
  message: string,
  path?: string,
): Result<never> => ({
  ok: false,
  error: { code, message, ...(path === undefined ? {} : { path }) },
});
const fromZod = (error: ZodError): Result<never> => {
  const issue = error.issues[0];
  const path = issue?.path.map(String).join(".") ?? "";
  const message = issue?.message ?? "Invalid input.";
  return fail(
    "invalid_input",
    path === "" ? message : `${path}: ${message}`,
    path || undefined,
  );
};

export interface Added<T> {
  readonly record: T;
  readonly created: boolean;
}

export interface Explanation {
  readonly confidence: Confidence;
  /** Independent origins supporting the finding (empty for derived). */
  readonly distinct_origins: readonly string[];
  /** The subset of origins that supplied a documented source. */
  readonly documented_origins: readonly string[];
  /** Derived only: the inputs that cap the confidence. */
  readonly weakest_inputs: readonly string[];
}

export interface LintWarning {
  readonly code: "missing_so_what";
  readonly finding_id: string;
  readonly message: string;
}

export interface LedgerOptions {
  /** Clock for `recorded_at`. Injected so tests and demos are deterministic. */
  readonly now?: () => string;
}

// --------------------------------------------------------------- helpers ---

const RANK: Record<Confidence, number> = { L1: 1, L2: 2, L3: 3 };

const TRANSITIONS: Record<UnknownStatus, readonly UnknownStatus[]> = {
  open: ["narrowed", "resolved", "unresolvable"],
  narrowed: ["open", "narrowed", "resolved", "unresolvable"],
  resolved: ["open"],
  unresolvable: ["open"],
};

const normalizeOrigin = (origin: string): string =>
  origin.trim().replace(/\s+/g, " ").toLowerCase();

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const uniqueSorted = (ids: readonly string[]): string[] =>
  [...new Set(ids)].sort(compare);

const normalizeSupports = (supports: readonly Support[]): Support[] => {
  const byKey = new Map<string, Support>();
  for (const support of supports) byKey.set(canonicalJson(support), support);
  return [...byKey.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([, support]) => support);
};

const defined = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));

const asJson = (value: unknown): Json => value as Json;

// ---------------------------------------------------------------- ledger ---

/**
 * The ledger owns the rules. Every write is validated at this boundary, every
 * record is content-addressed and immutable, and corroboration is computed from
 * the recorded sources rather than asserted by the caller.
 */
export class Ledger {
  readonly #now: () => string;
  readonly #sources = new Map<string, SourceRecord>();
  readonly #aliases = new Map<string, string>();
  readonly #findings = new Map<string, FindingRecord>();
  readonly #corroborations = new Map<string, CorroborationRecord>();
  readonly #corroborationsByFinding = new Map<string, CorroborationRecord[]>();
  readonly #unknowns = new Map<string, UnknownRecord>();

  constructor(options: LedgerOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  // ----------------------------------------------------------- sources ---

  addSource(input: unknown): Result<Added<SourceRecord>> {
    return this.#addSource(input, this.#now());
  }

  #addSource(input: unknown, recordedAt: string): Result<Added<SourceRecord>> {
    const parsed = sourceInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const s = parsed.data;
    const id = contentId("src", {
      alias: s.alias,
      origin: s.origin,
      medium: s.medium,
      sha256: s.sha256 ?? null,
      received: s.received ?? null,
    });
    const existing = this.#sources.get(id);
    if (existing !== undefined) {
      const sameDisplay =
        existing.name === s.name &&
        (existing.sensitive ?? false) === (s.sensitive ?? false);
      return sameDisplay
        ? ok({ record: existing, created: false })
        : fail(
            "conflict",
            `Source ${id} is already recorded with a different name or sensitivity. Identity fields match; display fields are not silently overwritten.`,
            "name",
          );
    }
    const aliasKey = s.alias.toLowerCase();
    const holder = this.#aliases.get(aliasKey);
    if (holder !== undefined)
      return fail(
        "conflict",
        `Alias "${s.alias}" already identifies a different source (${holder}). Aliases name sources in reports and must be unique.`,
        "alias",
      );
    const record: SourceRecord = {
      id,
      alias: s.alias,
      origin: s.origin,
      medium: s.medium,
      ...(s.sha256 === undefined ? {} : { sha256: s.sha256 }),
      ...(s.received === undefined ? {} : { received: s.received }),
      ...(s.name === undefined ? {} : { name: s.name }),
      ...(s.sensitive === undefined ? {} : { sensitive: s.sensitive }),
      recorded_at: recordedAt,
    };
    this.#sources.set(id, record);
    this.#aliases.set(aliasKey, id);
    return ok({ record, created: true });
  }

  // ---------------------------------------------------------- findings ---

  addFinding(input: unknown): Result<Added<FindingRecord>> {
    return this.#addFinding(input, this.#now());
  }

  #addFinding(
    input: unknown,
    recordedAt: string,
  ): Result<Added<FindingRecord>> {
    const parsed = findingInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const f = parsed.data;
    const kind = f.kind ?? "fact";
    const supports = normalizeSupports(f.supports ?? []);
    const inputs = uniqueSorted(f.inputs ?? []);

    const ruleIssue = this.#checkRules(f, kind, supports.length, inputs.length);
    if (ruleIssue !== undefined) return ruleIssue;

    for (const [i, support] of supports.entries())
      if (!this.#sources.has(support.source_id))
        return fail(
          "unknown_reference",
          `Source ${support.source_id} is not in the ledger. Record it with add_source first.`,
          `supports.${i}.source_id`,
        );
    for (const [i, inputId] of inputs.entries())
      if (!this.#findings.has(inputId))
        return fail(
          "unknown_reference",
          `Input finding ${inputId} is not in the ledger.`,
          `inputs.${i}`,
        );

    const limitations = f.limitations ?? [];
    const id = contentId("fnd", {
      statement: f.statement,
      kind,
      basis: f.basis,
      supports: asJson(supports),
      inputs,
      method: f.method ?? null,
      rationale: f.rationale ?? null,
      coverage: f.coverage ?? null,
      limitations,
      so_what: f.so_what ?? null,
      data: f.data ?? null,
    });
    const existing = this.#findings.get(id);
    if (existing !== undefined) return ok({ record: existing, created: false });

    const record: FindingRecord = {
      id,
      statement: f.statement,
      kind,
      basis: f.basis,
      supports,
      inputs,
      ...(f.method === undefined ? {} : { method: f.method }),
      ...(f.rationale === undefined ? {} : { rationale: f.rationale }),
      ...(f.coverage === undefined ? {} : { coverage: f.coverage }),
      limitations,
      ...(f.so_what === undefined ? {} : { so_what: f.so_what }),
      ...(f.data === undefined ? {} : { data: f.data }),
      recorded_at: recordedAt,
    };
    this.#findings.set(id, record);
    return ok({ record, created: true });
  }

  #checkRules(
    f: ReturnType<typeof findingInputSchema.parse>,
    kind: "fact" | "absence",
    supportCount: number,
    inputCount: number,
  ): Result<never> | undefined {
    switch (f.basis) {
      case "observed":
        if (supportCount === 0)
          return fail(
            "missing_support",
            "An observed finding must cite at least one source with a locator and excerpt. If nothing was read directly, record it as inferred with a rationale, or open an unknown.",
            "supports",
          );
        if (inputCount > 0)
          return fail(
            "rule_violation",
            'An observed finding is read from sources, not computed from other findings. Use basis "derived" with inputs and a method.',
            "inputs",
          );
        if (f.method !== undefined)
          return fail(
            "rule_violation",
            "method applies to derived findings only.",
            "method",
          );
        if (f.rationale !== undefined)
          return fail(
            "rule_violation",
            "rationale applies to inferred findings only.",
            "rationale",
          );
        break;
      case "derived":
        if (inputCount === 0)
          return fail(
            "missing_support",
            "A derived finding must list the findings it is computed from.",
            "inputs",
          );
        if (f.method === undefined)
          return fail(
            "missing_support",
            "A derived finding must state its method so the computation can be repeated.",
            "method",
          );
        if (supportCount > 0)
          return fail(
            "rule_violation",
            "A derived finding takes its support from its inputs. Cite sources on the input findings instead.",
            "supports",
          );
        if (f.rationale !== undefined)
          return fail(
            "rule_violation",
            "rationale applies to inferred findings only.",
            "rationale",
          );
        break;
      case "inferred":
        if (f.rationale === undefined)
          return fail(
            "missing_support",
            "An inferred finding must state why it is believed.",
            "rationale",
          );
        if (f.method !== undefined)
          return fail(
            "rule_violation",
            "method applies to derived findings only.",
            "method",
          );
        break;
    }
    if (kind === "absence") {
      if (f.basis !== "observed")
        return fail(
          "rule_violation",
          "An absence claim reports a search, so it is an observation. Record it as observed with coverage.",
          "basis",
        );
      if (f.coverage === undefined)
        return fail(
          "absence_requires_coverage",
          "A negative finding needs a stated search scope: pass coverage { scope, complete: true }. If the search was partial, open an unknown instead.",
          "coverage",
        );
      if (!f.coverage.complete)
        return fail(
          "absence_requires_coverage",
          `The search of "${f.coverage.scope}" was not complete, so absence is unknown, not established. Open an unknown stating what was searched and what would resolve it.`,
          "coverage.complete",
        );
    } else if (f.coverage !== undefined) {
      return fail(
        "rule_violation",
        "coverage applies to absence findings only.",
        "coverage",
      );
    }
    return undefined;
  }

  // ----------------------------------------------------- corroboration ---

  corroborate(
    input: unknown,
  ): Result<
    Added<CorroborationRecord> & { before: Confidence; after: Confidence }
  > {
    return this.#corroborate(input, this.#now());
  }

  #corroborate(
    input: unknown,
    recordedAt: string,
  ): Result<
    Added<CorroborationRecord> & { before: Confidence; after: Confidence }
  > {
    const parsed = corroborationInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const { finding_id, support } = parsed.data;
    const finding = this.#findings.get(finding_id);
    if (finding === undefined)
      return fail(
        "unknown_reference",
        `Finding ${finding_id} is not in the ledger.`,
        "finding_id",
      );
    if (finding.basis === "derived")
      return fail(
        "rule_violation",
        "A derived finding is no stronger than its weakest input. Corroborate the input findings instead.",
        "finding_id",
      );
    if (!this.#sources.has(support.source_id))
      return fail(
        "unknown_reference",
        `Source ${support.source_id} is not in the ledger. Record it with add_source first.`,
        "support.source_id",
      );
    const id = contentId("cor", { finding_id, support: asJson(support) });
    const before = this.#explain(finding).confidence;
    const existing = this.#corroborations.get(id);
    if (existing !== undefined)
      return ok({ record: existing, created: false, before, after: before });
    const record: CorroborationRecord = {
      id,
      finding_id,
      support,
      recorded_at: recordedAt,
    };
    this.#corroborations.set(id, record);
    const list = this.#corroborationsByFinding.get(finding_id) ?? [];
    list.push(record);
    this.#corroborationsByFinding.set(finding_id, list);
    return ok({
      record,
      created: true,
      before,
      after: this.#explain(finding).confidence,
    });
  }

  // ---------------------------------------------------------- unknowns ---

  openUnknown(input: unknown): Result<Added<UnknownRecord>> {
    return this.#openUnknown(input, this.#now());
  }

  #openUnknown(
    input: unknown,
    recordedAt: string,
  ): Result<Added<UnknownRecord>> {
    const parsed = openUnknownInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const u = parsed.data;
    const related = uniqueSorted(u.related_findings ?? []);
    for (const [i, findingId] of related.entries())
      if (!this.#findings.has(findingId))
        return fail(
          "unknown_reference",
          `Finding ${findingId} is not in the ledger.`,
          `related_findings.${i}`,
        );
    const id = contentId("unk", {
      question: u.question,
      why_it_matters: u.why_it_matters ?? null,
      searched: u.searched ?? null,
      would_resolve: u.would_resolve ?? null,
      related_findings: related,
    });
    const existing = this.#unknowns.get(id);
    if (existing !== undefined) return ok({ record: existing, created: false });
    const record: UnknownRecord = {
      id,
      question: u.question,
      ...(u.why_it_matters === undefined
        ? {}
        : { why_it_matters: u.why_it_matters }),
      ...(u.searched === undefined ? {} : { searched: u.searched }),
      ...(u.would_resolve === undefined
        ? {}
        : { would_resolve: u.would_resolve }),
      related_findings: related,
      revisions: [
        {
          n: 1,
          status: "open",
          note: "Opened.",
          resolved_by: [],
          recorded_at: recordedAt,
        },
      ],
    };
    this.#unknowns.set(id, record);
    return ok({ record, created: true });
  }

  reviseUnknown(input: unknown): Result<Added<UnknownRecord>> {
    return this.#reviseUnknown(input, this.#now());
  }

  #reviseUnknown(
    input: unknown,
    recordedAt: string,
  ): Result<Added<UnknownRecord>> {
    const parsed = reviseUnknownInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const r = parsed.data;
    const record = this.#unknowns.get(r.unknown_id);
    if (record === undefined)
      return fail(
        "not_found",
        `No unknown ${r.unknown_id}. List unknowns to see current ids.`,
        "unknown_id",
      );
    const current = record.revisions.at(-1);
    if (current === undefined)
      return fail(
        "integrity",
        `Unknown ${r.unknown_id} has no revision history.`,
      );
    const resolvedBy = uniqueSorted(r.resolved_by ?? []);
    if (r.status === "resolved") {
      if (resolvedBy.length === 0)
        return fail(
          "missing_support",
          "Resolving an unknown requires the findings that settle it (resolved_by). If it cannot be settled, use status unresolvable.",
          "resolved_by",
        );
      for (const [i, findingId] of resolvedBy.entries())
        if (!this.#findings.has(findingId))
          return fail(
            "unknown_reference",
            `Finding ${findingId} is not in the ledger.`,
            `resolved_by.${i}`,
          );
    } else if (resolvedBy.length > 0) {
      return fail(
        "rule_violation",
        "resolved_by applies only when status is resolved.",
        "resolved_by",
      );
    }
    const duplicate =
      current.status === r.status &&
      current.note === r.note &&
      canonicalJson(current.resolved_by) === canonicalJson(resolvedBy);
    if (duplicate) return ok({ record, created: false });
    if (!TRANSITIONS[current.status].includes(r.status))
      return fail(
        "invalid_transition",
        `An unknown that is ${current.status} cannot become ${r.status}. Allowed next: ${TRANSITIONS[current.status].join(", ")}.`,
        "status",
      );
    record.revisions.push({
      n: current.n + 1,
      status: r.status,
      note: r.note,
      resolved_by: resolvedBy,
      recorded_at: recordedAt,
    });
    return ok({ record, created: true });
  }

  // ----------------------------------------------------------- reading ---

  sources(): readonly SourceRecord[] {
    return [...this.#sources.values()];
  }
  getSource(id: string): SourceRecord | undefined {
    return this.#sources.get(id);
  }
  findings(): readonly FindingRecord[] {
    return [...this.#findings.values()];
  }
  getFinding(id: string): FindingRecord | undefined {
    return this.#findings.get(id);
  }
  corroborationsFor(findingId: string): readonly CorroborationRecord[] {
    return this.#corroborationsByFinding.get(findingId) ?? [];
  }
  unknowns(): readonly UnknownRecord[] {
    return [...this.#unknowns.values()];
  }
  getUnknown(id: string): UnknownRecord | undefined {
    return this.#unknowns.get(id);
  }

  /** The current status of an unknown is its latest revision. */
  static statusOf(record: UnknownRecord): UnknownStatus {
    return record.revisions.at(-1)?.status ?? "open";
  }

  confidenceOf(findingId: string): Confidence | undefined {
    const finding = this.#findings.get(findingId);
    return finding === undefined
      ? undefined
      : this.#explain(finding).confidence;
  }

  explain(findingId: string): Explanation | undefined {
    const finding = this.#findings.get(findingId);
    return finding === undefined ? undefined : this.#explain(finding);
  }

  gradedFindings(): readonly {
    record: FindingRecord;
    explanation: Explanation;
  }[] {
    return this.findings().map((record) => ({
      record,
      explanation: this.#explain(record),
    }));
  }

  /**
   * L1: two independent origins, each with a documented source.
   * L2: two independent origins, not both documented (this reconciles the
   *     "one strong source plus corroboration" table with the "two weak
   *     signals from independent sources" mosaic rule).
   * L3: one origin or none, including any single source and any inference
   *     without corroboration.
   * Derived findings take the weakest grade among their inputs.
   */
  #explain(finding: FindingRecord): Explanation {
    if (finding.basis === "derived") {
      const levels = finding.inputs.map((id) => ({
        id,
        level: this.#levelOf(id),
      }));
      let worst: Confidence = "L1";
      for (const { level } of levels)
        if (RANK[level] > RANK[worst]) worst = level;
      return {
        confidence: worst,
        distinct_origins: [],
        documented_origins: [],
        weakest_inputs: levels
          .filter((l) => l.level === worst)
          .map((l) => l.id),
      };
    }
    const origins = new Map<string, string>();
    const documented = new Map<string, string>();
    const supports = [
      ...finding.supports,
      ...this.corroborationsFor(finding.id).map((c) => c.support),
    ];
    for (const support of supports) {
      const source = this.#sources.get(support.source_id);
      if (source === undefined) continue;
      const key = normalizeOrigin(source.origin);
      if (!origins.has(key)) origins.set(key, source.origin);
      if (source.medium === "document" && !documented.has(key))
        documented.set(key, source.origin);
    }
    const confidence: Confidence =
      documented.size >= 2 ? "L1" : origins.size >= 2 ? "L2" : "L3";
    return {
      confidence,
      distinct_origins: [...origins.values()],
      documented_origins: [...documented.values()],
      weakest_inputs: [],
    };
  }

  /** A missing input fails toward the weakest grade. */
  #levelOf(findingId: string): Confidence {
    const finding = this.#findings.get(findingId);
    return finding === undefined ? "L3" : this.#explain(finding).confidence;
  }

  lint(): readonly LintWarning[] {
    const warnings: LintWarning[] = [];
    for (const { record, explanation } of this.gradedFindings())
      if (explanation.confidence !== "L3" && record.so_what === undefined)
        warnings.push({
          code: "missing_so_what",
          finding_id: record.id,
          message: `${explanation.confidence} finding has no "so what". State what it means, who it affects and the next action before relying on it.`,
        });
    return warnings;
  }

  // ------------------------------------------------------------ bundle ---

  toBundle(): Bundle {
    const body: Omit<Bundle, "digest"> = {
      format: BUNDLE_FORMAT,
      sources: [...this.#sources.values()],
      findings: [...this.#findings.values()],
      corroborations: [...this.#corroborations.values()],
      unknowns: [...this.#unknowns.values()],
    };
    return { ...body, digest: sha256Hex(canonicalJson(asJson(body))) };
  }

  /**
   * Rebuild a ledger from a bundle by replaying every record through the same
   * validators as a live write, then requiring each rebuilt record to equal
   * the bundle's record exactly. Altered content, forged ids, dangling
   * references and non-canonical ordering are all rejected. The digest detects
   * accidental change; it is not a signature and does not stop a deliberate
   * rewrite of the whole file.
   */
  static fromBundle(
    input: unknown,
    options: LedgerOptions = {},
  ): Result<Ledger> {
    const parsed = bundleSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const bundle = parsed.data;
    const ledger = new Ledger(options);

    const replayFailure = (
      what: string,
      id: string,
      issue: Issue,
    ): Result<never> =>
      fail(issue.code, `${what} ${id}: ${issue.message}`, issue.path);
    const mismatch = (what: string, id: string): Result<never> =>
      fail(
        "integrity",
        `${what} ${id} does not match its recorded content. The bundle was altered or is not in canonical form.`,
      );
    const duplicate = (what: string, id: string): Result<never> =>
      fail("integrity", `${what} ${id} appears more than once.`);

    for (const s of bundle.sources) {
      const r = ledger.#addSource(
        defined({
          alias: s.alias,
          origin: s.origin,
          medium: s.medium,
          sha256: s.sha256,
          received: s.received,
          name: s.name,
          sensitive: s.sensitive,
        }),
        s.recorded_at,
      );
      if (!r.ok) return replayFailure("Source", s.id, r.error);
      if (!r.value.created) return duplicate("Source", s.id);
      if (canonicalJson(asJson(r.value.record)) !== canonicalJson(asJson(s)))
        return mismatch("Source", s.id);
    }
    for (const f of bundle.findings) {
      const r = ledger.#addFinding(
        defined({
          statement: f.statement,
          basis: f.basis,
          kind: f.kind,
          supports: f.supports,
          inputs: f.inputs,
          method: f.method,
          rationale: f.rationale,
          coverage: f.coverage,
          limitations: f.limitations,
          so_what: f.so_what,
          data: f.data,
        }),
        f.recorded_at,
      );
      if (!r.ok) return replayFailure("Finding", f.id, r.error);
      if (!r.value.created) return duplicate("Finding", f.id);
      if (canonicalJson(asJson(r.value.record)) !== canonicalJson(asJson(f)))
        return mismatch("Finding", f.id);
    }
    for (const c of bundle.corroborations) {
      const r = ledger.#corroborate(
        { finding_id: c.finding_id, support: c.support },
        c.recorded_at,
      );
      if (!r.ok) return replayFailure("Corroboration", c.id, r.error);
      if (!r.value.created) return duplicate("Corroboration", c.id);
      if (canonicalJson(asJson(r.value.record)) !== canonicalJson(asJson(c)))
        return mismatch("Corroboration", c.id);
    }
    for (const u of bundle.unknowns) {
      const opening = u.revisions[0];
      if (opening === undefined) return mismatch("Unknown", u.id);
      const opened = ledger.#openUnknown(
        defined({
          question: u.question,
          why_it_matters: u.why_it_matters,
          searched: u.searched,
          would_resolve: u.would_resolve,
          related_findings: u.related_findings,
        }),
        opening.recorded_at,
      );
      if (!opened.ok) return replayFailure("Unknown", u.id, opened.error);
      if (!opened.value.created) return duplicate("Unknown", u.id);
      if (opened.value.record.id !== u.id) return mismatch("Unknown", u.id);
      for (const revision of u.revisions.slice(1)) {
        const r = ledger.#reviseUnknown(
          {
            unknown_id: u.id,
            status: revision.status,
            note: revision.note,
            resolved_by: revision.resolved_by,
          },
          revision.recorded_at,
        );
        if (!r.ok) return replayFailure("Unknown", u.id, r.error);
        if (!r.value.created) return duplicate("Unknown revision of", u.id);
      }
      const rebuilt = ledger.#unknowns.get(u.id);
      if (
        rebuilt === undefined ||
        canonicalJson(asJson(rebuilt)) !== canonicalJson(asJson(u))
      )
        return mismatch("Unknown", u.id);
    }
    if (ledger.toBundle().digest !== bundle.digest)
      return fail(
        "integrity",
        "The bundle digest does not match its contents. The file was altered after export.",
        "digest",
      );
    return ok(ledger);
  }
}

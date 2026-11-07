import { shortId } from "./canonical.ts";
import { Ledger } from "./ledger.ts";
import type { Explanation } from "./ledger.ts";
import type {
  Confidence,
  FindingRecord,
  Support,
  UnknownRecord,
} from "./model.ts";

export interface ReportOptions {
  /**
   * "client" withholds every L3 finding (and any source cited only by one),
   * following the rule that unconfirmed intel is never presented to a client.
   */
  readonly audience?: "internal" | "client";
  readonly title?: string;
  readonly asOf?: string;
}

const GRADE_TITLES: Record<Confidence, string> = {
  L1: "L1: two independent documented sources. Act on it.",
  L2: "L2: two independent sources, not both documented. Pursue with verification.",
  L3: "L3: unconfirmed. Log only; do not act until upgraded.",
};

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
const cell = (text: string): string => oneLine(text).replace(/\|/g, "\\|");
const truncate = (text: string, max = 90): string => {
  const line = oneLine(text);
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
};

const latestTimestamp = (ledger: Ledger): string | undefined => {
  const stamps = [
    ...ledger.sources().map((r) => r.recorded_at),
    ...ledger.findings().map((r) => r.recorded_at),
    ...ledger.unknowns().flatMap((u) => u.revisions.map((r) => r.recorded_at)),
  ];
  for (const f of ledger.findings())
    for (const c of ledger.corroborationsFor(f.id)) stamps.push(c.recorded_at);
  return stamps.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
};

export const renderReport = (
  ledger: Ledger,
  options: ReportOptions = {},
): string => {
  const audience = options.audience ?? "internal";
  const client = audience === "client";
  const graded = ledger.gradedFindings();
  const shown = graded.filter(
    (g) => !client || g.explanation.confidence !== "L3",
  );
  const withheld = graded.length - shown.length;

  const describe = (id: string): string => {
    const finding = ledger.getFinding(id);
    if (finding === undefined) return `${shortId(id)} (not in ledger)`;
    if (client && ledger.confidenceOf(id) === "L3") return "a withheld item";
    return `"${truncate(finding.statement)}" (${shortId(id)})`;
  };
  const sourceLabel = (support: Support): string => {
    const source = ledger.getSource(support.source_id);
    const where = `${support.locator.type} ${oneLine(support.locator.value)}`;
    if (source === undefined) return `${shortId(support.source_id)}; ${where}`;
    // A sensitive source is shown by alias only: its origin can identify a person.
    const origin =
      source.sensitive === true ? "origin withheld" : source.origin;
    return `${source.alias} (${origin}, ${source.medium}; ${where})`;
  };

  const renderFinding = (
    record: FindingRecord,
    explanation: Explanation,
  ): string[] => {
    const tag = [
      record.basis + (record.kind === "absence" ? ", absence" : ""),
      explanation.confidence,
    ].join(" · ");
    const lines = [
      `- **${oneLine(record.statement)}** _(${tag})_ \`${shortId(record.id)}\``,
    ];
    for (const support of record.supports)
      lines.push(
        `  - Source: ${sourceLabel(support)}: "${oneLine(support.excerpt)}"`,
      );
    for (const c of ledger.corroborationsFor(record.id))
      lines.push(
        `  - Corroborated by: ${sourceLabel(c.support)}: "${oneLine(c.support.excerpt)}"`,
      );
    if (record.basis === "derived") {
      lines.push(
        `  - Computed from: ${record.inputs.map(describe).join("; ")}`,
      );
      if (record.method !== undefined)
        lines.push(`  - Method: ${oneLine(record.method)}`);
      if (
        explanation.confidence !== "L1" &&
        explanation.weakest_inputs.length > 0
      )
        lines.push(
          `  - Capped by its weakest input: ${explanation.weakest_inputs.map(describe).join("; ")}`,
        );
    }
    if (record.rationale !== undefined)
      lines.push(`  - Why believed: ${oneLine(record.rationale)}`);
    if (record.basis === "inferred" && record.inputs.length > 0)
      lines.push(`  - Relies on: ${record.inputs.map(describe).join("; ")}`);
    if (record.coverage !== undefined)
      lines.push(
        `  - Searched: ${oneLine(record.coverage.scope)} (${record.coverage.complete ? "complete" : "partial"})`,
      );
    if (record.so_what !== undefined)
      lines.push(`  - So what? ${oneLine(record.so_what)}`);
    if (record.limitations.length > 0)
      lines.push(
        `  - Limitations: ${record.limitations.map((l) => oneLine(l).replace(/\.$/, "")).join("; ")}.`,
      );
    return lines;
  };

  const renderUnknown = (record: UnknownRecord, index: number): string[] => {
    const latest = record.revisions.at(-1);
    const status = Ledger.statusOf(record);
    const lines = [
      `${index + 1}. **${oneLine(record.question)}** _(${status})_ \`${shortId(record.id)}\``,
    ];
    if (record.why_it_matters !== undefined)
      lines.push(`   - Why it matters: ${oneLine(record.why_it_matters)}`);
    if (record.searched !== undefined)
      lines.push(`   - Already searched: ${oneLine(record.searched)}`);
    if (record.would_resolve !== undefined)
      lines.push(`   - Would resolve it: ${oneLine(record.would_resolve)}`);
    if (record.related_findings.length > 0)
      lines.push(
        `   - Related: ${record.related_findings.map(describe).join("; ")}`,
      );
    if (latest !== undefined && latest.n > 1) {
      lines.push(`   - Latest (revision ${latest.n}): ${oneLine(latest.note)}`);
      if (latest.resolved_by.length > 0)
        lines.push(
          `   - Resolved by: ${latest.resolved_by.map(describe).join("; ")}`,
        );
    }
    return lines;
  };

  // An unknown's wording is free text the ledger cannot inspect, and it often
  // restates the facts it is about. For a client, any unknown linked to a
  // withheld (L3) finding is withheld with it. Unlinked unknowns are shown.
  const allUnknowns = ledger.unknowns();
  const unknowns = allUnknowns.filter(
    (u) =>
      !client ||
      !u.related_findings.some((id) => ledger.confidenceOf(id) === "L3"),
  );
  const withheldUnknowns = allUnknowns.length - unknowns.length;
  const active = unknowns.filter((u) =>
    ["open", "narrowed"].includes(Ledger.statusOf(u)),
  );
  const closed = unknowns.filter((u) => !active.includes(u));
  const count = (level: Confidence): number =>
    shown.filter((g) => g.explanation.confidence === level).length;
  const basisCount = (basis: FindingRecord["basis"]): number =>
    shown.filter((g) => g.record.basis === basis).length;

  const out: string[] = [];
  out.push(`# ${options.title ?? "Findings report"}`, "");
  const asOf = options.asOf ?? latestTimestamp(ledger) ?? "no records";
  out.push(`_As of ${asOf}. Audience: ${audience}._`, "");

  out.push("## Summary", "");
  out.push(
    client
      ? `- Findings: ${count("L1")} at L1, ${count("L2")} at L2. ${withheld} unconfirmed item${withheld === 1 ? "" : "s"} withheld pending corroboration.`
      : `- Findings: ${count("L1")} at L1, ${count("L2")} at L2, ${count("L3")} at L3.`,
  );
  out.push(
    `- Basis of the findings shown: ${basisCount("observed")} observed, ${basisCount("derived")} derived, ${basisCount("inferred")} inferred.`,
  );
  out.push(
    `- Open unknowns: ${active.length}. Resolved or closed: ${closed.length}.`,
  );
  if (client && withheldUnknowns > 0)
    out.push(
      `- ${withheldUnknowns} further unknown${withheldUnknowns === 1 ? "" : "s"} concerning unconfirmed findings withheld.`,
    );
  if (!client) {
    const missing = ledger.lint().length;
    if (missing > 0)
      out.push(
        `- ${missing} L1/L2 finding${missing === 1 ? " needs" : "s need"} a "so what" before it is relied on.`,
      );
  }
  out.push("");

  out.push("## Open unknowns", "");
  out.push(
    ...(active.length === 0 ? ["_None open._"] : active.flatMap(renderUnknown)),
    "",
  );

  out.push("## Findings", "");
  const levels: Confidence[] = client ? ["L1", "L2"] : ["L1", "L2", "L3"];
  for (const level of levels) {
    out.push(`### ${GRADE_TITLES[level]}`, "");
    const group = shown.filter((g) => g.explanation.confidence === level);
    out.push(
      ...(group.length === 0
        ? ["_None._"]
        : group.flatMap((g) => renderFinding(g.record, g.explanation))),
      "",
    );
  }

  if (closed.length > 0) {
    out.push("## Resolved or closed unknowns", "");
    out.push(...closed.flatMap(renderUnknown), "");
  }

  const cited = new Set<string>();
  for (const { record } of shown) {
    for (const s of record.supports) cited.add(s.source_id);
    for (const c of ledger.corroborationsFor(record.id))
      cited.add(c.support.source_id);
  }
  const sources = ledger.sources().filter((s) => !client || cited.has(s.id));
  out.push("## Sources", "");
  if (sources.length === 0) out.push("_None cited._", "");
  else {
    out.push(
      "| Alias | Origin | Medium | Received | SHA-256 (first 16) | Name |",
    );
    out.push("| --- | --- | --- | --- | --- | --- |");
    for (const s of sources)
      out.push(
        `| ${cell(s.alias)} | ${s.sensitive === true ? "(withheld)" : cell(s.origin)} | ${s.medium} | ${s.received ?? ""} | ${s.sha256?.slice(0, 16) ?? ""} | ${s.name !== undefined && s.sensitive !== true ? cell(s.name) : ""} |`,
      );
    out.push("");
  }

  out.push("---", "");
  out.push(
    "_Grades are computed from the recorded sources, not asserted. Two sources are independent only if their origins differ. A derived finding is no stronger than its weakest input. Identifiers are abbreviated content digests; the complete records are in the exported bundle._",
  );
  return `${out.join("\n")}\n`;
};

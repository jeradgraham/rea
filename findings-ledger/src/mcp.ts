import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Ledger } from "./ledger.ts";
import type { Issue, Result } from "./ledger.ts";
import {
  BASES,
  CONFIDENCES,
  UNKNOWN_STATUSES,
  corroborationInputSchema,
  findingIdSchema,
  findingInputSchema,
  openUnknownInputSchema,
  reviseUnknownInputSchema,
  sourceInputSchema,
} from "./model.ts";
import { renderReport } from "./report.ts";
import type { LedgerStore } from "./store.ts";
import { VERSION } from "./version.ts";

const INSTRUCTIONS = [
  "Findings ledger for diligence work. Every claim is recorded with how it was obtained and where it came from; grades are computed, never asserted.",
  "Workflow: add_source for each document or conversation, record_finding for each claim, corroborate_finding when a new independent source confirms an existing claim, open_unknown for each gap, render_report to present.",
  "Basis: observed (read directly from a source, with locator and excerpt), derived (computed from other findings, with method), inferred (judgment, with rationale).",
  "Grades: L1 two independent documented origins; L2 two independent origins, not both documented; L3 one origin or none. Origins that match are not independent. A derived finding takes its weakest input's grade.",
  "Never write 'none found' without a complete search scope: use kind 'absence' with coverage, or open an unknown. Never present L3 findings to a client.",
].join("\n");

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});
const reply = (value: unknown): CallToolResult => text(JSON.stringify(value));
const refuse = (issue: Issue): CallToolResult =>
  text(JSON.stringify({ error: issue }), true);

const paging = {
  limit: z.number().int().min(1).max(100).optional().describe("Default 25."),
  offset: z.number().int().min(0).optional().describe("Default 0."),
};

export const createServer = (ledger: Ledger, store: LedgerStore): McpServer => {
  const server = new McpServer(
    { name: "findings-ledger", version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  /** Run a write; persist only when it changed something; never report success if the save failed. */
  const write = async <T>(
    operation: () => Result<T>,
    changed: (value: T) => boolean,
    summarize: (value: T) => unknown,
  ): Promise<CallToolResult> => {
    const result = operation();
    if (!result.ok) return refuse(result.error);
    if (changed(result.value)) {
      try {
        await store.save();
      } catch (cause) {
        return refuse({
          code: "integrity",
          message: `Recorded in memory but not saved to ${store.path}: ${(cause as Error).message}. The next successful write will save it.`,
        });
      }
    }
    return reply(summarize(result.value));
  };

  const mutating = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  } as const;
  const reading = { readOnlyHint: true } as const;

  server.registerTool(
    "add_source",
    {
      title: "Add source",
      description:
        "Record a document or verbal source before citing it. Documents need the SHA-256 of the exact file reviewed. Re-adding the same source is a no-op.",
      inputSchema: sourceInputSchema.shape,
      annotations: mutating,
    },
    async (args) =>
      write(
        () => ledger.addSource(args),
        (v) => v.created,
        (v) => ({ id: v.record.id, alias: v.record.alias, created: v.created }),
      ),
  );

  server.registerTool(
    "record_finding",
    {
      title: "Record finding",
      description:
        "Record one claim. observed needs supports (source, locator, excerpt); derived needs inputs and method; inferred needs rationale; an absence claim needs complete coverage. Returns the computed grade. Identical content is a no-op.",
      inputSchema: findingInputSchema.shape,
      annotations: mutating,
    },
    async (args) =>
      write(
        () => ledger.addFinding(args),
        (v) => v.created,
        (v) => ({
          id: v.record.id,
          created: v.created,
          basis: v.record.basis,
          confidence: ledger.confidenceOf(v.record.id),
        }),
      ),
  );

  server.registerTool(
    "corroborate_finding",
    {
      title: "Corroborate finding",
      description:
        "Add a new supporting source to an existing observed or inferred finding. Returns the grade before and after. Corroborate the inputs, not a derived finding.",
      inputSchema: corroborationInputSchema.shape,
      annotations: mutating,
    },
    async (args) =>
      write(
        () => ledger.corroborate(args),
        (v) => v.created,
        (v) => ({
          id: v.record.id,
          created: v.created,
          before: v.before,
          after: v.after,
        }),
      ),
  );

  server.registerTool(
    "open_unknown",
    {
      title: "Open unknown",
      description:
        "Record something that is not known, with what has already been searched. Use this instead of claiming absence from a partial search.",
      inputSchema: openUnknownInputSchema.shape,
      annotations: mutating,
    },
    async (args) =>
      write(
        () => ledger.openUnknown(args),
        (v) => v.created,
        (v) => ({
          id: v.record.id,
          created: v.created,
          status: Ledger.statusOf(v.record),
        }),
      ),
  );

  server.registerTool(
    "update_unknown",
    {
      title: "Update unknown",
      description:
        "Append a revision to an unknown: narrowed, resolved (requires resolved_by findings), unresolvable, or reopened. History is never overwritten.",
      inputSchema: reviseUnknownInputSchema.shape,
      annotations: mutating,
    },
    async (args) =>
      write(
        () => ledger.reviseUnknown(args),
        (v) => v.created,
        (v) => ({
          id: v.record.id,
          created: v.created,
          status: Ledger.statusOf(v.record),
          revisions: v.record.revisions.length,
        }),
      ),
  );

  server.registerTool(
    "get_finding",
    {
      title: "Get finding",
      description:
        "Full record for one finding with its computed grade, the independent origins behind it, and any corroborations.",
      inputSchema: { id: findingIdSchema },
      annotations: reading,
    },
    async ({ id }) => {
      const record = ledger.getFinding(id);
      const explanation = ledger.explain(id);
      if (record === undefined || explanation === undefined)
        return refuse({
          code: "not_found",
          message: `No finding ${id}. Use list_findings to see current ids.`,
          path: "id",
        });
      return reply({
        finding: record,
        explanation,
        corroborations: ledger.corroborationsFor(id),
      });
    },
  );

  server.registerTool(
    "list_findings",
    {
      title: "List findings",
      description:
        "Findings with id, statement, basis and computed grade. Filter by basis, grade or statement text.",
      inputSchema: {
        basis: z.enum(BASES).optional(),
        confidence: z.enum(CONFIDENCES).optional(),
        text: z
          .string()
          .optional()
          .describe("Case-insensitive match on the statement."),
        ...paging,
      },
      annotations: reading,
    },
    async ({ basis, confidence, text: needle, limit, offset }) => {
      const matches = ledger
        .gradedFindings()
        .filter((g) => basis === undefined || g.record.basis === basis)
        .filter(
          (g) =>
            confidence === undefined || g.explanation.confidence === confidence,
        )
        .filter(
          (g) =>
            needle === undefined ||
            g.record.statement.toLowerCase().includes(needle.toLowerCase()),
        );
      const start = offset ?? 0;
      const page = matches.slice(start, start + (limit ?? 25));
      return reply({
        total: matches.length,
        offset: start,
        ...(start + page.length < matches.length
          ? { next_offset: start + page.length }
          : {}),
        findings: page.map((g) => ({
          id: g.record.id,
          statement: g.record.statement,
          basis: g.record.basis,
          confidence: g.explanation.confidence,
          ...(g.record.so_what === undefined
            ? {}
            : { so_what: g.record.so_what }),
        })),
      });
    },
  );

  server.registerTool(
    "list_unknowns",
    {
      title: "List unknowns",
      description:
        "Unknowns with current status. Defaults to the active ones (open or narrowed).",
      inputSchema: {
        status: z
          .enum([...UNKNOWN_STATUSES, "active", "all"])
          .optional()
          .describe("Default 'active'."),
        ...paging,
      },
      annotations: reading,
    },
    async ({ status, limit, offset }) => {
      const want = status ?? "active";
      const matches = ledger.unknowns().filter((u) => {
        const current = Ledger.statusOf(u);
        return (
          want === "all" ||
          (want === "active"
            ? current === "open" || current === "narrowed"
            : current === want)
        );
      });
      const start = offset ?? 0;
      const page = matches.slice(start, start + (limit ?? 25));
      return reply({
        total: matches.length,
        offset: start,
        ...(start + page.length < matches.length
          ? { next_offset: start + page.length }
          : {}),
        unknowns: page.map((u) => ({
          id: u.id,
          question: u.question,
          status: Ledger.statusOf(u),
          ...(u.would_resolve === undefined
            ? {}
            : { would_resolve: u.would_resolve }),
        })),
      });
    },
  );

  server.registerTool(
    "render_report",
    {
      title: "Render report",
      description:
        "Markdown report: summary, open unknowns, findings by grade, sources. audience 'client' withholds every L3 finding.",
      inputSchema: {
        audience: z
          .enum(["internal", "client"])
          .optional()
          .describe("Default 'internal'."),
        title: z.string().optional(),
      },
      annotations: reading,
    },
    async ({ audience, title }) =>
      text(
        renderReport(ledger, {
          ...(audience === undefined ? {} : { audience }),
          ...(title === undefined ? {} : { title }),
        }),
      ),
  );

  server.registerTool(
    "ledger_status",
    {
      title: "Ledger status",
      description:
        "Counts by grade and unknown status, lint warnings, bundle digest and file path.",
      annotations: reading,
    },
    async () => {
      const grades = { L1: 0, L2: 0, L3: 0 };
      for (const g of ledger.gradedFindings())
        grades[g.explanation.confidence] += 1;
      const statuses = { open: 0, narrowed: 0, resolved: 0, unresolvable: 0 };
      for (const u of ledger.unknowns()) statuses[Ledger.statusOf(u)] += 1;
      return reply({
        path: store.path,
        digest: ledger.toBundle().digest,
        sources: ledger.sources().length,
        findings: grades,
        unknowns: statuses,
        lint_warnings: ledger.lint().length,
      });
    },
  );

  return server;
};

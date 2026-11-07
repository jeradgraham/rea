#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Ledger } from "./ledger.ts";
import type { Result } from "./ledger.ts";
import { createServer } from "./mcp.ts";
import { renderReport } from "./report.ts";
import { LedgerStore, loadLedger, parseBundleText } from "./store.ts";
import { VERSION } from "./version.ts";

const USAGE = `findings-ledger ${VERSION}

Usage:
  findings-ledger serve --ledger <file>     Run the MCP server on stdio over a ledger file
  findings-ledger verify <bundle>           Check a bundle's integrity and references
  findings-ledger status <bundle>           Counts by grade and the open unknowns
  findings-ledger report <bundle> [--audience internal|client] [--title <text>] [--out <file>]

Exit status: 0 success, 1 invalid or unreadable ledger, 2 usage error.
`;

const readLedger = async (path: string): Promise<Result<Ledger>> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "integrity",
        message: `Cannot read ${path}: ${(cause as Error).message}`,
      },
    };
  }
  return parseBundleText(text);
};

const OPTIONS = {
  ledger: { type: "string" },
  audience: { type: "string" },
  title: { type: "string" },
  out: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

const parse = (args: string[]) =>
  parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });

const main = async (args: string[]): Promise<number | undefined> => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (cause) {
    process.stderr.write(`${(cause as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, target, ...extra] = positionals;
  if (values.help === true || command === undefined) {
    process.stdout.write(USAGE);
    return values.help === true ? 0 : 2;
  }
  const usage = (message: string): number => {
    process.stderr.write(`${message}\n\n${USAGE}`);
    return 2;
  };

  if (command === "serve") {
    if (values.ledger === undefined || target !== undefined)
      return usage("serve takes --ledger <file> and no other arguments.");
    const loaded = await loadLedger(values.ledger);
    if (!loaded.ok) {
      process.stderr.write(
        `INVALID  ${loaded.error.code}: ${loaded.error.message}\n`,
      );
      return 1;
    }
    const store = new LedgerStore(values.ledger, loaded.value);
    await createServer(loaded.value, store).connect(new StdioServerTransport());
    process.stderr.write(`findings-ledger ${VERSION} serving ${store.path}\n`);
    return undefined;
  }

  if (!["verify", "status", "report"].includes(command))
    return usage(`Unknown command "${command}".`);
  if (target === undefined || extra.length > 0)
    return usage(`${command} takes exactly one bundle file.`);

  const audience = values.audience ?? "internal";
  if (audience !== "internal" && audience !== "client")
    return usage('--audience must be "internal" or "client".');

  const loaded = await readLedger(target);
  if (!loaded.ok) {
    process.stderr.write(
      `INVALID  ${loaded.error.code}: ${loaded.error.message}\n`,
    );
    return 1;
  }
  const ledger = loaded.value;
  const bundle = ledger.toBundle();

  if (command === "verify") {
    const warnings = ledger.lint().length;
    process.stdout.write(
      `OK  sources=${bundle.sources.length} findings=${bundle.findings.length} corroborations=${bundle.corroborations.length} unknowns=${bundle.unknowns.length} lint_warnings=${warnings} digest=${bundle.digest}\n`,
    );
    return 0;
  }

  if (command === "status") {
    const grades = { L1: 0, L2: 0, L3: 0 };
    for (const g of ledger.gradedFindings())
      grades[g.explanation.confidence] += 1;
    const active = ledger
      .unknowns()
      .filter((u) => ["open", "narrowed"].includes(Ledger.statusOf(u)));
    const lines = [
      `Sources: ${bundle.sources.length}`,
      `Findings: ${grades.L1} at L1, ${grades.L2} at L2, ${grades.L3} at L3`,
      `Open unknowns: ${active.length} of ${bundle.unknowns.length}`,
      ...active.map((u) => `  - ${u.question} (${Ledger.statusOf(u)})`),
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }

  const report = renderReport(ledger, {
    audience,
    ...(values.title === undefined ? {} : { title: values.title }),
  });
  if (values.out === undefined) process.stdout.write(report);
  else await writeFile(values.out, report, "utf8");
  return 0;
};

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exitCode = code;
  },
  (cause: unknown) => {
    process.stderr.write(
      `${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
    );
    process.exitCode = 1;
  },
);

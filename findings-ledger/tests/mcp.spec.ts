import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Ledger } from "../src/ledger.ts";
import { hex } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const NODE_ARGS = ["--disable-warning=ExperimentalWarning", CLI];

let dir = "";
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "fl-mcp-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const connect = async (ledgerPath: string) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...NODE_ARGS, "serve", "--ledger", ledgerPath],
    stderr: "ignore",
  });
  const client = new Client({ name: "findings-ledger-test", version: "0" });
  await client.connect(transport);
  return client;
};

interface Called {
  isError: boolean;
  text: string;
  json: Record<string, any>;
}
const call = async (
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Called> => {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text =
      (result.content as { type: string; text: string }[])[0]?.text ?? "";
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* report_render returns markdown */
    }
    return { isError: result.isError === true, text, json };
  } catch (cause) {
    return { isError: true, text: String(cause), json: {} };
  }
};

const EXPECTED_TOOLS = [
  "add_source",
  "corroborate_finding",
  "get_finding",
  "ledger_status",
  "list_findings",
  "list_unknowns",
  "open_unknown",
  "record_finding",
  "render_report",
  "update_unknown",
];

describe("MCP server over stdio", () => {
  it("advertises the full tool set with usage instructions", async () => {
    const client = await connect(join(dir, "tools.json"));
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
      const write = tools.find((t) => t.name === "record_finding");
      assert.ok(
        (write?.description ?? "").includes(
          "absence claim needs complete coverage",
        ),
      );
      assert.deepEqual(write?.annotations, {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      });
      assert.ok(tools.filter((t) => t.annotations?.readOnlyHint).length >= 5);
      assert.match(
        client.getInstructions() ?? "",
        /grades are computed, never asserted/,
      );
    } finally {
      await client.close();
    }
  });

  it("takes an investigation from source to L1, persists it, and restores it after a restart", async () => {
    const path = join(dir, "flow.json");
    let client = await connect(path);
    let digest: string;
    let statusBefore: Record<string, any>;
    try {
      const seller = await call(client, "add_source", {
        alias: "RentRoll",
        origin: "Seller",
        medium: "document",
        sha256: hex("a"),
      });
      const county = await call(client, "add_source", {
        alias: "TaxBill",
        origin: "County",
        medium: "document",
        sha256: hex("b"),
      });
      const broker = await call(client, "add_source", {
        alias: "Call",
        origin: "Broker",
        medium: "verbal",
        received: "2026-10-31",
        name: "Someone",
        sensitive: true,
      });
      assert.equal(seller.json.created, true);

      const finding = await call(client, "record_finding", {
        statement: "Unit 104 is vacant",
        basis: "observed",
        supports: [
          {
            source_id: seller.json.id,
            locator: { type: "row", value: "104" },
            excerpt: "104,2BR,980,vacant,1900,",
          },
        ],
      });
      assert.equal(finding.json.confidence, "L3");
      const again = await call(client, "record_finding", {
        statement: "Unit 104 is vacant",
        basis: "observed",
        supports: [
          {
            source_id: seller.json.id,
            locator: { type: "row", value: "104" },
            excerpt: "104,2BR,980,vacant,1900,",
          },
        ],
      });
      assert.deepEqual(
        [again.json.created, again.json.id],
        [false, finding.json.id],
        "idempotent",
      );

      const toL2 = await call(client, "corroborate_finding", {
        finding_id: finding.json.id,
        support: {
          source_id: broker.json.id,
          locator: { type: "timestamp", value: "call" },
          excerpt: "empty four months",
        },
      });
      assert.deepEqual([toL2.json.before, toL2.json.after], ["L3", "L2"]);
      const toL1 = await call(client, "corroborate_finding", {
        finding_id: finding.json.id,
        support: {
          source_id: county.json.id,
          locator: { type: "page", value: "2" },
          excerpt: "vacant",
        },
      });
      assert.deepEqual([toL1.json.before, toL1.json.after], ["L2", "L1"]);

      const detail = await call(client, "get_finding", { id: finding.json.id });
      assert.equal(detail.json.explanation.confidence, "L1");
      assert.equal(detail.json.explanation.distinct_origins.length, 3);
      assert.equal(detail.json.corroborations.length, 2);

      const unknown = await call(client, "open_unknown", {
        question: "Estoppels?",
        related_findings: [finding.json.id],
      });
      const narrowed = await call(client, "update_unknown", {
        unknown_id: unknown.json.id,
        status: "narrowed",
        note: "Requested.",
      });
      assert.deepEqual(
        [narrowed.json.status, narrowed.json.revisions],
        ["narrowed", 2],
      );

      const listed = await call(client, "list_findings", { confidence: "L1" });
      assert.equal(listed.json.total, 1);
      assert.equal(
        (await call(client, "list_findings", { confidence: "L3" })).json.total,
        0,
      );
      assert.equal((await call(client, "list_unknowns")).json.total, 1);
      assert.equal(
        (await call(client, "list_unknowns", { status: "resolved" })).json
          .total,
        0,
      );

      const report = await call(client, "render_report", {
        audience: "client",
        title: "T",
      });
      assert.match(report.text, /^# T\n/);
      assert.ok(report.text.includes("Unit 104 is vacant"));
      assert.ok(
        !report.text.includes("Someone"),
        "sensitive name never reaches a report",
      );

      statusBefore = (await call(client, "ledger_status")).json;
      digest = statusBefore.digest;
      assert.deepEqual(statusBefore.findings, { L1: 1, L2: 0, L3: 0 });
    } finally {
      await client.close();
    }

    const onDisk = JSON.parse(await readFile(path, "utf8"));
    const verified = Ledger.fromBundle(onDisk);
    assert.equal(verified.ok, true, "the saved file verifies");
    assert.equal(onDisk.digest, digest);

    client = await connect(path);
    try {
      const after = (await call(client, "ledger_status")).json;
      assert.equal(after.digest, digest);
      assert.deepEqual(after.findings, statusBefore.findings);
      assert.equal((await call(client, "list_findings")).json.total, 1);
    } finally {
      await client.close();
    }
  });

  it("refuses a write with a specific, actionable error", async () => {
    const client = await connect(join(dir, "errors.json"));
    try {
      const noSupport = await call(client, "record_finding", {
        statement: "x",
        basis: "observed",
      });
      assert.equal(noSupport.isError, true);
      assert.equal(noSupport.json.error.code, "missing_support");
      assert.equal(noSupport.json.error.path, "supports");

      const source = await call(client, "add_source", {
        alias: "S",
        origin: "County",
        medium: "document",
        sha256: hex("a"),
      });
      const partial = await call(client, "record_finding", {
        statement: "No liens",
        basis: "observed",
        kind: "absence",
        supports: [
          {
            source_id: source.json.id,
            locator: { type: "page", value: "1" },
            excerpt: "none",
          },
        ],
        coverage: { scope: "One page", complete: false },
      });
      assert.equal(partial.json.error.code, "absence_requires_coverage");
      assert.match(partial.json.error.message, /unknown, not established/);

      assert.equal(
        (await call(client, "get_finding", { id: `fnd_${hex("e")}` })).json
          .error.code,
        "not_found",
      );
      assert.equal(
        (await call(client, "get_finding", { id: "nonsense" })).isError,
        true,
        "malformed id",
      );
      assert.equal(
        (await call(client, "ledger_status")).json.findings.L3,
        0,
        "nothing was recorded",
      );
    } finally {
      await client.close();
    }
  });

  it("does not claim success when the save fails, and saves everything once it can", async () => {
    const blocked = join(dir, "blocked");
    const path = join(blocked, "ledger.json");
    const client = await connect(path);
    try {
      await writeFile(blocked, "a file where the directory must go");
      const failed = await call(client, "add_source", {
        alias: "A",
        origin: "Seller",
        medium: "document",
        sha256: hex("a"),
      });
      assert.equal(failed.isError, true);
      assert.match(
        failed.json.error.message,
        /Recorded in memory but not saved/,
      );

      await rm(blocked);
      const ok = await call(client, "add_source", {
        alias: "B",
        origin: "County",
        medium: "document",
        sha256: hex("b"),
      });
      assert.equal(ok.isError, false);
      const saved = Ledger.fromBundle(JSON.parse(await readFile(path, "utf8")));
      assert.equal(
        saved.ok && saved.value.sources().length,
        2,
        "the earlier write was saved too",
      );
    } finally {
      await client.close();
    }
  });
});

describe("server startup", () => {
  const start = (args: string[]) =>
    spawnSync(process.execPath, [...NODE_ARGS, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      input: "",
    });

  it("refuses to start over a corrupt ledger instead of starting empty", async () => {
    const path = join(dir, "corrupt.json");
    await writeFile(path, "{ not json");
    const r = start(["serve", "--ledger", path]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /INVALID/);
  });

  it("refuses to start over a tampered ledger and leaves the file untouched", async () => {
    const path = join(dir, "tampered.json");
    const ledger = new Ledger();
    ledger.addSource({
      alias: "A",
      origin: "Seller",
      medium: "document",
      sha256: hex("a"),
    });
    const bundle = ledger.toBundle();
    bundle.sources[0]!.origin = "Someone Else";
    const text = JSON.stringify(bundle);
    await writeFile(path, text);
    const r = start(["serve", "--ledger", path]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /integrity/);
    assert.equal(await readFile(path, "utf8"), text);
  });
});

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bundle } from "../src/model.ts";
import { scenario } from "./scenario.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const run = (args: string[]) =>
  spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", CLI, ...args],
    {
      encoding: "utf8",
      timeout: 30_000,
      input: "",
    },
  );

let dir = "";
let good = "";
let bundle!: Bundle;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "fl-cli-"));
  bundle = scenario().ledger.toBundle();
  good = join(dir, "good.json");
  await writeFile(good, JSON.stringify(bundle, null, 2));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("verify", () => {
  it("accepts a good bundle and reports its contents and digest", () => {
    const r = run(["verify", good]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /^OK {2}sources=4 findings=4 corroborations=0 unknowns=3 lint_warnings=1 digest=[0-9a-f]{64}\n$/,
    );
    assert.ok(r.stdout.includes(bundle.digest));
  });

  it("refuses an altered bundle with status 1 and names the record", async () => {
    const tampered = structuredClone(bundle);
    tampered.findings[0]!.statement = "ALPHA twenty units confirmed";
    const path = join(dir, "tampered.json");
    await writeFile(path, JSON.stringify(tampered));
    const r = run(["verify", path]);
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /^INVALID {2}integrity: Finding fnd_[0-9a-f]+ does not match/,
    );
    assert.equal(r.stdout, "");
  });

  it("refuses text that is not JSON, and a file that does not exist", async () => {
    const junk = join(dir, "junk.json");
    await writeFile(junk, "not json");
    assert.equal(run(["verify", junk]).status, 1);
    const missing = run(["verify", join(dir, "nope.json")]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Cannot read/);
  });
});

describe("status and report", () => {
  it("summarises grades and lists open unknowns", () => {
    const r = run(["status", good]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Findings: 1 at L1, 1 at L2, 2 at L3/);
    assert.match(r.stdout, /Open unknowns: 2 of 3/);
    assert.ok(r.stdout.includes("FOXTROT"));
  });

  it("writes the client report to stdout without any L3 content", () => {
    const r = run([
      "report",
      good,
      "--audience",
      "client",
      "--title",
      "Client view",
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^# Client view\n/);
    assert.ok(!r.stdout.includes("CHARLIE") && !r.stdout.includes("ECHO"));
  });

  it("writes to a file with --out and leaves stdout empty", async () => {
    const out = join(dir, "report.md");
    const r = run(["report", good, "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.ok((await readFile(out, "utf8")).includes("CHARLIE"));
  });

  it("will not render a report from a bundle that fails verification", async () => {
    const tampered = structuredClone(bundle);
    tampered.digest = "0".repeat(64);
    const path = join(dir, "bad-digest.json");
    await writeFile(path, JSON.stringify(tampered));
    const r = run(["report", path]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
  });
});

describe("usage errors", () => {
  it("exit 2 for an unknown command, a bad audience, a missing target or an unknown flag", () => {
    assert.equal(run(["frobnicate", good]).status, 2);
    assert.equal(run(["report", good, "--audience", "public"]).status, 2);
    assert.equal(run(["verify"]).status, 2);
    assert.equal(run(["verify", good, "--bogus"]).status, 2);
    assert.equal(run(["serve"]).status, 2);
  });

  it("prints usage for no arguments (status 2) and for --help (status 0)", () => {
    const none = run([]);
    assert.equal(none.status, 2);
    assert.match(none.stdout, /Usage:/);
    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /findings-ledger serve/);
  });
});

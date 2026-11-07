import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/report.ts";
import { doc, newLedger, observed, unwrap } from "./helpers.ts";
import { scenario } from "./scenario.ts";

const SENSITIVE = ["Pat Example", "Zoning Official Broward"];

describe("internal report", () => {
  const report = renderReport(scenario().ledger);

  it("shows every grade, including L3, with the record behind each finding", () => {
    for (const heading of ["### L1:", "### L2:", "### L3:"])
      assert.ok(report.includes(heading), heading);
    for (const marker of ["ALPHA", "BRAVO", "CHARLIE", "DELTA"])
      assert.ok(report.includes(marker), marker);
    assert.match(
      report,
      /Source: RentRoll \(Seller, document; page 1\): "relied-on text"/,
    );
  });

  it("puts what is not known before what is known", () => {
    assert.ok(
      report.indexOf("## Open unknowns") < report.indexOf("## Findings"),
    );
  });

  it("shows why a derived finding is only as strong as it is", () => {
    assert.match(report, /DELTA[\s\S]*Capped by its weakest input: "CHARLIE/);
  });

  it("flags L1/L2 findings with no 'so what'", () => {
    assert.match(report, /1 L1\/L2 finding needs a "so what"/);
  });

  it("closes resolved unknowns out in their own section", () => {
    assert.match(
      report,
      /## Resolved or closed unknowns[\s\S]*GOLF[\s\S]*Resolved by: "ALPHA/,
    );
  });

  it("is deterministic", () => {
    const { ledger } = scenario();
    assert.equal(renderReport(ledger), renderReport(ledger));
  });
});

describe("client report", () => {
  const { ledger } = scenario();
  const report = renderReport(ledger, { audience: "client" });

  it("withholds every L3 finding and says how many, without describing them", () => {
    assert.ok(report.includes("ALPHA") && report.includes("BRAVO"));
    assert.ok(!report.includes("CHARLIE"));
    assert.ok(!report.includes("DELTA"));
    assert.ok(!report.includes("### L3"));
    assert.match(report, /2 unconfirmed items withheld pending corroboration/);
  });

  it("withholds an unknown linked to a withheld finding, since its wording may restate it", () => {
    assert.ok(!report.includes("ECHO"));
    assert.match(
      report,
      /1 further unknown concerning unconfirmed findings withheld/,
    );
  });

  it("still shows unlinked unknowns, and resolved ones", () => {
    assert.ok(report.includes("FOXTROT"));
    assert.ok(report.includes("GOLF"));
  });

  it("lists only sources cited by findings it discloses", () => {
    assert.ok(
      !report.includes("LenderEmail"),
      "cited only by a withheld finding",
    );
    assert.ok(report.includes("RentRoll") && report.includes("TaxBill"));
    assert.ok(renderReport(ledger).includes("LenderEmail"));
  });

  it("does not suggest what the withheld findings were", () => {
    assert.ok(!/covenant|cash sweep/i.test(report));
  });
});

describe("sensitive sources", () => {
  const { ledger } = scenario();
  for (const audience of ["internal", "client"] as const) {
    it(`never print the name or origin in the ${audience} report, only the alias`, () => {
      const report = renderReport(ledger, { audience });
      for (const secret of SENSITIVE)
        assert.ok(!report.includes(secret), secret);
      assert.match(report, /Contact-7 \(origin withheld, verbal;/);
      assert.match(report, /\| Contact-7 \| \(withheld\) \| verbal \|/);
    });
  }

  it("keeps the name and origin in the bundle, where independence is decided", () => {
    const record = ledger.sources().find((s) => s.alias === "Contact-7");
    assert.equal(record?.name, "Pat Example");
    assert.equal(record?.origin, "Zoning Official Broward");
  });
});

describe("formatting", () => {
  it("escapes table separators in aliases", () => {
    const ledger = newLedger();
    const source = doc(ledger, "A|B", "Seller|Co");
    observed(ledger, "x", [source]);
    assert.ok(renderReport(ledger).includes("| A\\|B | Seller\\|Co |"));
  });

  it("joins limitations without doubled punctuation", () => {
    const report = renderReport(scenario().ledger);
    assert.ok(!report.includes(".;"));
    assert.match(report, /Limitations: Single email\./);
  });

  it("renders an empty ledger, and honours title and asOf", () => {
    const report = renderReport(newLedger(), {
      title: "Empty",
      asOf: "2026-11-07",
    });
    assert.match(report, /^# Empty\n/);
    assert.ok(report.includes("_As of 2026-11-07. Audience: internal._"));
    assert.ok(report.includes("_None open._"));
  });

  it("states the as-of time from the latest record when none is given", () => {
    const ledger = newLedger();
    unwrap(ledger.openUnknown({ question: "q" }));
    assert.match(renderReport(ledger), /As of 2026-11-07T09:00:00\.000Z/);
  });
});

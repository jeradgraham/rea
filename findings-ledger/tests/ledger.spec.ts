import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "../src/ledger.ts";
import {
  doc,
  hex,
  newLedger,
  observed,
  support,
  unwrap,
  verbal,
} from "./helpers.ts";

const expectFail = (
  result:
    | ReturnType<Ledger["addFinding"]>
    | ReturnType<Ledger["addSource"]>
    | ReturnType<Ledger["openUnknown"]>
    | ReturnType<Ledger["reviseUnknown"]>
    | ReturnType<Ledger["corroborate"]>,
  code: string,
  path?: string,
) => {
  assert.equal(result.ok, false, "expected the write to be refused");
  if (result.ok) return;
  assert.equal(result.error.code, code, result.error.message);
  if (path !== undefined) assert.equal(result.error.path, path);
};

describe("sources", () => {
  it("requires a hash for documents and forbids one for verbal sources", () => {
    const ledger = newLedger();
    expectFail(
      ledger.addSource({ alias: "A", origin: "Seller", medium: "document" }),
      "invalid_input",
      "sha256",
    );
    expectFail(
      ledger.addSource({
        alias: "B",
        origin: "Broker",
        medium: "verbal",
        sha256: hex("a"),
      }),
      "invalid_input",
      "sha256",
    );
  });

  it("is idempotent: recording the same source twice returns the same record", () => {
    const ledger = newLedger();
    const first = unwrap(
      ledger.addSource({
        alias: "RR",
        origin: "Seller",
        medium: "document",
        sha256: hex("a"),
      }),
    );
    const second = unwrap(
      ledger.addSource({
        alias: "RR",
        origin: "Seller",
        medium: "document",
        sha256: hex("a"),
      }),
    );
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.record.id, second.record.id);
    assert.equal(ledger.sources().length, 1);
  });

  it("gives the same source the same id in any ledger", () => {
    const a = doc(newLedger(), "RR", "Seller");
    const b = doc(newLedger(), "RR", "Seller");
    assert.equal(a.id, b.id);
  });

  it("does not silently overwrite a differing display name", () => {
    const ledger = newLedger();
    unwrap(
      ledger.addSource({
        alias: "RR",
        origin: "Seller",
        medium: "document",
        sha256: hex("a"),
        name: "one.csv",
      }),
    );
    expectFail(
      ledger.addSource({
        alias: "RR",
        origin: "Seller",
        medium: "document",
        sha256: hex("a"),
        name: "two.csv",
      }),
      "conflict",
    );
  });

  it("keeps aliases unique across different sources, ignoring case", () => {
    const ledger = newLedger();
    doc(ledger, "RentRoll", "Seller", "a");
    expectFail(
      ledger.addSource({
        alias: "rentroll",
        origin: "Seller",
        medium: "document",
        sha256: hex("b"),
      }),
      "conflict",
      "alias",
    );
  });
});

describe("finding rules", () => {
  it("refuses an observed finding with no support", () => {
    expectFail(
      newLedger().addFinding({ statement: "x", basis: "observed" }),
      "missing_support",
      "supports",
    );
  });

  it("refuses support that points at a source not in the ledger", () => {
    const ledger = newLedger();
    expectFail(
      ledger.addFinding({
        statement: "x",
        basis: "observed",
        supports: [support({ id: `src_${hex("f")}` })],
      }),
      "unknown_reference",
      "supports.0.source_id",
    );
  });

  it("keeps observed, derived and inferred distinct", () => {
    const ledger = newLedger();
    const s = doc(ledger, "RR", "Seller");
    const base = observed(ledger, "base", [s]);
    expectFail(
      ledger.addFinding({
        statement: "x",
        basis: "observed",
        supports: [support(s)],
        inputs: [base.id],
      }),
      "rule_violation",
      "inputs",
    );
    expectFail(
      ledger.addFinding({ statement: "x", basis: "derived", method: "m" }),
      "missing_support",
      "inputs",
    );
    expectFail(
      ledger.addFinding({
        statement: "x",
        basis: "derived",
        inputs: [base.id],
      }),
      "missing_support",
      "method",
    );
    expectFail(
      ledger.addFinding({
        statement: "x",
        basis: "derived",
        inputs: [base.id],
        method: "m",
        supports: [support(s)],
      }),
      "rule_violation",
      "supports",
    );
    expectFail(
      ledger.addFinding({ statement: "x", basis: "inferred" }),
      "missing_support",
      "rationale",
    );
  });

  it("refuses to treat a partial search as absence", () => {
    const ledger = newLedger();
    const s = doc(ledger, "Search", "County");
    const base = {
      statement: "No liens of record",
      basis: "observed",
      kind: "absence",
      supports: [support(s)],
    };
    expectFail(
      ledger.addFinding(base),
      "absence_requires_coverage",
      "coverage",
    );
    const partial = ledger.addFinding({
      ...base,
      coverage: { scope: "Grantor index 2015-2020", complete: false },
    });
    expectFail(partial, "absence_requires_coverage", "coverage.complete");
    if (!partial.ok)
      assert.match(partial.error.message, /unknown, not established/);
    const complete = unwrap(
      ledger.addFinding({
        ...base,
        coverage: { scope: "Grantor index 1990-2026", complete: true },
      }),
    );
    assert.equal(complete.record.kind, "absence");
  });

  it("allows absence only as an observation, and coverage only on absence", () => {
    const ledger = newLedger();
    const s = doc(ledger, "S", "County");
    expectFail(
      ledger.addFinding({
        statement: "x",
        basis: "inferred",
        rationale: "r",
        kind: "absence",
        coverage: { scope: "s", complete: true },
      }),
      "rule_violation",
      "basis",
    );
    expectFail(
      ledger.addFinding({
        statement: "x",
        basis: "observed",
        supports: [support(s)],
        coverage: { scope: "s", complete: true },
      }),
      "rule_violation",
      "coverage",
    );
  });

  it("rejects unrecognised fields instead of dropping them", () => {
    const ledger = newLedger();
    const s = doc(ledger, "S", "County");
    expectFail(
      ledger.addFinding({
        statement: "x",
        basis: "observed",
        supports: [support(s)],
        confidence: "L1",
      }),
      "invalid_input",
    );
  });

  it("is idempotent and independent of the order of supports", () => {
    const ledger = newLedger();
    const a = doc(ledger, "A", "Seller", "a");
    const b = doc(ledger, "B", "County", "b");
    const one = unwrap(
      ledger.addFinding({
        statement: "S",
        basis: "observed",
        supports: [support(a), support(b, "2")],
      }),
    );
    const two = unwrap(
      ledger.addFinding({
        statement: "S",
        basis: "observed",
        supports: [support(b, "2"), support(a), support(a)],
      }),
    );
    assert.equal(one.created, true);
    assert.equal(two.created, false);
    assert.equal(one.record.id, two.record.id);
    assert.equal(one.record.supports.length, 2);
  });

  it("gives different statements different ids", () => {
    const ledger = newLedger();
    const s = doc(ledger, "S", "Seller");
    assert.notEqual(
      observed(ledger, "one", [s]).id,
      observed(ledger, "two", [s]).id,
    );
  });
});

describe("confidence is computed from independent sources", () => {
  it("L3: a single source, however authoritative", () => {
    const ledger = newLedger();
    const f = observed(ledger, "x", [doc(ledger, "A", "County")]);
    assert.equal(ledger.confidenceOf(f.id), "L3");
  });

  it("L3: two sources with the same origin are not independent (case and spacing ignored)", () => {
    const ledger = newLedger();
    const a = doc(ledger, "A", "Seller", "a");
    const b = doc(ledger, "B", "  seller ", "b");
    assert.equal(ledger.confidenceOf(observed(ledger, "x", [a, b]).id), "L3");
  });

  it("L2: one documented source plus an independent verbal one", () => {
    const ledger = newLedger();
    const f = observed(ledger, "x", [
      doc(ledger, "A", "County"),
      verbal(ledger, "V", "Broker"),
    ]);
    assert.equal(ledger.confidenceOf(f.id), "L2");
  });

  it("L2: two independent verbal sources (the mosaic rule)", () => {
    const ledger = newLedger();
    const f = observed(ledger, "x", [
      verbal(ledger, "V1", "Broker"),
      verbal(ledger, "V2", "Tenant"),
    ]);
    assert.equal(ledger.confidenceOf(f.id), "L2");
  });

  it("L1: two independent documented sources", () => {
    const ledger = newLedger();
    const f = observed(ledger, "x", [
      doc(ledger, "A", "Seller", "a"),
      doc(ledger, "B", "County", "b"),
    ]);
    assert.equal(ledger.confidenceOf(f.id), "L1");
  });

  it("follows the upgrade path through corroboration and records the change", () => {
    const ledger = newLedger();
    const seller = doc(ledger, "RR", "Seller", "a");
    const broker = verbal(ledger, "Call", "Broker");
    const county = doc(ledger, "Tax", "County", "b");
    const f = observed(ledger, "Unit 104 is vacant", [seller]);
    assert.equal(ledger.confidenceOf(f.id), "L3");

    const toL2 = unwrap(
      ledger.corroborate({
        finding_id: f.id,
        support: support(broker, "call", "empty four months"),
      }),
    );
    assert.deepEqual(
      [toL2.before, toL2.after, toL2.created],
      ["L3", "L2", true],
    );

    const toL1 = unwrap(
      ledger.corroborate({
        finding_id: f.id,
        support: support(county, "7", "vacant"),
      }),
    );
    assert.deepEqual([toL1.before, toL1.after], ["L2", "L1"]);
    assert.equal(ledger.corroborationsFor(f.id).length, 2);
  });

  it("treats a repeated corroboration as a no-op", () => {
    const ledger = newLedger();
    const f = observed(ledger, "x", [doc(ledger, "A", "Seller", "a")]);
    const broker = verbal(ledger, "V", "Broker");
    const first = unwrap(
      ledger.corroborate({ finding_id: f.id, support: support(broker) }),
    );
    const again = unwrap(
      ledger.corroborate({ finding_id: f.id, support: support(broker) }),
    );
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(ledger.corroborationsFor(f.id).length, 1);
  });

  it("does not let a source corroborate a claim it does not independently add to", () => {
    const ledger = newLedger();
    const seller = doc(ledger, "A", "Seller", "a");
    const sellerCall = verbal(ledger, "SellerCall", "Seller");
    const f = observed(ledger, "x", [seller]);
    unwrap(
      ledger.corroborate({ finding_id: f.id, support: support(sellerCall) }),
    );
    assert.equal(ledger.confidenceOf(f.id), "L3");
  });

  it("refuses to corroborate a derived finding directly", () => {
    const ledger = newLedger();
    const base = observed(ledger, "base", [doc(ledger, "A", "Seller")]);
    const derived = unwrap(
      ledger.addFinding({
        statement: "d",
        basis: "derived",
        inputs: [base.id],
        method: "m",
      }),
    ).record;
    expectFail(
      ledger.corroborate({
        finding_id: derived.id,
        support: support(verbal(ledger, "V", "Broker")),
      }),
      "rule_violation",
      "finding_id",
    );
  });

  it("starts an uncorroborated inference at L3", () => {
    const ledger = newLedger();
    const f = unwrap(
      ledger.addFinding({
        statement: "likely",
        basis: "inferred",
        rationale: "because",
      }),
    ).record;
    assert.equal(ledger.confidenceOf(f.id), "L3");
  });

  it("caps a derived finding at its weakest premise and reports which input does it", () => {
    const ledger = newLedger();
    const strong = observed(ledger, "strong", [
      doc(ledger, "A", "Seller", "a"),
      doc(ledger, "B", "County", "b"),
    ]);
    const weak = observed(ledger, "weak", [doc(ledger, "C", "Lender", "c")]);
    const mixed = unwrap(
      ledger.addFinding({
        statement: "d",
        basis: "derived",
        inputs: [strong.id, weak.id],
        method: "m",
      }),
    ).record;
    const explained = ledger.explain(mixed.id);
    assert.equal(explained?.confidence, "L3");
    assert.deepEqual(explained?.weakest_inputs, [weak.id]);

    const onlyStrong = unwrap(
      ledger.addFinding({
        statement: "d2",
        basis: "derived",
        inputs: [strong.id],
        method: "m",
      }),
    ).record;
    assert.equal(ledger.confidenceOf(onlyStrong.id), "L1");
  });

  it("re-grades a derived finding when an input is corroborated, without rewriting it", () => {
    const ledger = newLedger();
    const weak = observed(ledger, "weak", [doc(ledger, "A", "Seller", "a")]);
    const derived = unwrap(
      ledger.addFinding({
        statement: "d",
        basis: "derived",
        inputs: [weak.id],
        method: "m",
      }),
    ).record;
    assert.equal(ledger.confidenceOf(derived.id), "L3");
    unwrap(
      ledger.corroborate({
        finding_id: weak.id,
        support: support(doc(ledger, "B", "County", "b")),
      }),
    );
    assert.equal(ledger.confidenceOf(derived.id), "L1");
    assert.equal(
      ledger.getFinding(derived.id),
      derived,
      "the record itself is unchanged",
    );
  });
});

describe("unknowns", () => {
  const open = (ledger: Ledger, extra: Record<string, unknown> = {}) =>
    unwrap(
      ledger.openUnknown({ question: "Is the roof permit closed?", ...extra }),
    ).record;

  it("opens with a first revision and is idempotent", () => {
    const ledger = newLedger();
    const first = open(ledger);
    const again = unwrap(
      ledger.openUnknown({ question: "Is the roof permit closed?" }),
    );
    assert.equal(again.created, false);
    assert.equal(again.record.id, first.id);
    assert.equal(first.revisions.length, 1);
    assert.equal(Ledger.statusOf(first), "open");
  });

  it("rejects a related finding that does not exist", () => {
    expectFail(
      newLedger().openUnknown({
        question: "q",
        related_findings: [`fnd_${hex("f")}`],
      }),
      "unknown_reference",
      "related_findings.0",
    );
  });

  it("keeps a complete, append-only revision history", () => {
    const ledger = newLedger();
    const finding = observed(ledger, "Permit closed 2020-03-02", [
      doc(ledger, "Permit", "City"),
    ]);
    const u = open(ledger);
    unwrap(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "narrowed",
        note: "City portal checked; 2019 permit only.",
      }),
    );
    unwrap(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "resolved",
        note: "Closed.",
        resolved_by: [finding.id],
      }),
    );
    const record = ledger.getUnknown(u.id);
    assert.deepEqual(
      record?.revisions.map((r) => [r.n, r.status]),
      [
        [1, "open"],
        [2, "narrowed"],
        [3, "resolved"],
      ],
    );
    assert.deepEqual(record?.revisions[2]?.resolved_by, [finding.id]);
  });

  it("will not mark an unknown resolved without the findings that resolve it", () => {
    const ledger = newLedger();
    const u = open(ledger);
    expectFail(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "resolved",
        note: "done",
      }),
      "missing_support",
      "resolved_by",
    );
    expectFail(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "resolved",
        note: "done",
        resolved_by: [`fnd_${hex("f")}`],
      }),
      "unknown_reference",
      "resolved_by.0",
    );
  });

  it("restricts transitions, allows reopening, and treats an identical revision as a no-op", () => {
    const ledger = newLedger();
    const u = open(ledger);
    expectFail(
      ledger.reviseUnknown({ unknown_id: u.id, status: "open", note: "again" }),
      "invalid_transition",
      "status",
    );
    unwrap(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "unresolvable",
        note: "Records destroyed in 2011 flood.",
      }),
    );
    expectFail(
      ledger.reviseUnknown({ unknown_id: u.id, status: "narrowed", note: "x" }),
      "invalid_transition",
      "status",
    );
    const repeat = unwrap(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "unresolvable",
        note: "Records destroyed in 2011 flood.",
      }),
    );
    assert.equal(repeat.created, false);
    unwrap(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "open",
        note: "Copy located at county archive.",
      }),
    );
    assert.equal(Ledger.statusOf(ledger.getUnknown(u.id)!), "open");
    assert.equal(ledger.getUnknown(u.id)?.revisions.length, 3);
  });

  it("reports resolved_by only where it applies, and unknown ids precisely", () => {
    const ledger = newLedger();
    const finding = observed(ledger, "f", [doc(ledger, "S", "Seller")]);
    const u = open(ledger);
    expectFail(
      ledger.reviseUnknown({
        unknown_id: u.id,
        status: "narrowed",
        note: "n",
        resolved_by: [finding.id],
      }),
      "rule_violation",
      "resolved_by",
    );
    expectFail(
      ledger.reviseUnknown({
        unknown_id: `unk_${hex("0")}`,
        status: "narrowed",
        note: "n",
      }),
      "not_found",
      "unknown_id",
    );
  });
});

describe("lint", () => {
  it('flags L1 and L2 findings that lack a "so what", and never L3', () => {
    const ledger = newLedger();
    const l1 = observed(ledger, "no so-what", [
      doc(ledger, "A", "Seller", "a"),
      doc(ledger, "B", "County", "b"),
    ]);
    observed(
      ledger,
      "has so-what",
      [doc(ledger, "C", "Lender", "c"), doc(ledger, "D", "Title", "d")],
      { so_what: "Underwrite on it." },
    );
    observed(ledger, "weak", [doc(ledger, "E", "Tenant", "e")]);
    const warnings = ledger.lint();
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.finding_id, l1.id);
  });
});

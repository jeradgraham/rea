import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "../src/ledger.ts";
import type { Bundle } from "../src/model.ts";
import {
  doc,
  hex,
  newLedger,
  observed,
  support,
  unwrap,
  verbal,
} from "./helpers.ts";

/** A ledger that exercises every record type. */
const populated = (): Ledger => {
  const ledger = newLedger();
  const seller = doc(ledger, "RentRoll", "Seller", "a");
  const county = doc(ledger, "TaxBill", "County", "b");
  const broker = verbal(ledger, "Call", "Broker");
  const units = observed(ledger, "Property has 12 units", [seller, county], {
    so_what: "Underwrite on 12 units.",
    data: { units: 12 },
  });
  const vacant = observed(ledger, "Unit 104 is vacant", [seller]);
  unwrap(
    ledger.corroborate({
      finding_id: vacant.id,
      support: support(broker, "call", "empty four months"),
    }),
  );
  unwrap(
    ledger.addFinding({
      statement: "Annual rent is 225780",
      basis: "derived",
      inputs: [units.id, vacant.id],
      method: "12 x monthly",
      data: { annual: 225780 },
    }),
  );
  unwrap(
    ledger.addFinding({
      statement: "No delinquent taxes",
      basis: "observed",
      kind: "absence",
      supports: [support(county, "1")],
      coverage: { scope: "2025 bill as issued", complete: true },
    }),
  );
  unwrap(
    ledger.addFinding({
      statement: "Seller anchors high",
      basis: "inferred",
      rationale: "Broker tone.",
      limitations: ["One conversation."],
    }),
  );
  const u = unwrap(
    ledger.openUnknown({
      question: "Estoppels?",
      searched: "Data room",
      related_findings: [vacant.id],
    }),
  ).record;
  unwrap(
    ledger.reviseUnknown({
      unknown_id: u.id,
      status: "narrowed",
      note: "Requested 10/31.",
    }),
  );
  return ledger;
};

const roundTrip = (bundle: Bundle): unknown =>
  JSON.parse(JSON.stringify(bundle));

const mutate = (fn: (b: Bundle) => void): unknown => {
  const copy = roundTrip(populated().toBundle()) as Bundle;
  fn(copy);
  return copy;
};

const refused = (input: unknown, code: string, pattern?: RegExp) => {
  const result = Ledger.fromBundle(input);
  assert.equal(result.ok, false, "expected the bundle to be refused");
  if (result.ok) return;
  assert.equal(result.error.code, code, result.error.message);
  if (pattern !== undefined) assert.match(result.error.message, pattern);
};

describe("bundle round trip", () => {
  it("restores an identical ledger from exported JSON", () => {
    const original = populated().toBundle();
    const restored = unwrap(Ledger.fromBundle(roundTrip(original)));
    assert.deepEqual(restored.toBundle(), original);
    assert.equal(restored.toBundle().digest, original.digest);
  });

  it("preserves computed confidence after a round trip", () => {
    const original = populated();
    const restored = unwrap(Ledger.fromBundle(roundTrip(original.toBundle())));
    for (const f of original.findings())
      assert.equal(
        restored.confidenceOf(f.id),
        original.confidenceOf(f.id),
        f.statement,
      );
  });

  it("round-trips an empty ledger", () => {
    const restored = unwrap(
      Ledger.fromBundle(roundTrip(newLedger().toBundle())),
    );
    assert.equal(restored.findings().length, 0);
  });
});

describe("bundle integrity", () => {
  it("rejects an edited statement that kept its old id", () => {
    refused(
      mutate((b) => {
        b.findings[0]!.statement = "Property has 14 units";
      }),
      "integrity",
      /Finding fnd_[0-9a-f]+ does not match/,
    );
  });

  it("rejects a forged id", () => {
    refused(
      mutate((b) => {
        b.findings[0]!.id = `fnd_${hex("0")}`;
      }),
      "integrity",
    );
  });

  it("rejects an edited source hash", () => {
    refused(
      mutate((b) => {
        b.sources[0]!.sha256 = hex("9");
      }),
      "integrity",
    );
  });

  it("rejects an edited timestamp through the bundle digest", () => {
    refused(
      mutate((b) => {
        b.findings[0]!.recorded_at = "2020-01-01T00:00:00.000Z";
      }),
      "integrity",
      /digest/,
    );
  });

  it("rejects an altered digest", () => {
    refused(
      mutate((b) => {
        b.digest = hex("0");
      }),
      "integrity",
      /digest/,
    );
  });

  it("rejects an altered unknown history", () => {
    refused(
      mutate((b) => {
        b.unknowns[0]!.revisions[1]!.note = "Rewritten.";
      }),
      "integrity",
    );
  });

  it("rejects a dangling source reference", () => {
    refused(
      mutate((b) => {
        b.sources.shift();
      }),
      "unknown_reference",
    );
  });

  it("rejects an input that appears after the finding derived from it", () => {
    refused(
      mutate((b) => {
        b.findings.reverse();
      }),
      "unknown_reference",
    );
  });

  it("rejects a duplicated record", () => {
    refused(
      mutate((b) => {
        b.sources.push(structuredClone(b.sources[0]!));
      }),
      "integrity",
      /more than once/,
    );
  });

  it("rejects supports that are not in canonical order", () => {
    refused(
      mutate((b) => {
        b.findings[0]!.supports.reverse();
      }),
      "integrity",
    );
  });

  it("rejects unrecognised fields and unknown formats instead of ignoring them", () => {
    refused(
      mutate((b) => {
        (b as unknown as Record<string, unknown>).extra = 1;
      }),
      "invalid_input",
    );
    refused(
      mutate((b) => {
        (b as unknown as Record<string, unknown>).format = "findings-ledger/2";
      }),
      "invalid_input",
    );
  });

  it("rejects input that is not a bundle at all", () => {
    refused(null, "invalid_input");
    refused("{}", "invalid_input");
  });
});

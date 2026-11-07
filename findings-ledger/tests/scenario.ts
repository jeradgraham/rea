import type { Ledger } from "../src/ledger.ts";
import { doc, newLedger, observed, unwrap } from "./helpers.ts";

/**
 * A ledger with every grade, a derived finding capped by a weak input, a
 * sensitive verbal source, a linked unknown, an unlinked unknown and a
 * resolved unknown. Statements are distinctive so tests can search for them.
 */
export const scenario = () => {
  const ledger: Ledger = newLedger();
  const seller = doc(ledger, "RentRoll", "Seller", "a");
  const county = doc(ledger, "TaxBill", "County", "b");
  const lender = doc(ledger, "LenderEmail", "Lender", "c");
  const informant = unwrap(
    ledger.addSource({
      alias: "Contact-7",
      origin: "Zoning Official Broward",
      medium: "verbal",
      received: "2026-10-30",
      name: "Pat Example",
      sensitive: true,
    }),
  ).record;

  const l1 = observed(
    ledger,
    "ALPHA twelve units confirmed",
    [seller, county],
    {
      so_what: "Underwrite on 12 units.",
    },
  );
  const l2 = observed(ledger, "BRAVO variance application filed", [
    county,
    informant,
  ]);
  const l3 = observed(
    ledger,
    "CHARLIE lender mentions covenant default",
    [lender],
    {
      limitations: ["Single email."],
    },
  );
  const weakDerived = unwrap(
    ledger.addFinding({
      statement: "DELTA default would trigger cash sweep",
      basis: "derived",
      inputs: [l3.id],
      method: "Read the loan agreement sweep clause against the default.",
    }),
  ).record;

  const linkedUnknown = unwrap(
    ledger.openUnknown({
      question: "ECHO is the covenant default real?",
      related_findings: [l3.id],
    }),
  ).record;
  const unlinkedUnknown = unwrap(
    ledger.openUnknown({ question: "FOXTROT are estoppels posted?" }),
  ).record;
  const resolvedUnknown = unwrap(
    ledger.openUnknown({ question: "GOLF is the permit closed?" }),
  ).record;
  unwrap(
    ledger.reviseUnknown({
      unknown_id: resolvedUnknown.id,
      status: "resolved",
      note: "Closed per city portal.",
      resolved_by: [l1.id],
    }),
  );

  return {
    ledger,
    seller,
    county,
    lender,
    informant,
    l1,
    l2,
    l3,
    weakDerived,
    linkedUnknown,
    unlinkedUnknown,
    resolvedUnknown,
  };
};

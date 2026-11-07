/**
 * Builds a ledger for a FICTIONAL property from the three fixture files beside
 * this script, then writes the bundle and both report audiences to ./output.
 * Everything in the ledger is computed from the fixture bytes: hashes, excerpts
 * and derived figures are read or calculated here, not typed in.
 *
 * Run: npm run demo
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ledger, renderReport, sha256Hex } from "../../src/index.ts";
import type { Result } from "../../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "output");

// Fixed clock so the committed output is reproducible byte for byte.
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 7, 9, tick++, 0)).toISOString();
const ledger = new Ledger({ now: clock });

const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`Fixture is missing ${what}.`);
  return value;
};
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

// ------------------------------------------------------------ fixtures ---

const rentRollBytes = readFileSync(join(here, "rent-roll.csv"));
const t12Bytes = readFileSync(join(here, "t12.csv"));
const countyBytes = readFileSync(join(here, "county-tax-bill.txt"));
const dataLines = (bytes: Uint8Array) =>
  Buffer.from(bytes)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));

const rentRows = dataLines(rentRollBytes)
  .slice(1)
  .map((line) => {
    const [unit, , , status, rent] = line.split(",");
    return {
      line,
      unit: must(unit, "unit"),
      status: must(status, "status"),
      rent: Number(rent),
    };
  });
const t12Line = (label: string) =>
  must(
    dataLines(t12Bytes).find((line) => line.startsWith(label)),
    label,
  );
const countyLine = (prefix: string) =>
  must(
    Buffer.from(countyBytes)
      .toString("utf8")
      .split("\n")
      .find((line) => line.startsWith(prefix)),
    prefix,
  );

const t12Taxes = Number(t12Line("Real estate taxes").split(",")[1]);
// Take the dollar amount only. Stripping every non-digit would keep the "2025".
const countyTaxes = Number(
  must(
    /\$([\d,]+)/.exec(countyLine("2025 tax bill:"))?.[1],
    "a dollar amount",
  ).replace(/,/g, ""),
);
// A statement's figure must appear in the excerpt it rests on.
assert.ok(t12Line("Real estate taxes").includes(String(t12Taxes)));
assert.ok(
  countyLine("2025 tax bill:").includes(countyTaxes.toLocaleString("en-US")),
);
assert.deepEqual([t12Taxes, countyTaxes], [48200, 52640]);

// ------------------------------------------------------------- sources ---

const rentRoll = unwrap(
  ledger.addSource({
    alias: "RentRoll-2026-10",
    origin: "Seller",
    medium: "document",
    sha256: sha256Hex(rentRollBytes),
    received: "2026-10-28",
    name: "rent-roll.csv",
  }),
).record;
const t12 = unwrap(
  ledger.addSource({
    alias: "T12-Seller",
    origin: "Seller",
    medium: "document",
    sha256: sha256Hex(t12Bytes),
    received: "2026-10-28",
    name: "t12.csv",
  }),
).record;
const county = unwrap(
  ledger.addSource({
    alias: "CountyTaxBill-2025",
    origin: "County Tax Collector",
    medium: "document",
    sha256: sha256Hex(countyBytes),
    received: "2026-10-30",
    name: "county-tax-bill.txt",
  }),
).record;
const broker = unwrap(
  ledger.addSource({
    alias: "BrokerCall-1031",
    origin: "Listing Broker",
    medium: "verbal",
    received: "2026-10-31",
    name: "Listing broker, phone call (fictional)",
    sensitive: true,
  }),
).record;

// ------------------------------------------------------------ findings ---

const allRows = rentRows.map((r) => r.line).join(" / ");
const unitsLine = countyLine("Units:");
for (const piece of [...rentRows.map((r) => r.line), unitsLine])
  assert.ok(piece.length > 0);
assert.equal(rentRows.length, 12);

// Two independent documents agree: L1.
const units = unwrap(
  ledger.addFinding({
    statement: "The property has 12 residential units.",
    basis: "observed",
    supports: [
      {
        source_id: rentRoll.id,
        locator: { type: "row", value: "1-12" },
        excerpt: `${must(rentRows[0], "first row").line} … ${must(rentRows.at(-1), "last row").line}`,
      },
      {
        source_id: county.id,
        locator: { type: "section", value: "Property" },
        excerpt: unitsLine,
      },
    ],
    so_what:
      "The unit count is settled by two independent records. Underwrite on 12 units.",
    data: { units: 12 },
  }),
).record;

// One seller document only: L3 until corroborated.
const rents = unwrap(
  ledger.addFinding({
    statement:
      "The rent roll schedules a monthly rent for each of the 12 units.",
    basis: "observed",
    supports: [
      {
        source_id: rentRoll.id,
        locator: { type: "row", value: "1-12" },
        excerpt: allRows,
      },
    ],
    limitations: ["Seller-prepared. No leases or estoppels reviewed."],
    data: { rents: Object.fromEntries(rentRows.map((r) => [r.unit, r.rent])) },
  }),
).record;

// Upgrade path: seller document (L3) -> plus an independent verbal source (L2).
const vacantRow = must(
  rentRows.find((r) => r.status === "vacant"),
  "a vacant unit",
);
const vacancy = unwrap(
  ledger.addFinding({
    statement: `The rent roll shows unit ${vacantRow.unit} as vacant.`,
    basis: "observed",
    supports: [
      {
        source_id: rentRoll.id,
        locator: { type: "row", value: vacantRow.unit },
        excerpt: vacantRow.line,
      },
    ],
    so_what: `One unit (${vacantRow.unit}) is in lease-up. Ask the seller for its leasing history and asking-rent support.`,
  }),
).record;
const beforeCorroboration = ledger.confidenceOf(vacancy.id);
const corroboration = unwrap(
  ledger.corroborate({
    finding_id: vacancy.id,
    support: {
      source_id: broker.id,
      locator: { type: "timestamp", value: "call of 2026-10-31" },
      excerpt: `Broker said unit ${vacantRow.unit} has sat empty for about four months.`,
    },
  }),
);

// Two different documents, two different numbers: both recorded, neither favoured.
const taxesT12 = unwrap(
  ledger.addFinding({
    statement: `The seller's T-12 reports real estate taxes of ${usd(t12Taxes)}.`,
    basis: "observed",
    supports: [
      {
        source_id: t12.id,
        locator: { type: "row", value: "Real estate taxes" },
        excerpt: t12Line("Real estate taxes"),
      },
    ],
    data: { annual_taxes: t12Taxes },
  }),
).record;
const taxesCounty = unwrap(
  ledger.addFinding({
    statement: `The county's 2025 tax bill is ${usd(countyTaxes)}.`,
    basis: "observed",
    supports: [
      {
        source_id: county.id,
        locator: { type: "section", value: "Bill" },
        excerpt: countyLine("2025 tax bill:"),
      },
    ],
    data: { annual_taxes: countyTaxes },
  }),
).record;

// An absence claim is allowed only with a complete, stated search scope.
const incompleteAbsence = ledger.addFinding({
  statement: "There are no recorded liens on the property.",
  basis: "observed",
  kind: "absence",
  supports: [
    {
      source_id: county.id,
      locator: { type: "section", value: "Bill" },
      excerpt: countyLine("Delinquent installments:"),
    },
  ],
  coverage: {
    scope: "County tax bill only; no title or lien search",
    complete: false,
  },
});
assert.equal(incompleteAbsence.ok, false);
const delinquency = unwrap(
  ledger.addFinding({
    statement: "The county's 2025 bill shows no delinquent installments.",
    basis: "observed",
    kind: "absence",
    supports: [
      {
        source_id: county.id,
        locator: { type: "section", value: "Bill" },
        excerpt: countyLine("Delinquent installments:"),
      },
    ],
    coverage: {
      scope: "Tax year 2025 bill for parcel 000-FICT-0001, as issued",
      complete: true,
    },
  }),
).record;

// Derived findings: reproducible from their inputs, graded by the weakest one.
const variance = countyTaxes - t12Taxes;
const variancePct = Math.round((variance / t12Taxes) * 10000) / 100;
const taxVariance = unwrap(
  ledger.addFinding({
    statement: `The county bill exceeds the seller's T-12 taxes by ${usd(variance)} (${variancePct}%).`,
    basis: "derived",
    inputs: [taxesT12.id, taxesCounty.id],
    method:
      "County 2025 bill minus T-12 real estate taxes; percentage of the T-12 figure.",
    data: { variance, percent_of_t12: variancePct },
  }),
).record;

const monthly = rentRows.reduce((sum, r) => sum + r.rent, 0);
const annualGpr = monthly * 12;
const gpr = unwrap(
  ledger.addFinding({
    statement: `Annual gross potential rent is ${usd(annualGpr)}.`,
    basis: "derived",
    inputs: [rents.id],
    method:
      "Sum of the 12 scheduled monthly rents times 12; the vacant unit counts at its asking rent.",
    data: { monthly_total: monthly, annual: annualGpr },
  }),
).record;
// Anyone can repeat the derivation from the input finding's own data.
const inputRents = Object.values(
  must(rents.data, "rents data").rents as Record<string, number>,
);
assert.equal(
  inputRents.reduce((a, b) => a + b, 0) * 12,
  (gpr.data as { annual: number }).annual,
);

const inference = unwrap(
  ledger.addFinding({
    statement: `The seller's T-12 may understate real estate taxes by about ${usd(variance)} a year.`,
    basis: "inferred",
    rationale:
      "The T-12 figure is below the county's 2025 bill. If the county figure governs going forward, expenses are understated and NOI is overstated by the same amount.",
    inputs: [taxesT12.id, taxesCounty.id],
    limitations: [
      "No reassessment history reviewed.",
      "The T-12 may reflect a prior-year bill.",
    ],
  }),
).record;

// ------------------------------------------------------------ unknowns ---

unwrap(
  ledger.openUnknown({
    question: `Why does the seller's T-12 show ${usd(t12Taxes)} in taxes when the county bill is ${usd(countyTaxes)}?`,
    why_it_matters:
      "Taxes feed NOI directly. A reassessment or a prior-year figure changes the valuation.",
    searched: "The T-12 and the 2025 county bill only.",
    would_resolve:
      "Tax-collector payment history and any pending reassessment notice.",
    related_findings: [taxesT12.id, taxesCounty.id, taxVariance.id],
  }),
);
unwrap(
  ledger.openUnknown({
    question: "Do tenant estoppels or leases confirm the rent roll?",
    why_it_matters:
      "Every rent figure comes from the seller alone, so rents and occupancy stay at L3.",
    searched:
      "Data room index as of 2026-11-07: no estoppels or leases posted.",
    would_resolve: `Signed estoppels or leases for the ${rentRows.filter((r) => r.status === "occupied").length} occupied units.`,
    related_findings: [rents.id],
  }),
);
const lossRuns = unwrap(
  ledger.openUnknown({
    question: "What do the insurance loss runs show?",
    would_resolve: "Five years of carrier loss runs.",
  }),
).record;
unwrap(
  ledger.reviseUnknown({
    unknown_id: lossRuns.id,
    status: "narrowed",
    note: "Requested 2026-10-31. Seller says they will be posted next week.",
  }),
);

// -------------------------------------------------------------- output ---

mkdirSync(outDir, { recursive: true });
const bundle = ledger.toBundle();
writeFileSync(
  join(outDir, "demo-ledger.json"),
  `${JSON.stringify(bundle, null, 2)}\n`,
);
const title = "Harborview Flats (FICTIONAL SAMPLE): diligence findings";
writeFileSync(
  join(outDir, "demo-report-internal.md"),
  renderReport(ledger, { title }),
);
writeFileSync(
  join(outDir, "demo-report-client.md"),
  renderReport(ledger, { title, audience: "client" }),
);

// The file we just wrote must verify and reproduce every grade.
const restored = unwrap(
  Ledger.fromBundle(
    JSON.parse(readFileSync(join(outDir, "demo-ledger.json"), "utf8")),
  ),
);
for (const f of ledger.findings())
  assert.equal(restored.confidenceOf(f.id), ledger.confidenceOf(f.id));

const grade = (id: string) => ledger.confidenceOf(id);
console.log("Fictional diligence demo");
console.log(`  units (two independent documents)        ${grade(units.id)}`);
console.log(
  `  vacancy before / after broker call        ${beforeCorroboration} -> ${corroboration.after}`,
);
console.log(
  `  rents, GPR (seller document only)         ${grade(rents.id)}, ${grade(gpr.id)}`,
);
console.log(
  `  tax variance (weakest input caps it)      ${grade(taxVariance.id)}`,
);
console.log(
  `  inference                                 ${grade(inference.id)}`,
);
console.log(
  `  absence, complete scope                   ${grade(delinquency.id)}`,
);
if (!incompleteAbsence.ok)
  console.log(
    `  partial-search absence refused: ${incompleteAbsence.error.code}`,
  );
console.log(`  lint warnings: ${ledger.lint().length}`);
console.log(`  digest: ${bundle.digest}`);
console.log(`  wrote ${outDir}`);

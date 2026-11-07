# Harborview Flats (FICTIONAL SAMPLE): diligence findings

_As of 2026-11-07T09:18:00.000Z. Audience: client._

## Summary

- Findings: 1 at L1, 1 at L2. 7 unconfirmed items withheld pending corroboration.
- Basis of the findings shown: 2 observed, 0 derived, 0 inferred.
- Open unknowns: 1. Resolved or closed: 0.
- 2 further unknowns concerning unconfirmed findings withheld.

## Open unknowns

1. **What do the insurance loss runs show?** _(narrowed)_ `unk_4238d6201f28`
   - Would resolve it: Five years of carrier loss runs.
   - Latest (revision 2): Requested 2026-10-31. Seller says they will be posted next week.

## Findings

### L1: two independent documented sources. Act on it.

- **The property has 12 residential units.** _(observed · L1)_ `fnd_84f5e58849ed`
  - Source: RentRoll-2026-10 (Seller, document; row 1-12): "101,1BR,720,occupied,1450,2027-03-31 … 206,studio,520,occupied,1210,2027-04-30"
  - Source: CountyTaxBill-2025 (County Tax Collector, document; section Property): "Units: 12"
  - So what? The unit count is settled by two independent records. Underwrite on 12 units.

### L2: two independent sources, not both documented. Pursue with verification.

- **The rent roll shows unit 104 as vacant.** _(observed · L2)_ `fnd_164725926917`
  - Source: RentRoll-2026-10 (Seller, document; row 104): "104,2BR,980,vacant,1900,"
  - Corroborated by: BrokerCall-1031 (origin withheld, verbal; timestamp call of 2026-10-31): "Broker said unit 104 has sat empty for about four months."
  - So what? One unit (104) is in lease-up. Ask the seller for its leasing history and asking-rent support.

## Sources

| Alias | Origin | Medium | Received | SHA-256 (first 16) | Name |
| --- | --- | --- | --- | --- | --- |
| RentRoll-2026-10 | Seller | document | 2026-10-28 | df943b3acf0237ae | rent-roll.csv |
| CountyTaxBill-2025 | County Tax Collector | document | 2026-10-30 | bf2448c44f0c1080 | county-tax-bill.txt |
| BrokerCall-1031 | (withheld) | verbal | 2026-10-31 |  |  |

---

_Grades are computed from the recorded sources, not asserted. Two sources are independent only if their origins differ. A derived finding is no stronger than its weakest input. Identifiers are abbreviated content digests; the complete records are in the exported bundle._

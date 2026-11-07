# Harborview Flats (FICTIONAL SAMPLE): diligence findings

_As of 2026-11-07T09:18:00.000Z. Audience: internal._

## Summary

- Findings: 1 at L1, 1 at L2, 7 at L3.
- Basis of the findings shown: 6 observed, 2 derived, 1 inferred.
- Open unknowns: 3. Resolved or closed: 0.

## Open unknowns

1. **Why does the seller's T-12 show $48,200 in taxes when the county bill is $52,640?** _(open)_ `unk_7880f49e406a`
   - Why it matters: Taxes feed NOI directly. A reassessment or a prior-year figure changes the valuation.
   - Already searched: The T-12 and the 2025 county bill only.
   - Would resolve it: Tax-collector payment history and any pending reassessment notice.
   - Related: "The seller's T-12 reports real estate taxes of $48,200." (fnd_18a9d1851c60); "The county's 2025 tax bill is $52,640." (fnd_5db329fae5ea); "The county bill exceeds the seller's T-12 taxes by $4,440 (9.21%)." (fnd_613e185c89d2)
2. **Do tenant estoppels or leases confirm the rent roll?** _(open)_ `unk_330038402f2e`
   - Why it matters: Every rent figure comes from the seller alone, so rents and occupancy stay at L3.
   - Already searched: Data room index as of 2026-11-07: no estoppels or leases posted.
   - Would resolve it: Signed estoppels or leases for the 11 occupied units.
   - Related: "The rent roll schedules a monthly rent for each of the 12 units." (fnd_21f7e90f4043)
3. **What do the insurance loss runs show?** _(narrowed)_ `unk_4238d6201f28`
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

### L3: unconfirmed. Log only; do not act until upgraded.

- **The rent roll schedules a monthly rent for each of the 12 units.** _(observed · L3)_ `fnd_21f7e90f4043`
  - Source: RentRoll-2026-10 (Seller, document; row 1-12): "101,1BR,720,occupied,1450,2027-03-31 / 102,1BR,720,occupied,1475,2026-12-31 / 103,2BR,980,occupied,1850,2027-06-30 / 104,2BR,980,vacant,1900, / 105,1BR,720,occupied,1450,2027-01-31 / 106,studio,510,occupied,1190,2026-11-30 / 201,1BR,735,occupied,1500,2027-08-31 / 202,1BR,735,occupied,1500,2027-02-28 / 203,2BR,990,occupied,1895,2027-05-31 / 204,2BR,990,occupied,1895,2026-12-31 / 205,1BR,735,occupied,1500,2027-09-30 / 206,studio,520,occupied,1210,2027-04-30"
  - Limitations: Seller-prepared. No leases or estoppels reviewed.
- **The seller's T-12 reports real estate taxes of $48,200.** _(observed · L3)_ `fnd_18a9d1851c60`
  - Source: T12-Seller (Seller, document; row Real estate taxes): "Real estate taxes,48200"
- **The county's 2025 tax bill is $52,640.** _(observed · L3)_ `fnd_5db329fae5ea`
  - Source: CountyTaxBill-2025 (County Tax Collector, document; section Bill): "2025 tax bill: $52,640"
- **The county's 2025 bill shows no delinquent installments.** _(observed, absence · L3)_ `fnd_38324a5ff397`
  - Source: CountyTaxBill-2025 (County Tax Collector, document; section Bill): "Delinquent installments: none"
  - Searched: Tax year 2025 bill for parcel 000-FICT-0001, as issued (complete)
- **The county bill exceeds the seller's T-12 taxes by $4,440 (9.21%).** _(derived · L3)_ `fnd_613e185c89d2`
  - Computed from: "The seller's T-12 reports real estate taxes of $48,200." (fnd_18a9d1851c60); "The county's 2025 tax bill is $52,640." (fnd_5db329fae5ea)
  - Method: County 2025 bill minus T-12 real estate taxes; percentage of the T-12 figure.
  - Capped by its weakest input: "The seller's T-12 reports real estate taxes of $48,200." (fnd_18a9d1851c60); "The county's 2025 tax bill is $52,640." (fnd_5db329fae5ea)
- **Annual gross potential rent is $225,780.** _(derived · L3)_ `fnd_32f7de66565b`
  - Computed from: "The rent roll schedules a monthly rent for each of the 12 units." (fnd_21f7e90f4043)
  - Method: Sum of the 12 scheduled monthly rents times 12; the vacant unit counts at its asking rent.
  - Capped by its weakest input: "The rent roll schedules a monthly rent for each of the 12 units." (fnd_21f7e90f4043)
- **The seller's T-12 may understate real estate taxes by about $4,440 a year.** _(inferred · L3)_ `fnd_5c47dd594821`
  - Why believed: The T-12 figure is below the county's 2025 bill. If the county figure governs going forward, expenses are understated and NOI is overstated by the same amount.
  - Relies on: "The seller's T-12 reports real estate taxes of $48,200." (fnd_18a9d1851c60); "The county's 2025 tax bill is $52,640." (fnd_5db329fae5ea)
  - Limitations: No reassessment history reviewed; The T-12 may reflect a prior-year bill.

## Sources

| Alias | Origin | Medium | Received | SHA-256 (first 16) | Name |
| --- | --- | --- | --- | --- | --- |
| RentRoll-2026-10 | Seller | document | 2026-10-28 | df943b3acf0237ae | rent-roll.csv |
| T12-Seller | Seller | document | 2026-10-28 | 3c43766fa4ccf3f7 | t12.csv |
| CountyTaxBill-2025 | County Tax Collector | document | 2026-10-30 | bf2448c44f0c1080 | county-tax-bill.txt |
| BrokerCall-1031 | (withheld) | verbal | 2026-10-31 |  |  |

---

_Grades are computed from the recorded sources, not asserted. Two sources are independent only if their origins differ. A derived finding is no stronger than its weakest input. Identifiers are abbreviated content digests; the complete records are in the exported bundle._

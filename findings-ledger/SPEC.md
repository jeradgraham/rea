# Findings Ledger Standard, v1

Working name. This document is the standard; the code in this directory is one
implementation. Each rule is enforced by the code and pinned by a test.

## 1. Purpose

A finding is only as useful as a reader's ability to tell three things apart:

1. **How it was obtained.** Read from a source, computed, or judged.
2. **How well it is corroborated.** One origin, or several independent ones.
3. **What is not known.** A gap must never be mistaken for a clean result.

The standard keeps those apart, computes the second instead of trusting it, and
makes the third a first-class record.

## 2. Definitions

| Term            | Meaning                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**      | A document or a verbal communication that a finding relies on.                                                                            |
| **Origin**      | Who produced the source (seller, county recorder, lender, listing broker).                                                                |
| **Independent** | Two sources are independent only if their origins differ. Origins are compared after trimming, collapsing spaces and ignoring case.       |
| **Documented**  | A source of medium `document`: a retrievable record, tied to the SHA-256 of the exact file reviewed. A `verbal` source is not documented. |
| **Basis**       | How a finding was obtained: `observed`, `derived` or `inferred`.                                                                          |
| **Confidence**  | `L1`, `L2` or `L3`. Computed, never supplied.                                                                                             |
| **Unknown**     | A recorded gap, with what was already searched and what would resolve it.                                                                 |
| **Ledger**      | The set of sources, findings, corroborations and unknowns, exportable as one bundle.                                                      |

## 3. Rules

### R1. Sources

- R1.1 A document source MUST carry the SHA-256 of the exact file reviewed.
- R1.2 A verbal source MUST NOT carry a hash.
- R1.3 Every source MUST have an alias, unique within the ledger (case-insensitive). Reports identify sources by alias.
- R1.4 A source's `name` and `sensitive` flag are display fields. They are not part of its identity, and re-recording a source with different display fields MUST be refused rather than overwrite.

### R2. Findings and basis

- R2.1 **Observed.** MUST cite at least one source with a locator and an excerpt copied from it. MUST NOT carry inputs, method or rationale.
- R2.2 **Derived.** MUST list the findings it is computed from and state the method. MUST NOT cite sources directly; its support comes from its inputs.
- R2.3 **Inferred.** MUST state the rationale. MAY cite sources or rely on other findings.
- R2.4 A finding MUST cite only sources already in the ledger, and derive only from findings already in the ledger.
- R2.5 Unrecognised fields MUST be rejected, not dropped.

### R3. Absence

- R3.1 A claim that something was searched for and not found (`kind: absence`) MUST be an observed finding.
- R3.2 It MUST state its search scope and that the scope was searched completely.
- R3.3 A partial search MUST NOT be recorded as absence. Record an unknown instead.

### R4. Confidence

- R4.1 **L1:** two independent origins, each supplying a documented source.
- R4.2 **L2:** two independent origins, not both documented.
- R4.3 **L3:** one origin or none. This includes any single source, however authoritative, and any inference no source corroborates.
- R4.4 A **derived** finding takes the weakest confidence among its inputs.
- R4.5 Confidence MUST be computed from the recorded sources each time it is read. It is never stored on a finding, so it cannot go stale or be asserted.
- R4.6 A new independent source raises confidence by **corroboration**: an appended record that leaves the original finding untouched. A derived finding is corroborated through its inputs, not directly.
- R4.7 L1 and L2 findings SHOULD carry a "so what": what it means, who it affects and the next action. The ledger reports those that do not.

### R5. Identity and immutability

- R5.1 Every record has an identifier of the form `<prefix>_<SHA-256 of its canonical identity content>`.
- R5.2 Canonical form is JSON with sorted keys and no insignificant whitespace.
- R5.3 Identity covers everything the analyst stated. It excludes timestamps and source display fields.
- R5.4 Recording identical content again is a no-op that returns the existing record.
- R5.5 Records are never edited. A revised claim is a new record.
- R5.6 `supports` and `inputs` are sets: duplicates are removed and order does not affect identity.

### R6. Unknowns

- R6.1 An unknown has a question and MAY state why it matters, what was searched and what would resolve it.
- R6.2 Its status is `open`, `narrowed`, `resolved` or `unresolvable`, and it changes only by appending a revision with a note. History is never overwritten.
- R6.3 `resolved` MUST name the findings that settle it.
- R6.4 Permitted transitions: from `open` to `narrowed`, `resolved` or `unresolvable`; from `narrowed` to any status; from `resolved` or `unresolvable` back to `open` only.

### R7. Bundles and integrity

- R7.1 A bundle is the complete ledger plus a digest over its contents.
- R7.2 Import MUST replay every record through the same rules as a live write and require each rebuilt record to equal the stored one exactly. Altered content, forged identifiers, dangling references, duplicates and non-canonical ordering are rejected.
- R7.3 The digest detects accidental change. It is **not a signature**: someone able to rewrite the whole file consistently can defeat it. Use signing or storage controls where tampering is a concern.
- R7.4 A tool that cannot verify a ledger MUST refuse it, never start from an empty one.

### R8. Reporting and disclosure

- R8.1 A report MUST put open unknowns before findings.
- R8.2 A **client** report MUST withhold every L3 finding and every source cited only by one. It states how many items were withheld, never what they were.
- R8.3 A client report MUST withhold any unknown linked to a withheld finding. The ledger cannot inspect an unknown's wording, and such wording often restates the finding.
- R8.4 A source marked `sensitive` is shown by alias only. Its name and origin never appear in a report. They remain in the bundle, where independence is decided.

## 4. Interpretive choices to confirm

These were decided by the implementer. Each is a policy question, not a technical
one, and each is easy to change.

| #   | Choice                                                                                                                                                                                                                                                                                             | Why it matters                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| IC1 | **L2 reconciles two statements in the J3 framework.** Its grading table defines L2 as "one strong source plus corroboration", while its mosaic section says "two weak signals from independent sources can upgrade to L2". R4.2 implements both: any two independent origins, not both documented. | If only the table was meant, two independent verbal sources should stay L3.                                        |
| IC2 | **A single authoritative document is L3** (R4.3). A county tax bill alone grades the same as a rumor, because the framework counts independent origins, not source quality.                                                                                                                        | In diligence this may be too strict. An `authoritative` flag on sources is the obvious extension.                  |
| IC3 | **Independence is a string comparison of origins.** `County` and `County Tax Collector` count as independent; `Seller` and `seller ` do not.                                                                                                                                                       | Origin names need a consistent vocabulary, or independence is over- or under-counted.                              |
| IC4 | **Unknowns are withheld from clients by link, not by content** (R8.3).                                                                                                                                                                                                                             | Safe by default, but a client-appropriate unknown linked to an L3 finding is hidden. Leave it unlinked to show it. |
| IC5 | **An inference is L3 until a source corroborates it** (R4.3), matching the framework's "single source, rumor, or inference".                                                                                                                                                                       | An inference resting on L1 inputs is still L3 and still "log only".                                                |

## 5. Provenance of this standard

| Element                                                                                                                                                                                               | Origin                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Observed / derived / inferred tagging                                                                                                                                                                 | Adapted from the REA project (see ATTRIBUTION.md)                      |
| Unknowns as first-class records with revision history                                                                                                                                                 | Adapted from REA                                                       |
| "Missing coverage is unknown, not absence" (R3)                                                                                                                                                       | Adapted from REA                                                       |
| Content-addressed immutable records, canonical form, import-time verification (R5, R7)                                                                                                                | Adapted from REA                                                       |
| L1/L2/L3 grading, independence, upgrade path, "so what", source aliases, "never present L3 to a client"                                                                                               | The J3 intel confidence framework (your `brokerage-prospecting` skill) |
| Grade **computed** from sources instead of asserted (R4.5); weakest-premise rule for derived findings (R4.4); client withholding of linked unknowns (R8.3); sensitive-source masking of origin (R8.4) | New in this project                                                    |

## 6. Not yet covered

- **Conflicting sources.** Two sources can state different values. Today both are recorded as separate findings and an unknown links them (see the demo). A first-class conflict record is the most valuable next addition.
- **Superseding a finding** when a document is updated. Today the old finding remains and the new one sits beside it.
- **Staleness.** Findings do not age. A rent roll from last quarter grades the same as today's.
- **Excerpt verification.** The ledger stores the excerpt; it does not re-read the source to confirm the words appear.
- **Signatures and multi-user concurrency.** One process owns one ledger file.

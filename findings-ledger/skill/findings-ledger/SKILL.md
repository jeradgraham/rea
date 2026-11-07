---
name: findings-ledger
description: Record diligence, underwriting or prospecting findings with source, basis and computed L1/L2/L3 confidence, and track what is not yet known. Use when a claim will be relied on or shown to someone, when sources may conflict or be incomplete, or when asked for an open-items list or a client-safe report. Skip for casual questions that need no audit trail.
---

# Findings ledger

Use the `findings-ledger` MCP tools to keep a durable, graded record of what is
established, how, and what is still open. The ledger computes the grade. Never
state a grade yourself; report the one the tool returns.

## Check the tools exist first

If no `add_source` / `record_finding` tools are available, say so and stop. Do
not simulate a ledger in prose. Setup is in the project README (register the
server with absolute paths, then restart the client).

## The model: two separate questions

| Question                                      | Values                      | Who decides                |
| --------------------------------------------- | --------------------------- | -------------------------- |
| How was it obtained? (**basis**)              | observed, derived, inferred | You, under the rules below |
| How well is it corroborated? (**confidence**) | L1, L2, L3                  | The ledger                 |

- **L1** two independent documented sources. Act on it.
- **L2** two independent sources, not both documented. Pursue with verification.
- **L3** one origin or none. Log only. Do not act or present it until upgraded.

Two sources are independent only if their **origins** differ. A seller's rent
roll and a call with the seller are one origin. Use one consistent name per
origin (always `County Tax Collector`, never `County` in one place and the full
name in another), or independence is miscounted.

## Workflow

1. **Source first.** `add_source` for each document (with the SHA-256 of the exact file reviewed) or conversation (`verbal`). Use a short alias. Mark a person's identity `sensitive: true`.
2. **Record each claim.** `record_finding`:
   - **observed**: cite `supports` with source, locator and an excerpt copied from the source. Never paraphrase the excerpt.
   - **derived**: give `inputs` and the `method`. Put the figures in `data`. The result is capped at its weakest input.
   - **inferred**: give the `rationale`. It stays L3 until a source corroborates it.
3. **Write the "so what".** For anything L1 or L2: what it means, who it affects, the next action.
4. **Upgrade by corroboration.** When a new independent source confirms an existing claim, call `corroborate_finding`. Do not re-record the claim. To strengthen a derived finding, corroborate its inputs.
5. **Record gaps as unknowns.** `open_unknown` with what was searched and what would resolve it. Close with `update_unknown`; `resolved` needs the findings that settle it.
6. **Report.** `render_report`. Use `audience: "client"` for anything leaving the team.

## Rules you must follow

- **Never write "none found" or "no issues" without coverage.** A negative claim needs `kind: "absence"` with a stated scope that was searched completely. A partial search is an unknown, not a finding. The tool will refuse otherwise; do not work around the refusal by rewording.
- **Never present L3 to a client.** The client report withholds it. Do not restate L3 content in your own message to a client, and do not put L3 facts in the wording of an unknown you want a client to see. Unknowns linked to an L3 finding are withheld from client reports.
- **Conflicting sources are not resolved by choosing one.** Record each as its own finding, derive the difference if useful, and open an unknown naming what would settle it. Say which source you would trust only as an `inferred` finding with a rationale.
- **Do not edit history.** Records are immutable. A revised claim is a new finding.
- **Copy figures from the source.** Wrong numbers are the commonest failure. Before recording a derived figure, check it against its inputs' `data`.

## Reading errors

Errors name a code and a field path. Act on the code:

| Code                         | Meaning                                      | Do                                                                    |
| ---------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `invalid_input`              | A field is malformed or not recognised       | Fix the field named in the path; do not add fields the tool lacks     |
| `not_found`                  | No finding or unknown has that id            | Find the id with `list_findings` or `list_unknowns`                   |
| `missing_support`            | Basis requires support you did not give      | Add supports, inputs, method or rationale, or choose the honest basis |
| `absence_requires_coverage`  | Negative claim without a complete search     | Open an unknown instead                                               |
| `unknown_reference`          | Cited source or finding is not in the ledger | `add_source` or find the right id with `list_findings`                |
| `rule_violation`             | Wrong field for this basis                   | Read the message; usually derived vs observed                         |
| `conflict`                   | Alias or display fields clash                | Choose a distinct alias                                               |
| `invalid_transition`         | Unknown status change not allowed            | Read the allowed next statuses in the message                         |
| `integrity` with "not saved" | Recorded in memory, disk write failed        | Tell the user; the next successful write saves it                     |

## Keep outputs small

`list_findings` and `list_unknowns` return ids and one line each. Call
`get_finding` only for the findings you will discuss. Use `ledger_status` for
counts, not a full listing.

## Relationship to the J3 intel framework

L1/L2/L3 here is the J3 grading, made computable. The "so what" requirement and
source aliases carry over. For prospecting intel, keep using the
`brokerage-prospecting` workflow for sourcing and outreach; use the ledger to
hold the graded record.

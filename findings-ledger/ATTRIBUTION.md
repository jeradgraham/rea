# Attribution

## Concepts adapted from REA

The design here adapts ideas from **REA (Reverse Engineer Anything)**, an
open-source reverse-engineering tool: <https://github.com/morluto/rea>,
copyright (c) 2026 morluto, MIT License.

What was adapted, as ideas and vocabulary:

- Findings tagged by how they were obtained: observed, derived, inferred.
- Unknowns as first-class records with a complete revision history.
- Missing coverage is unknown, not absence.
- Immutable records identified by a digest of canonical content, with identity kept separate from display fields.
- Verification on import by replaying records through the same rules as a live write.
- Fail-closed behavior when ownership, scope or integrity cannot be established.
- Return the smallest sufficient answer, with provenance.

## No REA source code is included

No file from REA was copied into this directory. The code was written
independently against the concepts above. Ideas, methods and vocabulary are not
themselves covered by copyright, and the MIT License does not require a notice
for work that does not copy REA's source.

**If REA source files are copied into this project later,** the MIT License
requires that REA's copyright notice and permission notice (the text of REA's
`LICENSE` file) accompany those files. Add that notice at the time of copying.

This project does not use the REA name and is not affiliated with or endorsed by
its authors.

## Concepts from your own framework

The L1/L2/L3 grading, the independence test, the upgrade path, the "so what"
requirement, source aliases and the rule that L3 intel is never presented to a
client come from the J3 intel confidence framework in the `brokerage-prospecting`
skill. Decisions about how those rules were made computable are listed in
`SPEC.md`, section 4.

## Dependencies

Declared licenses, checked at install time (v0.1.0):

| Package                   | Version | License    |
| ------------------------- | ------- | ---------- |
| zod                       | 4.6.7   | MIT        |
| @modelcontextprotocol/sdk | 1.32.2  | MIT        |
| typescript (build only)   | 5.9.3   | Apache-2.0 |
| @types/node (build only)  | 22.20.5 | MIT        |

The production dependency tree is about 93 packages, all declared MIT, ISC or
BSD. Preserve their notices if you redistribute a bundled build.

## This project's own license

None has been chosen. That is an owner decision, so no `LICENSE` file is
included. Until one is added, treat the code as all rights reserved.

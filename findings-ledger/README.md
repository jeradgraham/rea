# Findings Ledger

_Working name. Rename freely; the name appears in `package.json`, the server
identity (`src/mcp.ts`), the CLI, and the skill._

Graded, sourced findings and first-class unknowns for diligence work, usable
from the command line, as a library, or as an MCP server for an AI agent.

It exists to make one discipline enforceable: **every claim says how it was
obtained and how well it is corroborated, and a gap is never mistaken for a
clean result.**

## The idea in one table

Two questions about any claim are different, and are kept apart.

| Axis           | Question                     | Values                      | Who sets it              |
| -------------- | ---------------------------- | --------------------------- | ------------------------ |
| **Basis**      | How was it obtained?         | observed, derived, inferred | The analyst, under rules |
| **Confidence** | How well is it corroborated? | L1, L2, L3                  | **The ledger, computed** |

- **L1** two independent documented sources. **L2** two independent sources, not both documented. **L3** one origin or none.
- Two sources are independent only if their **origins** differ. A seller's rent roll and a seller's phone call are one origin.
- A **derived** finding is no stronger than its weakest input.
- "None found" is accepted only with a complete, stated search scope. Otherwise you record an **unknown**.

The full standard is in [SPEC.md](SPEC.md), including five judgment calls that
need your confirmation (section 4).

## See it work

```bash
npm install
npm test          # 89 tests
npm run demo      # builds a ledger for a FICTIONAL property
```

The demo reads three fixture files and writes, to `examples/diligence-demo/output/`:

- `demo-ledger.json`, the verified bundle
- `demo-report-internal.md`, everything, unknowns first
- `demo-report-client.md`, with every L3 finding withheld

The scenario is deliberately realistic: the seller's T-12 shows $48,200 in taxes
and the county bill shows $52,640. Both are recorded, neither is favored, a
derived finding states the gap, and an unknown records what would settle it.

## Command line

```bash
npm run build
node dist/cli.js verify bundle.json                       # integrity and references
node dist/cli.js status bundle.json                       # counts and open unknowns
node dist/cli.js report bundle.json --audience client --title "Harborview"
node dist/cli.js serve --ledger ledger.json               # MCP server on stdio
```

Exit status: 0 success, 1 invalid or unreadable ledger, 2 usage error.
`verify` and `report` refuse any bundle that fails verification.

## Use it from an AI agent

1. Build, then register the server with the **absolute** paths on your machine:

   ```bash
   claude mcp add findings-ledger -- node /ABS/PATH/findings-ledger/dist/cli.js serve --ledger /ABS/PATH/deal-ledger.json
   ```

2. Copy `skill/findings-ledger/` into your skills folder so the agent knows the
   rules and when to use the tools.

The server exposes ten tools: `add_source`, `record_finding`,
`corroborate_finding`, `open_unknown`, `update_unknown`, `get_finding`,
`list_findings`, `list_unknowns`, `render_report`, `ledger_status`. Every write
is saved to the ledger file before the tool reports success. The server refuses
to start over a corrupt or altered ledger rather than start empty.

It has not been registered in a Claude environment or tested through a live
Claude client. It was tested through the MCP protocol with the official SDK
client; see "What was verified".

## Use it as a library

```ts
import { Ledger, renderReport } from "findings-ledger";

const ledger = new Ledger();
const rentRoll = ledger.addSource({
  alias: "RentRoll",
  origin: "Seller",
  medium: "document",
  sha256,
});
// Every write returns { ok, value } or { ok: false, error: { code, message, path } }.
```

## Layout

| Path                                       | Contents                                                |
| ------------------------------------------ | ------------------------------------------------------- |
| `SPEC.md`                                  | The standard, its judgment calls, what is not covered   |
| `src/ledger.ts`                            | The rules and the grade computation                     |
| `src/model.ts`                             | Schemas for inputs, records and bundles                 |
| `src/report.ts`                            | Internal and client reports                             |
| `src/mcp.ts`, `src/cli.ts`, `src/store.ts` | Server, command line, atomic persistence                |
| `skill/findings-ledger/`                   | The agent skill                                         |
| `examples/diligence-demo/`                 | Fictional fixtures and the script that builds the demo  |
| `tests/`                                   | 89 tests: rules, bundles, reports, CLI, live MCP server |
| `ATTRIBUTION.md`                           | What was adapted from where, and what is not copied     |

## What was verified

Run in this environment (Node 22.23.4):

- Typecheck clean; 89 tests pass; the compiled build verifies the demo ledger to the same digest as the source, and its MCP server answers a real protocol handshake.
- Tests were mutation-checked: deliberately breaking the L1 rule, the import equality check, the absence rule, and three report-privacy rules each made tests fail.
- Reading the first demo output exposed a figure-parsing bug in the demo and two disclosure leaks in the client report. All three were fixed and now have tests.

Not verified:

- Use through a live Claude client or any agent. The skill has not been exercised by an agent.
- Windows or macOS; only Linux was run.
- Large ledgers. Reads rebuild grades on demand and the whole ledger is held in memory; nothing was measured.
- The root repository's own CI gate. This directory is self-contained, but its checks were not run against the parent project's lint, format and architecture rules.

## Moving it to its own repository

This directory is self-contained (own `package.json`, lockfile and configs).
To lift it out: copy the folder, or run `git subtree split --prefix=findings-ledger`.
It was placed here only because this session could reach one repository.

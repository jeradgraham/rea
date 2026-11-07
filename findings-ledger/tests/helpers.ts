import { Ledger } from "../src/ledger.ts";
import type { Result } from "../src/ledger.ts";

/** Deterministic clock: one second per call from 2026-11-07T09:00:00Z. */
export const fakeClock = (): (() => string) => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 10, 7, 9, 0, tick++)).toISOString();
};

export const newLedger = (): Ledger => new Ledger({ now: fakeClock() });

export const hex = (char: string): string => char.repeat(64);

export const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

export const doc = (
  ledger: Ledger,
  alias: string,
  origin: string,
  digestChar = "a",
) =>
  unwrap(
    ledger.addSource({
      alias,
      origin,
      medium: "document",
      sha256: hex(digestChar),
    }),
  ).record;

export const verbal = (ledger: Ledger, alias: string, origin: string) =>
  unwrap(
    ledger.addSource({
      alias,
      origin,
      medium: "verbal",
      received: "2026-10-31",
    }),
  ).record;

export const support = (
  source: { readonly id: string },
  value = "1",
  excerpt = "relied-on text",
) => ({
  source_id: source.id,
  locator: { type: "page" as const, value },
  excerpt,
});

export const observed = (
  ledger: Ledger,
  statement: string,
  sources: readonly { readonly id: string }[],
  extra: Record<string, unknown> = {},
) =>
  unwrap(
    ledger.addFinding({
      statement,
      basis: "observed",
      supports: sources.map((s, i) => support(s, String(i + 1))),
      ...extra,
    }),
  ).record;

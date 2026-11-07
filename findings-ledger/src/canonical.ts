import { createHash } from "node:crypto";

/** JSON values the ledger can store and digest. */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

/**
 * Deterministic JSON text: object keys sorted by UTF-16 code unit, no
 * insignificant whitespace, array order preserved. For the value space the
 * ledger admits (finite numbers, strings, no undefined) this is the same text
 * RFC 8785 specifies, so identical content always yields identical bytes.
 * Object members whose value is `undefined` are treated as absent.
 */
export const canonicalJson = (value: Json): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new RangeError("A non-finite number cannot be canonicalized.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${(value as readonly Json[]).map(canonicalJson).join(",")}]`;
  const record = value as { readonly [key: string]: Json | undefined };
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as Json)}`,
    );
  return `{${members.join(",")}}`;
};

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/**
 * Content-addressed identifier: `<prefix>_<sha256 of canonical content>`.
 * Callers pass only the fields that define identity; display fields and
 * timestamps stay out so the same content is always the same record.
 */
export const contentId = (prefix: string, identity: Json): string =>
  `${prefix}_${sha256Hex(canonicalJson(identity))}`;

/** Abbreviated identifier for human-facing output. Never use for lookup. */
export const shortId = (id: string, length = 12): string => {
  const cut = id.indexOf("_");
  return cut === -1 ? id.slice(0, length) : id.slice(0, cut + 1 + length);
};

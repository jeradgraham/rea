import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  contentId,
  sha256Hex,
  shortId,
} from "../src/canonical.ts";

describe("canonicalJson", () => {
  it("is independent of object key order, at every depth", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }),
      canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
  });

  it("preserves array order, because order is meaningful there", () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  it("emits no insignificant whitespace and sorts keys by code unit", () => {
    assert.equal(canonicalJson({ b: 1, B: 2, a: 3 }), '{"B":2,"a":3,"b":1}');
  });

  it("treats undefined members as absent", () => {
    const withUndefined = { a: 1, b: undefined } as unknown as Parameters<
      typeof canonicalJson
    >[0];
    assert.equal(canonicalJson(withUndefined), '{"a":1}');
  });

  it("refuses non-finite numbers rather than hashing a lossy value", () => {
    assert.throws(() => canonicalJson(Number.NaN), RangeError);
    assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), RangeError);
  });

  it("matches a known SHA-256 vector", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("contentId", () => {
  it("gives the same id to the same content and a different id to different content", () => {
    assert.equal(
      contentId("fnd", { a: 1, b: 2 }),
      contentId("fnd", { b: 2, a: 1 }),
    );
    assert.notEqual(contentId("fnd", { a: 1 }), contentId("fnd", { a: 2 }));
  });

  it("namespaces ids by prefix so a source cannot collide with a finding", () => {
    assert.notEqual(contentId("src", { a: 1 }), contentId("fnd", { a: 1 }));
    assert.match(contentId("fnd", { a: 1 }), /^fnd_[0-9a-f]{64}$/);
  });

  it("abbreviates for display without losing the prefix", () => {
    assert.equal(shortId(`fnd_${"ab".repeat(32)}`), "fnd_abababababab");
  });
});

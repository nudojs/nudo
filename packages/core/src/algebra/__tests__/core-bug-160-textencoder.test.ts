/**
 * BUG-160：`TextEncoder` 在 PROTOTYPED_BRAND_NAMES 里登记但两张成员表只有
 * `TextDecoder` ⇒ 成员读折 exact undefined（`e.encoding === undefined` 判 true）。
 * 修复：`new TextEncoder()` 建模 encoding/encode/encodeInto。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `
export function encIsUndef() {
  const e = new TextEncoder();
  return e.encoding === undefined;
}
export function encodeIsUndef() {
  const e = new TextEncoder();
  return e.encode === undefined;
}
export function encodeIntoIsUndef() {
  const e = new TextEncoder();
  return e.encodeInto === undefined;
}
export function decEncoding() {
  const d = new TextDecoder();
  return d.encoding;
}
`;

describe("BUG-160 TextEncoder member surface", () => {
  it("encoding / encode / encodeInto are present", () => {
    const r = checkSource("/t/bug-160.js", SRC, pTrue);
    expect(sigOf(r, "encIsUndef")).toBe("false");
    expect(sigOf(r, "encodeIsUndef")).toBe("false");
    expect(sigOf(r, "encodeIntoIsUndef")).toBe("false");
  });

  it("TextDecoder encoding still resolves", () => {
    const r = checkSource("/t/bug-160.js", SRC, pTrue);
    expect(sigOf(r, "decEncoding")).toBe('"utf-8"');
  });
});

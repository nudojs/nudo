/**
 * BUG-217：`o[k]`（字面量常量键）对 obj / brand 接收者不查成员表 ⇒ getter
 * 返回 unknown。修复：`$idx` 对字面量键委派 `$get`。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const SRC = `
export function f() {
  const k = "n";
  const o = { get n() { return 42; } };
  return o[k];
}
`;

const CONST_KEY = `
export function f() {
  const o = { n: 42 };
  return o["n"];
}
`;

describe("BUG-217 computed literal key member access", () => {
  it("getter through a computed variable key resolves", () => {
    expect(val(SRC)).toEqual({ ok: true, value: 42 });
  });

  it("plain literal key resolves", () => {
    expect(val(CONST_KEY)).toEqual({ ok: true, value: 42 });
  });
});

/**
 * BUG-216：`g.m?.()`（可选调用）对同一 getter 读两次 ⇒ 第二次读到不同值，
 * 推断结果错位。修复：`$invoke`/`$invokeKey` 接受预读值，可选链只读一次。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const SRC = `
export function f() {
  let i = 0;
  const g = {
    get m() {
      i++;
      return i === 1 ? () => 1 : () => "two";
    },
  };
  return g.m?.();
}
`;

describe("BUG-216 optional call reads the getter once", () => {
  it("returns the first getter value (1), not the second (two)", () => {
    expect(val(SRC)).toEqual({ ok: true, value: 1 });
  });
});

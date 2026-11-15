/**
 * BUG-242：`indexOf(x, fromIndex)` 越界（fromIndex >= length）时应返回 -1
 * （`lastIndexOf` 则按规范从末尾夹取）。修复：fromIndex 夹取。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const INDEX_OF = `
export function f() {
  const a = [1, 2, 3];
  return a.indexOf(3, 5);
}
`;

const LAST_INDEX_OF = `
export function f() {
  const a = [1, 2, 3];
  return a.lastIndexOf(3, 5);
}
`;

describe("BUG-242 indexOf / lastIndexOf fromIndex clamping", () => {
  it("indexOf past the end returns -1", () => {
    expect(val(INDEX_OF)).toEqual({ ok: true, value: -1 });
  });

  it("lastIndexOf past the end searches from the end", () => {
    expect(val(LAST_INDEX_OF)).toEqual({ ok: true, value: 2 });
  });
});

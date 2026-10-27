/**
 * BUG-215：`{[Symbol.iterator]: 5}`（不可调用的迭代器槽）以前被当成
 * 可迭代 ⇒ `for..of` 静默得到空循环 / 错误结果。修复：迭代器槽存在但
 * 不可调用 ⇒ 定抛 TypeError。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf, l2Count } from "./nudo-constraints.ts";

const SRC = `
export function consume() {
  const o = { [Symbol.iterator]: 5 };
  let total = 0;
  for (const x of o) total += x;
  return total;
}
export function consumeNull() {
  const o = { [Symbol.iterator]: null };
  let total = 0;
  for (const x of o) total += x;
  return total;
}
export function okIt() {
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return i++ < 2 ? { value: i, done: false } : { value: undefined, done: true }; } }; } };
  let total = 0;
  for (const x of o) total += x;
  return total;
}
`;

describe("BUG-215 non-callable iterator slot", () => {
  it("throws TypeError instead of silently iterating nothing", () => {
    const r = checkSource("/t/bug-215.js", SRC, pTrue);
    expect(sigOf(r, "consume")).toBe("never throws TypeError");
    expect(sigOf(r, "consumeNull")).toBe("never throws TypeError");
    expect(l2Count(r, "consume")).toBe(1);
    expect(l2Count(r, "consumeNull")).toBe(1);
  });

  it("valid user iterators keep working", () => {
    const r = checkSource("/t/bug-215.js", SRC, pTrue);
    expect(sigOf(r, "okIt")).toBe("3");
    expect(l2Count(r, "okIt")).toBe(0);
  });
});

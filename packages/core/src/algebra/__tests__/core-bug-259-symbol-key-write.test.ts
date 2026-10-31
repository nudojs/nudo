/**
 * BUG-259：`$setKey` 对 symbol 键直接走字符串键写面 ⇒ 运行时 symbol 键读写
 * 不一致（写入丢失 / 读到 undefined）。修复：symbol 槽键经 symbolSlotKeyOf
 * 映射到 `@@…` 槽。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

const READ = `
export function f() {
  const s = Symbol("k");
  const o = { [s]: 1 };
  return o[s];
}
`;

const OWN_SYMBOLS = `
export function f() {
  const s = Symbol("k");
  const o = { [s]: 1 };
  return Object.getOwnPropertySymbols(o).length;
}
`;

const WRITE_THEN_READ = `
export function f() {
  const s = Symbol("k");
  const o = {};
  o[s] = 7;
  return o[s];
}
`;

describe("BUG-259 symbol-keyed writes", () => {
  it("literal symbol key reads back", () => {
    expect(val(READ)).toEqual({ ok: true, value: 1 });
  });

  it("computed symbol assignment reads back", () => {
    expect(val(WRITE_THEN_READ)).toEqual({ ok: true, value: 7 });
  });

  it("own symbol keys are counted", () => {
    expect(val(OWN_SYMBOLS)).toEqual({ ok: true, value: 1 });
  });
});

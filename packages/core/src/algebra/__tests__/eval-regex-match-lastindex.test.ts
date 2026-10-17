/**
 * Bug 94 回归：`String.prototype.match/matchAll` 忽略模式 RegExp brand 的
 * lastIndex。stringRegexMethod 用 brand source/flags 重建宿主 RegExp，但
 * 从不复制 brand 的 lastIndex 槽——非全局 match ≡ RegExpExec（sticky 从
 * lastIndex 起）、matchAll 迭代起点同源，二者都从 0 起步。修复：
 * reReal.lastIndex = toLength(brand lastIndex)；matchAll 另按 spec 克隆
 * （flags 去 y，ToLength(lastIndex) 起点）。
 *
 * node 实测 ground truth（见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

function expectVal(body: string, expected: unknown) {
  const rec = call(`export function f() {\n${body}\n}`);
  expect(rec.throws?.shape?.k ?? "never", `throws face for: ${body}`).toBe("never");
  expect(litValue(rec.result), `value for: ${body}`).toEqual({ ok: true, value: expected });
}

describe("match/matchAll honor pattern brand lastIndex (Bug 94)", () => {
  it("非全局 sticky match 从 lastIndex 起（命中）", () => {
    // node: const r = /b/y; r.lastIndex = 1; "ab".match(r)[0] → "b"
    expectVal(`const r = /b/y; r.lastIndex = 1; return "ab".match(r)[0];`, "b");
  });

  it("非全局 sticky match 从 lastIndex 起（长度）", () => {
    expectVal(`const r = /b/y; r.lastIndex = 1; return "ab".match(r).length;`, 1);
  });

  it("非全局 sticky match 未中 → null", () => {
    // node: /c/y @1 对 "ab" → null
    expectVal(`const r = /c/y; r.lastIndex = 1; return "ab".match(r) === null;`, true);
  });

  it("matchAll 迭代从 lastIndex 起（/a/g @1 → 2 项）", () => {
    // node: 2
    expectVal(`const r = /a/g; r.lastIndex = 1; return [..."aaa".matchAll(r)].length;`, 2);
  });

  it("matchAll 带走 test 推进后的 lastIndex（@1 → 2 项）", () => {
    // node: const r = /a/g; r.test("a") 置 1，matchAll 从 1 → 2
    expectVal(`const r = /a/g; r.test("a"); return [..."aaa".matchAll(r)].length;`, 2);
  });

  it("sticky+global matchAll 克隆去 y、ToLength 起点（/b/gy @1 → 1 项）", () => {
    // node: 1（去 y 后非锚定，从 1 起 "b" 命中 1 次）
    expectVal(`const r = /b/gy; r.lastIndex = 1; return [..."ab".matchAll(r)].length;`, 1);
  });

  // controls：全局 match 宿主先重置 lastIndex，起点不生效
  it("control：全局 match 从 0（/b/g @1 仍命中）", () => {
    expectVal(`const r = /b/g; r.lastIndex = 1; return "ab".match(r)[0];`, "b");
  });

  it("control：无 stale lastIndex 的 matchAll 基线", () => {
    expectVal(`const r = /a/g; return [..."aaa".matchAll(r)].length;`, 3);
  });
});

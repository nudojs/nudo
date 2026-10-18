/**
 * Bug 96 回归：语句位 `"s".match/replace/replaceAll(r)` 不重置参数位 RegExp
 * 的 lastIndex。值通道 stringRegexMethod 在实参 regex 的副本上执行，spec
 * @@match/@replace 对**原正则** Set lastIndex（全局 → 0）从未反映回绑定。
 * 修复：emit 语句位写回 pass 对 StringLiteral 接收者 + Identifier 实参发射
 * `r = $reStateCall(r, "<method>", [subj])`——全局 → lastIndex 0；非全局
 * sticky 的 match ≡ 单次 RegExpExec 推进；其余不动（search 恢复原值 /
 * split 不动 / matchAll 克隆不动原件）。
 *
 * 原生阵营注意：sticky 非全局 replace V8 推进 lastIndex、JSC 保原值——
 * 引擎以 JSC 差分门禁口径为准（不动），见用例注释。
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

describe("statement-position string regex methods reset argument lastIndex (Bug 96)", () => {
  it("全局 replace 重置参数 lastIndex → 0", () => {
    // node: const r = /a/g; r.test("a") → 1；"aaa".replace(r,"b") 全局 → 0
    expectVal(`const r = /a/g; r.test("a"); "aaa".replace(r, "b"); return r.lastIndex;`, 0);
  });

  it("全局 match 重置参数 lastIndex → 0", () => {
    expectVal(`const r = /a/g; r.test("a"); "aaa".match(r); return r.lastIndex;`, 0);
  });

  it("全局 replaceAll 重置参数 lastIndex → 0", () => {
    expectVal(`const r = /a/g; r.test("a"); "aaa".replaceAll(r, "b"); return r.lastIndex;`, 0);
  });

  it("非全局 sticky match 单次 exec 推进（命中 → 末端）", () => {
    // node: /b/y @1 命中 "ab" → 2
    expectVal(`const r = /b/y; r.lastIndex = 1; "ab".match(r); return r.lastIndex;`, 2);
  });

  it("非全局 sticky match 单次 exec 推进（未中 → 0）", () => {
    // node: /c/y @1 对 "ab" → 0
    expectVal(`const r = /c/y; r.lastIndex = 1; "ab".match(r); return r.lastIndex;`, 0);
  });

  it("非全局 sticky replace：JSC 差分口径保原值（V8 推进——阵营分裂）", () => {
    // node (V8): 2；JSC: 1。引擎锚定 JSC 差分门禁 → 1
    expectVal(`const r = /b/y; r.lastIndex = 1; "ab".replace(r, "x"); return r.lastIndex;`, 1);
  });

  it("非全局非 sticky replace 不动 lastIndex", () => {
    // node: /b/ @1 → 1（replace 不触碰）
    expectVal(`const r = /b/; r.lastIndex = 1; "ab".replace(r, "x"); return r.lastIndex;`, 1);
  });

  it("search 恢复原值（置 0 执行后 Set 回原值）", () => {
    // node: /a/g @1 → search 后仍 1
    expectVal(`const r = /a/g; r.lastIndex = 1; "aa".search(r); return r.lastIndex;`, 1);
  });

  // control：值通道结果不受写回影响
  it("control：replace 返回值仍正确", () => {
    expectVal(`const r = /a/g; r.test("a"); return "aaa".replace(r, "b");`, "bbb");
  });
});

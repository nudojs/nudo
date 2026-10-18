/**
 * Bug 111 回归：`delete o?.a` 的成员真删。emitArrMutatorRebinds 的 delete
 * 臂原本只匹配 MemberExpression——OptionalMemberExpression 的表达式值
 * （$delRes）对但从未写回容器，`"a" in o` 之后仍真。修复：optional 链按
 * 普通 member 层取路径，写回经 nullish 守卫 fork——守卫真（链短路）保根
 * 原值，假（链走通）从 $removeNullish 收窄后的守卫基删键写回。
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

describe("delete optional member actually deletes (Bug 111)", () => {
  it("delete o?.a 真删（dot 形）", () => {
    // node: const o = { a: 1 }; delete o?.a; "a" in o → false
    expectVal(`const o = { a: 1 }; delete o?.a; return "a" in o;`, false);
  });

  it("delete o?.[\"a\"] 真删（computed 形）", () => {
    expectVal(`const o = { a: 1 }; delete o?.["a"]; return "a" in o;`, false);
  });

  it("delete o?.a.b 真删（optional 在内层，守卫基 = o）", () => {
    // node: false
    expectVal(`const o = { a: { b: 1 } }; delete o?.a.b; return "b" in o.a;`, false);
  });

  it("delete o.a?.b 真删（optional 在外层，守卫基 = o.a）", () => {
    // node: false
    expectVal(`const o = { a: { b: 1 } }; delete o.a?.b; return "b" in o.a;`, false);
  });

  it("守卫短路：o.a 非空链，外层属性保留", () => {
    // node: delete o.a?.b 不动 o.a → 1
    expectVal(`const o = { a: 1 }; delete o.a?.b; return o.a;`, 1);
  });

  it("守卫短路：undefined 根不抛（原生 delete o?.a.b 恒 true）", () => {
    // node: const o = undefined; delete o?.a.b → true
    expectVal(`const o = undefined; return delete o?.a.b;`, true);
  });

  it("表达式值通道不受写回影响（delete 返回 true）", () => {
    expectVal(`const o = { a: 1 }; const d = delete o?.a; return d;`, true);
  });

  // control：普通 delete 形态不回归
  it("control：delete o.a 仍真删", () => {
    expectVal(`const o = { a: 1 }; delete o.a; return "a" in o;`, false);
  });
});

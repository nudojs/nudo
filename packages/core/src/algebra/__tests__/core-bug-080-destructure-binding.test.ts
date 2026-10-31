/**
 * BUG-080 残留（core 转译层）：**解构声明**的子名此前不进**顶层绑定表**
 * （`$recordBinding` 通道）⇒ 该名字在别处被当作实参时解析不出类型 ⇒
 * 调用点的契约检查被整条跳过 ⇒ **假绿**（同一份值走 Identifier 形态会报
 * `nudo:constraint-violated`，走解构形态一声不吭）。
 *
 * 修法：`emitVariableDeclaration` 的解构分支按 Identifier 分支**同口径**
 * 登记绑定名（顶层 depth 0；块内 / 形参 / catch / for 头不是顶层绑定）。
 */
import { describe, it, expect } from "vitest";
import { bindingsOf, runTranspiled } from "../exec/run.ts";
import { litValue } from "../abs.ts";
import { issuesOf } from "./nudo-constraints.ts";

describe("BUG-080 残留 — 解构声明的子名进顶层绑定表", () => {
  it("对象 / 改名 / 数组 / 嵌套 / rest / 默认值 / export 包装 的子名都进绑定表", () => {
    const r = runTranspiled(
      `const { a } = { a: 1 };
const { b: c } = { b: 2 };
const [d] = [3];
const { e: { f } } = { e: { f: 4 } };
const { ...rest } = { g: 5 };
const { h = 6 } = {};
const i = 7;
export const { j } = { j: 8 };
`,
      { mode: "analyze" },
    );
    const binds = bindingsOf(r);
    expect(binds).toBeDefined();
    expect([...(binds!.keys())].sort()).toEqual(
      ["a", "c", "d", "f", "h", "i", "j", "rest"].sort(),
    );
  });

  it("绑定表里的值 = 解构出来的槽值（不是 any）", () => {
    const r = runTranspiled(`const { a } = { a: 1 }; const { b: c } = { b: 2 };`, {
      mode: "analyze",
    });
    const binds = bindingsOf(r)!;
    expect(litValue(binds.get("a") as never)).toEqual({ ok: true, value: 1 });
    // 改名绑定：表里登记的是**绑定名** c，值是源键 b 的槽值
    expect(binds.has("b")).toBe(false);
    expect(litValue(binds.get("c") as never)).toEqual({ ok: true, value: 2 });
  });

  it("for 头解构：循环体内子名拿到元素槽类型（契约面 signature 不是 any）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract xs findings
 */
export function f(xs) {
  for (const { severity } of xs) { return severity; }
  return "";
}
`);
    const sig = r.signatures.find((s) => s.name === "f")?.display ?? "";
    // 返回面 = 循环体 `return severity`（与 "" 并）= string；子名若退化成
    // any（解构未求类型），这里会是 any。
    expect(sig).toBe("string");
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });

  it("端到端：实参来自解构绑定 ⇒ 契约违例被报出（改前静默跳过 = 假绿）", () => {
    const r = issuesOf(`
const { p } = { p: -5 };
/**
 * @nudo:contract x port
 */
export function g(x) { return x; }
export function h() { return g(p); }
`);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("负控制：Identifier 形态仍在绑定表里（本次修改不退化）", () => {
    const r = runTranspiled(`const a = 1;`, { mode: "analyze" });
    expect([...(bindingsOf(r)!.keys())]).toEqual(["a"]);
  });

  it("负控制：块内解构子名不是顶层绑定", () => {
    const r = runTranspiled(
      `function f() { const { a } = { a: 1 }; return a; }
export { f };`,
      { mode: "analyze" },
    );
    expect(bindingsOf(r)!.has("a")).toBe(false);
  });

  it("负控制：for 头解构子名不是顶层绑定（循环作用域）", () => {
    const r = runTranspiled(`const xs = [{ a: 1 }]; for (const { a } of xs) { }`, {
      mode: "analyze",
    });
    const binds = bindingsOf(r)!;
    expect(binds.has("xs")).toBe(true);
    expect(binds.has("a")).toBe(false);
  });
});

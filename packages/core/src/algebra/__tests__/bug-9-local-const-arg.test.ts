/**
 * 分册 03 · Bug 9 —— 实参是**函数内 `const`** 的调用点整条跳过（假绿）。
 *
 * 根因：`varAbs` 只由模块级求值绑定表构造 ⇒ `const v = -1; f(v)` 的
 * `Identifier` 实参退化成 `absUnknown()` ⇒ `hasInfo === false` ⇒
 * `checkOneCall` 直接跳过；执行态实参回退（`bCalls`）只覆盖顶层语句。
 *
 * 修法：`scan-literal-calls.ts` 在 AST 走查时按作用域收集局部 const 的
 * 静态可判值，调用点解析 `Identifier` 实参时用「模块级 + 局部」合并绑定表
 * （求不出的保持无信息，fail-closed）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;
const IMP = `/// @nudo:import { positive } from "./std9.nudo.js"\n`;
const FILE = "/t/bug9.js";

function check(body: string) {
  return checkSource(FILE, IMP + body, pTrue, sidecarOpts("std9", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

const DECL = `/** @nudo:contract x positive */
export function f(x) { return x; }

const TOP = -1;
`;

describe("Bug 9 · 函数内 const 实参不再静默跳过", () => {
  it("字面量 / 模块级 const / 函数内 const 三条调用点各报一条", () => {
    const r = check(`${DECL}export function literal() { return f(-1); }
export function topConst() { return f(TOP); }
export function localConst() { const v = -1; return f(v); }`);
    expect(violations(r)).toHaveLength(3);
  });

  it("函数内 const 单独出现也报（位置不决定判定）", () => {
    const r = check(`${DECL}export function localConst() { const v = -1; return f(v); }`);
    expect(violations(r)).toHaveLength(1);
    expect(r.issues.find((i) => i.code === "nudo:constraint-violated")?.expected).toBe("x > 0");
  });

  it("负控制：函数内 const 是合法值 ⇒ 零违例", () => {
    const r = check(`${DECL}export function ok() { const v = 1; return f(v); }`);
    expect(violations(r)).toHaveLength(0);
  });

  it("负控制：求不出值的局部绑定不发明义务", () => {
    const r = check(`${DECL}export function unknown() { const v = f(TOP); return f(v); }`);
    // TOP 那条仍应报；v 的值不可静态判定 ⇒ 不额外造违例
    expect(violations(r)).toHaveLength(1);
  });
});

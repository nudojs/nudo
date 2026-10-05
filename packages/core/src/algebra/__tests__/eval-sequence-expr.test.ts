/**
 * SequenceExpression 发射回归（OSS perf 事故 2026-10-05）：
 * 逗号序列裸发射 `a, b` 在任何嵌套位都会撕裂宿主结构——
 * - 对象字面量属性值：后续项被解析成新属性的键 → new Function SyntaxError
 * - 数组元素：一项变多项（长度静默翻倍）
 * - 类计算键（TS 降级产物 `[(_A = new WeakMap(), …, "k")]` 正是该形态）：
 *   整文件 eval-incapable → 模块图逐依赖重试 → yargs hub-edit 4.4x 回归
 *   （CI OSS baseline gate 5 连红）。修复：序列统一括号包裹。
 * 每条断言与 Node 真实执行对齐（修前：SyntaxError×3 + 数组静默撕裂）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  formatAbs,
  abs,
  type Abs,
} from "@nudojs/core";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

function evalSrc(src: string, fnName: string, args: Abs[] = []): string {
  const run = runTranspiled(src, { mode: "analyze" });
  const r = callTranspiledExportFull(run, fnName, args) as { result?: Abs };
  return formatAbs(r.result ?? abs({ k: "unknown" }, undefined, undefined, "opaque")).replace(/\s+#[a-z]+$/, "");
}

describe("SequenceExpression emission is parenthesized in every nesting position", () => {
  it("class computed method key ending a sequence (TS downlevel shape)", () => {
    // TS 降级 #private 的真实形态：WeakMap holders 前置初始化，序列尾是键
    const r = evalSrc(
      `
let _H1, _H2;
export class Y { [(_H1 = new WeakMap(), _H2 = new WeakMap(), "runValidation")](v) { return v + 1; } }
export function use(v) { const y = new Y(); return y.runValidation(v); }
`,
      "use",
      [abs({ k: "prim", type: "number" }, { op: "lit", value: 41 }, undefined, "exact")],
    );
    expect(r).toBe("42");
  });

  it("static computed field key ending a sequence", () => {
    const r = evalSrc(
      `
let _A;
export function f() { class D { static [(_A = 9, "sk")] = 7; } return D.sk; }
`,
      "f",
    );
    expect(r).toBe("7");
  });

  it("object literal property value keeps single-value semantics", () => {
    // { a: (x, 2) } —— 修前 SyntaxError（"Unexpected number"）
    const r = evalSrc(
      `export function g(x) { const o = { a: (x, 2) }; return o.a; }`,
      "g",
      [anyAbs],
    );
    expect(r).toBe("2");
  });

  it("array element keeps single-element semantics (length not torn)", () => {
    // [(x, 2), 3] —— 修前静默撕裂成 3 元素数组（a[0]=x=any）
    const r = evalSrc(
      `export function h(x) { const a = [(x, 2), 3]; return a.length * 10 + a[0]; }`,
      "h",
      [anyAbs],
    );
    expect(r).toBe("22");
  });

  it("sequence as statement-level expression still evaluates in order", () => {
    const r = evalSrc(
      `export function s(x) { let b = 0; const a = (b = b + 1, b = b + 10, b + 100); return a + b; }`,
      "s",
      [anyAbs],
    );
    expect(r).toBe("122");
  });
});

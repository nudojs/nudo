/**
 * Bug 165 / Bug 166 回归（@nudo:replace / @nudo:as 指令面）。
 *
 * Bug 165：@nudo:replace 命中的子表达式**仍要求值**——副作用与 throws 域
 * 保留（L2 门禁不再假绿），只是**结果**被注入值取代。
 * 修复前：命中节点整段替换 → 原表达式从不求值 → 副作用归零、抛错域消失
 * （`JSON.parse(input)` 的 TypeError 被吞 → L2 假绿）。
 *
 * Bug 166：指令作用范围按 **AST 节点身份**（源文本字符区间）判定，不是
 * 「同一行号窗口」——不再泄漏进嵌套语句 / 嵌套函数体 / 同行下一条语句
 * （文档承诺「only affects the immediately following statement」）。
 *
 * 负控制钉住：指令**仍**作用于它标注的那条语句/子表达式（不被本次修复
 * 波及）；未被标注的相邻子表达式照常求值。
 */
import { describe, it, expect } from "vitest";
import { checkSource, formatShape, pTrue, type RunTranspiledOptions } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { collectEvalReplacements } from "../eval-run.ts";
import { l2Count } from "./check-helpers.ts";

/** 收集指令 → 注入包 → checkSource（产品面同口径：collect → inject → 门禁） */
function check(src: string, file = "/t/replace-scope.js") {
  const reps = collectEvalReplacements(src);
  const inject: RunTranspiledOptions = {
    replacements: reps.values,
    replacementTargets: reps.targets,
    asOverrides: reps.asValues,
    asOverrideTargets: reps.asTargets,
  };
  return checkSource(file, src, pTrue, { inject });
}

/** checkSource 签名显示串 */
function sigOf(r: { signatures: { name: string; display: string }[] }, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

/** @nudo:case 见证值（确定性） */
function witness(src: string, file = "/t/replace-scope.js"): string {
  const r = analyzeFile(file, src);
  return formatShape(r.functions[0].cases[0].abs);
}

describe("Bug 165: @nudo:replace 命中的子表达式仍求值", () => {
  it("被替换调用的 throws 域保留（L2 门禁不再假绿）", () => {
    const withDirective = `export function f(input) {
  // @nudo:replace JSON.parse(input) number()
  const v = JSON.parse(input);
  return v;
}
`;
    const control = `export function f(input) {
  const v = JSON.parse(input);
  return v;
}
`;
    // 修复前：带指令 → 0（假绿，JSON.parse 的 TypeError 被吞）
    expect(l2Count(check(withDirective), "f")).toBe(1);
    // 对照：JSON.parse 本来就会抛 → 门禁红
    expect(l2Count(check(control), "f")).toBe(1);
    // 类型覆盖仍在（结果类型 = 断言类型）
    expect(sigOf(check(withDirective), "f")).toContain("number");
  });

  it("被替换调用的副作用保留（求值发生，结果取注入值）", () => {
    const withDirective = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
/** @nudo:case "c" () */
export function f() {
  // @nudo:replace bump() number()
  const x = bump();
  return counter;
}
`;
    const control = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
/** @nudo:case "c" () */
export function f() {
  const x = bump();
  return counter;
}
`;
    // 修复前：bump() 整段被替换 → 从不调用 → counter 停在 0
    expect(witness(withDirective)).toBe("1");
    expect(witness(control)).toBe("1");
  });

  it("负控制：未被标注的相邻子表达式照常求值", () => {
    const src = `/**
 * @nudo:case "c" (5, 10)
 */
export function f(a, b) {
  // @nudo:replace a lit(100)
  const x = a + b;
  return x;
}
`;
    // 只有 a 被替换（→ 100），b 照常求值（→ 10）
    expect(witness(src)).toBe("110");
  });
});

describe("Bug 166: @nudo:as / @nudo:replace 的作用范围按 AST 节点身份", () => {
  it("@nudo:as 挂在 if 上不泄漏进块内的 return", () => {
    const withDirective = `export function f(cond) {
  // @nudo:as number()
  if (cond) {
    const x = "str";
    return x;
  }
  return 0;
}
`;
    const control = `export function f(cond) {
  if (cond) {
    const x = "str";
    return x;
  }
  return 0;
}
`;
    // 修复前：块内的 return x 被替换 → 签名 number
    expect(sigOf(check(withDirective), "f")).toBe(sigOf(check(control), "f"));
    expect(sigOf(check(withDirective), "f")).toContain('"str"');
  });

  it("@nudo:replace 不泄漏进嵌套函数体", () => {
    const withDirective = `export function f(x) {
  // @nudo:replace x number()
  const g = function () {
    return x;
  };
  return g();
}
`;
    const control = `export function f(x) {
  const g = function () {
    return x;
  };
  return g();
}
`;
    // 修复前：嵌套函数体内的 return x 被替换 → 签名 number
    expect(sigOf(check(withDirective), "f")).toBe(sigOf(check(control), "f"));
  });

  it("@nudo:replace 只作用于被标注的那条语句（同行下一条不受影响）", () => {
    const withDirective = `export function f(a) {
  // @nudo:replace a number()
  const x = a; const y = a;
  return [x, y];
}
`;
    const control = `export function f(a) {
  const x = a; const y = a;
  return [x, y];
}
`;
    const sig = sigOf(check(withDirective), "f");
    // 修复前：[number, number]（两条语句都被改）
    expect(sig).toContain("[number, any]");
    expect(sig).not.toContain("[number, number]");
  });

  it("负控制：指令仍作用于它标注的那条语句", () => {
    const src = `/**
 * @nudo:case "c" (5, 10)
 */
export function f(a, b) {
  // @nudo:replace a lit(100)
  const x = a + b;
  return x;
}
`;
    expect(witness(src)).toBe("110");
  });

  it("负控制：@nudo:as 仍覆盖紧随语句的 init", () => {
    const src = `/**
 * @nudo:case "c" ()
 */
export function f() {
  // @nudo:as string()
  const a = 1;
  return a;
}
`;
    expect(witness(src)).toBe("string");
  });
});

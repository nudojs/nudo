/**
 * Bug 454 —— 行内指令（@nudo:as / @nudo:replace）收集器的**通用下钻**。
 *
 * 改前：收集器只下钻 4 类容器（Block / Function / Export / If）⇒ 写在
 * for / for-of / while / do-while / try / catch / finally / switch /
 * labeled / 箭头函数 / 类方法 里的指令被**静默丢弃**（零诊断、类型覆盖失效）。
 *
 * 原生真值：指令是注释，运行时**无任何效果**——@nudo:as 是**类型面**声明，
 * 落在哪条语句就覆盖那条语句的 init / return 值。故断言口径是
 * 「承载指令的那条语句的被覆盖值」。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";
import { collectEvalReplacements } from "../eval-run.ts";

/** 指令所在容器 → 源码片段（其余部分逐字相同） */
const CONTAINERS: Array<[string, string]> = [
  ["fn-body", `export function f() {
  // @nudo:as number()
  const y = "hello";
  return y;
}`],
  ["for", `export function f() {
  for (let i = 0; i < 1; i++) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
  return 0;
}`],
  ["for-of", `export function f(xs) {
  for (const x of xs) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
  return 0;
}`],
  ["for-in", `export function f(o) {
  for (const k in o) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
  return 0;
}`],
  ["while", `export function f() {
  while (true) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["do-while", `export function f() {
  do {
    // @nudo:as number()
    const y = "hello";
    return y;
  } while (false);
}`],
  ["try", `export function f() {
  try {
    // @nudo:as number()
    const y = "hello";
    return y;
  } catch (e) {
    return 0;
  }
}`],
  ["catch", `export function f() {
  try {
    throw new Error("x");
  } catch (e) {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["finally", `export function f() {
  try {
    return 1;
  } finally {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["switch", `export function f(k) {
  switch (k) {
    case 1: {
      // @nudo:as number()
      const y = "hello";
      return y;
    }
    default:
      return 0;
  }
}`],
  ["labeled", `export function f() {
  lbl: {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
  ["arrow", `export const f = () => {
  // @nudo:as number()
  const y = "hello";
  return y;
};`],
  ["fn-expression", `export const f = function () {
  // @nudo:as number()
  const y = "hello";
  return y;
};`],
  ["class-method", `export class K {
  m() {
    // @nudo:as number()
    const y = "hello";
    return y;
  }
}`],
];

/** 收集器层面：每个容器位置的指令都必须进注入表 */
describe("Bug 454 — 指令收集覆盖面", () => {
  for (const [name, body] of CONTAINERS) {
    it(`收集 ${name} 容器里的 @nudo:as`, () => {
      const src = `/// @nudo:env es\n\n${body}\n`;
      const reps = collectEvalReplacements(src);
      expect(reps.asTargets.length).toBe(1);
      expect(reps.asValues[Object.keys(reps.asValues)[0]]).toBeDefined();
    });
  }

  it("收集 for 循环体里的 @nudo:replace", () => {
    const src = `export function f() {
  for (let i = 0; i < 1; i++) {
    // @nudo:replace JSON.parse("{}") shape({ port: number() })
    const y = JSON.parse("{}");
    return y;
  }
  return 0;
}
`;
    const reps = collectEvalReplacements(src);
    expect(reps.targets.length).toBeGreaterThan(0);
  });
});

/** 产品面（分析器）层面：承载指令的那条语句被覆盖 */
describe("Bug 454 — 分析面上的覆盖效果", () => {
  // 类方法的入口用例在分析面恒为 unknown（与指令无关）——它只断言收集器层面
  for (const [name, body] of CONTAINERS.filter(([n]) => n !== "class-method")) {
    it(`${name} 里的 @nudo:as 覆盖承载语句的值`, () => {
      const src = `/// @nudo:env es\n\n${body}\n`;
      const result = analyzeFile("/test/bug454.js", src);
      expect(result.functions.length).toBe(1);
      expect(formatShape(result.functions[0].cases[0].abs)).toBe("number");
    });
  }
});

/** 负控制：不该被这条修复波及的邻近形态 */
describe("Bug 454 — 负控制", () => {
  it("无指令的语句不受同函数内其它指令影响", () => {
    const src = `/// @nudo:env es

export function f() {
  // @nudo:as number()
  const a = "x";
  const b = "y";
  return b;
}
`;
    const result = analyzeFile("/test/bug454-neg.js", src);
    expect(formatShape(result.functions[0].cases[0].abs)).toBe('"y"');
  });

  it("指令挂在非语句节点上——不产生注入（无处可施），且发显式诊断", () => {
    // 对象属性不是语句：@nudo:as 没有可覆盖的语句
    const src = `export const o = {
  // @nudo:as number()
  a: 1,
};
`;
    const reps = collectEvalReplacements(src);
    expect(reps.asTargets.length).toBe(0);
    const diags: Array<{ code: string }> = [];
    collectEvalReplacements(src, { diags });
    expect(diags.map((d) => d.code)).toContain("nudo:directive-syntax");
  });

  it("无任何行内指令的源码不产生诊断", () => {
    const src = `export function f() {\n  return 1;\n}\n`;
    const diags: Array<{ code: string }> = [];
    const reps = collectEvalReplacements(src, { diags });
    expect(reps.asTargets.length).toBe(0);
    expect(reps.targets.length).toBe(0);
    expect(diags).toEqual([]);
  });
});

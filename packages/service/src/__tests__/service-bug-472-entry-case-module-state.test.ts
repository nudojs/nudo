/**
 * Bug 472 —— 合成入口用例（entry@）之间的**模块级状态串味**。
 *
 * 改前：`tryRunEval` 的 memo 按「文件 × mode」命中时直接返回缓存里的
 * `out`，而 `out.exports` 是**活模块实例**（导出函数的闭包捕获着模块级
 * `let` 绑定）⇒ 后一个合成用例看到前一个用例改写过的模块级状态。
 *
 * 原生真值：每个合成用例 = 一次**独立**的外部调用（各自进程 / 各自模块
 * 实例）⇒ 模块级计数器每次都从初值起算：
 *   `let n = 0; function inc(){ n = n + 1; return n; }`
 *   `export function a(){ inc(); return n; }` → 1（不是 2）
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";

function caseShapes(source: string): Record<string, string> {
  const result = analyzeFile("/test/bug472.js", source);
  const out: Record<string, string> = {};
  for (const fn of result.functions) {
    const c = fn.cases[0];
    if (c) out[fn.name] = formatShape(c.abs);
  }
  return out;
}

describe("Bug 472 — 合成入口用例的模块实例隔离", () => {
  it("非导出辅助函数改写模块级状态后，导出函数的入口用例仍从初值起算", () => {
    const shapes = caseShapes(`let n = 0;
function inc() { n = n + 1; return n; }
export function f() { return n; }
`);
    // 改前：f → 1（复用了 inc 调用后的实例）
    expect(shapes.inc).toBe("1");
    expect(shapes.f).toBe("0");
  });

  it("多个导出函数的入口用例互不串味（各自独立实例）", () => {
    const shapes = caseShapes(`let n = 0;
function inc() { n = n + 1; return n; }
export function a() { inc(); return n; }
export function b() { inc(); return n; }
export function c() { inc(); return n; }
`);
    // 改前：a → 2 / b → 3 / c → 4（同一个实例累加）
    expect(shapes.a).toBe("1");
    expect(shapes.b).toBe("1");
    expect(shapes.c).toBe("1");
  });
});

/** 负控制：不该被这条修复波及的邻近形态 */
describe("Bug 472 — 负控制", () => {
  it("声明式 @nudo:case 的求值结果不变", () => {
    const shapes = caseShapes(`/**
 * @nudo:case "t" (1)
 */
export function add(x) { return x + 1; }
`);
    expect(shapes.add).toBe("2");
  });

  it("无模块级状态的模块，入口用例结果不变", () => {
    const shapes = caseShapes(`export function g() { return "ok"; }
`);
    expect(shapes.g).toBe('"ok"');
  });

  it("模块级状态未被改写时，读到的就是初值", () => {
    const shapes = caseShapes(`let n = 7;
export function read() { return n; }
`);
    expect(shapes.read).toBe("7");
  });
});

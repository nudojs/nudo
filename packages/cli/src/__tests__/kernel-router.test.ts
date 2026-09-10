import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import {
  evaluateProgram,
  evaluateFunctionFull,
  resetMemo,
} from "../evaluator.ts";
import {
  setKernelDomains,
  resetPhi,
  tryKernelBinary,
  kernelEnabled,
} from "../kernel-router.ts";

function runExpr(src: string, kernel: "off" | "arith"): string {
  setKernelDomains(kernel === "off" ? "off" : ["arith"]);
  resetPhi();
  resetMemo();
  const ast = parse(src);
  const env = createEnvironment();
  const result = evaluateProgram(ast, env);
  return typeValueToString(result as any);
}

function runFn(
  src: string,
  args: Array<ReturnType<typeof T.literal> | typeof T.number | typeof T.string>,
  kernel: "off" | "arith",
): string {
  setKernelDomains(kernel === "off" ? "off" : ["arith"]);
  resetPhi();
  resetMemo();
  const ast = parse(src);
  const fnNode = (ast.program.body as any[]).find(
    (s) => s.type === "FunctionDeclaration",
  );
  const env = createEnvironment();
  // 先求值 program 以绑定全局/函数（可选）
  evaluateProgram(ast, createEnvironment());
  const full = evaluateFunctionFull(fnNode, args as any, env);
  return typeValueToString(full.value);
}

describe("M1 kernel router", () => {
  afterEach(() => {
    setKernelDomains("off");
    resetPhi();
  });

  it("M5 default: arith/hof/object on; off switch works", () => {
    setKernelDomains("off");
    expect(kernelEnabled("arith")).toBe(false);
    // 默认（未 set）时 parseDomainsFromEnv 在模块加载时读 env；
    // 测试里用 set 模拟 M5 默认
    setKernelDomains(["arith", "hof", "object"]);
    expect(kernelEnabled("arith")).toBe(true);
    expect(kernelEnabled("hof")).toBe(true);
    expect(kernelEnabled("object")).toBe(true);
    expect(kernelEnabled("generalize")).toBe(false);
  });

  it("arith on: 1+2*3 still 7 (literal path parity)", () => {
    const off = runExpr("1+2*3;", "off");
    const on = runExpr("1+2*3;", "arith");
    expect(on).toBe("7");
    expect(on).toBe(off);
  });

  it("scale(5) parity: 6 both modes", () => {
    const src = `function scale(x){ return x+1; }`;
    const off = runFn(src, [T.literal(5)], "off");
    const on = runFn(src, [T.literal(5)], "arith");
    expect(on).toBe("6");
    expect(on).toBe(off);
  });

  it("number+1 stays number both modes", () => {
    const src = `function f(x){ return x+1; }`;
    const off = runFn(src, [T.number], "off");
    const on = runFn(src, [T.number], "arith");
    expect(on).toBe("number");
    expect(on).toBe(off);
  });

  it("if (x>5) return 11 — true branch parity", () => {
    const src = `
      function g(x) {
        if (x > 5) return 11;
        return 0;
      }
    `;
    const off = runFn(src, [T.literal(10)], "off");
    const on = runFn(src, [T.literal(10)], "arith");
    expect(on).toBe("11");
    expect(on).toBe(off);
  });

  it("if (x>5) return x — narrowing keeps refined range (parity)", () => {
    // 旧路径：true 分支 x 被 narrow 成 number (>=6)，字面量 10 丢失
    const src = `
      function c(x) {
        if (x > 5) return x;
        return 0;
      }
    `;
    const off = runFn(src, [T.literal(10)], "off");
    const on = runFn(src, [T.literal(10)], "arith");
    expect(on).toBe(off);
    expect(on).toContain("number");
  });

  it("tryKernelBinary: 2+3 → 5", () => {
    setKernelDomains(["arith"]);
    const r = tryKernelBinary("+", T.literal(2), T.literal(3));
    expect(r).toBeDefined();
    expect(typeValueToString(r!)).toBe("5");
  });

  it("tryKernelBinary rejects string+number for - (non-add)", () => {
    setKernelDomains(["arith"]);
    const r = tryKernelBinary("-", T.string, T.literal(1));
    expect(r).toBeUndefined();
  });

  it("tryKernelBinary string concat via + (both literals)", () => {
    setKernelDomains(["arith"]);
    const r = tryKernelBinary("+", T.literal("a"), T.literal("b"));
    expect(r).toBeDefined();
    expect(typeValueToString(r!)).toBe('"ab"');
  });

  it("tryKernelBinary abstract string + literal → template", () => {
    setKernelDomains(["arith"]);
    const r = tryKernelBinary("+", T.string, T.literal("x"));
    expect(r).toBeDefined();
    expect(typeValueToString(r!)).toContain("string");
  });

  it("if false branch: g(3) → 0", () => {
    const src = `
      function g(x) {
        if (x > 5) return x + 1;
        return 0;
      }
    `;
    const on = runFn(src, [T.literal(3)], "arith");
    expect(on).toBe("0");
  });
});

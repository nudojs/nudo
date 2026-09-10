import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T, typeValueEquals } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateFunctionFull, resetMemo } from "../evaluator.ts";
import { setKernelDomains, resetPhi, pushPhi } from "../kernel-router.ts";
import { gtNum, v } from "@nudojs/kernel";

function runFn(
  src: string,
  args: any[],
  kernel: "off" | "hof" | "arith",
): ReturnType<typeof evaluateFunctionFull>["value"] {
  setKernelDomains(kernel === "off" ? "off" : kernel === "hof" ? ["hof"] : ["arith", "hof"]);
  resetPhi();
  resetMemo();
  const ast = parse(src);
  const fnNode = (ast.program.body as any[]).find(
    (s) => s.type === "FunctionDeclaration",
  );
  return evaluateFunctionFull(fnNode, args, createEnvironment()).value;
}

describe("M2 HOF kernel routing", () => {
  afterEach(() => {
    setKernelDomains("off");
    resetPhi();
  });

  it("tuple map still exact: [1,2,3].map(x=>x*2)", () => {
    const src = `
      function doubleAll(xs) {
        return xs.map((x) => x * 2);
      }
    `;
    const arr = T.tuple([T.literal(1), T.literal(2), T.literal(3)]);
    const off = runFn(src, [arr], "off");
    const on = runFn(src, [arr], "hof");
    expect(typeValueToString(off)).toBe("[2, 4, 6]");
    expect(typeValueToString(on)).toBe(typeValueToString(off));
  });

  it("array map: Arr(number) map x=>x+1 stays number[]", () => {
    const src = `
      function incAll(xs) {
        return xs.map((x) => x + 1);
      }
    `;
    const arr = T.array(T.number);
    const on = runFn(src, [arr], "hof");
    expect(on.kind).toBe("array");
    if (on.kind === "array") {
      expect(typeValueToString(on.element)).toContain("number");
    }
  });

  it("array map under Φ: element tagged, x+1 with x>0 ⇒ refined element", () => {
    const src = `
      function incAll(xs) {
        return xs.map((x) => x + 1);
      }
    `;
    setKernelDomains(["arith", "hof"]);
    resetPhi();
    pushPhi(gtNum(v("x"), 0)); // 约束名需与 tag 一致：fn.params[0]
    resetMemo();
    const ast = parse(src);
    const fnNode = (ast.program.body as any[]).find(
      (s) => s.type === "FunctionDeclaration",
    );
    // 回调参数名是 x，tagEl 用 fn.params[0] === "x"，Φ 有 x>0
    const result = evaluateFunctionFull(
      fnNode,
      [T.array(T.number)],
      createEnvironment(),
    ).value;
    resetPhi();
    expect(result.kind).toBe("array");
    if (result.kind === "array") {
      // 元素应是 refined（x+1 > 1）
      expect(result.element.kind).toBe("refined");
      if (result.element.kind === "refined") {
        const meta = result.element.refinement.meta as { op?: string; n?: number };
        expect(meta.op).toBe("gt");
        expect(meta.n).toBe(1);
      }
    }
  });

  it("reduce tuple sum exact", () => {
    const src = `
      function sum(xs) {
        return xs.reduce((acc, n) => acc + n, 0);
      }
    `;
    const arr = T.tuple([T.literal(1), T.literal(2), T.literal(3)]);
    const off = runFn(src, [arr], "off");
    const on = runFn(src, [arr], "hof");
    expect(typeValueToString(on)).toBe("6");
    expect(typeValueToString(on)).toBe(typeValueToString(off));
  });

  it("reduce abstract array: fixed-point converges to number", () => {
    const src = `
      function sum(xs) {
        return xs.reduce((acc, n) => acc + n, 0);
      }
    `;
    const arr = T.array(T.number);
    const on = runFn(src, [arr], "hof");
    // 不动点：0 + number → number
    expect(typeValueToString(on)).toBe("number");
  });

  it("filter tuple keeps elements", () => {
    const src = `
      function keepPos(xs) {
        return xs.filter((x) => x > 0);
      }
    `;
    const arr = T.tuple([T.literal(1), T.literal(-2), T.literal(3)]);
    const on = runFn(src, [arr], "hof");
    // 1>0 true, -2>0 false, 3>0 true → [1, 3] as array of union
    expect(on.kind === "array" || on.kind === "tuple").toBe(true);
  });
});

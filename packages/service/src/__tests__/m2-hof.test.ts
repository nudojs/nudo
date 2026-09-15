import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateFunctionFull, resetMemo } from "../evaluator/evaluator.ts";
import { resetPhi, pushPhi } from "../evaluator/abs-route.ts";
import { gtNum, v } from "@nudojs/core";

function runFn(
  src: string,
  args: any[],
): ReturnType<typeof evaluateFunctionFull>["value"] {
  resetPhi();
  resetMemo();
  const ast = parse(src);
  const fnNode = (ast.program.body as any[]).find(
    (s) => s.type === "FunctionDeclaration",
  );
  return evaluateFunctionFull(fnNode, args, createEnvironment()).value;
}

describe("HOF algebra routing", () => {
  afterEach(() => {
    resetPhi();
  });

  it("tuple map still exact: [1,2,3].map(x=>x*2)", () => {
    const src = `
      function doubleAll(xs) {
        return xs.map((x) => x * 2);
      }
    `;
    const arr = T.tuple([T.literal(1), T.literal(2), T.literal(3)]);
    const on = runFn(src, [arr]);
    expect(typeValueToString(on)).toBe("[2, 4, 6]");
  });

  it("array map: Arr(number) map x=>x+1 stays number[]", () => {
    const src = `
      function incAll(xs) {
        return xs.map((x) => x + 1);
      }
    `;
    const arr = T.array(T.number);
    const on = runFn(src, [arr]);
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
    resetPhi();
    pushPhi(gtNum(v("x"), 0));
    resetMemo();
    const ast = parse(src);
    const fnNode = (ast.program.body as any[]).find(
      (s) => s.type === "FunctionDeclaration",
    );
    const result = evaluateFunctionFull(
      fnNode,
      [T.array(T.number)],
      createEnvironment(),
    ).value;
    resetPhi();
    expect(result.kind).toBe("array");
    if (result.kind === "array") {
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
    const on = runFn(src, [arr]);
    expect(typeValueToString(on)).toBe("6");
  });

  it("reduce abstract array: fixed-point converges to number", () => {
    const src = `
      function sum(xs) {
        return xs.reduce((acc, n) => acc + n, 0);
      }
    `;
    const arr = T.array(T.number);
    const on = runFn(src, [arr]);
    expect(typeValueToString(on)).toBe("number");
  });

  it("filter tuple keeps elements", () => {
    const src = `
      function keepPos(xs) {
        return xs.filter((x) => x > 0);
      }
    `;
    const arr = T.tuple([T.literal(1), T.literal(-2), T.literal(3)]);
    const on = runFn(src, [arr]);
    expect(on.kind === "array" || on.kind === "tuple").toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { parse, extractDirectives } from "@nudojs/parser";
import { num, str, numLit, abs as makeAbs, type Abs } from "@nudojs/core";
import { phiFromTest } from "../evaluator/phi-from-test.ts";
import { tryAbsJoinObjects, resetPhi } from "../evaluator/abs-route.ts";
import { mockDirectivesToAbsSeeds } from "@nudojs/service";

function absObj(properties: Record<string, Abs>): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(properties)) slots[k] = { value: v };
  return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
}

describe("phiFromTest false branch", () => {
  function testNode(src: string) {
    const file = parse(src);
    const stmt = file.program.body[0];
    if (stmt.type !== "IfStatement") throw new Error("expected if");
    return stmt.test;
  }

  it("x > n → whenTrue gt, whenFalse le", () => {
    const { whenTrue, whenFalse } = phiFromTest(testNode("if (x > 0) {}"));
    expect(whenTrue.op).toBe("gt");
    expect(whenFalse.op).toBe("le");
  });

  it("x >= n → whenTrue ge, whenFalse lt", () => {
    const { whenTrue, whenFalse } = phiFromTest(testNode("if (x >= 0) {}"));
    expect(whenTrue.op).toBe("ge");
    expect(whenFalse.op).toBe("lt");
  });

  it("x < n → whenTrue lt, whenFalse ge", () => {
    const { whenTrue, whenFalse } = phiFromTest(testNode("if (x < 10) {}"));
    expect(whenTrue.op).toBe("lt");
    expect(whenFalse.op).toBe("ge");
  });

  it("non-compare test stays pTrue", () => {
    const { whenTrue, whenFalse } = phiFromTest(testNode("if (flag) {}"));
    expect(whenTrue.op).toBe("true");
    expect(whenFalse.op).toBe("true");
  });
});

describe("tryAbsJoinObjects", () => {
  it("joins same-key object slots", () => {
    resetPhi();
    const a = absObj({ x: numLit(1) });
    const b = absObj({ x: numLit(2) });
    const r = tryAbsJoinObjects(a, b);
    expect(r).toBeDefined();
    expect(r!.shape.k).toBe("obj");
    if (r!.shape.k === "obj") {
      expect(r!.shape.slots.x).toBeDefined();
    }
  });

  it("returns undefined for non-objects", () => {
    expect(tryAbsJoinObjects(num(), str())).toBeUndefined();
  });
});

describe("mock Abs conf", () => {
  it("stub return carries conf=mock", () => {
    const src = `
/**
 * @nudo:mock fetch = stub().returns({ ok: true })
 */
function load() { return fetch(); }
`;
    const file = parse(src);
    const fns = extractDirectives(file);
    const seeds = mockDirectivesToAbsSeeds(fns);
    expect(seeds.seedVars.fetch).toBeDefined();
    expect(seeds.seedVars.fetch!.conf).toBe("mock");
  });

  it("type-value expression mock seeds a var for the B path", () => {
    // 回归：`= number()` 只进 TypeValue env，B 路径注入拿不到 → 被当
    // unknown 全局（nudo:builtin-unknown）。seed 后两路径口径一致。
    const src = `
/**
 * @nudo:mock retries = number()
 */
function plan() { return retries + 1; }
`;
    const file = parse(src);
    const fns = extractDirectives(file);
    const seeds = mockDirectivesToAbsSeeds(fns);
    expect(seeds.seedVars.retries).toBeDefined();
    expect(seeds.seedVars.retries!.shape.k).toBe("prim");
    expect((seeds.seedVars.retries!.shape as { type?: string }).type).toBe("number");
  });
});

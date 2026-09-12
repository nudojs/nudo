import { describe, it, expect } from "vitest";
import { parse, extractDirectives } from "@nudojs/parser";
import { T } from "@nudojs/core";
import { phiFromTest } from "../phi-from-test.ts";
import { tryAbsJoinObjects, resetPhi } from "../abs-route.ts";
import { mockDirectivesToAbsSeeds } from "@nudojs/service";

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
    const a = T.object({ x: T.literal(1) });
    const b = T.object({ x: T.literal(2) });
    const r = tryAbsJoinObjects(a, b);
    expect(r).toBeDefined();
    expect(r!.kind).toBe("object");
    if (r!.kind === "object") {
      expect(r.properties.x).toBeDefined();
    }
  });

  it("returns undefined for non-objects", () => {
    expect(tryAbsJoinObjects(T.number, T.string)).toBeUndefined();
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
});

import { describe, it, expect } from "vitest";
import { parse, extractDirectives } from "@nudojs/parser";
import { mockDirectivesToAbsSeeds } from "@nudojs/service";

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

  it("type-value expression mock seeds a var for the eval path", () => {
    // 回归：`= number()` 只进 TypeValue env，求值引擎注入拿不到 → 被当
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

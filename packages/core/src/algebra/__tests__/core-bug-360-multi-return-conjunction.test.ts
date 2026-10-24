/**
 * Bug 360 回归：多条 `@nudo:contract return` 段只执法**第一条** ⇒ 违反第 2 条
 * 时 0 error / exit 0（**加一条契约反而让门禁变绿**）。
 *
 * 修法（不改公开返回型，仍是**单条**返回槽）：在 `refine.ts` 的 return 段
 * 提取里把多条 return 段**合成单条合取**——语义 = 合取，与形参位「同形参多
 * 段取合取」的既有语义一致（`interface.ts` 的 `conjoinOrConflict` → `andC`）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  extractRefineReturnFromSource,
  setRefineDiagCollector,
  takeRefineDiags,
} from "../refine.ts";
import { assertImplies } from "../postcondition.ts";
import { absLit } from "../abs.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

const STD = `
import { number } from "@nudojs/core";
export const positive = number().gt(0);
export const small = number().lt(10);
`;

const MULTI = `
/// @nudo:import { positive, small } from "./std.nudo.js"
/**
 * @nudo:contract return positive
 * @nudo:contract return small
 */
export function f(x) {
  return 100;
}
`;

const SINGLE = `
/// @nudo:import { small } from "./std.nudo.js"
/**
 * @nudo:contract return small
 */
export function f(x) {
  return 100;
}
`;

describe("Bug 360: 多条 return 契约", () => {
  it("合成**单条**合取（返回槽仍是单条）", () => {
    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(MULTI, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    expect(ret!.name).toBe("positive ∧ small");
  });

  it("违反**第 2 条**段也被执法（旧口径只执法第一条）", () => {
    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(MULTI, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    const proof = assertImplies(absLit(100), ret!.constraint);
    expect(proof.status).toBe("disproved");
  });

  it("满足全部段时不报错", () => {
    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(MULTI, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    const proof = assertImplies(absLit(5), ret!.constraint);
    expect(proof.status).toBe("proved");
  });

  it("单条 return 段语义不变（名字不变、约束不变）", () => {
    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(SINGLE, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    expect(ret!.name).toBe("small");
    const proof = assertImplies(absLit(100), ret!.constraint);
    expect(proof.status).toBe("disproved");
  });
});

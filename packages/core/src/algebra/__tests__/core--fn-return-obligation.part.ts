/**
 * Bug 351 回归：源码 `@nudo:contract return <fn 形态模板>` 的返回义务
 * **整条不被执法**——返回槽装的是整个 fn 约束，而 postcondition 的 fn 分支
 * 把 fn 形态直接判「已证明」⇒ 零诊断假绿。
 *
 * 修法（不改公开返回型，仍是**单条**返回槽）：
 * - `refine.ts` 的 return 段提取：fn 形态模板取其 `fn.returns`（**真正的返回
 *   义务**）——与侧车口径（`sidecarFn?.fn.returns`）一致；
 * - `postcondition.ts`：fn 形态**无法执法**时不再返回 `proved()`，返回
 *   `unprovable`（无法证明 ≠ 已证明 ⇒ 出 warning `nudo:unproven-return`）。
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

const RETFN_SIDECAR = `
import { fn, number } from "@nudojs/core";
export const retfn = fn({ d: number().ge(0) }, number().ge(0).le(1));
`;

const SRC = `
/// @nudo:import { retfn } from "./retfn.nudo.js"
/**
 * @nudo:contract return retfn
 */
export function other(d) {
  return 999;
}
`;

describe("Bug 351: fn 形态的返回义务", () => {
  it("返回槽取 fn.returns（不是整个 fn 约束）", () => {
    const { loadModule } = makeFiles({
      "/t/retfn.nudo.js": RETFN_SIDECAR,
    });
    const ret = extractRefineReturnFromSource(SRC, "other", {
      loadModule,
      fromFile: "/t/other.js",
    });
    expect(ret).toBeDefined();
    expect(ret!.name).toBe("retfn");
    // fn 形态被拆成它的 returns（标量），不再是 fn 约束本身
    expect(ret!.constraint.fn).toBeUndefined();
  });

  it("返回义务真被执法：999 ⊭ number().ge(0).le(1)", () => {
    const { loadModule } = makeFiles({
      "/t/retfn.nudo.js": RETFN_SIDECAR,
    });
    const ret = extractRefineReturnFromSource(SRC, "other", {
      loadModule,
      fromFile: "/t/other.js",
    });
    expect(ret).toBeDefined();
    const proof = assertImplies(absLit(999), ret!.constraint);
    expect(proof.status).toBe("disproved");
  });

  it("postcondition：fn 形态不再被直接判「已证明」", () => {
    const fnConstraint = {
      __nudoConstraint: true as const,
      prim: "number" as const,
      preds: [],
      fn: {
        params: {},
        returns: undefined,
      },
    };
    const proof = assertImplies(absLit(1), fnConstraint as never);
    expect(proof.status).toBe("unprovable");
  });
});

/**
 * BUG-084：`@nudo:invariant` 只要「声明了 + 返回契约证明成功」就**无条件**报
 * `nudo:invariant-relied`（无循环、零贡献也报）⇒ 审计归因说谎。
 *
 * 文档口径（docs/concepts/directives.md「When a proof relies on it」）要求
 * 只在**证明依赖**时上屏。修法 = 与 `@nudo:assume` 同款的**消费账本**：
 * `exec/runtime/invariant-apply.ts` 在循环 join/宽化位命中自己的绑定时记账，
 * `check-return.ts` 按账本过滤。
 *
 * 钉：
 * - 无循环（不变式从未实施）⇒ **零** `nudo:invariant-relied`；
 * - 循环里真的实施了 ⇒ 仍有 `nudo:invariant-relied`（不是把特性关掉）；
 * - 声明了不存在的绑定名 ⇒ 该 spec 不参与，也不得被归因。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

/** 返回契约 `number().ge(1)`：`return 7` 平凡满足 */
const SIDECAR_GE1 = `import { fn, number } from "@nudojs/core";
export const f = fn({ n: number() }, number().ge(1));
`;
/** 返回契约 `number().ge(0)`：循环累加面只有靠不变式才能证成 */
const SIDECAR_GE0 = `import { fn, number } from "@nudojs/core";
export const f = fn({ n: number() }, number().ge(0));
`;

function check(src: string, sidecar = SIDECAR_GE1) {
  const { loadModule } = makeFiles({ "/t/f.nudo.js": sidecar });
  return checkSource("/t/f.js", src, pTrue, {
    loadModule,
    fromFile: "/t/f.js",
  });
}

describe("BUG-084 nudo:invariant-relied 只在真正消费时归因", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeInterfaceDiags();
    takeRefineDiags();
  });

  it("没有循环的函数上声明不变式 ⇒ 零 invariant-relied（旧口径无条件报）", () => {
    const r = check(`
/**
 * @nudo:invariant last >= 1
 */
export function f(n) {
  let last = 0;
  return 7;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-relied")).toEqual([]);
    // 返回契约仍被证明（零贡献的不变式既不该被归因，也不该影响判定）
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return")).toEqual([]);
  });

  it("循环里真正实施了不变式 ⇒ 仍有 invariant-relied", () => {
    const r = check(`
/**
 * @nudo:invariant dp[*] >= 0
 */
export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`, SIDECAR_GE0);
    const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
    expect(relied).toBeDefined();
    expect(relied!.message).toContain("dp[*] >= 0");
  });

  it("不变式指向的绑定在循环里不存在 ⇒ 不归因", () => {
    const r = check(`
/**
 * @nudo:invariant other >= 1
 */
export function f(n) {
  let other = 3;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc = acc + i;
  }
  return 7;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-relied")).toEqual([]);
  });
});

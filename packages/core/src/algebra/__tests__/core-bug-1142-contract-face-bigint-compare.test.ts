/**
 * Bug 1142 —— 调用边界契约面（`contract-face.ts`）的 **bigint 过滤**必须
 * 发生在**比较之后**，不能发生在比较之前。
 *
 * 旧行为：`litMeetsReturnConstraint` / `violatesDeclaredReturn` 在调用
 * `literalMeetsConstraint` **之前**就把 `typeof v === "bigint"` 的值排除掉
 * ⇒ bigint 值**从不参与**域判定：
 * - `lit(1n)` 契约 + 推断面 `2n` ⇒ 「不满足声明约束」判不出来
 *   ⇒ `violatesDeclaredReturn` 说「没违反」⇒ **声明面替换**真实推断面
 *   ⇒ `2n` 被当成满足 `lit(1n)` ⇒ **假绿**（违约被放过）。
 * - `lit(1n)` 契约 + 推断面 `1n` ⇒ 同样判不出「满足」⇒ 也走面替换
 *   （本例恰好无害，但口径与 number / string / boolean 三域不一致）。
 *
 * 新行为：bigint 与其余标量同口径 —— 参与 `literalMeetsConstraint` 比较
 * （口径同 `domain-membership.ts` 的 `literalSame`：`===` + NaN 特例 ⇒
 * `1n !== 1`，bigint 与 number 不混同）：
 * - `lit(1n)` + `2n` ⇒ **确定违反** ⇒ 不许用声明面替换 ⇒ 调用方也红；
 * - `lit(1n)` + `1n` ⇒ 满足 ⇒ 保留推断精度（调用方零诊断）。
 *
 * 覆盖面：同文件路径（`$callNamed` 消费按名解析的契约面）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { literalMeetsConstraint } from "../domain-membership.ts";
import { litC } from "../constraint.ts";
import { makeFiles, sigOf } from "./nudo-constraints.ts";

const SIDECAR = `import { lit } from "@nudojs/core";
export const litN = lit(1n);
`;

/**
 * 同文件：callee `inner` 声明 `lit(1n)` 返回契约、实际返回 ret；
 * caller `outer` 同样声明 `lit(1n)` 返回契约（返回位面由 inner 的
 * 声明面决定 ⇒ 声明面替换会把违约洗白）。
 */
function src(ret: string): string {
  return `/// @nudo:import { litN } from "./t.nudo.js"
/**
 * @nudo:contract return litN
 */
export function inner() {
  return ${ret};
}
/**
 * @nudo:contract return litN
 */
export function outer() {
  return inner();
}
`;
}

function run(ret: string) {
  const { loadModule } = makeFiles({ "/t/t.nudo.js": SIDECAR });
  return checkSource("/t/lib.js", src(ret), pTrue, {
    loadModule,
    fromFile: "/t/lib.js",
  });
}

describe("Bug 1142 —— 契约面的大字面量比较：bigint 必须参与比较", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("域隶属口径：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 与 number 不混同）", () => {
    expect(literalMeetsConstraint(1n, litC(1n))).toBe(true);
    expect(literalMeetsConstraint(2n, litC(1n))).toBe(false);
    expect(literalMeetsConstraint(1, litC(1n))).toBe(false);
  });

  it("callee 违约（返回 2n）⇒ 调用方不得被声明面「证得」（假绿回归）", () => {
    const r = run("2n");
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.map((i) => i.fn)).toContain("outer");
    expect(r.ok).toBe(false);
  });

  it("callee 违约（返回 2n）⇒ 调用方的返回面是真实值 2n，不是声明面", () => {
    const r = run("2n");
    expect(sigOf(r, "outer")).toMatch(/^2n\b/);
  });

  it("callee 守约（返回 1n）⇒ 调用方零诊断（不得新增诊断）", () => {
    const r = run("1n");
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("callee 守约（返回 1n）⇒ 调用方的返回面保留推断精度 1n", () => {
    const r = run("1n");
    expect(sigOf(r, "outer")).toMatch(/^1n\b/);
  });
});

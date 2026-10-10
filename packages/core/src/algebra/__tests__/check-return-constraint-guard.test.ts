/**
 * Bug 1 回归：守卫过的普通变量返回不再触发 `nudo:constraint-violated` 假阳。
 *
 * 根因：`if (x >= 0) return x` 的守卫事实 ge(x,0) 只进 exec Φ（算术折叠
 * 消费），裸变量读取丢界 → checkReturnConstraint 的 g.symbolic 臂是
 * 无界 number → disproved 假阳。修复：关系守卫事实臂（cons）内以
 * $refineRel 影子重绑（与 nullish/typeof/判别剪影同机制），普通变量
 * 读取携带守卫界。
 *
 * 精度红线：真实违规控制组必须仍报——守卫弱于契约（x=0 路径）、补集臂
 * NaN 面（NaN 与任何比较皆假）、`&&` 的 false 臂、臂内写守卫变量
 * （窄化按 fork 绑定集跳过）都不得漏。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/ret-guard.js", withStdImport(src), pTrue, stdOpts);
}

function errorsOf(src: string) {
  return issuesOf(src).issues.filter((i) => i.severity === "error");
}

function retViolations(src: string) {
  return errorsOf(src).filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 1: 守卫后普通变量返回（假阳 → 无 issue）", () => {
  it("ok: if (x >= 0) return x; return 0 —— nonNeg", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  if (x >= 0) return x;
  return 0;
}
`),
    ).toEqual([]);
  });

  it("ok: 算术形态控制组（修复前也绿）—— x + 0 消费 exec Φ", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  if (x >= 0) return x + 0;
  return 0;
}
`),
    ).toEqual([]);
  });

  it("ok: if (x > 0) return x; return 1 —— nonNeg", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  if (x > 0) return x;
  return 1;
}
`),
    ).toEqual([]);
  });

  it("ok: if (x >= 1) return x; return 1 —— positive", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
function f(x) {
  if (x >= 1) return x;
  return 1;
}
`),
    ).toEqual([]);
  });

  it("ok: if (x > 1) return x; return 0 —— nonNeg", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  if (x > 1) return x;
  return 0;
}
`),
    ).toEqual([]);
  });

  it("ok: 字面量在左的翻转形态 0 < x —— positive", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
function f(x) {
  if (0 < x) return x;
  return 1;
}
`),
    ).toEqual([]);
  });

  it("ok: 守卫强于契约（x > 0 ⇒ nonNeg）", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  if (x > 0) return x;
  return 0;
}
`),
    ).toEqual([]);
  });

  it("ok: 三元形态 x >= 0 ? x : 0 —— nonNeg（同一假阳面）", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  return x >= 0 ? x : 0;
}
`),
    ).toEqual([]);
  });
});

describe("Bug 1: 真实违规控制组（精度红线——仍报 error）", () => {
  it("error: 无守卫裸 return x ⊭ positive", () => {
    const v = retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
function f(x) {
  return x;
}
`);
    expect(v).toHaveLength(1);
    expect(v[0]!.message).toContain("@nudo:contract return positive");
  });

  it("error: 守卫弱于契约（x >= 0 臂含 x=0 ⊭ positive）", () => {
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
function f(x) {
  if (x >= 0) return x;
  return 1;
}
`),
    ).toHaveLength(1);
  });

  it("error: 补集臂 NaN 面（x < 0 ? 0 : x 的 else 含 NaN ⊭ nonNeg）", () => {
    // NaN < 0 为假 → else 臂可达且 NaN ⊭ ge(0)：真实违约，不得因守卫机制漏报
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  return x < 0 ? 0 : x;
}
`),
    ).toHaveLength(1);
  });

  it("error: && 值形态的 false 臂 ⊭ number 契约（NaN 路径）", () => {
    // x = NaN → NaN >= 0 假 → 返回 false（boolean）⊭ nonNeg：真实违约
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  return x >= 0 && x;
}
`),
    ).toHaveLength(1);
  });

  it("error: 臂内写守卫变量（窄化按 fork 绑定集跳过，仍按事实报）", () => {
    // if 臂内 x = x - 10：x=5 时返回 -5 ⊭ nonNeg——真实违约
    expect(
      retViolations(`
/**
 * @nudo:contract x num
 * @nudo:contract return nonNeg
 */
function f(x) {
  if (x >= 0) {
    x = x - 10;
    return x;
  }
  return 0;
}
`),
    ).toHaveLength(1);
  });
});

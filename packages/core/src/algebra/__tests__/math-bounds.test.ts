/**
 * #68-A：Math.min/max/round 区间透传 + NaN 显式化（option 1）。
 *
 * - 钳位 `max(0, min(100, n))` 按操作数区间推导
 * - 可能 NaN 时结果为 `NaN | number@bounds`（契约对 NaN 臂诚实报违例）
 * - `if (Number.isNaN(n)) return …` 假臂 ne(n,NaN) 排除 NaN 臂后可证
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function retIssues(src: string) {
  return checkSource("/t/clamp.js", withStdImport(src), pTrue, stdOpts).issues.filter(
    (i) => i.message.includes("@nudo:contract return"),
  );
}

const CLAMP_CONTRACT = `
/**
 * @nudo:contract return percent
 */
`;

describe("#68 Math.min/max bounds", () => {
  it("clamp100: NaN 臂 → error（option 1：形态 1 仍报）", () => {
    const r = retIssues(`
${CLAMP_CONTRACT}
function clamp100(n) {
  return Math.max(0, Math.min(100, n));
}
`);
    // 可能 NaN → NaN | [0,100]；percent 不含 NaN → 至少一条
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.severity).toBe("error");
  });

  it("clamp100 + isNaN 守卫：假臂非 NaN → 区间 [0,100] 可证", () => {
    const r = retIssues(`
${CLAMP_CONTRACT}
function clamp100(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
`);
    expect(r).toEqual([]);
  });

  it("clamp100 + Math.round + isNaN 守卫可证", () => {
    const r = retIssues(`
${CLAMP_CONTRACT}
function clamp100(n) {
  if (Number.isNaN(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}
`);
    expect(r).toEqual([]);
  });

  it("纯区间：min(100, n) 对 max100 可证（无 NaN 义务）", () => {
    // max100 = number().le(100)——n 可能 NaN 时仍有 NaN 臂；
    // 用 ge(0).le(100) 的 percent 会要求排除 NaN。
    // 这里用带界的 n：n≥0 时 min(100,n) 非 NaN（界排除 NaN）且 ≤100
    const r = retIssues(`
/**
 * @nudo:contract n nonNeg
 * @nudo:contract return max100
 */
function cap(n) {
  return Math.min(100, n);
}
`);
    expect(r).toEqual([]);
  });

  it("max(0, x) 在 x≥0 下蕴含 nonNeg", () => {
    const r = retIssues(`
/**
 * @nudo:contract x nonNeg
 * @nudo:contract return nonNeg
 */
function keep(x) {
  return Math.max(0, x);
}
`);
    expect(r).toEqual([]);
  });
});

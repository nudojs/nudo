/**
 * ABS-08：自动循环不变量候选（阶段一：只观测，不参与证明）。
 *
 * 纪律（计划 §ABS-08 风险段）：自动推断先只开 info；候选**不进**证明前提，
 * 所以不可能造成假绿。本套钉住：
 * - 宽化确实发生的循环携带标量给出「观测界」候选（info，来源标记 inferred）；
 * - 候选不改变任何证明结论（与候选上界一致的返回契约仍证不出 = warning）；
 * - 用户 `@nudo:invariant` 覆盖同名候选（不重复提示，且归因走 relied）；
 * - 未发生宽化的循环不产候选（无噪音）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";
import { DIAG } from "../diagnostics/diag-codes.ts";

const STD = `export const le8 = number().le(8);\nexport const num = number();`;

function run(source: string) {
  const { loadModule } = makeFiles({ "/t/abs08.nudo.js": STD });
  return checkSource("/t/abs08.js", source, pTrue, {
    loadModule,
    fromFile: "/t/abs08.js",
    entryThrows: "off",
  });
}

const wideningLoop = `
export function count(n) {
  let s = 0;
  let i = 0;
  while (s < n) { s = s + 1; i = i + 1; }
  return s + i;
}
`;

describe("ABS-08 自动循环不变量候选", () => {
  it("宽化循环给出观测界候选（info；明确「不是已证不变量」）", () => {
    const r = run(wideningLoop);
    const inferred = r.issues.filter((i) => i.code === DIAG.invariantInferred);
    expect(inferred.length).toBeGreaterThan(0);
    for (const i of inferred) {
      expect(i.severity).toBe("info");
      expect(i.message).toContain("observed");
      expect(i.message).toContain("NOT a proved invariant");
      expect(i.suggestion).toContain("never participate in proofs");
    }
    // 至少 s 的下界被观测到（s 从 0 起）
    expect(inferred.some((i) => i.actual === "s >= 0")).toBe(true);
  });

  it("候选不参与证明：与观测上界一致的返回契约仍证不出（no false green）", () => {
    const r = run(`
/// @nudo:import { le8 } from "./abs08.nudo.js"
/**
 * @nudo:contract return le8
 */
export function count(n) {
  let s = 0;
  while (s < n) { s = s + 1; }
  return s;
}
`);
    // 观测界候选存在（s <= 8）但不得把 return ⊨ le8 证成 proved
    expect(r.issues.some((i) => i.code === DIAG.invariantInferred)).toBe(true);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    expect(r.issues.some((i) => i.code === DIAG.invariantRelied)).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("用户 @nudo:invariant 覆盖同名候选（不重复提示；用户声明才进 relied）", () => {
    const r = run(`
/**
 * @nudo:invariant s >= 0
 */
export function count(n) {
  let s = 0;
  while (s < n) { s = s + 1; }
  return n;
}
`);
    const inferred = r.issues.filter((i) => i.code === DIAG.invariantInferred);
    expect(inferred.some((i) => i.actual?.startsWith("s "))).toBe(false);
    // 用户声明合法（无 invalid）
    expect(r.issues.some((i) => i.code === DIAG.invariantInvalid)).toBe(false);
    // s 的候选被覆盖；其它绑定（若被宽化）仍可出现
    for (const i of inferred) expect(i.actual?.startsWith("s ") ?? false).toBe(false);
  });

  it("未宽化的循环不产候选（无噪音）", () => {
    const r = run(`
export function small() {
  let s = 0;
  for (let i = 0; i < 3; i++) { s = s + i; }
  return s;
}
`);
    expect(r.issues.some((i) => i.code === DIAG.invariantInferred)).toBe(false);
  });
});

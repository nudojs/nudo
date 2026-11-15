/**
 * Bug 1004 回归：strict 端点的 **1 ULP 离散性放松只做一次**。
 *
 * 根因（实测，与报告的「两次放松叠加」说法有出入——见下）：
 * 端点合成（`arithmetic/shared.ts`）已把 `x > 0 ⇒ x + 1` 的事实写成
 * `gt(x + 1, nextDown(1))`（=「语义等价但语法更弱」的写法，`0.9999999999999999`
 * 与 1 之间没有别的 double ⇒ 该事实**等价于** `x + 1 >= 1`）。这条**和**的
 * 事实被线性化到原子 `x` 时（`pred.ts` 的 `applyCmp`）丢掉格点步进
 * （只得到 `x > -2^-53`），再线性化回来时区间层又做了一次 `nextDown` 放松
 * ⇒ 事实退到 `x + 1 > 0.9999999999999998`（比义务宽 2 ULP）⇒
 * `ge(x + 1, 1)` 证不出 ⇒ `nudo:constraint-violated` **假红**。
 *
 * 为什么不能靠「去掉区间层的第二次放松」来补（实测）：
 * 区间层 `linInterval` 的 `nextDown` 放松是**保真**所需——`x>0 ∧ y>=1 ⊬ x+y>1`
 * （`fl(MIN + 1) === 1` ⇒ 和可以恰好取到端点 ⇒ 严格断言不成立）这条既有钉
 * 就靠它才不假证；去掉 ⇒ 引擎把 `x + y > 1` 证成真（**假证**）。
 * ⇒ 正确落点是**谓词层**：事实与义务**同一个项**时，事实端点已带 IEEE 离散
 * 信息（`t > L` ⟺ `t >= nextUp(L)`；`t >= L` ⟺ `t >= L` 不步进）⇒ 直接比端点。
 */
import { describe, it, expect } from "vitest";
import { and, ge, gt, implies, lt, pTrue } from "../pred.ts";
import { app, lit, v } from "../term.ts";
import { checkSource } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";

const x = v("x");
const y = v("y");
/** 被求和的项（`x + 1`） */
const sum = app("+", [x, lit(1)]);

describe("Bug 1004：strict 端点的 1 ULP 离散性放松只做一次（同项格点步进）", () => {
  it("同项事实 `x+1 > nextDown(1)` ⇒ 义务 `x+1 >= 1`（IEEE 下恒真）", () => {
    expect(implies(gt(sum, lit(0.9999999999999999)), ge(sum, lit(1)))).toBe(true);
  });

  it("同项事实 ⇒ 更弱的义务同样成立（ge / gt nextDown(1)）", () => {
    expect(implies(gt(sum, lit(0.9999999999999999)), ge(sum, lit(0.9999999999999999)))).toBe(
      true,
    );
    expect(implies(gt(sum, lit(0.9999999999999999)), gt(sum, lit(0.9999999999999999)))).toBe(
      true,
    );
  });

  it("反向不成立：`x+1 > nextDown(1)` ⇏ `x+1 > 1`（严格差一格不够）", () => {
    expect(implies(gt(sum, lit(0.9999999999999999)), gt(sum, lit(1)))).toBe(false);
  });

  it("严格事实才步进一格：非严格事实 `x+1 >= nextDown(1)` ⇏ `x+1 >= 1`", () => {
    // `x + 1 >= 0.9999999999999999` 允许 x + 1 恰好 = 0.9999999999999999 ⇒ 不蕴含 >= 1
    expect(implies(ge(sum, lit(0.9999999999999999)), ge(sum, lit(1)))).toBe(false);
  });

  it("保真控制：吸收型累加仍证不出 `x+y > 1`（fl(MIN + 1) === 1）", () => {
    const phi = and(gt(x, lit(0)), ge(y, lit(1)));
    expect(implies(phi, gt(app("+", [x, y]), lit(1)))).toBe(false);
  });

  it("保真控制：同项格点步进不越界（`x >= 5` ⇏ `x > 5`）", () => {
    expect(implies(ge(x, lit(5)), gt(x, lit(5)))).toBe(false);
    expect(implies(ge(x, lit(5)), lt(x, lit(5)))).toBe(false);
  });

  it("产品面：侧车契约 `return number().ge(1)` 不再假红（nudo:constraint-violated）", () => {
    const impl = `export function f(x) { return x + 1; }`;
    const sidecar = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number().ge(1));
`;
    const files = { "/t/bug-1004.nudo.js": sidecar };
    const r = checkSource("/t/bug-1004.js", impl, pTrue, {
      ...makeFiles(files),
      fromFile: "/t/bug-1004.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });

  it("产品面控制组：真违约仍报（`x >= 0` ⇒ `x + 1 >= 2` 不成立）", () => {
    const impl = `export function f(x) { return x + 1; }`;
    const sidecar = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().ge(0) }, number().ge(2));
`;
    const files = { "/t/bug-1004-ctl.nudo.js": sidecar };
    const r = checkSource("/t/bug-1004-ctl.js", impl, pTrue, {
      ...makeFiles(files),
      fromFile: "/t/bug-1004-ctl.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(1);
  });
});

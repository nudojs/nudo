/**
 * `shape()` **形参**契约的访问器读法：对象字面量 getter 的槽是
 * `$lit(void 0)` 占位（真 getter 住 accessorTable）⇒ 按原始槽表证明会把
 * getter 实参读成占位 `undefined`（假红），与返回值契约面 / 函数体读面 /
 * 签名面互相矛盾。
 *
 * 修法同 accessors.ts 的不变量：**投影通道先经 `accessorReadDomain` 取读域**，
 * 与 postcondition.ts 的返回位读法（`accessorReadDomain(ret, key) ?? slot.value`）
 * 同一读域函数。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check/check.ts";
import { makeFiles } from "./nudo-constraints.ts";
import type { CheckIssue } from "../check/check-report.ts";

const SIDECAR = `import { fn, number, shape } from "@nudojs/core";
export const num = fn({ o: shape({ a: number() }) }, number());
`;

const DECLS = `export function num(o) { return o.a; }\n`;

/** 跑一次调用点扫描，返回形参契约（constraint-violated）诊断 */
function paramViolations(calls: string): CheckIssue[] {
  const { loadModule } = makeFiles({ "/t/get.nudo.js": SIDECAR });
  const report = checkSource("/t/get.js", `${DECLS}${calls}\n`, pTrue, {
    loadModule,
    fromFile: "/t/get.js",
  });
  return report.issues.filter((i) => i.code === "nudo:constraint-violated");
}

beforeEach(() => {
  resetCheckSourceMemo();
});

describe("shape() 形参契约的访问器读域", () => {
  it("BUG-203 对象字面量 getter 实参：合法值不再报 constraint-violated（改前 actual: undefined 假红）；违例时 diagnostic 的 actual 是 getter 读域（改前 undefined）而不是占位槽", () => {
    // 缺陷组 1：getter 返回合法值 ⇒ 零违例（改前 1 条 actual: undefined）
    expect(paramViolations(`export function ok() { return num({ get a() { return 1; } }); }`)).toEqual(
      [],
    );
    // 缺陷组 2：getter 返回 "s" ⇒ 恰好 1 条，且 actual 报真值（改前 undefined）
    const bad = paramViolations(`export function bad() { return num({ get a() { return "s"; } }); }`);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.actual).toContain('"s"');
    expect(bad[0]!.expected).toContain("number");
  });

  it("BUG-203 同口径对照：数据槽实参 / 类 getter 实参保持零违例，违例的只该是 getter 读域本身", () => {
    expect(paramViolations(`export function plain() { return num({ a: 1 }); }`)).toEqual([]);
    expect(
      paramViolations(
        `export function cls() { class C { get a() { return 1; } } return num(new C()); }`,
      ),
    ).toEqual([]);
    expect(paramViolations(`export function plainBad() { return num({ a: "s" }); }`)).toHaveLength(1);
  });

  it("BUG-203 Object.defineProperty 安装的 getter 实参：静态走查重放安装语句，合法值零违例、违例 actual 是 getter 读域（改前 actual: {} / missing field）", () => {
    // 改前：函数体内调用点只走静态走查，绑定仍是安装前的 `{}` ⇒
    // `missing field o.a` 假红（同一函数体求值面读 getter 得 1）。
    expect(
      paramViolations(
        `export function dp() { const o = {}; Object.defineProperty(o, "a", { get() { return 1; }, enumerable: true }); return num(o); }`,
      ),
    ).toEqual([]);
    const bad = paramViolations(
      `export function dpBad() { const o = {}; Object.defineProperty(o, "a", { get() { return "s"; }, enumerable: true }); return num(o); }`,
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]!.actual).toContain('"s"');
    expect(bad[0]!.expected).toContain("number");
  });
});

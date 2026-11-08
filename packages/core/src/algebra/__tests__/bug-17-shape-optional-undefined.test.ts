/**
 * 分册 03 · Bug 17 —— `shape(...).optional()` 的**契约级可选位**未进谓词 ⇒
 * 契约明确允许的 `undefined` 被判 L1 假红（dts 写 `x?`、guard 接受
 * undefined、check 签名写 `{…} | undefined`，唯独 check 报 error）。
 *
 * 根因：`instantiateConstraint` 的 shape 分支提前 return，未消费
 * `c.isOptional`；`scan/literal-shapes.ts` 的 `checkShapeAgainstAbs` 对
 * nullish 实参（unknown 形状 + lit term）直接判「object shape at x」。
 *
 * 修法：shape 分支同款 `optionalizePred`；结构通道对契约级可选位 + 显式
 * undefined 放行（只放行 undefined，`.optional()` 不接纳 null）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, instantiateConstraint, number, pTrue, shape } from "../index.ts";
import { predToString } from "../pred.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDE = `import { number, shape } from "@nudojs/core";
export const shp = shape({ a: number().gt(0) }).optional();
`;
const IMP = `/// @nudo:import { shp } from "./std17.nudo.js"\n`;
const FILE = "/t/bug17.js";

const DECL = `${IMP}/** @nudo:contract x shp */
export function f(x) { return x; }
`;

function check(body: string) {
  return checkSource(FILE, DECL + body, pTrue, sidecarOpts("std17", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string; expected?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 17 · shape().optional() 的 undefined 臂在调用点生效", () => {
  it("实例化谓词含 undefined 臂（shape 分支不再提前 return）", () => {
    const text = predToString(instantiateConstraint(shape({ a: number().gt(0) }).optional(), "x"));
    expect(text).toContain("x = undefined");
    expect(text).toContain("x.a > 0");
  });

  it("显式 f(undefined) ⇒ 零违例（改前报 object shape at x）", () => {
    const r = check(`export function undefinedArg() { return f(undefined); }`);
    expect(violations(r)).toHaveLength(0);
    expect(r.issues.some((i) => (i.expected ?? "").includes("object shape"))).toBe(false);
  });

  it("合法对象 f({ a: 1 }) ⇒ 零违例", () => {
    expect(violations(check(`export function ok() { return f({ a: 1 }); }`))).toHaveLength(0);
  });

  it("省略该位 f() ⇒ 零违例（元数检查已放行）", () => {
    expect(violations(check(`export function omitted() { return f(); }`))).toHaveLength(0);
  });

  it("真违例 f({ a: 0 }) ⇒ 报 x.a > 0", () => {
    const v = violations(check(`export function bad() { return f({ a: 0 }); }`));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toBe("x.a > 0");
  });

  it("负控制：显式 null 仍不被 .optional() 接纳", () => {
    expect(violations(check(`export function nullArg() { return f(null); }`)).length).toBeGreaterThan(0);
  });
});

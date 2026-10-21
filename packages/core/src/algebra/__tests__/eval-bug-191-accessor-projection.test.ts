/**
 * Bug 191（对象字面量访问器的**投影面**把 getter 占位槽渲染成 exact `undefined`）。
 *
 * 背景：访问器不住在 shape 槽里——transpile 只落一个 `$lit(void 0)` 占位槽
 * （保键存在性），真 getter 住 accessorTable 侧表。**读**通道（$get）先查
 * 侧表 ⇒ `o.ab` 读得对；但**投影通道**（formatShape / denoteGuard /
 * absToConstraint / 契约证明）直读占位槽 ⇒ 任何带 getter 的对象字面量，
 * 其投影一律把该属性渲染成 exact `undefined`（一个自信的错值：比真值更窄
 * 且自相矛盾——`{ab: 1}` 被声明成 `{ab: undefined}`）。
 *
 * 修法：投影侧统一经 accessorReadDomain（accessors.ts）取 getter 读域；
 * getter 抛（读域不可刻画）→ unknown（sound 超近似，不得回落 definite
 * undefined）；无 getter（数据槽 / 仅 setter）→ 用槽值。
 *
 * 本文件的断言与 Node 真实执行结果对齐（原生读值见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { formatShape, formatAbs } from "../format.ts";
import { denoteGuard } from "../denote.ts";
import { absToConstraint } from "../projection.ts";
import { checkSource, pTrue } from "../index.ts";
import { call } from "./eval-helpers.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
import type { Abs } from "../abs.ts";

/** 取对象的投影串（签名面 / dts / zod / guard 的同源渲染） */
function shapeOf(src: string, fn = "f"): string {
  return formatShape(call(src, fn).result);
}

/** 取对象的守卫串（`nudo export --format guard` 的同源渲染） */
function guardOf(src: string, fn = "f"): string {
  return denoteGuard(call(src, fn).result, "data");
}

/** 契约投影里字段的 eq-lit 值（absToConstraint → zod / standard 面的同源） */
function fieldLit(a: Abs, field: string): unknown {
  const c = absToConstraint(a);
  const fc = c?.fields?.[field]?.constraint;
  const eq = fc?.preds.find((p) => p.op === "eq");
  if (!eq || eq.op !== "eq") return undefined;
  return eq.b.op === "lit" ? eq.b.value : undefined;
}

describe("Bug 191: 访问器占位槽不得投影成 exact undefined", () => {
  it("getter 槽投影成读域值（原生读 1），不是 exact undefined", () => {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    expect(shapeOf(src)).toBe("{ ab: 1 }");
  });

  it("formatAbs（无损面）的 shape 段同口径", () => {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    const r = call(src, "f").result;
    expect(formatAbs(r)).toContain("{ ab: 1 }");
    expect(formatAbs(r)).not.toContain("ab: undefined");
  });

  it("getter 槽投影成字符串读域（原生读 \"s\"）", () => {
    const src = `export function f() { return { get ab() { return "s"; } }; }`;
    expect(shapeOf(src)).toBe('{ ab: "s" }');
  });

  it("getter 以 this 为接收者读域（原生 this.n = 41）", () => {
    const src = `export function f() { return { n: 41, get q() { return this.n; } }; }`;
    expect(shapeOf(src)).toBe("{ n: 41, q: 41 }");
  });

  it("嵌套对象的 getter 槽同样按读域投影", () => {
    const src = `export function f() { return { inner: { get ab() { return 2; } } }; }`;
    expect(shapeOf(src)).toBe("{ inner: { ab: 2 } }");
  });

  it("getter + 数据属性同对象：各按各自读域投影", () => {
    const src = `export function f() { return { get ab() { return true; }, plain: 7 }; }`;
    expect(shapeOf(src)).toBe("{ ab: true, plain: 7 }");
  });

  it("守卫面按 getter 读域判定（原生读 data.ab 得 1）", () => {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    expect(guardOf(src)).toBe(
      'typeof data === "object" && data !== null && data.ab === 1',
    );
  });

  it("契约投影（zod / standard 面的同源）取 getter 读域", () => {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    expect(fieldLit(call(src, "f").result, "ab")).toBe(1);
  });

  it("契约门禁：getter 返回值满足 shape 契约（改前假红）", () => {
    const accNudo = `
import { number, shape } from "@nudojs/core";
export const numShape = shape({ ab: number() });
`;
    const src = `
/// @nudo:import { numShape } from "./acc.nudo.js"
/// @nudo:contract return numShape
export function f() { return { get ab() { return 1; } }; }
`;
    const r = checkSource(
      "/t/acc.js",
      src,
      pTrue,
      sidecarOpts("acc.nudo.js", accNudo),
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("Bug 191 负控制：非 getter 槽不受影响", () => {
  it("普通数据属性仍渲染成它的值类型", () => {
    const src = `export function f() { return { plain: 5 }; }`;
    expect(shapeOf(src)).toBe("{ plain: 5 }");
    expect(guardOf(src)).toBe(
      'typeof data === "object" && data !== null && data.plain === 5',
    );
  });

  it("显式 undefined 数据属性仍渲染成 undefined", () => {
    const src = `export function f() { return { u: undefined }; }`;
    expect(shapeOf(src)).toBe("{ u: undefined }");
  });

  it("仅 setter 的访问器：原生读值恒 undefined，占位槽本就正确", () => {
    const src = `export function f() { return { set ab(v) {} }; }`;
    expect(shapeOf(src)).toBe("{ ab: undefined }");
    expect(guardOf(src)).toBe(
      'typeof data === "object" && data !== null && data.ab === undefined',
    );
  });

  it("getter 抛（读域不可刻画）→ unknown，不得回落 definite undefined", () => {
    const src = `export function f() { return { get boom() { throw new Error("x"); } }; }`;
    expect(shapeOf(src)).toBe("{ boom: unknown }");
  });

  it("无访问器的对象不受影响（空对象）", () => {
    const src = `export function f() { return {}; }`;
    expect(shapeOf(src)).toBe("{  }");
  });
});

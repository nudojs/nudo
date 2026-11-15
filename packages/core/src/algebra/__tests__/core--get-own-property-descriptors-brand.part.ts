/**
 * Bug 281 — `Object.getOwnPropertyDescriptors`（**复数**）没有 `brand` 分支
 * ⇒ 类实例 / 内建 brand 一路落「键集不可判 → 开放 obj」兜底（**零槽**）⇒
 * `Object.keys(gOPDs(x))` 折 **exact 空元组**（自信的确切错值），而同一引擎
 * 的 `gOPN`（exact 键集）与 `gOPD(单数)`（exact 描述符）都说键在 ⇒ 三面互斥。
 *
 * 修法：① 补 `brand` 分支——键源与 gOPN 面同口径（内层闭 obj 槽表剔除
 * `internal` / `inherited`，并上 `builtinBrandOwnKeyNames` 的已知自有键；
 * TA 走 typedArrayEnumKeyView），逐键产出描述符；② 兜底开放对象打
 * `@@nudoKeySetOpen` 标记（`markKeySetOpenAbs`）⇒ 键家族折诚实 partial，
 * 而不是 exact 空元组。
 *
 * 严格单变量对照：唯一变量 = 接收者的 kind（普通对象 / 数组为绿灯对照组，
 * 类实例 / Error brand / Map brand 为缺陷组）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue, type Abs } from "../abs.ts";

const PRELUDE = `
class C { constructor() { this.x = 1; this.y = 2; } }
`;

function absOf(body: string): Abs {
  return call(`${PRELUDE}\nexport function f() { ${body} }`, "f").result;
}

function tupleLits(a: Abs): unknown[] | undefined {
  if (a.shape.k !== "tuple") return undefined;
  const out = a.shape.elements.map((e) => {
    const v = litValue(e);
    return v.ok ? v.value : undefined;
  });
  return out.some((v) => v === undefined) ? undefined : out;
}

describe("Bug 281 · 复数 gOPDs 必须有 brand 分支（键集与 gOPN 同口径）", () => {
  it("类实例：描述符映射的键集 = 自有键集（改前 []）", () => {
    expect(tupleLits(absOf("const inst = new C(); return Object.keys(Object.getOwnPropertyDescriptors(inst));"))).toEqual([
      "x",
      "y",
    ]);
  });

  it("类实例：键集与 gOPN / gOPD(单数) 三面一致（引擎内部不再互斥）", () => {
    expect(
      tupleLits(
        absOf("const inst = new C(); return Object.keys(Object.getOwnPropertyDescriptors(inst));"),
      ),
    ).toEqual(["x", "y"]);
    expect(tupleLits(absOf("const inst = new C(); return Object.getOwnPropertyNames(inst);"))).toEqual([
      "x",
      "y",
    ]);
    expect(
      tupleLits(
        absOf(`
  const inst = new C();
  const one = Object.getOwnPropertyDescriptor(inst, "x");
  return [one.value, one.enumerable];
`),
      ),
    ).toEqual([1, true]);
  });

  it("描述符内容精确：类字段是 writable/enumerable/configurable 全真的数据属性", () => {
    expect(
      tupleLits(
        absOf(`
  const inst = new C();
  const d = Object.getOwnPropertyDescriptors(inst).x;
  return [d.value, d.writable, d.enumerable, d.configurable];
`),
      ),
    ).toEqual([1, true, true, true]);
  });

  it("内建 brand（Error 家族）：键集 = 自有键集（stack/message，name 是原型链槽）", () => {
    expect(
      tupleLits(
        absOf('const e = new TypeError("boom"); return Object.keys(Object.getOwnPropertyDescriptors(e));'),
      ),
    ).toEqual(["stack", "message"]);
  });

  it("内建 brand（Map + m.foo）：键集 = 用户新增自有键", () => {
    expect(
      tupleLits(
        absOf("const m = new Map(); m.foo = 1; return Object.keys(Object.getOwnPropertyDescriptors(m));"),
      ),
    ).toEqual(["foo"]);
  });

  it("单变量对照组 A：普通对象（引擎 == 宿主）", () => {
    expect(tupleLits(absOf("return Object.keys(Object.getOwnPropertyDescriptors({ x: 1, y: 2 }));"))).toEqual([
      "x",
      "y",
    ]);
  });

  it("单变量对照组 B：数组（索引 + length）", () => {
    expect(tupleLits(absOf("return Object.keys(Object.getOwnPropertyDescriptors([1, 2]));"))).toEqual([
      "0",
      "1",
      "length",
    ]);
  });

  it("单变量对照组 C：不可枚举自有键在描述符映射里照列（gOPDs 是全部自有键）", () => {
    expect(
      tupleLits(
        absOf(`
  const inst = new C();
  Object.defineProperty(inst, "x", { enumerable: false });
  return Object.keys(Object.getOwnPropertyDescriptors(inst));
`),
      ),
    ).toEqual(["x", "y"]);
  });

  it("兜底路径诚实降级：键集不可判时不折 exact 空元组", () => {
    // 函数接收者：gOPDs 没有品牌槽表可投影 ⇒ 结果对象必须带「键集不完备」
    // 标记 ⇒ Object.keys 折 partial string[]（改前折 exact []）
    const a = absOf("return Object.keys(Object.getOwnPropertyDescriptors(() => 1));");
    expect(a.shape.k).toBe("arr");
    expect((a.shape as { element: Abs }).element.shape).toMatchObject({ k: "prim", type: "string" });
  });
});

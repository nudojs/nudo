/**
 * 模块套件：对象/原型/Proxy/Reflect/属性描述符面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { abs, numLit, type Abs, litValue } from "../abs.ts";
import { isHiddenInternalSlot } from "../contract/slot-visibility.ts";
import { formatShape } from "../format/format.ts";
import { denoteGuard } from "../denote.ts";
import { call, val, throwsError, tupleEls, effects, isNever } from "./eval-helpers.ts";
import { arrayProtoMemberForKey, ARRAY_ITERATOR_SLOT_KEY, OBJECT_PROTO_NAMES } from "../exec/member-diag.ts";
import { shape, number, partial, omit, pick, formatConstraint, checkSource, pTrue, abs as makeAbs, num, absToConstraint, serializeCheckJson, formatCheckReport } from "../index.ts";
import { resetCheckSourceMemo } from "../check/check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeContractDiags } from "../contract/contract.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles, issuesOf, l2Count, sigOf } from "./nudo-constraints.ts";
import { BOXED_PRIMITIVE_SLOT, makeBoxedAbs } from "../builtins/error/boxed.ts";
import { $lit } from "../exec/runtime/state.ts";
import type { Slot } from "../objects.ts";
import { OBJECT_PROTO_METHOD_NAMES } from "../builtins/ctor.ts";
import { litValue as litValue___nudojs_core, checkSource as checkSource___nudojs_core, pTrue as pTrue___nudojs_core } from "@nudojs/core";
import { constraintToEntryAbs, instantiateConstraint, number as number_____constraint_ts, pick as pick_____constraint_ts, shape as shape_____constraint_ts } from "../constraint.ts";
import { formatObjectKey } from "../format/codegen-escape.ts";

// ---------------------------------------------------------------------------
// core 槽可见性 symbolKey 规则
// ---------------------------------------------------------------------------
describe("core 槽可见性 symbolKey 规则", () => {
/**
 * 回归（core 面）：`isHiddenInternalSlot` 缺 `symbolKey` 规则
 * ⇒ check / test 签名面把符号键槽发布成运行时不存在的字符串字段
 * （`"@@iterator"` / `"@@sym#1"`），guard 面还写出恒假的 Object.hasOwn 子句。
 *
 * 修法：core 判据补 `if (slot.symbolKey === true) return true`（与 service
 * 侧 internal-slot.ts 的 同款），使 format（展示/签名）、projection
 * （约束）、denote（guard）三个消费点同口径剔除。
 */






/** `const o = { a: 1, [Symbol.iterator]: 2 }; return o;` 的引擎建模 */
const withSymbolSlot = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        a: { value: numLit(1) },
        "@@iterator": { value: numLit(2), symbolKey: true },
      },
    },
    undefined,
    undefined,
    "exact",
  );


  it("isHiddenInternalSlot 剔除 symbolKey 槽（与 service 副本同款）；internal 规则与规范数组下标例外保持不变；formatShape（check / test 签名面）不发布符号键槽；denoteGuard（guard 面）不写恒假的 Object.hasOwn(@@iterator) 子句", () => {
  {
    expect(isHiddenInternalSlot("@@iterator", { symbolKey: true })).toBe(true);
    expect(isHiddenInternalSlot("@@sym#1", { symbolKey: true })).toBe(true);
    expect(isHiddenInternalSlot("a", { symbolKey: false })).toBe(false);
    expect(isHiddenInternalSlot("a", {})).toBe(false);
  }
  {
    expect(isHiddenInternalSlot("next", { internal: true })).toBe(true);
    expect(isHiddenInternalSlot("0", { internal: true })).toBe(false);
    // symbol 键不分数组下标例外——一律不可见
    expect(isHiddenInternalSlot("0", { internal: true, symbolKey: true })).toBe(true);
  }
  {
    const s = formatShape(withSymbolSlot(), { showLits: true });
    expect(s).toContain("a");
    expect(s).not.toContain("@@iterator");
  }
  {
    const g = denoteGuard(withSymbolSlot(), "data");
    expect(g).not.toContain("@@iterator");
    expect(g).toContain("data.a");
  }
});




});

// ---------------------------------------------------------------------------
// 符号键与字符串 "@@iterator" 分态
// ---------------------------------------------------------------------------
describe("符号键与字符串 \"@@iterator\" 分态", () => {
/**
 * 回归：`ARRAY_PROTO_METHOD_NAMES` 把 "@@iterator" 当**普通字符串键**
 * ⇒ `[1,2]["@@iterator"]` 折成函数、`"@@iterator" in [1,2]` 折成 true
 * （原生 undefined / false），而 `Symbol.iterator in [1,2]` 必须仍为 true。
 *
 * 修法：查表点按 symbolKey 信号分态——`$in` 用 symSlotKey、`$get` 用
 * opts.symbolKey。字符串键 "@@iterator" 与符号键 Symbol.iterator 是两个
 * 不同的 PropertyKey，不得合并成同一个事实。
 *
 * 原生 ground truth：
 * [1,2]["@@iterator"] === undefined / typeof === "undefined"
 * "@@iterator" in [1,2] === false / Symbol.iterator in [1,2] === true
 */





function v(src: string) {
  return litValue(call(src, "f").result);
}


  it("字符串键 \"@@iterator\" 在 tuple 上确定缺席（改前折成函数）；\"@@iterator\" in [1,2] → false（改前是自信的 true）；Symbol.iterator in [1,2] → true（符号键保持命中，既有钉不回归）；普通对象面本就正确，不回归；Array.prototype 普通字符串键方法不受影响；调用面同样分态：字符串键 \"@@iterator\"() 不产迭代器、Symbol.iterator() 产迭代器；brand 面同样", () => {
  {
    expect(v(`export function f() { return [1,2]["@@iterator"]; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(v(`export function f() { return typeof [1,2]["@@iterator"]; }`)).toEqual({
      ok: true,
      value: "undefined",
    });
  }
  {
    expect(v(`export function f() { return "@@iterator" in [1,2]; }`)).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(`export function f() { return Symbol.iterator in [1,2]; }`)).toEqual({
      ok: true,
      value: true,
    });
    // eval-proxy-symbol-key.test.ts 的同款钉：符号键读仍是迭代器函数
    expect(v(`export function f() { return typeof [1,2][Symbol.iterator]; }`)).toEqual({
      ok: true,
      value: "function",
    });
  }
  {
    expect(v(`export function f() { const o = { k: 1 }; return o["@@iterator"]; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(v(`export function f() { return "@@iterator" in { k: 1 }; }`)).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(v(`export function f() { return typeof [1,2].map; }`)).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(`export function f() { return "map" in [1,2]; }`)).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    // `$invokeKey` 把运行时键折成 "@@iterator" 槽名后，必须把**键身份**
    // 一并透传到 $get：字符串键 "@@iterator" 不是 Symbol.iterator，原生
    // `[1,2]["@@iterator"]()` 定抛 TypeError。此前调用面把两者合并 ⇒
    // 字符串键也能拿到迭代器面（ 的符号键调用则反过来全塌）。
    expect(v(`export function f() { return [1,2]["@@iterator"]().next().value; }`)).toEqual({
      ok: false,
    });
    expect(
      v(`export function f() { const k = "@@iterator"; return [1,2][k]().next().value; }`),
    ).toEqual({ ok: false });
    expect(v(`export function f() { return [1,2][Symbol.iterator]().next().value; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(
      v(`export function f() { return new Map([["a",1]])[Symbol.iterator]().next().value[0]; }`),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(v(`export function f() { return new Map()["@@iterator"]; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(v(`export function f() { return typeof new Map()[Symbol.iterator]; }`)).toEqual({
      ok: true,
      value: "function",
    });
  }
  {
    expect(arrayProtoMemberForKey(ARRAY_ITERATOR_SLOT_KEY, false)).toBe(false);
    expect(arrayProtoMemberForKey(ARRAY_ITERATOR_SLOT_KEY, true)).toBe(true);
    expect(arrayProtoMemberForKey("map", false)).toBe(true);
    expect(arrayProtoMemberForKey("map", true)).toBe(true);
    expect(arrayProtoMemberForKey("zzz", false)).toBe(false);
  }
});








});

// ---------------------------------------------------------------------------
// number / boolean 原型方法走自己的原型面
// ---------------------------------------------------------------------------
describe("number / boolean 原型方法走自己的原型面", () => {
/**
 * 回归：`number` / `boolean` 原型方法不得落 `Object.prototype` 泛型版。
 *
 * 根因（`packages/core/src/algebra/exec/runtime/containers/member.ts`
 * `getProtoMethodMember` 的 prim 通道例外清单）：`toString` / `toLocaleString`
 * / `valueOf` 三者都在 `OBJECT_PROTO_METHOD_NAMES` 里，prim 通道必须**显式**
 * 例外才能进；例外清单此前只列了 string（）、bigint（）、
 * symbol（独立臂，member.ts 的 `symbolProtoMethodAbs`）⇒ **number / boolean
 * 从未被加入** ⇒ 落 `objectProtoMethodAbs(key)` ⇒
 * - **错值**：`[object Number]` / `[object Boolean]`（原生是 "5" / "true"）；
 * - **丢 brand check**：`(5).toString.call("x")` 原生定抛 TypeError，引擎
 * 照常返回值 ⇒ L2 `nudo:entry-may-throw` 闸门**假绿**。
 *
 * 修法：prim 通道例外补 number（toString / toLocaleString / valueOf）与
 * boolean（toString / valueOf）；`PRIM_HOME_BRAND`（number→Number /
 * boolean→Boolean）已就位 ⇒ 借用调用的 brand check 生效。
 */



/** litValue 结果解包（ok 时取字面量值） */
const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

const wrap = (body: string): string => `export function f() { ${body} }`;


  it("(5).toString.call(5) ⇒ \"5\"（不是 \"[object Number]\"）；true.toString.call(true) ⇒ \"true\"（不是 \"[object Boolean]\"）；(5).toString.call(\"x\") ⇒ 定抛 TypeError（brand check）；(5).toString.call(5n) ⇒ 定抛 TypeError（brand check）；(5).toString.call(true) ⇒ 定抛 Type", () => {
  {
    expect(lit(wrap("return (5).toString.call(5);"))).toBe("5");
  }
  {
    expect(lit(wrap("return true.toString.call(true);"))).toBe("true");
  }
  {
    const rec = call(wrap("return (5).toString.call(\"x\");"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(wrap("return (5).toString.call(5n);"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(wrap("return (5).toString.call(true);"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(wrap("return true.toString.call(0);"));
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(lit(wrap("return (5).valueOf.call(5);"))).toBe(5);
  }
  {
    expect(lit(wrap("return true.valueOf.call(true);"))).toBe(true);
  }
  {
    expect(lit(wrap("return \"a\".toString.call(\"a\");"))).toBe("a");
    expect(lit(wrap("return (5n).toString.call(5n);"))).toBe("5");
    expect(lit(wrap("return Symbol(\"x\").toString.call(Symbol(\"x\"));"))).toBe("Symbol(x)");
  }
});









});

// ---------------------------------------------------------------------------
// 函数 / 类接收者的 getOwnPropertyDescriptor（不再定抛）
// ---------------------------------------------------------------------------
describe("函数 / 类接收者的 getOwnPropertyDescriptor（不再定抛）", () => {
/**
 * 回归：`Object/Reflect.getOwnPropertyDescriptor(fn, key)` 不得被建模成
 * 「必定抛」。
 *
 * 根因：`packages/core/src/algebra/builtins/object/methods.ts` 的
 * `case "getOwnPropertyDescriptor"` 有 obj / tuple / string / prim / brand 接收者
 * 臂，但**没有 `fn` 形态接收者臂** ⇒ 函数接收者一路落兜底 `maybeDesc()`
 * （descriptor | undefined 并集）⇒ 再读 `.value` / `.writable` 就成**定抛
 * TypeError** ⇒ 整条表达式折 `never`（假 TypeError——引擎比原生更悲观）。
 * `Reflect.getOwnPropertyDescriptor`（`builtins/reflect.ts`）共用同一 helper，
 * 同样受影响。
 *
 * 修法：为 `fn` 形态接收者补一条描述符臂（`name` / `length` / `prototype` 是
 * 函数**自有属性**，原生恒有描述符 ⇒ 折精确描述符而非并集）。
 */



const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};

const wrap = (body: string): string => `export function f() { ${body} }`;


  it("gOPD(function f(){}, \"length\").value ⇒ 0（原生精确值）；gOPD(function f(){}, \"name\").writable ⇒ false（原生 false）；gOPD(function f(){}, \"name\").value ⇒ 字符串（不抛、不折 never）；gOPD(class A {}, \"name\").value ⇒ \"A\"（原生精确值）；gOPD(function f(){}, \"prototype\").writ", () => {
  {
    expect(lit(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "length").value;'))).toBe(0);
  }
  {
    expect(
      lit(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "name").writable;')),
    ).toBe(false);
  }
  {
    const rec = call(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "name").value;'));
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
    expect(
      lit(wrap('return typeof Object.getOwnPropertyDescriptor(function f(){}, "name").value;')),
    ).toBe("string");
  }
  {
    expect(lit(wrap('return Object.getOwnPropertyDescriptor(class A {}, "name").value;'))).toBe("A");
  }
  {
    expect(
      lit(wrap('return Object.getOwnPropertyDescriptor(function f(){}, "prototype").writable;')),
    ).toBe(true);
  }
  {
    expect(
      lit(wrap('return Object.getOwnPropertyDescriptor(class A {}, "prototype").writable;')),
    ).toBe(false);
  }
  {
    const rec = call(
      wrap('return Reflect.getOwnPropertyDescriptor(function f(){}, "name").value;'),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  }
  {
    expect(lit(wrap('return Object.getOwnPropertyDescriptor({a:1},"a").value;'))).toBe(1);
  }
});








});

// ---------------------------------------------------------------------------
// shape/partial/omit/pick 写侧不得吞掉 __proto__ 字段
// ---------------------------------------------------------------------------
describe("shape/partial/omit/pick 写侧不得吞掉 __proto__ 字段", () => {
/**
 * 约束 DSL 的**写侧**把 `__proto__` 字段静默吞掉：
 * 普通对象字面量 `{}` 装配字段表 ⇒ `mapped["__proto__"] = {…}` 触发
 * `Object.prototype.__proto__` 的 **setter** ⇒ 字段被写成**原型**而非
 * **自有键** ⇒ 下游 `Object.entries` 读不到 ⇒ 契约被悄悄削弱成空 shape
 * （域放宽到「任意对象」）⇒ 门禁对违约实参**判绿**（假绿）。
 *
 * 修法（切片① 的 DSL 写侧）：字段表一律用**无原型对象**（`Object.create(null)`）
 * 装配 ⇒ `__proto__` 是普通自有键；并加「自有键数」断言（键数不符 ⇒ 报错，
 * 不静默降级）。写侧共四处：`shape` / `partial` / `omit` / `pick`。
 *
 * 覆盖的面：DSL 字段表（构建器层）＋ 契约面（`formatConstraint`）＋ 门禁面
 * （`nudo check` 的 missing field 诊断）。
 * 未覆盖（**别的片的地盘**，见交付报告「越界发现」）：dts / zod 产物面——
 * 那条链上的吞键点是 Abs 投影层（core `constraintToEntryAbs` 的 slots 表、
 * core `projection.ts:330` 的 fields 表、service `dts-generator.ts` 的 slots 表），
 * 不是本条的 DSL 写侧。
 */








const protoField = (): Record<string, unknown> => ({ ["__proto__"]: number() });

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  });

  it("shape({ ['__proto__']: number() }) 的字段表含 __proto__ 自有键；partial / omit / pick 转一道后字段仍在（不二次吞键）；对照组：普通字段名行为不变（不被误伤）；契约面：shape({ __proto__: number() }) 的字段不得消失；门禁面：f({}) 违反「含 __proto__: number」⇒ 报 missing field（改前判绿）；门禁面：对照组（字段名 p）与 __proto__ 的", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const s = shape(protoField() as never);
    expect(Object.keys(s.fields ?? {})).toEqual(["__proto__"]);
    expect(Object.hasOwn(s.fields ?? {}, "__proto__")).toBe(true);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const base = shape(protoField() as never);
    expect(Object.keys(partial(base).fields ?? {})).toEqual(["__proto__"]);
    expect(Object.keys(omit(base, ["id"]).fields ?? {})).toEqual(["__proto__"]);
    expect(Object.keys(pick(base, ["__proto__"]).fields ?? {})).toEqual(["__proto__"]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const s = shape({ p: number() });
    expect(Object.keys(s.fields ?? {})).toEqual(["p"]);
    expect(Object.keys(partial(s).fields ?? {})).toEqual(["p"]);
    expect(Object.keys(omit(s, ["p"]).fields ?? {})).toEqual([]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const shown = formatConstraint(shape(protoField() as never));
    expect(shown).toContain("__proto__");
    expect(shown).not.toContain("shape({  })");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, number, any } from "@nudojs/core";
export const f = fn({ o: shape({ ["__proto__"]: number() }) }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
export function g() {
  return f({});
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.some((i) => (i.expected ?? "").includes("__proto__"))).toBe(true);
    expect(r.ok).toBe(false);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, number, any } from "@nudojs/core";
export const f = fn({ o: shape({ p: number() }) }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
export function g() {
  return f({});
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.some((i) => (i.expected ?? "").includes("missing field o.p"))).toBe(true);
  }
});





}
});

// ---------------------------------------------------------------------------
// Proxy [[GetOwnProperty]] 不变量：值不同 ⇒ TypeError
// ---------------------------------------------------------------------------
describe("Proxy [[GetOwnProperty]] 不变量：值不同 ⇒ TypeError", () => {
/**
 * 回归：Proxy **[[GetOwnProperty]]** 的靶一致性不变量
 * （ES2024 10.5.5 step 12.f）——违者原生定抛 TypeError，引擎此前
 * **照抄陷阱的值**（自信的错值 / 假绿）。
 *
 * 修前（探针实测）：
 * - `Object.getOwnPropertyDescriptor(p, "a").value` ⇒ **exact 2**
 * （原生抛 TypeError：靶上 "a" 是不可配置 + 不可写的数据属性，陷阱
 * 报了不同的 value ⇒ 违反 [[GetOwnProperty]] 不变量）；
 * - `Reflect.getOwnPropertyDescriptor(p, "a").value` ⇒ 同款 exact 2。
 *
 * 修后：靶自有 + 不可配置 + 不可写 + 陷阱 value 与靶值不同 ⇒ 定抛
 * TypeError（Object 面抛、Reflect 面同口径抛）；可写靶 / 同值陷阱
 * **不抛**（负控制）。
 *
 * 判定口径与 [[Get]] 面的 `exec/runtime/state.ts` 的
 * `enforceProxyGetInvariant` 同源（靶自有 + 不可配置 + 不可写 + 值不同
 * ⇒ 抛）；那处归并行 worker 拥有 ⇒ 本次在 builtins 侧就地复刻
 * （`builtins/object/descriptor.ts` 的 enforceProxyGetOwnPropDescInvariant）。
 *
 * **口径扩展（收口轮）**：原先只落「值」这一条；现按 ES2024 10.5.5
 * step 6.a / 7.a–7.c 补齐 configurable / writable / enumerable 三档与
 * 「靶无该自有键」「靶是访问器」两档。口径以 **node v26.10.0 实测矩阵**
 * 为准（靶 present/absent × 陷阱 present/absent ×
 * configurable/writable/enumerable 全组合 = 82 例，候选谓词与原生**零偏差**）。
 *
 * oracle：node v26.10.0 实测。
 */



const wrap = (body: string) => `export function f() { ${body} }`;

/** 靶上 "a" 是不可配置 + 不可写的数据属性（value 1） */
const FROZEN_TARGET = `const t = {}; Object.defineProperty(t, "a", {value:1, configurable:false, writable:false});`;


  it("Object.getOwnPropertyDescriptor(p, \"a\").value ⇒ 抛 TypeError（native：同款）；Reflect.getOwnPropertyDescriptor(p, \"a\").value ⇒ 抛 TypeError（native：同款）；用户 try/catch 捕到（native：\"threw\"）", () => {
  {
    const rec = call(
      wrap(
        `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:false, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(
      wrap(
        `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:false, configurable:false}; } }); return Reflect.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      val(
        wrap(
          `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:false, configurable:false}; } }); try { Object.getOwnPropertyDescriptor(p, "a"); } catch { return "threw"; } return "no-throw";`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
});




describe("负控制（邻近形态不回归）", () => {
  it("靶属性**可写**（普通 {a:1}）⇒ 陷阱值原样给出（native：2）；陷阱报**同一个值** ⇒ 不抛（native：值一致不违 12.f）；靶**无**该自有键 + 陷阱报**可配置** ⇒ 不变量不适用（native：不抛，2）；非 Proxy 路径不受影响：{a:1} 的描述符 value 1", () => {
  {
    expect(
      val(
        wrap(
          `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(
        wrap(
          `${FROZEN_TARGET} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:1, writable:false, enumerable:false, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        wrap(
          `const p = new Proxy({}, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(val(wrap(`return Object.getOwnPropertyDescriptor({ a: 1 }, "a").value;`))).toEqual({
      ok: true,
      value: 1,
    });
  }
});



});

/** 靶侧描述符（defineProperty） */
const TGT = (flags: string): string =>
  `const t = {}; Object.defineProperty(t, "a", {value:1, ${flags}});`;

/** 陷阱侧描述符 */
const TRAP = (flags: string): string =>
  `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, ${flags}}; } });`;

describe("扩展 — 规则 1：靶无该自有键 ⇒ 陷阱必须可配置", () => {
  it("靶 {} + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）；靶 {} + 陷阱报 configurable:true ⇒ 不抛（native：2）", () => {
  {
    const rec = call(
      wrap(
        `const t = {}; const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      val(
        wrap(
          `const t = {}; const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
});

});

describe("扩展 — 规则 2：可配置性必须一致", () => {
  it("靶可配置 + 陷阱报 configurable:false ⇒ 抛 TypeError（native：抛）；靶不可配置 + 陷阱报 configurable:true ⇒ 抛 TypeError（native：抛）", () => {
  {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:true")} ${TRAP("writable:true, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:true, configurable:true")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
});

});

describe("扩展 — 规则 3：靶不可配置 ⇒ writable / enumerable 冻结", () => {
  it("靶不可配置+可写 + 陷阱报 writable:false ⇒ 抛 TypeError（native：抛）；靶不可配置+可写 + 陷阱报 enumerable 不同 ⇒ 抛 TypeError（native：抛）；靶不可配置+不可写 + 陷阱报 writable:true ⇒ 抛 TypeError（native：抛）；靶不可配置+可写 + 陷阱报同 writable/enumerable ⇒ 不抛（native：2）；靶可配置 ⇒ 陷阱报任意 writable/enumer", () => {
  {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:false, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(
      wrap(`${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:false, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(
      wrap(`${TGT("writable:false, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      val(
        wrap(
          `${TGT("writable:true, enumerable:true, configurable:false")} ${TRAP("writable:true, enumerable:true, configurable:false")} return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(
        wrap(
          `${TGT("writable:true, enumerable:true, configurable:true")} ${TRAP("writable:false, enumerable:false, configurable:true")} return Object.getOwnPropertyDescriptor(p, "a").value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
});




});

describe("扩展 — 规则 4：数据 / 访问器描述符不得混报", () => {
  it("靶是访问器 + 陷阱报数据描述符 ⇒ 抛 TypeError（native：抛）；靶是数据属性 + 陷阱报访问器描述符 ⇒ 抛 TypeError（native：抛）", () => {
  {
    const rec = call(
      wrap(
        `const t = {}; Object.defineProperty(t, "a", { get(){ return 1; }, configurable:false }); const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {value:2, writable:true, enumerable:true, configurable:true}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    const rec = call(
      wrap(
        `${TGT("writable:true, enumerable:true, configurable:false")} const p = new Proxy(t, { getOwnPropertyDescriptor(){ return {get(){ return 2; }, configurable:false}; } }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
});

});
});

// ---------------------------------------------------------------------------
// gOPDs 保留 symbol 键（原生走 [[OwnPropertyKeys]]）
// ---------------------------------------------------------------------------
describe("gOPDs 保留 symbol 键（原生走 [[OwnPropertyKeys]]）", () => {
/**
 * 回归：`Object.getOwnPropertyDescriptors` **丢弃 symbol 键**的自有属性
 * ——结果对象少一个自有属性、键数少 1（exact 结构 ⇒ 假绿）。
 *
 * 修前（探针实测）：
 * - `Reflect.ownKeys(Object.getOwnPropertyDescriptors(o)).length` ⇒ **1**
 * （原生 2）；
 * - `Object.getOwnPropertySymbols(Object.getOwnPropertyDescriptors(o)).length`
 * ⇒ **0**（原生 1）。
 *
 * 根因：gOPDs 面按 `symbolKey` 过滤掉了 symbol 投影槽。但原生 gOPDs 走
 * [[OwnPropertyKeys]]——**含** symbol 键（结果对象带**真 symbol** 键 ⇒
 * `Object.getOwnPropertySymbols` 看得到、`Object.keys` /
 * `Object.getOwnPropertyNames` 看不到）。
 *
 * 修后：gOPDs 保留 symbol 投影槽并带 `symbolKey` 标记 ⇒
 * - ownKeys / getOwnPropertySymbols 看得见（数量与原生一致）；
 * - 字符串键面（Object.keys / getOwnPropertyNames）仍只看字符串键（原生同款）。
 *
 * 附注：`builtins/invariants.ts` 的文件头不变量此前把 gOPDs 列进「只枚举
 * 字符串键」清单——与原生不符，已一并修正（该清单仍管 for-in / keys 家族 /
 * gOPN / JSON.stringify 面）。
 *
 * oracle：node v26.10.0 实测。
 */



const wrap = (body: string) => `export function f() { ${body} }`;


  it("Reflect.ownKeys(gOPDs(o)).length ⇒ 2（native：2；修前：1）；Object.getOwnPropertySymbols(gOPDs(o)).length ⇒ 1（native：1；修前：0）；well-known symbol 键同款：ownKeys 2 条 / getOwnPropertySymbols 1 条（native 同款）；symbol 键的描述符值可读（native：d[Symbol.toStringTag].value", () => {
  {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Reflect.ownKeys(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Object.getOwnPropertySymbols(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const d = Object.getOwnPropertyDescriptors(o); return Reflect.ownKeys(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const d = Object.getOwnPropertyDescriptors(o); return Object.getOwnPropertySymbols(d).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const d = Object.getOwnPropertyDescriptors(o); return d[Symbol.toStringTag].value;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  }
});





describe("负控制（字符串键面不受影响）", () => {
  it("Object.keys(gOPDs(o)) ⇒ \"a\"（native：symbol 键不进字符串键面）；Object.getOwnPropertyNames(gOPDs(o)) ⇒ \"a\"（native：同款）；无 symbol 键的对象：gOPDs 只有一个字符串键（native 同款）", () => {
  {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Object.keys(d).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol("s")] = 1; o.a = 2; const d = Object.getOwnPropertyDescriptors(o); return Object.getOwnPropertyNames(d).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      val(wrap(`const d = Object.getOwnPropertyDescriptors({ a: 1 }); return Reflect.ownKeys(d).length;`)),
    ).toEqual({ ok: true, value: 1 });
  }
});


});
});

// ---------------------------------------------------------------------------
// Reflect.ownKeys：字符串键段在前、symbol 键段在后
// ---------------------------------------------------------------------------
describe("Reflect.ownKeys：字符串键段在前、symbol 键段在后", () => {
/**
 * 回归：`Reflect.ownKeys` 的 **symbol 键排在字符串键之前**——段序错
 * 的 exact 元组（假绿）。
 *
 * 修前（探针实测）：`Reflect.ownKeys(o)`（o 有 symbol 键 + 字符串键 "a"）⇒
 * `"sym,a"`（原生：`"a,sym"`）。
 *
 * 规范依据（ES2024 OrdinaryOwnPropertyKeys）：**字符串键**（整数键升序 +
 * 插入序）→ **symbol 键**（插入序）两段排列。引擎此前按槽插入序把 `@@X`
 * 投影槽与字符串键混排 ⇒ 顺序错。
 *
 * 修后（`builtins/reflect.ts` 的 ownKeys 臂）：先切字符串键段、再接 symbol
 * 键段（各段内部维持既有顺序；与 `Object.getOwnPropertyNames` 的字符串键
 * 顺序口径一致）。
 *
 * oracle：node v26.10.0 实测。
 */



const wrap = (body: string) => `export function f() { ${body} }`;


  it("ownKeys(o) ⇒ \"a,sym\"（native：a 在前、symbol 在后；修前：\"sym,a\"）；ownKeys(o)[0] 是字符串 \"a\"、typeof ownKeys(o)[1] 是 \"symbol\"（native 同款）；well-known symbol 键同款：\"a,sym\"（native 同款）", () => {
  {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol.iterator] = 1; o.a = 2; const ks = Reflect.ownKeys(o); return ks.map(k => typeof k === "symbol" ? "sym" : k).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,sym" });
  }
  {
    expect(
      val(
        wrap(
          `const o = {}; o[Symbol.iterator] = 1; o.a = 2; const ks = Reflect.ownKeys(o); return ks[0] + ":" + (typeof ks[1]);`,
        ),
      ),
    ).toEqual({ ok: true, value: "a:symbol" });
  }
  {
    expect(
      val(
        wrap(
          `const o = { a: 1, [Symbol.toStringTag]: 2 }; const ks = Reflect.ownKeys(o); return ks.map(k => typeof k === "symbol" ? "sym" : k).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,sym" });
  }
});




describe("负控制（字符串键段内部顺序不变）", () => {
  it("只有字符串键：ownKeys 保持插入序（native：\"b,a\"）；整数键升序在前（native：\"0,1\"）；无 symbol 键时长度不变（native：1）", () => {
  {
    expect(val(wrap(`const o = { b: 1, a: 2 }; return Reflect.ownKeys(o).join(",");`))).toEqual({
      ok: true,
      value: "b,a",
    });
  }
  {
    expect(val(wrap(`const o = { b: 1, 0: 2, 1: 3 }; return Reflect.ownKeys(o).join(",");`))).toEqual({
      ok: true,
      value: "0,1,b",
    });
  }
  {
    expect(val(wrap(`return Reflect.ownKeys({ a: 1 }).length;`))).toEqual({ ok: true, value: 1 });
  }
});


});
});

// ---------------------------------------------------------------------------
// 验收 1 — 可配置靶 + 异形态陷阱 ⇒ 不抛（native：不抛）
// ---------------------------------------------------------------------------
describe("验收 1 — 可配置靶 + 异形态陷阱 ⇒ 不抛（native：不抛）", () => {
/**
 * Proxy **[[GetOwnProperty]]** 靶一致性不变量的**阈值**回归
 * （ES2024 10.5.5 step 12.f / 24.4.2.1 IsCompatiblePropertyDescriptor）。
 *
 * 症状族：native 不抛，引擎抛 TypeError ⇒ error 级 `nudo:entry-may-throw`
 * ⇒ **CI 闸门假红**（卡死用户仓库）。三处都在
 * `builtins/object/descriptor.ts` 的 `enforceProxyGetOwnPropDescInvariant`
 * （Object 面 / Reflect 面共用此函数）。
 *
 * ── 修前的三处缺陷 ─────────────────────────────────────────────────
 * ① **形态一致性检查（规则 4）没以「靶属性不可配置」为前提**
 * —— 靶属性**可配置**（默认）时，陷阱报异形态描述符（靶是数据属性、
 * 陷阱报访问器，或反之）⇒ 引擎无条件抛 TypeError；原生**不抛**
 * （IsCompatiblePropertyDescriptor 只在 current.[[Configurable]] 为
 * false 时做形态比对）。
 * ② **`frozen` 被当成 `enumerable:false`**
 * —— `Object.freeze` 只改 writable/configurable，**不改 enumerable**
 * （原生：`Object.freeze({a:1})` ⇒ writable:false / enumerable:true /
 * configurable:false）；引擎把 targetEnumerable 算成 false ⇒ 陷阱诚实报
 * `enumerable:true` ⇒ 规则 3 判不一致 ⇒ 抛 TypeError。
 * ③ **靶侧标志 / extState 只查「内层 obj」，不查「接收者」**
 * —— defineProperty / freeze / seal 把标志记在**接收者**上（brand 靶 ⇒
 * 记在 brand 上；obj 靶 ⇒ 记在 obj 上），只读内层 obj 的标志表 ⇒ 取不到
 * ⇒ targetConfigurable 回落成 true ⇒ 与陷阱报的 `configurable:false`
 * 判「不一致」⇒ **即使陷阱报告的描述符与靶完全一致也抛**。
 *
 * ── 修法（descriptor.ts 内，三处最小改动）────────────────────────
 * ① 形态比对收进「靶属性不可配置」分支（与规则 3 同一前提）；
 * ② 靶侧 enumerable 不再叠 `st !== "frozen"`（freeze 不改 enumerable）；
 * ③ 靶侧三标志 + extState 统一走 `currentPropDesc(target, key)`
 * （**接收者优先、内层兜底**——同文件既有口径，不再漂移）。
 *
 * ── oracle：node v26.10.0 实测（`node -e` 本机跑，2026-10）──────────
 * | # | 靶 | 陷阱报告 | native |
 * |---|-----------------------------------------------|-----------------------------------|--------|
 * | 1 | `{a:1}`（a 可配置·数据） | 访问器 {get, configurable:true} | 不抛 |
 * | 2 | 可配置**访问器** a | 数据 {value:2,…,configurable:true} | 不抛 |
 * | 3 | 不可配置数据 a | 访问器 {get, configurable:false} | 抛 |
 * | 4 | 不可配置访问器 a | 数据 {value:2,…,configurable:false} | 抛 |
 * | 5 | `Object.freeze({a:1})` | {value:1,writable:false,enum:true,cfg:false} | 不抛 |
 * | 6 | `Object.freeze({a:1})` | 同上但 writable:true | 抛 |
 * | 7 | `Object.freeze({a:1})` | 同上但 enumerable:false | 抛 |
 * | 8 | brand 实例 + defineProperty 收紧（非配置·非写） | 与靶完全一致的描述符 | 不抛 |
 * | 9 | 同 8 | writable:true | 抛 |
 * |10 | 同 8 | enumerable:false | 抛 |
 * |11 | 同 8 | value:2（值不同） | 抛 |
 *
 * Object 面与 Reflect 面同口径（node 实测 1/2 两面皆不抛）。
 *
 * ── 已知缺口（**本次不修**：基线同样不抛 ⇒ 非本次回归；新增抛点有
 * 制造新假红的风险 ⇒ 后续单独立项）─────────────────────────────
 * ① 靶不可扩展且该键不存在时，陷阱报 `configurable:true`
 * ⇒ node v26.10.0 **抛** TypeError，引擎**不抛**（漏抛）。
 * ② 靶不可写 + 不可配置而陷阱**省略 value** 时
 * ⇒ node v26.10.0 **抛** TypeError，引擎**不抛**（漏抛）。
 * ③ 靶为不可配置**访问器**且陷阱的 get/set 身份与靶不同
 * ⇒ node v26.10.0 **抛** TypeError，引擎**放过**（漏抛——引擎的访问器
 * 侧表只存 thunk、不存原函数值 ⇒ SameValue 不可判）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/* ── 靶 / 陷阱片段 ─────────────────────────────────────────────── */

/** 可配置的数据属性靶（默认标志：writable/enumerable/configurable 皆 true） */
const DATA_CFG = `const t = { a: 1 };`;

/** 可配置的访问器属性靶 */
const ACC_CFG = `const t = {}; Object.defineProperty(t, "a", { get(){ return 1; }, enumerable: true, configurable: true });`;

/** 不可配置的数据属性靶（writable:true / enumerable:true / configurable:false） */
const DATA_NONCFG = `const t = {}; Object.defineProperty(t, "a", { value: 1, writable: true, enumerable: true, configurable: false });`;

/** 不可配置的访问器属性靶（enumerable 缺省 ⇒ false） */
const ACC_NONCFG = `const t = {}; Object.defineProperty(t, "a", { get(){ return 1; }, configurable: false });`;

/** 冻结靶（writable:false / enumerable:true / configurable:false） */
const FROZEN = `const t = Object.freeze({ a: 1 });`;

/** brand 靶（类实例）+ defineProperty 收紧标志（记在**接收者 brand** 上） */
const BRAND_TIGHT = `class A { constructor(){ this.a = 1; } }
const t = new A();
Object.defineProperty(t, "a", { value: 1, writable: false, enumerable: true, configurable: false });`;

/** 陷阱：报访问器描述符（configurable 决定可配置档） */
const TRAP_ACC = (configurable: boolean) =>
  `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { get(){ return 2; }, configurable: ${configurable} }; } });`;

/** 陷阱：报数据描述符（value 恒 2 ⇒ 与靶值不同 ⇒ 靶不可写时必抛） */
const TRAP_DATA = (configurable: boolean) =>
  `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 2, writable: true, enumerable: true, configurable: ${configurable} }; } });`;

/** 陷阱：报「与靶完全一致」的冻结数据描述符 */
const TRAP_FROZEN_HONEST = `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: true, configurable: false }; } });`;

/** 陷阱：报与 brand 靶完全一致的描述符 */
const TRAP_TIGHT_HONEST = `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: true, configurable: false }; } });`;

/* ── 组装 / 断言（复用共享 harness，不复刻 helper）───────────────── */

/** 靶 + 陷阱 + 读描述符（field 缺省 ⇒ 读整个描述符；face ⇒ Object / Reflect） */
const read = (
  target: string,
  trap: string,
  face: "Object" | "Reflect" = "Object",
  field?: string,
): string => {
  const m =
    face === "Object" ? "Object.getOwnPropertyDescriptor" : "Reflect.getOwnPropertyDescriptor";
  return `${target} ${trap} return ${m}(p, "a")${field ? `.${field}` : ""};`;
};

/** 该片段在引擎里**不抛 TypeError**（原生亦不抛） */
function expectNoTypeError(body: string): void {
  expect(throwsError(call(wrap(body)).throws, "TypeError")).toBe(false);
}

/** 该片段在引擎里**抛 TypeError**（原生亦抛） */
function expectTypeError(body: string): void {
  expect(throwsError(call(wrap(body)).throws, "TypeError")).toBe(true);
}


  it("Object 面：靶是可配置数据属性 + 陷阱报访问器描述符 ⇒ 不抛；Reflect 面同款 ⇒ 不抛；Object 面：靶是可配置访问器属性 + 陷阱报数据描述符 ⇒ 不抛；Reflect 面同款 ⇒ 不抛", () => {
  {
    expectNoTypeError(read(DATA_CFG, TRAP_ACC(true)));
    // 原生返回**陷阱**的描述符（configurable:true；访问器描述符缺省不可枚举）
    expect(val(wrap(read(DATA_CFG, TRAP_ACC(true), "Object", "configurable")))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expectNoTypeError(read(DATA_CFG, TRAP_ACC(true), "Reflect"));
    expect(val(wrap(read(DATA_CFG, TRAP_ACC(true), "Reflect", "configurable")))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expectNoTypeError(read(ACC_CFG, TRAP_DATA(true)));
    expect(val(wrap(read(ACC_CFG, TRAP_DATA(true), "Object", "value")))).toEqual({
      ok: true,
      value: 2,
    });
  }
  {
    expectNoTypeError(read(ACC_CFG, TRAP_DATA(true), "Reflect"));
    expect(val(wrap(read(ACC_CFG, TRAP_DATA(true), "Reflect", "value")))).toEqual({
      ok: true,
      value: 2,
    });
  }
});





describe("验收 2 — 不可配置靶 + 异形态陷阱 ⇒ 抛 TypeError（native：抛）", () => {
  it("Object 面：靶是不可配置数据属性 + 陷阱报访问器描述符 ⇒ 抛；Reflect 面同款 ⇒ 抛；Object 面：靶是不可配置访问器属性 + 陷阱报数据描述符 ⇒ 抛；Reflect 面同款 ⇒ 抛", () => {
  {
    expectTypeError(read(DATA_NONCFG, TRAP_ACC(false)));
  }
  {
    expectTypeError(read(DATA_NONCFG, TRAP_ACC(false), "Reflect"));
  }
  {
    expectTypeError(read(ACC_NONCFG, TRAP_DATA(false)));
  }
  {
    expectTypeError(read(ACC_NONCFG, TRAP_DATA(false), "Reflect"));
  }
});



});

describe("验收 3 — frozen 靶（freeze 不改 enumerable）", () => {
  it("陷阱诚实报 enumerable:true ⇒ 不抛（native：不抛）；Reflect 面同款 ⇒ 不抛；陷阱报 writable:true ⇒ 抛（frozen 仍冻结 writable；native：抛）；陷阱报 enumerable:false ⇒ 抛（靶的 enumerable 仍是 true；native：抛）", () => {
  {
    expectNoTypeError(read(FROZEN, TRAP_FROZEN_HONEST));
    expect(val(wrap(read(FROZEN, TRAP_FROZEN_HONEST, "Object", "enumerable")))).toEqual({
      ok: true,
      value: true,
    });
  }
  {
    expectNoTypeError(read(FROZEN, TRAP_FROZEN_HONEST, "Reflect"));
  }
  {
    expectTypeError(
      read(
        FROZEN,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: true, enumerable: true, configurable: false }; } });`,
      ),
    );
  }
  {
    expectTypeError(
      read(
        FROZEN,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: false, configurable: false }; } });`,
      ),
    );
  }
});



});

describe("验收 4 — brand 靶 + defineProperty 收紧标志（记在接收者上）", () => {
  it("陷阱报与靶完全一致的描述符 ⇒ 不抛（native：不抛）；Reflect 面同款 ⇒ 不抛；陷阱报 writable:true ⇒ 抛（native：抛）；陷阱报 enumerable:false ⇒ 抛（native：抛）；陷阱报 value:2（值不同）⇒ 抛（native：抛）", () => {
  {
    expectNoTypeError(read(BRAND_TIGHT, TRAP_TIGHT_HONEST));
    expect(val(wrap(read(BRAND_TIGHT, TRAP_TIGHT_HONEST, "Object", "value")))).toEqual({
      ok: true,
      value: 1,
    });
  }
  {
    expectNoTypeError(read(BRAND_TIGHT, TRAP_TIGHT_HONEST, "Reflect"));
  }
  {
    expectTypeError(
      read(
        BRAND_TIGHT,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: true, enumerable: true, configurable: false }; } });`,
      ),
    );
  }
  {
    expectTypeError(
      read(
        BRAND_TIGHT,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 1, writable: false, enumerable: false, configurable: false }; } });`,
      ),
    );
  }
  {
    expectTypeError(
      read(
        BRAND_TIGHT,
        `const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 2, writable: false, enumerable: true, configurable: false }; } });`,
      ),
    );
  }
});




});

describe("CI 闸门面：nudo check 不得报 error 级 nudo:entry-may-throw", () => {
  /** 闸门源（导出函数 ⇒ 入口面参与 may-throw 分析） */
  const gate = (body: string) => `export function f() { ${body} }`;

  it("可配置靶 + 异形态陷阱 ⇒ 零 L2 / 零 error（修前：error 级 1 条 ⇒ 卡 CI）；frozen 靶 + 陷阱诚实报 ⇒ 零 L2 / 零 error（修前：error 级 1 条）；brand 靶 + 陷阱报一致描述符 ⇒ 零 L2 / 零 error（修前：error 级 1 条）；负控制：真违约（不可配置靶 + 不可写 + 值不同）⇒ 仍报 error 级 L2（闸门没被关掉）；负控制：不可配置靶 + 异形态陷阱 ⇒ 仍报 error 级 L2（闸", () => {
  {
    const r = issuesOf(gate(read(DATA_CFG, TRAP_ACC(true))), "/t/proxy-gopd-1.js");
    expect(l2Count(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  }
  {
    const r = issuesOf(gate(read(FROZEN, TRAP_FROZEN_HONEST)), "/t/proxy-gopd-2.js");
    expect(l2Count(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  }
  {
    const r = issuesOf(gate(read(BRAND_TIGHT, TRAP_TIGHT_HONEST)), "/t/proxy-gopd-3.js");
    expect(l2Count(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  }
  {
    const r = issuesOf(
      gate(
        `const t = {}; Object.defineProperty(t, "a", { value: 1, writable: false, configurable: false }); const p = new Proxy(t, { getOwnPropertyDescriptor(){ return { value: 2, writable: false, configurable: false }; } }); return Object.getOwnPropertyDescriptor(p, "a");`,
      ),
      "/t/proxy-gopd-4.js",
    );
    expect(l2Count(r)).toBe(1);
    expect(r.issues.find((i) => i.code === "nudo:entry-may-throw")?.severity).toBe("error");
  }
  {
    const r = issuesOf(
      gate(read(DATA_NONCFG, TRAP_ACC(false))),
      "/t/proxy-gopd-5.js",
    );
    expect(l2Count(r)).toBe(1);
    expect(r.issues.find((i) => i.code === "nudo:entry-may-throw")?.severity).toBe("error");
  }
});




});
});

// ---------------------------------------------------------------------------
// [[PrimitiveValue]] 内部槽不进自有属性面
// ---------------------------------------------------------------------------
describe("[[PrimitiveValue]] 内部槽不进自有属性面", () => {
/**
 * 回归：装箱原始值的 `[[PrimitiveValue]]` 是**内部槽**，不是自有属性。
 *
 * 根因：`packages/core/src/algebra/builtins/error/boxed.ts` 的 `makeBoxedAbs`
 * 建 `[[PrimitiveValue]]` 时**只**把「不可枚举」记在**侧表**（prop flags）里，
 * **没有**落 `Slot.internal` ⇒ 投影面（format / denote / projection /
 * service emit/internal-slot 全按 `internal` 剔除内部槽）**一个都不查侧表**
 * ⇒ guard 面把它当**必填自有属性**发布
 *（`data["[[PrimitiveValue]]"] === 1`）⇒ guard 对被导出函数自己的返回值
 * **恒假**（假红；zod / dts / check 三面都正确）。
 *
 * 修法：`[[PrimitiveValue]]` 槽打 `internal: true`（ES 规范内部槽 = 不是自有
 * 属性；原生 `Object.getOwnPropertyNames(new Number(1))` 是 `[]`）。
 */







const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};
const wrap = (body: string): string => `export function f() { ${body} }`;

/** 装箱 brand 的内层 `[[PrimitiveValue]]` 槽 */
function primSlotOf(name: "Number" | "String" | "Boolean", v: unknown): Slot {
  const brand = makeBoxedAbs(name, $lit(v as never));
  const inner = brand.shape.k === "brand" ? brand.shape.shape : undefined;
  expect(inner?.shape.k).toBe("obj");
  const slots = (inner!.shape as { slots: Record<string, Slot> }).slots;
  return slots[BOXED_PRIMITIVE_SLOT]!;
}


  it("槽带 internal 标记（投影面据此剔除）；isHiddenInternalSlot 对 [[PrimitiveValue]] 判真（guard / dts / schema 三面同判据）；运行时面：new Number(1) 的 getOwnPropertyNames 是 []（原生同款）；运行时面：new Number(1).hasOwnProperty(\"[[PrimitiveValue]]\") 是 false；对照组：new String(\"s\") 的**真实**", () => {
  {
    for (const [name, v] of [
      ["Number", 1],
      ["String", "s"],
      ["Boolean", true],
    ] as const) {
      const slot = primSlotOf(name, v);
      expect(slot, `${name} 缺 [[PrimitiveValue]] 槽`).toBeDefined();
      expect(slot.internal, `${name} 的 [[PrimitiveValue]] 未打 internal`).toBe(true);
    }
  }
  {
    expect(isHiddenInternalSlot(BOXED_PRIMITIVE_SLOT, primSlotOf("Number", 1))).toBe(true);
  }
  {
    expect(tupleEls(call(wrap("return Object.getOwnPropertyNames(new Number(1));")).result)).toEqual(
      [],
    );
  }
  {
    expect(lit(wrap('return new Number(1).hasOwnProperty("[[PrimitiveValue]]");'))).toBe(false);
  }
  {
    expect(tupleEls(call(wrap("return Object.getOwnPropertyNames(new String('s'));")).result)).toEqual([
      "0",
      "length",
    ]);
  }
});





});

// ---------------------------------------------------------------------------
// （toJSON 半）：URL 原型方法面
// ---------------------------------------------------------------------------
describe("（toJSON 半）：URL 原型方法面", () => {
/**
 * （**toJSON 半**）：`URL.prototype` 的自有方法面（`toString` /
 * `toJSON`）此前不在 `BUILTIN_BRAND_METHODS` / `BUILTIN_BRAND_ACCESSORS`
 * 里 ⇒ 成员读落闭 obj 槽 miss 折 **exact undefined**（wrong-exact：
 * `u.toJSON === undefined` 判 true）、`"toJSON" in u` 折 **exact false**
 * （原生 true）。
 *
 * 注：本条 bug 的 **host 半**（`urlBrandAbs.componentKeys` 漏 `host`）在本
 * 测试落盘前已修（`packages/core/src/algebra/builtins/error/web.ts` 的
 * `componentKeys` 已含 `"host"`）；本文件只钉 **toJSON 半**，host 仅作
 * 对照（不得回退）。
 *
 * 原生（node v26.10.0 实测）：
 * `Object.getOwnPropertyNames(URL.prototype)` =
 * constructor, toString, href, origin, protocol, username, password, host,
 * hostname, port, pathname, search, searchParams, hash, toJSON
 * ⇒ `u.toJSON` 恒是函数、`typeof u.toJSON === "function"`、
 * `"toJSON" in u` 恒 true、`u.toJSON === undefined` 恒 false。
 */



const url = (expr: string) =>
  val(`export function f() { const u = new URL("http://example.com/a"); return ${expr}; }`);


  it("u.toJSON 折函数值（不是 exact undefined）；u.toJSON === undefined 折 false（此前假绿 true）；\"toJSON\" in u 折 exact true（此前假红 false）；u.toString 同为原型方法（同一行表项的四项之一）；对照：host 半已修且不得回退（host 含端口、hostname 不含）；对照：组件槽（href/hostname/pathname/search）读面不回退", () => {
  {
    const r = call(
      `export function f() { const u = new URL("http://example.com/a"); return u.toJSON; }`,
    );
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("fn");
    expect(url("typeof u.toJSON")).toEqual({ ok: true, value: "function" });
  }
  {
    expect(url("u.toJSON === undefined")).toEqual({ ok: true, value: false });
  }
  {
    expect(url('"toJSON" in u')).toEqual({ ok: true, value: true });
  }
  {
    expect(url("typeof u.toString")).toEqual({ ok: true, value: "function" });
    expect(url('"toString" in u')).toEqual({ ok: true, value: true });
  }
  {
    expect(url("u.host")).toEqual({ ok: true, value: "example.com" });
    expect(url("u.host === undefined")).toEqual({ ok: true, value: false });
    expect(url('"host" in u')).toEqual({ ok: true, value: true });
    expect(
      val(
        `export function f() { const u = new URL("http://example.com:8080/a"); return u.host; }`,
      ),
    ).toEqual({ ok: true, value: "example.com:8080" });
    expect(
      val(
        `export function f() { const u = new URL("http://example.com:8080/a"); return u.hostname; }`,
      ),
    ).toEqual({ ok: true, value: "example.com" });
  }
  {
    expect(url("u.href")).toEqual({ ok: true, value: "http://example.com/a" });
    expect(url("u.pathname")).toEqual({ ok: true, value: "/a" });
    expect(url('"searchParams" in u')).toEqual({ ok: true, value: true });
  }
});






});

// ---------------------------------------------------------------------------
// Object.prototype legacy 四访问器（值读面与 `in` 面同口径）
// ---------------------------------------------------------------------------
describe("Object.prototype legacy 四访问器（值读面与 `in` 面同口径）", () => {
/**
 * 回归：`Object.prototype` 的 **legacy 四访问器**
 * （`__defineGetter__` / `__defineSetter__` / `__lookupGetter__` /
 * `__lookupSetter__`）在**值读面**不得折 exact undefined。
 *
 * 根因：引擎有**两张** `Object.prototype` 名单——
 * - `exec/member-diag.ts` 的 `OBJECT_PROTO_NAMES`（**11** 个，含 legacy 四件）
 * —— 被 **`in` 判定**与不可调用判定使用；
 * - `builtins/ctor.ts` 的 `OBJECT_PROTO_METHOD_NAMES`（此前**只有 6** 个，
 * 无 legacy 四件）—— 被**值读面**使用。
 * ⇒ 同一个成员 `in` 面说有、值读面说没有 ⇒ **同一引擎两面结论相反** +
 * 假绿（`({}).__defineGetter__ === undefined` 恒 true）。
 *
 * 修法：值读面那张表补 legacy 四件（两张表同口径）；`__proto__` /
 * `constructor` 走专门臂，不在此列。
 */



/** litValue 结果解包（ok 时取字面量值） */
const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};



const wrap = (body: string): string => `export function f() { ${body} }`;

const LEGACY = [
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
] as const;


  it("legacy 四件的 `=== undefined` 恒 false（原生恒是函数）；legacy 四件的 `in` 面仍为 true（与值读面同结论）；对照组：既有六件两表都有 ⇒ 值读面仍正确；同步守卫：`in` 面名单 ⊆ 值读面名单 ∪ {constructor, __proto__}", () => {
  {
    for (const k of LEGACY) {
      expect(lit(wrap(`return ({}).${k} === undefined;`))).toBe(false);
      expect(lit(wrap(`return typeof ({}).${k};`))).toBe("function");
    }
  }
  {
    for (const k of LEGACY) {
      expect(lit(wrap(`return "${k}" in {};`))).toBe(true);
    }
  }
  {
    for (const k of ["toString", "valueOf", "toLocaleString", "hasOwnProperty",
      "isPrototypeOf", "propertyIsEnumerable"]) {
      expect(lit(wrap(`return ({}).${k} === undefined;`))).toBe(false);
    }
  }
  {
    const special = new Set(["constructor", "__proto__"]);
    for (const n of OBJECT_PROTO_NAMES) {
      if (special.has(n)) continue;
      expect(
        OBJECT_PROTO_METHOD_NAMES.has(n),
        `OBJECT_PROTO_NAMES 里的 ${n} 未登记进值读面名单（两张表必须同口径）`,
      ).toBe(true);
    }
  }
});




});

// ---------------------------------------------------------------------------
// symbol member call face
// ---------------------------------------------------------------------------
describe("symbol member call face", () => {
/**
 * 符号成员（@@matchAll / @@iterator …）读面说「有」，调用面查的是
 * 另两张表 ⇒ 判「确定不存在」⇒ hard throw TypeError（对永不抛的代码报假红）。
 * 修复：读面说存在的符号成员，调用面不得声称缺失（brand 接收者折 unknown /
 * 迭代器面）。
 */




const SRC = `
export function sMatchAllType() { return typeof /a/g[Symbol.matchAll]; }
export function sMatchAll() { return /a/g[Symbol.matchAll]("a"); }
export function sMatch() { return /a/g[Symbol.match]("a"); }
export function sSearch() { return /a/g[Symbol.search]("a"); }
export function sReplace() { return /a/g[Symbol.replace]("a", "b"); }
export function sSplit() { return /a/g[Symbol.split]("a"); }
export function sDatePrim() { return new Date(0)[Symbol.toPrimitive]("number"); }
export function sUspIter() { return new URLSearchParams("a=1")[Symbol.iterator](); }
export function sTaIter() { return new Uint8Array(2)[Symbol.iterator](); }
export function sMapIter() { return new Map()[Symbol.iterator](); }
`;


  it("no hard TypeError for registered symbol members；iterator member calls yield an iterator face (not undefined)", () => {
  {
    const r = checkSource("/t/bug-165.js", SRC, pTrue);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toHaveLength(0);
  }
  {
    const r = checkSource("/t/bug-165.js", SRC, pTrue);
    expect(sigOf(r, "sUspIter")).toContain("next");
    expect(sigOf(r, "sTaIter")).toContain("next");
    expect(sigOf(r, "sMapIter")).toContain("next");
    expect(sigOf(r, "sMatchAllType")).toBe('"function"');
  }
});


});

// ---------------------------------------------------------------------------
// instanceof RHS without prototype
// ---------------------------------------------------------------------------
describe("instanceof RHS without prototype", () => {
/**
 * `instanceof` RHS 没有 `prototype`（Proxy / 箭头函数 / 方法）时
 * `rhsPrototypeOf` 合成一个 brand 原型 ⇒ 「原型非对象 ⇒ 定抛」门永不触发。
 * 修复：缺省信息不得伪造空值语义。
 */




const P1 = `
export function instProxy() { const o = { a: 1 }; return o instanceof Proxy; }
export function instProxyFn() { const f = function () {}; return f instanceof Proxy; }
export function instMath() { const o = { a: 1 }; return o instanceof Math; }
`;

const P2 = `
export function instArrow() { const o = { a: 1 }; return o instanceof (() => {}); }
export function instGen() { const o = { a: 1 }; return o instanceof (function* () {}); }
export function instMethod() { const o = { a: 1 }; const m = { f() {} }.f; return o instanceof m; }
export function instProxy() { const o = { a: 1 }; return o instanceof Proxy; }
`;


  it("missing prototype ⇒ native TypeError (not a synthetic brand)；generator function has a prototype ⇒ boolean", () => {
  {
    const r = checkSource("/t/bug-175-p1.js", P1, pTrue);
    expect(sigOf(r, "instProxy")).toBe("never throws TypeError");
    expect(sigOf(r, "instProxyFn")).toBe("never throws TypeError");
    expect(sigOf(r, "instMath")).toBe("never throws TypeError");
  }
  {
    const r = checkSource("/t/bug-175-p2.js", P2, pTrue);
    expect(sigOf(r, "instArrow")).toBe("never throws TypeError");
    expect(sigOf(r, "instGen")).toBe("boolean");
    expect(sigOf(r, "instMethod")).toBe("never throws TypeError");
    expect(sigOf(r, "instProxy")).toBe("never throws TypeError");
  }
});


});

// ---------------------------------------------------------------------------
// Reflect.construct(用户类, …) 不记假 may-throw
// ---------------------------------------------------------------------------
describe("Reflect.construct(用户类, …) 不记假 may-throw", () => {
/**
 * 回归：`Reflect.construct(用户类, argsList[, newTarget])` 不得误报
 * may-throw TypeError。
 *
 * 原生（node v26）：用户类值 `class A {}` 恒有 `[[Construct]]`（ClassDefinition-
 * Evaluation 建构造器时装）⇒ `Reflect.construct(A, [])` / `(A, [], B)` **从不抛**。
 * 引擎的类值是 brand + `ctor: true` facet（$class / 类注册表产出）；此前
 * construct 的 **target 侧**只对 fn 形读 ctor facet，brand 一律走「可能不可
 * 构造」⇒ 记 may-throw ⇒ `nudo:entry-may-throw` 假红（exit 1 卡 CI）。
 *
 * 修复：brand + `ctor: true`（类值）⇒ 恒可构造，不记 may；fn 形 ctor 缺省时
 * 先查类注册表（命中 ⇒ 类定义 ⇒ 不记 may）；真·命名空间一等函数（Math.max
 * 等，ctor:false）与实例 brand（无 ctor facet）维持既有保守口径。
 */



const wrap = (body: string) => `export function f() { ${body} }`;


  it("2 参合法形：target/argsList 均为用户类值 → 不抛、不记 may；3 参形（newTarget 亦用户类）→ target/newTarget 两侧均不记 may；内建类值控制组（Array）结论不变：不抛、不记 may；对照：实例 brand 无 ctor facet ⇒ 保守口径保持（不折假不抛）；对照：ctor:false 的宿主一等函数（Math.max）⇒ 定抛 TypeError", () => {
  {
    const src = wrap(`class A { constructor(){ this.t = 1; } } return Reflect.construct(A, []);`);
    const r = call(src);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
    // 假红来源：target 侧「Reflect.construct target may not be a constructor」
    expect(effects(src)).not.toContain("TypeError");
  }
  {
    const src = wrap(
      `class A { constructor(){ this.t = 1; } } class B {} return Reflect.construct(A, [], B);`,
    );
    const r = call(src);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  }
  {
    const src = wrap(`return Reflect.construct(Array, []);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  }
  {
    const src = wrap(`class A {} const a = new A(); return Reflect.construct(a, []);`);
    expect(effects(src)).toContain("TypeError");
  }
  {
    const src = wrap(`return Reflect.construct(Math.max, []);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(true);
  }
});





});

// ---------------------------------------------------------------------------
// derived constructor returning an object
// ---------------------------------------------------------------------------
describe("derived constructor returning an object", () => {
/**
 * 派生构造器 `return {obj}` 时，ES 返回值语义应先于「必须调用
 * super()」门 ⇒ 合法代码被误报必抛。修复：按 ES [[Construct]] 顺序。
 */




const SRC = `
export class BaseB { constructor(){ this.p = 1; } }
export class DerivedB extends BaseB {
  constructor(){ return { q: 1 }; }
}
export function derivedReturnObj() { return new DerivedB(); }
`;


  it("returns the explicit object instead of may-throw", () => {
    const r = checkSource("/t/bug-177.js", SRC, pTrue);
    expect(sigOf(r, "derivedReturnObj")).toBe("{ q: 1 }");
    expect(sigOf(r, "DerivedB")).toBe("DerivedB");
    expect(sigOf(r, "BaseB")).toBe("BaseB");
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// computed literal key member access
// ---------------------------------------------------------------------------
describe("computed literal key member access", () => {
/**
 * `o[k]`（字面量常量键）对 obj / brand 接收者不查成员表 ⇒ getter
 * 返回 unknown。修复：`$idx` 对字面量键委派 `$get`。
 */



const SRC = `
export function f() {
  const k = "n";
  const o = { get n() { return 42; } };
  return o[k];
}
`;

const CONST_KEY = `
export function f() {
  const o = { n: 42 };
  return o["n"];
}
`;


  it("getter through a computed variable key resolves；plain literal key resolves", () => {
  {
    expect(val(SRC)).toEqual({ ok: true, value: 42 });
  }
  {
    expect(val(CONST_KEY)).toEqual({ ok: true, value: 42 });
  }
});


});

// ---------------------------------------------------------------------------
// Proxy has 陷阱的规范不变式
// ---------------------------------------------------------------------------
describe("Proxy has 陷阱的规范不变式", () => {
/**
 * Proxy `has` 陷阱缺 **ES 规范不变式** ⇒ 漏判必抛 TypeError ⇒ 假绿，
 * 并印出宿主不可能产出的值 `false`。
 *
 * ES2023 `[[HasProperty]]` 第 8 步：陷阱结果为 falsy 时取靶的
 * `[[GetOwnProperty]](P)`——存在且 `[[Configurable]]` 为 false ⇒ 定抛
 * `TypeError: 'has' on proxy: trap returned falsish for property 'x' which
 * exists in the proxy target as non-configurable`。
 *
 * 改前 `$in` 的 has 陷阱分支**只取返回值**就 `boolLit(truth)`（无不变式检查）
 * ⇒ `"x" in p` 判 `false` 且不抛：`nudo check` exit 0 假绿，值面还污染
 * `if (k in p)` 的控制流。同族不变式（get 的非配置+不可写、ownKeys 的重复项/
 * 漏键、deleteProperty 的非配置门）引擎都已实现——has 是唯一缺口。
 */



const hasSrc = (targetSetup: string, trapBody: string): string => `export function f(){
  const t = {};
  ${targetSetup}
  const p = new Proxy(t, { has() { return ${trapBody}; } });
  return "x" in p;
}`;


  it("靶上不可配置自有属性 + 陷阱返 false ⇒ 定抛 TypeError（改前：false，不抛）；负控：同一陷阱 + 靶上该键**可配置** ⇒ 不抛，值 false（缺口只在这一格）；负控：靶上**没有**该键 + 陷阱返 false ⇒ 不抛，值 false；负控：陷阱返 true ⇒ 不触发不变式（该门只对 falsy 生效）", () => {
  {
    const r = call(
      hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: false, enumerable: true });`, "false"),
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(
      hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: true, enumerable: true });`, "false"),
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(val(hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: true });`, "false"))).toEqual({
      ok: true,
      value: false,
    });
  }
  {
    expect(throwsError(call(hasSrc("", "false")).throws, "TypeError")).toBe(false);
    expect(val(hasSrc("", "false"))).toEqual({ ok: true, value: false });
  }
  {
    const r = call(
      hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: false });`, "true"),
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  }
});




});

// ---------------------------------------------------------------------------
// String.prototype 的 generic 方法不品牌检查
// ---------------------------------------------------------------------------
describe("String.prototype 的 generic 方法不品牌检查", () => {
/**
 * `String.prototype.*` 的 30 个方法被**品牌检查**（ES2023 §22.1.3 实为
 * **generic**：RequireObjectCoercible + ToString）⇒ 借用调用定抛 TypeError
 * （L2 门禁假红；`String.prototype.toUpperCase.call(1)` 原生 "1"）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：**修表**——`String.prototype` 上只有
 * `toString` / `valueOf` 要品牌（BRAND_CHECK_METHODS 方法级表），其余方法走
 * generic 路（ToString 接收者后派发）；品牌检查判定改由 brandCheckBrandOf
 * 表驱动，Error 家族不进品牌面（）。
 */





  it("toUpperCase.call(1) = '1'（原生 generic；此前定抛 TypeError）；trim / charAt / at / concat 借用给数字接收者 = 原生值；品牌方法仍要品牌（toString / valueOf.call(1) → TypeError）；nullish 接收者仍定抛（RequireObjectCoercible）；其它家族的品牌检查不受影响（Number.toFixed.call('s') → TypeError）；直接字符", () => {
  {
    const r = call(`export function f() { return String.prototype.toUpperCase.call(1); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(r.throws.shape.k).toBe("never");
  }
  {
    expect(
      litValue(call(`export function f() { return String.prototype.trim.call(42); }`).result),
    ).toEqual({ ok: true, value: "42" });
    expect(
      litValue(call(`export function f() { return String.prototype.charAt.call(7); }`).result),
    ).toEqual({ ok: true, value: "7" });
    expect(
      litValue(call(`export function f() { return String.prototype.at.call(1); }`).result),
    ).toEqual({ ok: true, value: "1" });
    expect(
      litValue(
        call(`export function f() { return String.prototype.concat.call(1, "x"); }`).result,
      ),
    ).toEqual({ ok: true, value: "1x" });
  }
  {
    const r = call(`export function f() { return String.prototype.toString.call(1); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
    const r2 = call(`export function f() { return String.prototype.valueOf.call(1); }`);
    expect(isNever(r2.result)).toBe(true);
    expect(throwsError(r2.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(`export function f() { return String.prototype.toUpperCase.call(null); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(`export function f() { return Number.prototype.toFixed.call("s"); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(`export function f() { return "abc".toUpperCase(); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "ABC" });
    expect(r.throws.shape.k).toBe("never");
  }
});






});

// ---------------------------------------------------------------------------
// symbol-keyed writes
// ---------------------------------------------------------------------------
describe("symbol-keyed writes", () => {
/**
 * `$setKey` 对 symbol 键直接走字符串键写面 ⇒ 运行时 symbol 键读写
 * 不一致（写入丢失 / 读到 undefined）。修复：symbol 槽键经 symbolSlotKeyOf
 * 映射到 `@@…` 槽。
 */



const READ = `
export function f() {
  const s = Symbol("k");
  const o = { [s]: 1 };
  return o[s];
}
`;

const OWN_SYMBOLS = `
export function f() {
  const s = Symbol("k");
  const o = { [s]: 1 };
  return Object.getOwnPropertySymbols(o).length;
}
`;

const WRITE_THEN_READ = `
export function f() {
  const s = Symbol("k");
  const o = {};
  o[s] = 7;
  return o[s];
}
`;


  it("literal symbol key reads back；computed symbol assignment reads back；own symbol keys are counted", () => {
  {
    expect(val(READ)).toEqual({ ok: true, value: 1 });
  }
  {
    expect(val(WRITE_THEN_READ)).toEqual({ ok: true, value: 7 });
  }
  {
    expect(val(OWN_SYMBOLS)).toEqual({ ok: true, value: 1 });
  }
});



});

// ---------------------------------------------------------------------------
// Error.prototype.toString 是普通方法（无品牌检查）
// ---------------------------------------------------------------------------
describe("Error.prototype.toString 是普通方法（无品牌检查）", () => {
/**
 * `Error.prototype.toString` 被判**品牌检查**⇒ 定抛 TypeError
 * （L2 门禁假红）。规范里它是**普通方法**（无品牌校验）：只读 this.name /
 * this.message 两个属性（node 实测 `Error.prototype.toString.call({name:"X",
 * message:"y"})` → "X: y"）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：**修表**——Error 家族**不进**品牌
 * 检查面（brandCheckBrandOf 表驱动），并补 generic 实现（只读 name / message；
 * 原始值接收者按 V8 / node 定抛 TypeError）。
 */





  it("toString.call({name:'X', message:'y'}) = 'X: y'（原生；此前定抛）；toString.call({}) = 'Error'（缺省名）；toString.call({name:'X'}) = 'X'（空消息只回名）；空名只回消息（toString.call({name:'',message:'y'}) = 'y'）；TypeError.prototype.toString 同口径（'X: y'）；Error 实例沿既有 brand ", () => {
  {
    const r = call(
      `export function f() { return Error.prototype.toString.call({ name: "X", message: "y" }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "X: y" });
    expect(r.throws.shape.k).toBe("never");
  }
  {
    const r = call(`export function f() { return Error.prototype.toString.call({}); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "Error" });
  }
  {
    const r = call(`export function f() { return Error.prototype.toString.call({ name: "X" }); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "X" });
  }
  {
    const r = call(
      `export function f() { return Error.prototype.toString.call({ name: "", message: "y" }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "y" });
  }
  {
    const r = call(
      `export function f() { return TypeError.prototype.toString.call({ name: "X", message: "y" }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "X: y" });
  }
  {
    const r = call(`export function f() { return Error.prototype.toString.call(new Error("m")); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "Error: m" });
    expect(r.throws.shape.k).toBe("never");
  }
  {
    const r = call(`export function f() { return Error.prototype.toString.call(5); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
});







});

// ---------------------------------------------------------------------------
// Object.create(proto) 继承 proto 的字段存在性
// ---------------------------------------------------------------------------
describe("Object.create(proto) 继承 proto 的字段存在性", () => {
/**
 * `Object.create(proto)` 的 Abs 此前只记**原型身份**
 * （protoTable）、槽面是空 obj ⇒ L1 shape 契约逐字段对账（只查自有槽）报
 * `missing field`（门禁假红），而宿主（`"a" in o` = true）、TypeScript
 * （结构类型）、引擎自己的 guard / zod / standard 三个产物（HasProperty
 * 语义）**全部接受**同一个值 ⇒ 四个面三个接受、一个拒绝。
 *
 * 修复口径（`builtins/object/methods.ts` 的 `inheritedProtoSlots`）：proto
 * 的自有槽键**镜像**为新对象的 `Slot.inherited` 槽（值折 unknown——原型链
 * 取值仍是精度债，只承诺**存在性**）。继承槽可见于 `$get` / `$in`，
 * 但**不进**自有键视图（Object.keys/values/entries / for-in /
 * CopyDataProperties / JSON）——与原生一致。
 *
 * 宿主 node v26.10.0 对照：
 * `const o = Object.create({a:1})` → `"a" in o` true、`Object.hasOwn(o,"a")`
 * false、`Object.keys(o)` []。
 */





const create = (expr: string) =>
  val(`export function f() { const o = Object.create({ a: 1 }); return ${expr}; }`);


  it("\"a\" in Object.create({a:1}) 折 exact true（HasProperty 口径）；自有键面不得见继承槽（Object.keys/values/entries/for-in）；值面维持保守 unknown（只承诺存在性，不冒充确定值）；对照：自有属性对象行为不变；门禁面：f(Object.create({a:1})) 不再报 missing field（与三个导出产物同结论）；门禁面负控制：真缺字段仍报 missing field（不得整面放水）", () => {
  {
    expect(create('"a" in o')).toEqual({ ok: true, value: true });
  }
  {
    expect(create("JSON.stringify(Object.keys(o))")).toEqual({ ok: true, value: "[]" });
    expect(create("JSON.stringify(Object.values(o))")).toEqual({ ok: true, value: "[]" });
    expect(create("JSON.stringify(Object.entries(o))")).toEqual({ ok: true, value: "[]" });
    // Object.hasOwn 仍是 false（继承 vs 自有）
    expect(create('Object.hasOwn(o, "a")')).toEqual({ ok: true, value: false });
  }
  {
    expect(create("o.a")).toEqual({ ok: false, value: undefined });
  }
  {
    expect(
      val(`export function f() { const o = { a: 1 }; return "a" in o; }`),
    ).toEqual({ ok: true, value: true });
    expect(
      val(`export function f() { const o = { a: 1 }; return JSON.stringify(Object.keys(o)); }`),
    ).toEqual({ ok: true, value: '["a"]' });
  }
  {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, number, shape } from "@nudojs/core";
export const f = fn({ v: shape({ a: number() }) }, any());`,
    });
    const src = `
export function f(v) {
  return v;
}
export function own() {
  return f({ a: 1 });
}
export function inherited() {
  return f(Object.create({ a: 1 }));
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, number, shape } from "@nudojs/core";
export const f = fn({ v: shape({ a: number() }) }, any());`,
    });
    const src = `
export function f(v) {
  return v;
}
export function bad() {
  return f({});
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(violated[0]!.expected).toContain("missing field v.a");
    expect(r.ok).toBe(false);
  }
  {
    const r = call(
      `export function f() { const o = Object.create(null); return "toString" in o; }`,
    );
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("prim");
    expect(val(`export function f() { const o = Object.create(null); return "a" in o; }`)).toEqual({
      ok: true,
      value: false,
    });
  }
});







});

// ---------------------------------------------------------------------------
// Proxy 靶不可调用 → 调用定抛 TypeError
// ---------------------------------------------------------------------------
describe("Proxy 靶不可调用 → 调用定抛 TypeError", () => {
/**
 * Proxy 的 `[[Call]]` **不检查靶是否可调用** —— 代理一个不可调用
 * 靶（`{}` / `[]` / 类）时，引擎恒判「可调用」⇒ 调用不抛且**不记
 * may-throw** ⇒ 声称「永不抛」⇒ L2 `nudo:entry-may-throw` 假绿。
 *
 * 规范：ProxyCreate 只在**靶可调用**时才给代理装 `[[Call]]` 内部槽——
 * 靶不可调用时代理没有 `[[Call]]`，调用它定抛 TypeError（且**不派发**
 * apply 陷阱）。
 *
 * 修复（packages/core/src/algebra/exec/call.ts）：
 * - `$callDispatch` 遇 Proxy brand → `callProxyAbs`：先按**靶**判可调用性
 * （callableFacetOf 三档：true / false / 不可判），false ⇒ hard NudoThrow。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}


  it("靶是普通对象 → throws TypeError（此前 unknown + never）；靶是数组 → throws TypeError；靶是类值 → throws TypeError（类构造器不带 new 被调）；靶不可调用 → apply 陷阱**不派发**（原生同口径）；控制组：可调用靶的代理调用正常（不抛）；控制组：代理的读面正常（get 陷阱不受影响）", () => {
  {
    const r = call(
      `export function f() {
  const p = new Proxy({}, {});
  return p();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(
      `export function f() {
  const p = new Proxy([], {});
  return p();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(
      `class A {}
export function f() {
  const p = new Proxy(A, {});
  return p();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      v(`export function f() {
  const log = [];
  const p = new Proxy({}, { apply(t, thisArg, args) { log.push("apply"); return 1; } });
  try { p(); return "nothrow|" + log.join(","); } catch (e) { return "threw:" + e.name + "|" + log.join(","); }
}`),
    ).toEqual({ ok: true, value: "threw:TypeError|" });
  }
  {
    expect(
      v(`export function f() {
  const p = new Proxy(function (x) { return x * 2; }, {});
  return p(21);
}`),
    ).toEqual({ ok: true, value: 42 });
  }
  {
    expect(
      v(`export function f() {
  const p = new Proxy({ x: 1 }, {});
  return p.x;
}`),
    ).toEqual({ ok: true, value: 1 });
  }
});






});

// ---------------------------------------------------------------------------
// Proxy [[Call]] 回退靶 + 派发 apply 陷阱
// ---------------------------------------------------------------------------
describe("Proxy [[Call]] 回退靶 + 派发 apply 陷阱", () => {
/**
 * Proxy 的 `[[Call]]` 既**不回退靶**、**不派发 `apply` 陷阱**
 * —— 引擎声称代理调用「永不抛」且结果恒 unknown（假绿 + 错值）。
 *
 * 规范（Proxy [[Call]]）：靶可调用时，`[[Call]]` 先取 handler 的 `apply`
 * 陷阱（实参 `(target, thisArg, args)`），**无** apply 陷阱才回退**靶**的
 * `[[Call]]`。
 *
 * 修复（packages/core/src/algebra/exec/call.ts` + `exec/match-iter.ts`）：
 * - `proxyTrapOf` 陷阱名联合补 `"apply"`（此前并集里没有 ⇒ 陷阱**从不派发**，
 * 陷阱副作用整体丢失）。
 * - `$callDispatch` 遇 Proxy brand → `callProxyAbs`：apply 陷阱优先、
 * 缺席回退靶；陷阱实参按原生口径 (target, thisArg, args)。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}


  it("无 apply 陷阱 → 回退靶的 [[Call]]（此前恒 unknown）；apply 陷阱 → 派发并取其返回值；apply 陷阱副作用保留（此前陷阱从未被调用）；apply 陷阱实参口径：(target, thisArg, args)；控制组：get 陷阱仍照旧派发（本次只加 apply 面）", () => {
  {
    expect(
      v(`export function f() {
  const p = new Proxy(function (x) { return x * 2; }, {});
  return p(21);
}`),
    ).toEqual({ ok: true, value: 42 });
  }
  {
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t, thisArg, args) { return args[0]; } });
  return p(42);
}`),
    ).toEqual({ ok: true, value: 42 });
  }
  {
    expect(
      v(`export function f() {
  let seen = 0;
  const p = new Proxy(function () { return 1; }, { apply() { seen = 1; return 7; } });
  const r = p();
  return String(seen) + "," + String(r);
}`),
    ).toEqual({ ok: true, value: "1,7" });
  }
  {
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t) { return typeof t; } });
  return p();
}`),
    ).toEqual({ ok: true, value: "function" });
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t, thisArg) { return typeof thisArg; } });
  return p();
}`),
    ).toEqual({ ok: true, value: "undefined" });
    expect(
      v(`export function f() {
  const p = new Proxy(function () {}, { apply(t, thisArg, args) { return args.length; } });
  return p(1, 2, 3);
}`),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(
      v(`export function f() {
  const p = new Proxy({}, { get(t, k) { return k === "x" ? 42 : undefined; } });
  return p.x;
}`),
    ).toEqual({ ok: true, value: 42 });
  }
});





});

// ---------------------------------------------------------------------------
// 复数 gOPDs 必须有 brand 分支（键集与 gOPN 同口径）
// ---------------------------------------------------------------------------
describe("复数 gOPDs 必须有 brand 分支（键集与 gOPN 同口径）", () => {
/**
 * `Object.getOwnPropertyDescriptors`（**复数**）没有 `brand` 分支
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


  it("类实例：描述符映射的键集 = 自有键集（改前 []）；类实例：键集与 gOPN / gOPD(单数) 三面一致（引擎内部不再互斥）；描述符内容精确：类字段是 writable/enumerable/configurable 全真的数据属性；内建 brand（Error 家族）：键集 = 自有键集（stack/message，name 是原型链槽）；内建 brand（Map + m.foo）：键集 = 用户新增自有键；单变量对照组 A：普通对象（引擎 == 宿主）；单变量对照组", () => {
  {
    expect(tupleLits(absOf("const inst = new C(); return Object.keys(Object.getOwnPropertyDescriptors(inst));"))).toEqual([
      "x",
      "y",
    ]);
  }
  {
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
  }
  {
    expect(
      tupleLits(
        absOf(`
  const inst = new C();
  const d = Object.getOwnPropertyDescriptors(inst).x;
  return [d.value, d.writable, d.enumerable, d.configurable];
`),
      ),
    ).toEqual([1, true, true, true]);
  }
  {
    expect(
      tupleLits(
        absOf('const e = new TypeError("boom"); return Object.keys(Object.getOwnPropertyDescriptors(e));'),
      ),
    ).toEqual(["stack", "message"]);
  }
  {
    expect(
      tupleLits(
        absOf("const m = new Map(); m.foo = 1; return Object.keys(Object.getOwnPropertyDescriptors(m));"),
      ),
    ).toEqual(["foo"]);
  }
  {
    expect(tupleLits(absOf("return Object.keys(Object.getOwnPropertyDescriptors({ x: 1, y: 2 }));"))).toEqual([
      "x",
      "y",
    ]);
  }
  {
    expect(tupleLits(absOf("return Object.keys(Object.getOwnPropertyDescriptors([1, 2]));"))).toEqual([
      "0",
      "1",
      "length",
    ]);
  }
  {
    expect(
      tupleLits(
        absOf(`
  const inst = new C();
  Object.defineProperty(inst, "x", { enumerable: false });
  return Object.keys(Object.getOwnPropertyDescriptors(inst));
`),
      ),
    ).toEqual(["x", "y"]);
  }
  {
    // 函数接收者：gOPDs 没有品牌槽表可投影 ⇒ 结果对象必须带「键集不完备」
    // 标记 ⇒ Object.keys 折 partial string[]（改前折 exact []）
    const a = absOf("return Object.keys(Object.getOwnPropertyDescriptors(() => 1));");
    expect(a.shape.k).toBe("arr");
    expect((a.shape as { element: Abs }).element.shape).toMatchObject({ k: "prim", type: "string" });
  }
});









});

// ---------------------------------------------------------------------------
// Object.isExtensible 派发 Proxy 的 isExtensible 陷阱
// ---------------------------------------------------------------------------
describe("Object.isExtensible 派发 Proxy 的 isExtensible 陷阱", () => {
/**
 * Proxy 的 `isExtensible` 陷阱**从不派发** ⇒ `Object.isExtensible(proxy)`
 * 折**确定 true**（原生必抛 TypeError：陷阱报 false 而靶实际可扩展 ⇒ 规范
 * 不变量冲突），且陷阱的副作用整体丢失（假绿 + 错值）。
 *
 * 修复（packages/core/src/algebra/builtins/object/methods.ts）：
 * - "isExtensible" 分支接线 Proxy 臂 → `proxyIsExtensible`：
 * GetMethod(handler, "isExtensible") → 缺席回退**靶**的 [[IsExtensible]]；
 * ToBoolean(陷阱结果) 与靶的实际可扩展性不一致 ⇒ TypeError。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}


  it("陷阱报 false 而靶可扩展 → TypeError（此前恒折 true）；陷阱报 true 而靶可扩展 → true（陷阱被调用，副作用保留）；靶已不可扩展：陷阱报 false → false（不变量一致，不抛）；靶已不可扩展：陷阱报 true → TypeError（不变量冲突）；陷阱副作用保留（此前陷阱从未被调用）；无陷阱 → 回退靶语义（控制组）；控制组：普通对象 → true；不可扩展普通对象 → false；陷阱内抛出的 TypeError 透出（throws ", () => {
  {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return false; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|ie" });
  }
  {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return true; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "true|ie" });
  }
  {
    expect(
      v(`export function f() {
        const log = [];
        const t = Object.preventExtensions({ a: 1 });
        const p = new Proxy(t, { isExtensible(x) { log.push("ie"); return false; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "false|ie" });
  }
  {
    expect(
      v(`export function f() {
        const log = [];
        const t = Object.preventExtensions({ a: 1 });
        const p = new Proxy(t, { isExtensible(x) { log.push("ie"); return true; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|ie" });
  }
  {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return true; } });
        Object.isExtensible(p);
        return log.join(",");
      }`),
    ).toEqual({ ok: true, value: "ie" });
  }
  {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, {});
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "true|" });
  }
  {
    expect(v(`export function f() { return Object.isExtensible({ a: 1 }); }`)).toEqual({
      ok: true,
      value: true,
    });
    expect(
      v(`export function f() { const o = Object.preventExtensions({ a: 1 }); return Object.isExtensible(o); }`),
    ).toEqual({ ok: true, value: false });
  }
  {
    const r = call(
      `export function f() {
        const p = new Proxy({ a: 1 }, { isExtensible() { throw new TypeError("boom"); } });
        return Object.isExtensible(p);
      }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(
      `export function f() {
        const p = new Proxy({ a: 1 }, { isExtensible() { return false; } });
        return Object.isExtensible(p);
      }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1 }, { isExtensible(t) { log.push("ie"); return 1; } });
        try { return String(Object.isExtensible(p)) + "|" + log.join(","); }
        catch (e) { return "threw:" + e.name + "|" + log.join(","); }
      }`),
    ).toEqual({ ok: true, value: "true|ie" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1 }, {});
        Object.preventExtensions(p);
        return String(Object.isExtensible(p));
      }`),
    ).toEqual({ ok: true, value: "false" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1 }, {});
        Object.freeze(p);
        return String(Object.isExtensible(p));
      }`),
    ).toEqual({ ok: true, value: "false" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1 }, {
          preventExtensions(t) { Object.preventExtensions(t); return true; },
          isExtensible() { return false; },
        });
        Object.preventExtensions(p);
        return String(Object.isExtensible(p));
      }`),
    ).toEqual({ ok: true, value: "false" });
  }
});













});

// ---------------------------------------------------------------------------
// for…in 走 Proxy 的 ownKeys 陷阱
// ---------------------------------------------------------------------------
describe("for…in 走 Proxy 的 ownKeys 陷阱", () => {
/**
 * Proxy 的 `for…in` **完全无视 `ownKeys` 陷阱** ⇒ 枚举出**靶对象**的
 * 自有可枚举键（精确错值：原生 "" 而引擎 "ac"）。
 *
 * 修复（packages/core/src/algebra/exec/runtime/containers/iterate.ts）：
 * `$forInKeys` 加 Proxy 臂 → `proxyForInKeys`：
 * 1. [[OwnPropertyKeys]] → ownKeys 陷阱（proxyOwnKeysTrapKeys：单一实现，含
 * 规范不变量校验——重复名 / 非字符串键 / 漏靶的不可配置自有键 ⇒ TypeError）；
 * 2. 每个键按 [[GetOwnProperty]] 判**可枚举性**（gOPD 陷阱优先，否则靶的自有
 * 描述符）——不可枚举 / 靶上不存在 ⇒ 不进结果；
 * 3. 键序 = 陷阱结果的顺序（原生 for-in 不重排整数键）。
 *
 * 已知保守偏差（**不钉**，待 descriptor.ts 的 gOPD 派发面区分「陷阱返回
 * undefined」与「形态不可判」后再收口）：gOPD 陷阱返回 undefined ⇒ 原生
 * 「该属性不存在」⇒ for…in 精确空；引擎侧 proxyGetOwnPropDescTrap 把
 * undefined 与 opaque 合并 ⇒ 键面降级为抽象字符串键（0..N 次，保守方向）。
 */




function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}


  it("陷阱返回不在靶上的键 → 0 次（此前枚举靶的 2 个键）；陷阱返回不在靶上的键 → 键序列为空（此前 \"ac\"）；陷阱部分命中 → 只枚举可枚举的命中键；陷阱全命中 → 键序按陷阱结果（原生不重排整数键）；无 ownKeys 陷阱 → 落靶语义（控制组）；陷阱返回重复键 → 原生抛 TypeError（规范不变量）；陷阱漏掉靶的不可配置自有键 → 原生抛 TypeError（规范不变量）；陷阱副作用保留（此前陷阱从未被调用）；控制组：普通对象的 for…in 不受影响；gO", () => {
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b"]; } });
        let n = 0; for (const k in p) n = n + 1;
        return String(n);
      }`),
    ).toEqual({ ok: true, value: "0" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b"]; } });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["a", "z"]; } });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "a" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["c", "a"]; } });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "ca" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, {});
        let n = 0; for (const k in p) n = n + 1;
        return String(n);
      }`),
    ).toEqual({ ok: true, value: "2" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b", "b"]; } });
        let n = 0; try { for (const k in p) n = n + 1; return "n=" + n; }
        catch (e) { return "threw:" + e.name + "|" + n; }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|0" });
  }
  {
    expect(
      v(`export function f() {
        const t = {};
        Object.defineProperty(t, "a", { value: 1, enumerable: true, configurable: false, writable: true });
        const p = new Proxy(t, { ownKeys() { return []; } });
        let n = 0; try { for (const k in p) n = n + 1; return "n=" + n; }
        catch (e) { return "threw:" + e.name + "|" + n; }
      }`),
    ).toEqual({ ok: true, value: "threw:TypeError|0" });
  }
  {
    expect(
      v(`export function f() {
        const log = [];
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { log.push("ok"); return ["b"]; } });
        let n = 0; for (const k in p) n = n + 1;
        return log.join(",") + "|n=" + n;
      }`),
    ).toEqual({ ok: true, value: "ok|n=0" });
  }
  {
    expect(
      v(`export function f() {
        const o = { a: 1, c: 3 };
        let s = ""; for (const k in o) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "ac" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, {
          ownKeys() { return ["a", "c"]; },
          getOwnPropertyDescriptor(t, k) { return { value: 1, enumerable: false, configurable: true }; },
        });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "" });
  }
  {
    expect(
      v(`export function f() {
        const p = new Proxy({ a: 1, c: 3 }, {
          ownKeys() { return ["a", "b"]; },
          getOwnPropertyDescriptor(t, k) { return { value: 1, enumerable: true, configurable: true }; },
        });
        let s = ""; for (const k in p) s = s + k;
        return s;
      }`),
    ).toEqual({ ok: true, value: "ab" });
  }
  {
    const r = call(
      `export function f() {
        const p = new Proxy({ a: 1, c: 3 }, { ownKeys() { return ["b", "b"]; } });
        let n = 0; for (const k in p) n = n + 1;
        return n;
      }`,
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
});












});

// ---------------------------------------------------------------------------
// structuredClone 按可克隆性分档（不再一律 may TypeError）
// ---------------------------------------------------------------------------
describe("structuredClone 按可克隆性分档（不再一律 may TypeError）", () => {
/**
 * 宿主全局 `structuredClone` 的**抽象实参**一律记 may `TypeError`
 * ⇒ ① 可克隆形态（普通对象 / 数组 / Date / Map / Set / RegExp）**假红**
 * （L1/L2 门禁红，而 native 不抛）；② 不可克隆形态（Symbol / 函数 /
 * WeakMap / Promise）**抛错类型错**（native 抛 `DOMException`
 * `DataCloneError`，引擎记 `TypeError`）⇒ 契约面写不出
 * `@nudo:throws DataCloneError`。
 *
 * 根因：`exec/calls.ts` 的 `callHostGlobalLiteralOnly` 对**任一**抽象实参
 * 一律记 may `TypeError`（cause 写「Symbol coercion」）——那条推理只对
 * 「对实参做 ToString / ToNumber」的宿主函数成立（parseInt / Number /
 * decodeURIComponent / btoa …），而 `structuredClone` 走**结构化克隆算法**
 * （完全不对实参做 ToString）⇒ 该 cause 与它代表的推理在 `structuredClone`
 * 上不成立。
 *
 * 修法：把 `structuredClone` 从「抽象实参一律抛」里**排除**，按实参形态
 * 的**可克隆性**分档——可克隆形态不记抛；不可克隆形态记
 * **`DataCloneError`**（宿主 DOMException 的 name，**不是** `TypeError`）。
 *
 * 证据口径：原生 oracle（同进程真实 `structuredClone`）+ 引擎探针。
 */





function check(src: string) {
  return checkSource___nudojs_core("/t/core-bug-288.js", src, pTrue___nudojs_core, {});
}

/** 引擎侧 throws 面名（brand 名 / never） */
function throwsName(t: unknown): string {
  const s = (t as { shape?: { k?: string; name?: string } } | undefined)?.shape;
  if (!s || s.k === "never") return "never";
  return s.k === "brand" ? (s.name ?? "brand") : (s.k ?? "never");
}

/** 可克隆形态：native 不抛 ⇒ 引擎不得记抛（原口径是假红） */
const CLONEABLE: Array<[string, string]> = [
  ["plain object", `return structuredClone({ a: 1 });`],
  ["nested object", `return structuredClone({ a: { b: [1, 2] } });`],
  ["array", `return structuredClone([1, 2]);`],
  ["Date", `return structuredClone(new Date(0));`],
  ["Map", `return structuredClone(new Map([[1, 2]]));`],
  ["Set", `return structuredClone(new Set([1]));`],
  ["RegExp", `return structuredClone(/x/g);`],
  ["user class instance", `class C { constructor() { this.a = 1; } }\nreturn structuredClone(new C());`],
  ["alias of host fn", `const f = structuredClone;\nreturn f({ a: 1 });`],
];

/** 不可克隆形态：native 抛 DataCloneError ⇒ 引擎须记 DataCloneError */
const NOT_CLONEABLE: Array<[string, string]> = [
  ["symbol", `return structuredClone(Symbol("x"));`],
  ["arrow fn", `return structuredClone(() => 1);`],
  ["function decl", `return structuredClone(function f() { return 1; });`],
  ["WeakMap", `return structuredClone(new WeakMap());`],
  ["Promise", `return structuredClone(Promise.resolve(1));`],
  ["object with fn prop", `return structuredClone({ f: () => 1 });`],
  ["nested fn prop", `return structuredClone({ a: { b: () => 1 } });`],
  ["class with fn prop", `class C { constructor() { this.f = () => 1; } }\nreturn structuredClone(new C());`],
];

{
  it("原生 oracle：可克隆形态不抛 / 不可克隆形态抛 DataCloneError；L2 门禁：可克隆形态零 L2（原口径：一条 may throw TypeError 假红）；L2 门禁：不可克隆形态一条 L2（kind = DataCloneError）；契约面：`@nudo:throws DataCloneError` 能申报（原先写不出正确的 kind）；无约束实参（any）：仍诚实记 may-throw，但 kind 是 DataCloneError；try-ca", () => {
  {
    expect(structuredClone({ a: 1 })).toEqual({ a: 1 });
    expect(structuredClone(new Date(0))).toBeInstanceOf(Date);
    expect(structuredClone([1, 2])).toEqual([1, 2]);
    let name = "";
    try {
      structuredClone(Symbol("x"));
    } catch (e) {
      name = (e as Error).name;
    }
    expect(name, "native 抛 DOMException(DataCloneError)").toBe("DataCloneError");
    let fnName = "";
    try {
      structuredClone(() => 1);
    } catch (e) {
      fnName = (e as Error).name;
    }
    expect(fnName).toBe("DataCloneError");
  }
  {
    for (const [, body] of CLONEABLE) {
      const r = check(`export function f() {\n${body}\n}`);
      expect(l2Count(r, "f"), `可克隆形态不应报 may-throw：${body}`).toBe(0);
      expect(r.summary.errors).toBe(0);
    }
  }
  {
    for (const [, body] of NOT_CLONEABLE) {
      const r = check(`export function f() {\n${body}\n}`);
      expect(l2Count(r, "f"), `不可克隆形态应报 may-throw：${body}`).toBe(1);
      const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
      expect(issue?.message).toContain("DataCloneError");
      expect(issue?.message).not.toContain("TypeError");
    }
  }
  {
    const r = check(`/**\n * @nudo:throws DataCloneError\n */\nexport function f() { return structuredClone(() => 1); }`);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.summary.errors).toBe(0);
    // 展示层仍上屏事实（门禁过滤 ≠ 藏事实）
    expect(r.signatures[0]?.throws).toContain("DataCloneError");
  }
  {
    // 入口无约束 = any = 诚实 may-throw（既定 policy，见 check-entry-may-throw-fp）
    expect(effects(`export function f(x) { return structuredClone(x); }`, "f")).toEqual([
      "DataCloneError",
    ]);
  }
  {
    const rec = call(
      `export function f() { try { return structuredClone(() => 1); } catch (e) { return "caught"; } }`,
      "f",
    );
    const lv = rec.result.term;
    expect(lv && lv.op === "lit" ? lv.value : undefined).toBe("caught");
    expect(throwsName(rec.throws)).toBe("never");
  }
  {
    const rec = call(`export function f() { return parseInt(Symbol("x")); }`, "f");
    expect(throwsName(rec.throws)).toBe("TypeError");
  }
});

  it.each(CLONEABLE)("可克隆形态（%s）：零 throws 面（native 不抛 ⇒ 原口径是假红）", (_name, body) => {
    const rec = call(`export function f() {\n${body}\n}`, "f");
    expect(throwsName(rec.throws), "可克隆形态不得记抛").toBe("never");
    expect(isNever(rec.throws)).toBe(true);
    // 签名面（may-throw 效果的展示位）：原口径在此挂 TypeError ⇒ 假红
    const r = check(`export function f() {\n${body}\n}`);
    expect(r.signatures[0]?.throws, "签名不得带 throws 面").toBeUndefined();
  });

  it.each(NOT_CLONEABLE)("不可克隆形态（%s）：throws 面 = DataCloneError（不是 TypeError）", (_name, body) => {
    const rec = call(`export function f() {\n${body}\n}`, "f");
    expect(throwsName(rec.throws)).toBe("DataCloneError");
    expect(throwsError(rec.throws, "DataCloneError")).toBe(true);
    expect(throwsError(rec.throws, "TypeError"), "不得记 TypeError").toBe(false);
  });






}
});

// ---------------------------------------------------------------------------
// pick 不把原型链成员当字段
// ---------------------------------------------------------------------------
describe("pick 不把原型链成员当字段", () => {
/**
 * `pick(shape({…}), keys)` 用 `d.fields[k]` 取字段，**沿原型链读**：
 * `"constructor"` / `"toString"` / `"valueOf"` 会命中 `Object.prototype` 成员，
 * 判真后被当成字段塞进新字段表 ⇒ 消费端读 `f.constraint` 拿到 `undefined`
 * ⇒ `nudo contract` / `nudo export` 面裸崩（内部 TypeError 外泄），
 * `nudo check` 面整条契约静默作废（假绿）。
 *
 * 修法（core/algebra/constraint.ts `pick`）：取字段用**自有属性**判定
 * （`Object.hasOwn`）——原型链成员与非自有键一律视作「不存在的 key」忽略。
 */



const PROTO_KEYS = ["constructor", "toString", "valueOf", "hasOwnProperty"];


  it("原型链 key 不进字段表（constructor / toString / valueOf …）；字段表里的每个条目都是真字段（带 constraint）；原型链 key 不得让契约崩溃（entry Abs / 实例化面）；合法 key 仍然取到字段", () => {
  {
    for (const k of PROTO_KEYS) {
      const p = pick_____constraint_ts(shape_____constraint_ts({ a: number_____constraint_ts() }), [k]);
      const fields = p.fields ?? {};
      expect(Object.prototype.hasOwnProperty.call(fields, k)).toBe(false);
    }
  }
  {
    const p = pick_____constraint_ts(shape_____constraint_ts({ a: number_____constraint_ts() }), ["a"]);
    const fields = p.fields ?? {};
    expect(Object.keys(fields)).toEqual(["a"]);
    expect(fields["a"]!.constraint).toBeDefined();
  }
  {
    const p = pick_____constraint_ts(shape_____constraint_ts({ a: number_____constraint_ts() }), ["constructor"]);
    expect(() => constraintToEntryAbs(p, "x")).not.toThrow();
    expect(() => instantiateConstraint(p, "x")).not.toThrow();
  }
  {
    const p = pick_____constraint_ts(shape_____constraint_ts({ a: number_____constraint_ts(), b: number_____constraint_ts() }), ["b"]);
    expect(Object.keys(p.fields ?? {})).toEqual(["b"]);
  }
});




});

// ---------------------------------------------------------------------------
// shape 非对象实参守卫
// ---------------------------------------------------------------------------
describe("shape 非对象实参守卫", () => {
/**
 * `shape(42)` 这类**非对象实参**：`Object.entries(42)` ⇒ `[]` ⇒
 * 整条参数契约退化成「空 shape」⇒ 域放宽到「任意对象」⇒ 门禁**假绿**
 * （合法实参与违约实参同样放行），且全程零诊断。
 *
 * 修法：`shape` 实参守卫（切片① 的共用校验 `requireFieldsObject`）——
 * 非对象 ⇒ 点名构造器 + 实际类型的 Nudo 原生诊断。
 */








{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  });

  it("shape(42) 抛 Nudo 原生诊断（点名构造器 + 实际类型）；shape(null) / shape([]) / shape(\"x\") 同样被拒；正常实参不受影响；产品面：shape(42) 的侧车契约不再静默退化成空 shape", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => shape(42 as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape(42 as never)).toThrow(/got number/);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => shape(null as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape([] as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape("x" as never)).toThrow(/nudo shape\(\)/);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const s = shape({ a: number() });
    expect(Object.keys(s.fields ?? {})).toEqual(["a"]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, any } from "@nudojs/core";
export const f = fn({ o: shape(42) }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
export function g() {
  return f({ a: 1 });
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("nudo shape()");
    // 改前：契约退化成空 shape ⇒ 门禁 0 error（假绿）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  }
});



}
});

// ---------------------------------------------------------------------------
// 对象键走 ToPropertyKey（写落地）
// ---------------------------------------------------------------------------
describe("对象键走 ToPropertyKey（写落地）", () => {
/**
 * 计算成员访问的**对象键**不做 ToPropertyKey：写被静默丢弃、
 * 键强制转换副作用全丢。
 *
 * 修前（HEAD）：`propertyKeyOf` 只认**字面量** term ⇒ 对象键落「抽象键」臂 ⇒
 * - 写被**静默丢弃**（`o[{}] = 1` 之后 `Object.keys(o).length` = 0；native 1）
 * - 键的强制转换副作用全丢（`k.toString()` 从不执行 ⇒ 计数器恒 0）
 * - 键集面还折 **exact 空元组**（自信的确切错值）
 *
 * 修后：对象键走 ToPropertyKey（ToPrimitive(string) → ToString），钩子**真调用**
 * （与 的钩子调用面同口径）；键**不可判**时写不得静默丢弃 ⇒ 打
 * 「自有键集不完备」标记（键家族据此折 partial，**不得**折 exact 空元组）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */




  it("`o[{}] = 1` 的键为 \"[object Object]\" ⇒ 写落地（native：1）；`o[k] = 1`（k 有 toString）⇒ 键为 toString 的结果（native：1）；类实例接收者同样落地（native：\"number\"）；读面：对象键读到对应的槽值（native：1）", () => {
  {
    expect(val(`export function f() { const o = {}; o[{}] = 1; return Object.keys(o).length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  }
  {
    expect(
      val(
        `export function f() { const o = {}; const k = { toString(){ return "kk"; } }; o[k] = 1; return Object.keys(o).length; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(`export function f() { class A {} const a = new A(); a[{}] = 1; return typeof a["[object Object]"]; }`),
    ).toEqual({ ok: true, value: "number" });
  }
  {
    expect(
      val(
        `export function f() { const o = {kk: 1}; const k = { toString(){ return "kk"; } }; return o[k]; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
});





describe("键的强制转换副作用不再全丢", () => {
  it("写面：键的 toString 被调一次（native：1）；读面：键的 toString 被调一次（native：1）", () => {
  {
    expect(
      val(
        `export function f() { let n = 0; const o = {}; const k = { toString(){ n++; return "kk"; } }; o[k] = 1; return n; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        `export function f() { let n = 0; const o = {kk: 1}; const k = { toString(){ n++; return "kk"; } }; const v = o[k]; return n; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
});

});

describe("键不可判 ⇒ 写不得静默丢弃（键集面不折 exact 空元组）", () => {
  it("函数键的 ToString 不可判 ⇒ 键集折 partial（native：1，引擎不得折 exact 0）", () => {
    const r = val(`export function f() { const o = {}; o[function f(){}] = 1; return Object.keys(o).length; }`);
    expect(r.ok).toBe(false);
  });
});

describe("对照组（字面量键）不得回归", () => {
  it("字符串键 / 数字键照旧落地（native：1）", () => {
    expect(val(`export function f() { const o = {}; o["x"] = 1; return Object.keys(o).length; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(val(`export function f() { const o = {}; o[1] = 1; return Object.keys(o).length; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });
});
});

// ---------------------------------------------------------------------------
// 不可变原型 Object.prototype：Object.setPrototypeOf 抛 TypeError
// ---------------------------------------------------------------------------
describe("不可变原型 Object.prototype：Object.setPrototypeOf 抛 TypeError", () => {
/**
 * `Object.setPrototypeOf(Object.prototype, …)` **不查不可变原型**：
 * 引擎**静默改写** `Object.prototype` 的原型并声称「不会抛」（假绿）。
 *
 * 修前（HEAD）：`protoChangeAllowed` 只查 extensibility + SameValue ⇒
 * `Object.setPrototypeOf(Object.prototype, {})` **不抛**（native：TypeError:
 * Immutable prototype object 'Object.prototype' cannot have their prototype set）。
 *
 * 修后：**同一事实源**（`protoChangeAllowed`，builtins/object/methods.ts——
 * 与 的原型环判定同处）——
 * - `Object.setPrototypeOf` 据此**抛 TypeError**（native 同款）
 * - `Reflect.setPrototypeOf` 据此**返 false**（native 口径：Reflect 不抛）
 *
 * 不可变原型的范围（规范 + V8 实测）：**仅 `Object.prototype`**——其余内建
 * 原型（Array / Function / String / … .prototype）**可**改（native 不抛）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */




  it("`Object.setPrototypeOf(Object.prototype, {})` ⇒ 抛 TypeError（native：同款）；用户 try/catch 捕到（native：\"threw\"）；设为自身原型同样拒绝（native：同款）", () => {
  {
    const rec = call(`export function f() { Object.setPrototypeOf(Object.prototype, {}); return 1; }`);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      val(
        `export function f() { try { Object.setPrototypeOf(Object.prototype, {}); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
  {
    expect(
      val(
        `export function f() { try { Object.setPrototypeOf(Object.prototype, Object.prototype); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
});




describe("不可变原型：Reflect.setPrototypeOf 返 false（Reflect 口径不抛）", () => {
  it("`Reflect.setPrototypeOf(Object.prototype, {})` ⇒ false（native：false）", () => {
    expect(
      val(`export function f() { return Reflect.setPrototypeOf(Object.prototype, {}); }`),
    ).toEqual({ ok: true, value: false });
  });
});

describe("对照组（其余内建原型可改）不得回归", () => {
  it("`Object.setPrototypeOf(Array.prototype, {})` 不抛（native：可改）；`Reflect.setPrototypeOf(Array.prototype, {})` 返 true（native：true）", () => {
  {
    expect(
      val(`export function f() { try { Object.setPrototypeOf(Array.prototype, {}); return "no-throw"; } catch { return "threw"; } }`),
    ).toEqual({ ok: true, value: "no-throw" });
  }
  {
    expect(
      val(`export function f() { return Reflect.setPrototypeOf(Array.prototype, {}); }`),
    ).toEqual({ ok: true, value: true });
  }
});

});
});

// ---------------------------------------------------------------------------
// `__proto__` 槽在契约投影层不被吞掉（族 17 / 已修，本钉防回归）
// ---------------------------------------------------------------------------
describe("`__proto__` 槽在契约投影层不被吞掉（族 17 / 已修，本钉防回归）", () => {
/**
 * 对象槽名 `__proto__` 在 core 契约投影层被吞掉。
 *
 * 报告称两处 Nudo 侧缺陷（core 投影层吞键 + 渲染层第二道防线失效）⇒ **与 同族不同层**。
 *
 * ⚠ **勘误（按实测走）**：报告这句**不成立** —— 两处 Nudo 侧缺陷**均已在族 17 / 修掉**，
 * 且**是同一层**（不是不同层）：
 * - `packages/core/src/algebra/projection.ts` 的 `projectObj` 字段表已是 `Object.create(null)`
 * （注释明写「族 17 」）⇒ 键 `__proto__` 的赋值不命中 `Object.prototype.__proto__`
 * 的**原型 setter** ⇒ 该键成自有属性；
 * - `packages/core/src/algebra/codegen-escape.ts` 的 `formatObjectKey` 已特判 `__proto__`
 * ⇒ 一律写成计算键 `["__proto__"]`（计算键是普通自有属性，不是原型 setter）。
 *
 * ⇒ **本条判假阳性** ⇒ **零实现改动**，只补一条**反向守护钉**把「已修的行为」钉住，防回归。
 *
 * ⚠ **反向闸口径与其他片相反**：本钉钉的是「**已成立的行为**」⇒
 * **本钉在 HEAD（族 17 之后）上必须通过**（不是大面积失败）。
 *
 * 残留现象（**不修**，见族 09 台账的「越界发现」）：zod v4 运行时把 `["__proto__"]` 赋回结果对象时
 * 走 `[[Set]]` ⇒ 触发原型 setter ⇒ **解析结果**里丢掉该键（实测 `zod parse success: true {"a":2}`）。
 * 那是 **zod 自身的运行时行为**，**不在 Nudo 的投影 / 生成职责内** ⇒ 建议另开「zod 方言 `__proto__` 键」条目。
 */





/**
 * 造一个只含 `__proto__` 槽的 obj Abs。
 *
 * ⚠ 槽表**必须**用 `Object.create(null)`：对象字面量里的 `"__proto__"` 键是**原型 setter**
 * （不是自有属性）⇒ 用字面量会把槽表原型改成 `num()` 的包装对象，键直接丢失。
 */
function protoSlotObjAbs(): Abs {
  const slots: Record<string, { value: Abs }> = Object.create(null);
  slots["__proto__"] = { value: num() };
  return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
}


  it("渲染层第二道防线：formatObjectKey 把 `__proto__` 写成计算键（不是裸键）；core 投影层：字段表原型为 null（原型 setter 不会吞掉赋值）；core 投影层：`__proto__` 是自有键（`Object.hasOwn` 为真，键没被吞）；对照：普通键同样投影成自有键（口径一致）", () => {
  {
    expect(formatObjectKey("__proto__")).toBe('["__proto__"]');
    // 对照：普通标识符仍是裸键（特判只针对 `__proto__`）
    expect(formatObjectKey("proto")).toBe("proto");
  }
  {
    const c = absToConstraint(protoSlotObjAbs());
    expect(c).toBeDefined();
    const fields = c!.fields;
    expect(fields).toBeDefined();
    expect(Object.getPrototypeOf(fields)).toBe(null);
  }
  {
    const c = absToConstraint(protoSlotObjAbs());
    expect(c).toBeDefined();
    const fields = c!.fields!;
    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    // 键确实在表里（不是靠原型链「看起来有」）
    expect(Object.keys(fields)).toContain("__proto__");
  }
  {
    const slots: Record<string, { value: Abs }> = Object.create(null);
    slots["a"] = { value: num() };
    const c = absToConstraint(makeAbs({ k: "obj", slots }, undefined, undefined, "exact"));
    expect(c).toBeDefined();
    expect(Object.hasOwn(c!.fields!, "a")).toBe(true);
    expect(Object.getPrototypeOf(c!.fields!)).toBe(null);
  }
});




});

// ---------------------------------------------------------------------------
// 机器面签名不得含引擎内部计数器 id
// ---------------------------------------------------------------------------
describe("机器面签名不得含引擎内部计数器 id", () => {
/**
 * `nudo check --json` / `--verbose` 把**引擎内部 term id**
 * （`len#N` 一族）渲进机器可读的签名字段。
 *
 * 三条症状：
 * ① 机器面载荷含**内部符号**（`len#N` 不是一个用户能理解的名字）；
 * ② 编号随**同一次调用内的文件顺序**漂移（`len#0` / `len#2` / `len#4`）
 * ⇒ **单个文件的 JSON 载荷是它在参数列表中位置的函数**，不是文件内容的
 * 函数（机器消费方拿到的不是可比对的内容）；
 * ③ 同一条命令的**人类面**给出另一个字符串（`f() => number` vs
 * `number = len#0 where len#0 ≥ 0 #path`）⇒ 两个面自相矛盾。
 *
 * 根因：`formatAbs` / `formatAbsMultiline` **无条件**把 Abs 的 term / pred
 * 渲进签名串，而 Abs 的 term 里混着引擎内部的抽象变量名（`len#N` 来自
 * **模块级**自增计数器 ⇒ 编号是进程历史的函数）；机器面（`serializeCheckJson`）
 * 用它、人类面（`formatCheckReport`）用 `formatShape`。
 *
 * 修法（core/algebra/check-signatures.ts + core/algebra/check-report.ts）：
 * - `formatSigCached` 的 `display` 改为**人类面口径**（`formatShape`）⇒ 与
 * `formatCheckReport` 的签名行**逐字同源**；
 * - 新增模块级导出 `absWithStableTermIds`（`check-report.ts`，**不进公开面**）：
 * 把 term / pred 里的**引擎内部计数器 id**换成**稳定名**（`len#2` → `len`）
 * ⇒ `formatSigCached` 的 `detail` 与 `serializeCheckJson` 的 `abs` 用它渲染
 * ⇒ 形状 / 谓词证据（`len ≥ 0`）/ `#conf` / pathNote 全部保留，只有那个
 * 会随进程漂移的编号被抹平。
 *
 * 回归护栏：
 * - 机器面三字段（display / detail / abs）不得含内部 id；
 * - 人类面 `--verbose` 同样不得含内部 id；
 * - 机器面 `display` 与人类面签名行口径一致（逐字同源）；
 * - **同内容不同路径** ⇒ 载荷逐字相同（不再随位置漂移）；
 * - 非内部 id 的 term / pred 证据**仍在**（D2 契约：verbose 明细不丢信息）；
 * - 谓词证据不丢（`len ≥ 0` 仍在 detail / abs 里，只是 id 变稳定名）。
 */



/** 抽象长度：引擎为「未知长度」铸一个**进程级计数器** var（`len#N`） */
const LEN_SRC = `export function f() {
  const a = [1, 2, 3];
  a.length = 5000;
  return a.length;
}
`;

/** 引擎内部计数器 id 形态（`len#N` / `fromIdx#N` / `inv#N` / `#N` 一族） */
const INTERNAL_ID_RE = /#\d+/;


  it("display / detail / abs 三字段都不含内部 id；人类面 --verbose 同样不得含内部 id；机器面 display 与人类面签名行同源（口径一致）；detail 首行仍是函数名（Bug 377 的「不得串号」契约不回归）；同内容不同路径 ⇒ 载荷逐字相同（不再随参数列表位置漂移）；非内部 id 的 term 段仍在（verbose 明细不丢信息 —— D2 契约）；不带内部 id 的签名：term / pred 证据仍在（契约面不被无谓收紧）；内部", () => {
  {
    const j = serializeCheckJson(checkSource("/t/len.js", LEN_SRC, pTrue));
    const sig = j.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    for (const field of [sig!.display, sig!.detail, sig!.abs]) {
      expect(field).not.toContain("len#");
      expect(field).not.toMatch(INTERNAL_ID_RE);
    }
  }
  {
    const text = formatCheckReport(checkSource("/t/len.js", LEN_SRC, pTrue), {
      verbose: true,
    });
    expect(text).not.toContain("len#");
    expect(text).not.toMatch(INTERNAL_ID_RE);
  }
  {
    const r = checkSource("/t/len.js", LEN_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "f")!;
    const line = formatCheckReport(r)
      .split("\n")
      .find((ln) => ln.startsWith("  f("));
    expect(line).toBe(`  f() => ${sig.display}`);
  }
  {
    const sig = checkSource("/t/len.js", LEN_SRC, pTrue).signatures.find(
      (s) => s.name === "f",
    )!;
    expect(sig.detail.split("\n")[0]).toBe("f");
  }
  {
    const a = serializeCheckJson(checkSource("/t/a.js", LEN_SRC, pTrue));
    const b = serializeCheckJson(checkSource("/t/b.js", LEN_SRC, pTrue));
    const c = serializeCheckJson(checkSource("/t/c.js", LEN_SRC, pTrue));
    expect(b.signatures).toEqual(a.signatures);
    expect(c.signatures).toEqual(a.signatures);
  }
  {
    const r = checkSource("/t/alpha.js", "export function add(a, b) { return a + b; }\n", pTrue);
    expect(formatCheckReport(r, { verbose: true })).toContain("term:");
  }
  {
    const j = serializeCheckJson(
      checkSource("/t/alpha.js", "export function add(a, b) { return a + b; }\n", pTrue),
    );
    const sig = j.signatures.find((s) => s.name === "add")!;
    // display 已是人类面口径（formatShape）⇒ 与人类面签名行同源（无 term 注记）
    expect(sig.display).toContain("number | string");
    expect(sig.display).not.toContain("= (A1 + A2)");
    // detail / abs 仍是 formatAbsMultiline / formatAbs 口径（证据不丢）
    expect(sig.detail).toContain("term: (A1 + A2)");
    expect(sig.detail).toContain("conf: partial");
    expect(sig.abs).toContain("= (A1 + A2)");
    expect(sig.abs).toContain("#partial");
  }
  {
    const j = serializeCheckJson(checkSource("/t/len.js", LEN_SRC, pTrue));
    const sig = j.signatures.find((s) => s.name === "f")!;
    expect(sig.detail).toContain("term: len");
    expect(sig.detail).toContain("pred: len ≥ 0");
    expect(sig.abs).toContain("= len");
    expect(sig.abs).toContain("where len ≥ 0");
  }
});








});

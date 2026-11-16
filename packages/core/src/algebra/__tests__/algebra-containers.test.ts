/**
 * 模块套件：数组/Map/Set/迭代器/HOF 运行时面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, abs as abs_____index_ts, anyAbs, instantiateReturn, numLit, strLit, type Abs, abs as abs_____index_ts_1, formatShape, lit, unknown, array as array_____index_ts, litC, number as number_____index_ts, abs as abs_____index_ts_2 } from "../index.ts";
import { sidecarOpts, sigOf, l2Count, makeFiles, issuesOf } from "./nudo-constraints.ts";
import { call, isNever, throwsError, val, resetEngineCaches, effects, tupleEls, objSlots, callLit } from "./eval-helpers.ts";
import { abs, litValue as litValue_____abs_ts, numLit as numLit_____abs_ts, type Abs as Abs_____abs_ts, litValue as litValue_____abs_ts_1, litValue as litValue_____abs_ts_2, markArrayView, isArrayView, numLit as numLit_____abs_ts_1, strLit as strLit_____abs_ts, obj, type Abs as Abs_____abs_ts_1, litValue as litValue_____abs_ts_3, litValue as litValue_____abs_ts_4, litValue as litValue_____abs_ts_5, type Abs as Abs_____abs_ts_2 } from "../abs.ts";
import { array, number } from "../constraint.ts";
import { assertImplies } from "../postcondition.ts";
import { takeRefineDiags } from "../refine.ts";
import { takeContractDiags } from "../contract/contract.ts";
import { formatShape as formatShape_____format_format_ts } from "../format/format.ts";
import { abs as abs___nudojs_core, anyAbs as anyAbs___nudojs_core, undefAbs, numLit as numLit___nudojs_core, strLit as strLit___nudojs_core, litValue, collectionExactLen, makeMapAbs, makeSetAbs, mapHasEntry, mapSizeAbs, setHasEntry, setSizeAbs, type Abs as Abs___nudojs_core, formatShape as formatShape___nudojs_core, abs as abs___nudojs_core_1, mapDeleteEntry, mapEntriesAbs, mapSetEntry, mapValuesAbs, numLit as numLit___nudojs_core_1, strLit as strLit___nudojs_core_1, type Abs as Abs___nudojs_core_1 } from "@nudojs/core";
import { objOf, joinObjects } from "../objects.ts";
import { invokeArrMethod } from "../exec/class/invoke-arr.ts";
import { isMatchArrayView } from "../builtins/regexp.ts";
import { denoteGuard } from "../denote.ts";
import { resetCheckSourceMemo } from "../check/check.ts";
import { resetGeneralizeMemo, generalizeFromAst } from "../generalize.ts";
import { formalParamsFromNodes, formalParamSignatureNames, locateContractParam } from "../format/param-surface.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../diagnostics/may-throw.ts";
import { listTopFunctions } from "../scan/scan.ts";

// ---------------------------------------------------------------------------
// shape 槽位 / 数组元素的长度界执法
// ---------------------------------------------------------------------------
describe("shape 槽位 / 数组元素的长度界执法", () => {
/**
 * 分册 03 · 契约**槽位**（shape 字段 / 数组元素）上的数组长度界
 * 在 L1 门禁零执法（假绿）；同一界在顶层形参 / guard 面都生效。
 *
 * 根因：`checkFieldConstraint` 复制顶层长度通道时只抄了字符串半边
 * （`sv = typeof lv === "string" ? lv.length : undefined`）⇒ 数组 Abs 的
 * `sv === undefined` 命中 `continue` ⇒ 该槽位的长度谓词一次都不裁决。
 *
 * 修法：与顶层 `checkReqs` 同口径 —— 字符串取字数、数组取元素个数
 * （`arrayLengthOf`）。
 */




const SIDE = `import { number, shape, array } from "@nudojs/core";
export const twoNumbers = array(number()).min(2);
export const nestedTwo = shape({ list: array(number()).min(2) });
export const nestedArr = array(array(number()).min(2));
`;
const IMP = `/// @nudo:import { twoNumbers, nestedTwo, nestedArr } from "./std38.nudo.js"\n`;
const FILE = "/t/bug38.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource(FILE, src, pTrue, sidecarOpts("std38", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string; expected?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("shape 槽位 / 数组元素的长度界执法", () => {
  it("顶层形参（对照组）topLevel([1]) ⇒ 报 length(xs) ≥ 2；shape 槽位 nested({ list: [1] }) ⇒ 报 length(s.list) ≥ 2（改前零诊断）；数组元素位 [[1]]（array(array(...).min(2))）⇒ 报违例", () => {
(() => {

    const v = violations(check("twoNumbers", "[1]"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length");
  })();
(() => {

    const v = violations(check("nestedTwo", "{ list: [1] }"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length");
  })();
(() => {

    expect(violations(check("nestedArr", "[[1]]"))).toHaveLength(1);
  })();
});;

  ;

  ;

  it.each([
    ["twoNumbers", "[1, 2]"],
    ["nestedTwo", "{ list: [1, 2] }"],
    ["nestedArr", "[[1, 2]]"],
  ])("负控制：%s 收到满足长度界的 %s ⇒ 零违例", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });
});
});

// ---------------------------------------------------------------------------
// Array 借用方法 nullish 接收者记抛
// ---------------------------------------------------------------------------
describe("Array 借用方法 nullish 接收者记抛", () => {
/**
 * 回归：`Array.prototype.sort / reverse / fill / copyWithin / concat`
 * 借用给 **nullish 接收者**必须记抛（ES2023 RequireObjectCoercible(this)）。
 * `$lit(null/undefined)` 的 shape.k 是 "unknown" 而非 "prim"，此前绕过
 * prim 守卫 ⇒ sort 一族原样返回 nullish、concat 包成 [null]（假绿 + 错值）。
 */



const wrap = (body: string) => `export function f() { ${body} }`;

const CASES: Array<[string, string]> = [
  ["sort", `const s = Array.prototype.sort; return s.call(null);`],
  ["reverse", `const s = Array.prototype.reverse; return s.call(undefined);`],
  ["concat", `return Array.prototype.concat.call(null);`],
  ["fill", `return Array.prototype.fill.call(null, 1);`],
  ["copyWithin", `return Array.prototype.copyWithin.call(undefined, 0, 1);`],
];

describe("Array 借用方法 nullish 接收者记抛", () => {
  for (const [name, body] of CASES) {
    it(`${name}.call(nullish) ⇒ definite TypeError`, () => {
      const r = call(wrap(body));
      expect(isNever(r.result), name).toBe(true);
      expect(throwsError(r.throws, "TypeError"), name).toBe(true);
    });
  }

  it("负控制：非 nullish 接收者仍不抛（join / sort / concat）", () => {
    for (const body of [
      `return Array.prototype.join.call([1,2]);`,
      `return Array.prototype.sort.call([2,1]);`,
      `return Array.prototype.concat.call([1], 2);`,
      `return Array.prototype.sort.call({a:1});`,
    ]) {
      const r = call(wrap(body));
      expect(isNever(r.result), body).toBe(false);
    }
  });
});
});

// ---------------------------------------------------------------------------
// 数组解构契约按元素下标执法
// ---------------------------------------------------------------------------
describe("数组解构契约按元素下标执法", () => {
/**
 * 分册 03 · 数组解构形参的契约被投影成**对象槽** ⇒ 合法调用报
 * `missing field x`（假红），元素值从未与界比对（真违例也被误伤）。
 *
 * 根因：`locateContractParam` 对数组 pattern 只给 `fieldIndex`、不给
 * `fieldPath`；`scan-literal-calls.ts` 的 `contractToIndexed` 此前把「没有
 * `fieldPath`」退回 `[hit.field]`（对象槽路径）⇒ `projectAbsPath(数组,
 * ["x"])` 必然取不到。模型层产出的 `fieldIndex` 从没被读。
 *
 * 修法：把 `fieldIndex` 一路传到 `checkReqs` / `checkShapeReqs`，按 tuple
 * 元素下标投影（对象解构的 `fieldPath` 口径不变）。
 */




const SIDE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;
const IMP = `/// @nudo:import { positive } from "./std8.nudo.js"\n`;
const FILE = "/t/bug8.js";

const DECL = `${IMP}/** @nudo:contract x positive */
export function f([x]) { return x; }
`;

function check(body: string) {
  return checkSource(FILE, DECL + body, pTrue, sidecarOpts("std8", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string; expected?: string; actual?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("数组解构契约按元素下标执法", () => {
  it("f([5]) 合法 ⇒ 零违例（改前报 missing field x）；f([-1]) 违例 ⇒ 报 x > 0，actual 是元素值 -1（不是整只数组）；不再出现 missing field x 文案", () => {
(() => {

    const r = check(`export function ok() { return f([5]); }`);
    expect(violations(r)).toHaveLength(0);
    expect(r.issues.some((i) => (i.expected ?? "").includes("missing field"))).toBe(false);
  })();
(() => {

    const r = check(`export function bad() { return f([-1]); }`);
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toBe("x > 0");
    expect(v[0]!.actual).toContain("-1");
  })();
(() => {

    const r = check(`export function ok() { return f([5]); }
export function bad() { return f([-1]); }`);
    expect(r.issues.some((i) => (i.expected ?? "").includes("missing field"))).toBe(false);
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// array 长度界在返回契约上必须执法
// ---------------------------------------------------------------------------
describe("array 长度界在返回契约上必须执法", () => {
/**
 * 回归：`array(...)` 的**长度界**在返回契约上完全不执法（假绿）。
 *
 * 根因：`assertImpliesSingle` 的 `element` 分支只对账元素类型就 `proved()` 返回，
 * 而 `array(...)` **没有 prim** ⇒ 通用谓词通道（`assertScalar`）根本走不到 ⇒
 * 约束自身的 `preds`（`length(self) ≥ n`）被静默丢弃 ⇒ 返回 `[]`（明确违反
 * `array(number()).min(1)`）也判 OK（CLI exit 0，零诊断）。
 * 同一条契约用作**参数**时由 scan 的独立 length 通道正确拦截 ⇒ 两个通道口径不一致。
 *
 * 修法：结构对账通过后补评约束自身的 preds——`length(<返回项>)` 用已知结构长度
 * （tuple 元素数 / obj 自有键数）接地判定；接地不了降 `unprovable`（不伪装 proved）。
 */






const SIDECAR = `
export const nonEmpty = array(number()).min(1);
export const twoOrMore = array(number()).min(2);
export const atMostOne = array(number()).max(1);
export const exactlyOne = array(number()).length(1);
export const anyLen = array(number());
`;

const opts = {
  loadModule: (spec: string) => (spec.includes("len.nudo.js") ? SIDECAR : undefined),
  fromFile: "/t/app.js",
};

function check(contract: string, body: string) {
  const src = `/// @nudo:import { nonEmpty, twoOrMore, atMostOne, exactlyOne, anyLen } from "./len.nudo.js"
/**
 * @nudo:contract return ${contract}
 */
export function f() {
  return ${body};
}
`;
  return checkSource("/t/app.js", src, pTrue, opts);
}

const violations = (r: ReturnType<typeof check>) =>
  r.issues.filter((i) => i.code === "nudo:constraint-violated" && i.fn === "f");

describe("array 长度界在返回契约上必须执法", () => {
  it("返回 [] ⊭ array(number()).min(1) ⇒ error（此前零诊断假绿）；返回 [1] ⊭ array(number()).min(2) ⇒ error；返回 [1, 2] ⊭ array(number()).max(1) ⇒ error；返回 [1, 2] ⊭ array(number()).length(1) ⇒ error；不制造假红：[1] 满足 min(1) / length(1)，[] 满足 max(1)；元素域仍照旧对账（长度通道不得掩盖元", () => {
(() => {

    const r = check("nonEmpty", "[]");
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
    // 违约描述必须点出长度界（formatConstraint 不渲染 array 的长度链）
    expect(v[0]!.expected).toContain("length(return) ≥ 1");
  })();
(() => {

    const v = violations(check("twoOrMore", "[1]"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length(return) ≥ 2");
  })();
(() => {

    const v = violations(check("atMostOne", "[1, 2]"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("length(return) ≤ 1");
  })();
(() => {

    expect(violations(check("exactlyOne", "[1, 2]")).length).toBeGreaterThan(0);
  })();
(() => {

    expect(violations(check("nonEmpty", "[1]"))).toEqual([]);
    expect(violations(check("exactlyOne", "[1]"))).toEqual([]);
    expect(violations(check("atMostOne", "[]"))).toEqual([]);
    // 无长度界的 array 契约照旧只问元素域
    expect(violations(check("anyLen", "[]"))).toEqual([]);
  })();
(() => {

    const r = checkSource(
      "/t/app.js",
      `/// @nudo:import { nonEmpty } from "./len.nudo.js"
/**
 * @nudo:contract return nonEmpty
 */
export function f() {
  return ["x"];
}
`,
      pTrue,
      opts,
    );
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toContain("array element");
  })();
(() => {

    const el = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    const arrAbs = abs({ k: "arr", element: el }, undefined, undefined, "path");
    expect(assertImplies(arrAbs, array(number()).min(1)).status).toBe("unprovable");
    // tuple 长度已知 ⇒ 可判定（0 < 1）
    const empty = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
    expect(assertImplies(empty, array(number()).min(1)).status).toBe("disproved");
    expect(assertImplies(empty, array(number())).status).toBe("proved");
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// Object.prototype 置 null 原型：放行（native：不抛 / true）
// ---------------------------------------------------------------------------
describe("Object.prototype 置 null 原型：放行（native：不抛 / true）", () => {
/**
 * 回归：`Object.setPrototypeOf(Object.prototype, null)` /
 * `Reflect.setPrototypeOf(Object.prototype, null)` 被**过拒绝**——把合法程序
 * 判成必抛 ⇒ L1/L2 门禁假红。
 *
 * 修前（探针实测）：
 * - `Object.setPrototypeOf(Object.prototype, null)` ⇒ **抛 TypeError**
 * （原生 node v26.10.0：**不抛**——Object.prototype 的 [[Prototype]] 本来
 * 就是 null ⇒ 空操作）；
 * - `Reflect.setPrototypeOf(Object.prototype, null)` ⇒ **false**（原生：true）。
 *
 * 规范依据（ES2024 10.4.1.2 的 Object.prototype.[[SetPrototypeOf]]）：**只在
 * V 非 null 时抛** TypeError ⇒ 置 null 本就合法（与 node v26 实测一致）。
 * 置**非 null** 仍拒（原生 TypeError: Immutable prototype object
 * 'Object.prototype' cannot have their prototype set）。
 *
 * 修后（`builtins/object/methods.ts` 的 `protoChangeAllowed` 单一事实源：
 * Object 面不抛 / Reflect 面返 true）：
 * - 置 null ⇒ 放行；
 * - 置非 null ⇒ 仍拒（Object 面抛 TypeError、Reflect 面返 false）；
 * - `Object.prototype` 的原型链面**不变**（不落 null-proto 标记 ⇒ 原生
 * `"toString" in Object.prototype === true` 仍成立）。
 *
 * oracle：node v26.10.0 实测。
 */



const wrap = (body: string) => `export function f() { ${body} }`;

describe("Object.prototype 置 null 原型：放行（native：不抛 / true）", () => {
  it("Object.setPrototypeOf(Object.prototype, null) ⇒ 不抛（native：no-throw；修前：threw）；Reflect.setPrototypeOf(Object.prototype, null) ⇒ true（native：true；修前：false）", () => {
(() => {

    expect(
      val(
        wrap(
          `try { Object.setPrototypeOf(Object.prototype, null); return "no-throw"; } catch { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "no-throw" });
  })();
(() => {

    expect(val(wrap(`return Reflect.setPrototypeOf(Object.prototype, null);`))).toEqual({
      ok: true,
      value: true,
    });
  })();
});;

  ;
});

describe("负控制（置非 null 仍拒 + 原型链面不变）", () => {
  it("Object.setPrototypeOf(Object.prototype, {}) ⇒ 仍抛 TypeError（native：同款）；Reflect.setPrototypeOf(Object.prototype, {}) ⇒ 仍返 false（native：false）；Object.prototype 的原型链面不变：typeof Object.prototype.toString === \"function\"（native 同款）；其余内建原型照旧可改：Objec", () => {
(() => {

    expect(
      val(
        wrap(
          `try { Object.setPrototypeOf(Object.prototype, {}); return "no-throw"; } catch { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  })();
(() => {

    expect(val(wrap(`return Reflect.setPrototypeOf(Object.prototype, {});`))).toEqual({
      ok: true,
      value: false,
    });
  })();
(() => {

    expect(val(wrap(`return typeof Object.prototype.toString;`))).toEqual({
      ok: true,
      value: "function",
    });
  })();
(() => {

    expect(
      val(
        wrap(
          `try { Object.setPrototypeOf(Array.prototype, {}); return "no-throw"; } catch { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "no-throw" });
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// arr 形参 × tuple 实参的 α 绑定口径
// ---------------------------------------------------------------------------
describe("arr 形参 × tuple 实参的 α 绑定口径", () => {
/**
 * arr 形参（收割的 `T[]`）× tuple 实参（引擎的数组字面量）：
 * α 绑定**只取首元素** ⇒ 异构数组 `[1,"a"]` 被推成 `number[]`
 * ——比真实类型 `(number|string)[]` **更窄** ⇒ 把「不知道」升级成「知道」
 * ⇒ 下游按该类型执法时假绿（契约 `array(number())` 被判满足，而实参里
 * 可能有 string）／假红（契约 `array(string())`）。
 *
 * 修法（`packages/core/src/algebra/hof.ts` 的 `tupleElementDomain`）：
 * 元素域 = tuple **全部**元素的同型域；异构 ⇒ `any`（诚实的「不知道」）。
 * 同型时仍绑出元素类型 ⇒ 的 L2 假红修复（同 kind 臂 + 跨 kind 臂
 * 都还生效）不被回退。
 */



/** α 变量（any 形状 + var term） */
const alpha = abs_____index_ts({ k: "any" }, { op: "var", id: "T0" }, undefined, "exact");
/** harvester 建的 `T[]` 形参：shape = arr(element = α) */
const arrParam = abs_____index_ts({ k: "arr", element: alpha }, undefined, undefined, "exact");

/** 泛型 `<T>(xs: T[]) => T` 的外延关系（收割面：paramTypes + returnType） */
function genericArrFn(): Abs {
  return abs_____index_ts(
    {
      k: "fn",
      params: ["xs"],
      paramTypes: [arrParam],
      returnType: alpha,
    },
    undefined,
    undefined,
    "exact",
  );
}

/** 引擎的数组字面量实参：shape = tuple(elements) */
function tupleArg(...elements: Abs[]): Abs {
  return abs_____index_ts({ k: "tuple", elements }, undefined, undefined, "exact");
}

describe("arr 形参 × tuple 实参的 α 绑定口径", () => {
  it("异构数组字面量 [1,\"a\"] ⇒ α 不绑成 number（落 any，不窄于真实类型）；异构数组字面量 [1,\"a\"] ⇒ 返回类型不窄于真实类型 `(number|string)[]`；异构数组字面量（string 在前）⇒ 同样落 any（首元素不是 number 也不该被当成全域）；同型数组字面量 [1,2] ⇒ α 仍绑成 number（Bug 453 的 L2 修复不回退）；同型数组字面量 [1,2] ⇒ 元素域按 TS 侧字面量拓宽落 base prim（不是", () => {
(() => {

    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a"))]);
    // 改前：首元素 ⇒ T := number ⇒ 返回 `number[]`（比真实类型窄 ⇒ 假绿）
    expect(out.shape).not.toEqual({ k: "prim", type: "number" });
    expect(out.shape.k).toBe("any");
  })();
(() => {

    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a"))]);
    // 真实元素域含 string ⇒ 推出来的类型不得断言「只有 number」
    const shape = out.shape;
    expect(shape.k).not.toBe("prim");
    expect(shape.k).not.toBe("tuple");
  })();
(() => {

    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(strLit("a"), numLit(1))]);
    expect(out.shape.k).toBe("any");
  })();
(() => {

    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), numLit(2))]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  })();
(() => {

    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), numLit(2))]);
    expect(out.term?.op).not.toBe("lit");
  })();
(() => {

    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(strLit("a"))]);
    expect(out.shape).toEqual({ k: "prim", type: "string" });
  })();
(() => {

    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg()]);
    expect(out.shape.k).toBe("any");
  })();
(() => {

    const fn = genericArrFn();
    const arrArg = abs_____index_ts(
      { k: "arr", element: abs_____index_ts({ k: "prim", type: "number" }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(fn, [arrArg]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  })();
(() => {

    // 「首次绑定保留」语义：异构元素域必须**占住** α，否则后续形参（这里
    // 是第二个 `T` 形参）会绑出窄类型 ⇒ 又变回「自信的错误类型」。
    const fn = abs_____index_ts(
      {
        k: "fn",
        params: ["xs", "y"],
        paramTypes: [arrParam, alpha],
        returnType: alpha,
      },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a")), numLit(2)]);
    expect(out.shape.k).toBe("any");
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;

  ;

  ;
});

describe("anyAbs 是异构元素域的落点", () => {
  it("异构元素域用 anyAbs（不是 unknown——unknown 是推断失败，any 是未约束）", () => {
    const fn = abs_____index_ts(
      {
        k: "fn",
        params: ["xs", "y"],
        paramTypes: [arrParam, alpha],
        returnType: alpha,
      },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a")), numLit(2)]);
    // ⚠ 断言强度：落点是 **anyAbs 本体的面**（`anyAbs.shape` 是**同一个**
    // 对象）——旧写法只断言本地常量 `anyAbs.shape.k === "any"`（恒真 ⇒ 在
    // main 上也过 ⇒ 空转）；这里断言的是**引擎行为**：异构元素域真的落到
    // anyAbs（main 的引擎会绑成 number ⇒ 这条断言在 main 上**红**）。
    expect(out.shape).toBe(anyAbs.shape);
    expect(out.shape).toEqual({ k: "any" });
    expect(out.shape.k).not.toBe("unknown");
    expect(out.conf).toBe(anyAbs.conf);
    expect(out.term).toBe(anyAbs.term);

    // 负控制：同型元素域**不是** anyAbs（否则上面那条断言没有鉴别力——
    // 修前 α 绑成首元素 number，落点与 anyAbs 完全不同）
    const homogeneous = instantiateReturn(
      abs_____index_ts(
        { k: "fn", params: ["xs"], paramTypes: [arrParam], returnType: alpha },
        undefined,
        undefined,
        "exact",
      ),
      [tupleArg(numLit(1), numLit(2))],
    );
    expect(homogeneous.shape).not.toBe(anyAbs.shape);
    expect(homogeneous.shape).toEqual({ k: "prim", type: "number" });
  });
});
});

// ---------------------------------------------------------------------------
// tuple 元素域的 7 个验收值
// ---------------------------------------------------------------------------
describe("tuple 元素域的 7 个验收值", () => {
/**
 * `tupleElementDomain`（`packages/core/src/algebra/hof.ts`）按
 * **形状 kind** 判「元素域是否可知」：`shape.k === "unknown"` ⇒ 域退 `any`。
 *
 * 但引擎把 `null` / `undefined` 建成「`unknown` **形状** + lit **项**」
 * （`abs.ts` 的 `absLit`：`abs({k:"unknown"}, lit(null), …)`；`exec` runtime
 * 的 `undef()` 同款）⇒ 这两个是**已知类型**，却被当成「域不可知」⇒
 * 元素域整体退 `any`：
 *
 * - `[null]` / `[undefined]`：元素域从 `null` / `undefined` 退成 `any`
 * （精度回退）；
 * - `[1,null]`：退成 `any`（应为 `number | null`）；
 * - `any` 是「**自信的任意值**」（仓内口径 `abs.ts`：`any` = 无约束并集，
 * `unknown` = 推导失败）⇒ 参与算术即抽象强转 ⇒ 记 may-throw ⇒ L2 假红。
 *
 * 修法：元素分三类——已知 nullish（**不参与**异型判定，只**贡献可空性**）／
 * 真·推断失败（退 **`unknown`**，不是 `any`）／其它（既有同型 base type 口径，
 * 异型仍退 `any`）。
 */



/** α 变量（any 形状 + var term） */
const alpha = abs_____index_ts_1({ k: "any" }, { op: "var", id: "T0" }, undefined, "exact");
/** harvester 建的 `T[]` 形参：shape = arr(element = α) */
const arrParam = abs_____index_ts_1({ k: "arr", element: alpha }, undefined, undefined, "exact");

/** 泛型 `<T>(xs: T[]) => T` 的外延关系（收割面：paramTypes + returnType） */
function genericArrFn(): Abs {
  return abs_____index_ts_1(
    {
      k: "fn",
      params: ["xs"],
      paramTypes: [arrParam],
      returnType: alpha,
    },
    undefined,
    undefined,
    "exact",
  );
}

/** 引擎的数组字面量实参：shape = tuple(elements) */
function tupleArg(...elements: Abs[]): Abs {
  return abs_____index_ts_1({ k: "tuple", elements }, undefined, undefined, "exact");
}

/** 引擎的 `null` 值：unknown 形状 + lit 项（`abs.ts` 的 `absLit`） */
function nullElem(): Abs {
  return abs_____index_ts_1({ k: "unknown" }, lit(null), undefined, "exact");
}

/** 引擎的 `undefined` 值：unknown 形状 + lit 项 */
function undefElem(): Abs {
  return abs_____index_ts_1({ k: "unknown" }, lit(undefined), undefined, "exact");
}

/** tuple 实参的元素域（经 α 绑定后的返回类型） */
function elementDomain(...elements: Abs[]): Abs {
  return instantiateReturn(genericArrFn(), [tupleArg(...elements)]);
}

describe("tuple 元素域的 7 个验收值", () => {
  it("[1,2] ⇒ number（同型 base prim，字面量拓宽）；[1,null] ⇒ number | null（nullish 只贡献可空性，不判异型）；[1,undefined] ⇒ number | undefined；[null] ⇒ null（已知类型，不是 any）；[undefined] ⇒ undefined（已知类型，不是 any）；[1,\"a\"] ⇒ any（异型：既有保守口径，本轮不变）；真·未知元素（unknown 形状且无已知 lit）⇒ un", () => {
(() => {

    const d = elementDomain(numLit(1), numLit(2));
    expect(d.shape).toEqual({ k: "prim", type: "number" });
    expect(formatShape(d)).toBe("number");
  })();
(() => {

    const d = elementDomain(numLit(1), nullElem());
    expect(formatShape(d)).toBe("number | null");
    expect(d.shape.k).toBe("sum");
  })();
(() => {

    const d = elementDomain(numLit(1), undefElem());
    expect(formatShape(d)).toBe("number | undefined");
    expect(d.shape.k).toBe("sum");
  })();
(() => {

    const d = elementDomain(nullElem());
    expect(formatShape(d)).toBe("null");
    expect(d.shape.k).not.toBe("any");
    expect(d.term?.op === "lit" && d.term.value === null).toBe(true);
  })();
(() => {

    const d = elementDomain(undefElem());
    expect(formatShape(d)).toBe("undefined");
    expect(d.shape.k).not.toBe("any");
    expect(d.term?.op === "lit" && d.term.value === undefined).toBe(true);
  })();
(() => {

    const d = elementDomain(numLit(1), strLit("a"));
    expect(d.shape.k).toBe("any");
    expect(formatShape(d)).toBe("any");
  })();
(() => {

    const d = elementDomain(unknown);
    expect(d.shape.k).toBe("unknown");
    expect(formatShape(d)).toBe("unknown");
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});

describe("修前红 / 修后绿（口径锚点）", () => {
  it("修前：nullish 元素命中 `shape.k === \"unknown\"` 一刀切 ⇒ 域退 any；修后：同一输入不再退 any（null / number | null）；仓内口径：unknown = 推导失败，any = 无约束并集（二者不可互换）", () => {
(() => {

    // 修前实现（保留为对照）：任何 unknown 形状元素 ⇒ anyAbs。
    const oldDomain = (elements: Abs[]): Abs => {
      for (const el of elements) {
        if (el.shape.k === "any" || el.shape.k === "unknown") {
          return abs_____index_ts_1({ k: "any" }, undefined, undefined, "path");
        }
      }
      return elements[0]!;
    };
    expect(formatShape(oldDomain([nullElem()]))).toBe("any");
    expect(formatShape(oldDomain([numLit(1), nullElem()]))).toBe("any");
  })();
(() => {

    expect(formatShape(elementDomain(nullElem()))).toBe("null");
    expect(formatShape(elementDomain(numLit(1), nullElem()))).toBe("number | null");
  })();
(() => {

    expect(unknown.shape.k).toBe("unknown");
    expect(abs_____index_ts_1({ k: "any" }, undefined, undefined, "path").shape.k).toBe("any");
  })();
});;

  ;

  ;
});

describe("其它 nullish 组合", () => {
  it("[null, undefined] ⇒ null | undefined（两个已知 nullish 都保留）；[1, null, null] ⇒ number | null（重复 nullish 去重）；[null, 1] ⇒ number | null（nullish 位置不影响结果）；[1, null, \"a\"] ⇒ any（异型优先：仍不窄化成联合）；[null, 真·未知] ⇒ unknown（真·推断失败优先于可空性）", () => {
(() => {

    const d = elementDomain(nullElem(), undefElem());
    expect(formatShape(d)).toBe("null | undefined");
  })();
(() => {

    const d = elementDomain(numLit(1), nullElem(), nullElem());
    expect(formatShape(d)).toBe("number | null");
  })();
(() => {

    const d = elementDomain(nullElem(), numLit(1));
    expect(formatShape(d)).toBe("number | null");
  })();
(() => {

    const d = elementDomain(numLit(1), nullElem(), strLit("a"));
    expect(d.shape.k).toBe("any");
  })();
(() => {

    const d = elementDomain(nullElem(), unknown);
    expect(d.shape.k).toBe("unknown");
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 默认值补齐覆盖缺失的尾部位置
// ---------------------------------------------------------------------------
describe("默认值补齐覆盖缺失的尾部位置", () => {
/**
 * 默认值填充**只在零参调用**时发生（的不完整修复）⇒
 * 漏传尾部位置时**静默**（P1 **假绿**：违约代码被放过 ⇒ 门禁空转）。
 *
 * 复现：`/** @nudo:contract x positive *\/ function e4(a, x = -5)`：
 * - `e4()` 被报（对：x = -5 违约）—— 的零参补齐生效；
 * - `e4(1)` **静默** —— 但运行时 x = -5（应当报）⇒ 假绿。
 *
 * 根因（`scan-literal-calls.ts` 的零参守卫 + `literal-args.ts` 的
 * `defaultArgAbss`）：默认值补齐的条件是 `absArgs.length === 0` ⇒ 只要调用点
 * 传了**任意**个实参，缺失的**尾部**位置就不会被默认值填上 ⇒ 契约面看到的
 * 该位是「缺失」⇒ 整条跳过 ⇒ 静默。
 *
 * 修法：补齐**所有缺失的尾部位置**（不只零参调用）；补齐后按形参位逐位执法。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

function check(src: string, file = "/t/defaults.js") {
  const imp = `/// @nudo:import { positive } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

function violations(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("默认值补齐覆盖缺失的尾部位置", () => {
  it("e4(1)（x = -5，契约 x > 0）⇒ 报违例（默认值违约不沉默）；e4() 仍然报（Bug 444 的零参补齐不回归）；默认值合规时不报（x = 5，契约 x > 0，e4(1) ⇒ 零诊断）；多个尾部位置都补齐（f(1) ⇒ b = -1、c = -2 都按默认值执法）", () => {
(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x positive */
function e4(a, x = -5) { return x; }
export function use() { return e4(1); }
`);
    expect(violations(r)).toBe(1);
  })();
(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x positive */
function e4(a, x = -5) { return x; }
export function use() { return e4(); }
`);
    expect(violations(r)).toBe(1);
  })();
(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x positive */
function e5(a, x = 5) { return x; }
export function use() { return e5(1); }
`);
    expect(violations(r)).toBe(0);
  })();
(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract b positive */
/** @nudo:contract c positive */
function f(a, b = -1, c = -2) { return a; }
export function use() { return f(1); }
`);
    expect(violations(r)).toBe(2);
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// Reflect.set 的非对象 receiver 返 boolean 不抛
// ---------------------------------------------------------------------------
describe("Reflect.set 的非对象 receiver 返 boolean 不抛", () => {
/**
 * 回归：`Reflect.set(target, key, value, receiver)` 的 receiver 为
 * **原始值**时不得判 TypeError——规范返回面是 `false`（不抛）。
 *
 * 原生（node v26，ES2024 10.1.9.2 OrdinarySetWithOwnDescriptor）：data 臂
 * 「If Receiver is not an Object, return false」；accessor 臂照常派发 setter
 * （this = 原始值）⇒ true。两条臂都不抛 ⇒ 引擎返回面必须是 boolean。
 *
 * 修复前：字面量原始值臂与抽象 prim 臂**定抛** TypeError（`never throws
 * TypeError`）⇒ L2 假红；而 null（同样非对象）因 `!== null` 例外偶然判
 * boolean ⇒ 同一函数内三种 receiver 两种结论。也直接违反本文件头不变量
 * 「Reflect.* 的写面失败一律返 false 不抛」。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果面字符串（formatShape）：boolean / true / false / never / … */
function face(src: string): string {
  return formatShape_____format_format_ts(call(src).result);
}

describe("Reflect.set 的非对象 receiver 返 boolean 不抛", () => {
  it("数字字面量 receiver → boolean，定抛面消失；显式 undefined receiver → boolean（此前「never throws TypeError」）；null receiver 控制组结论不变 → boolean；三种非对象 receiver 均不记 may-throw（规范返回面是 false 不是异常）；非对象 receiver ⇒ 写门失败，target 不变（原生 [[Set]] 不落写）；对象 receiver 的既有语义不受影响（写", () => {
(() => {

    const src = wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, 1);`);
    expect(face(src)).toEqual("boolean");
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
    expect(isNever(call(src).result)).toBe(false);
  })();
(() => {

    const src = wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, undefined);`);
    expect(face(src)).toEqual("boolean");
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
  })();
(() => {

    const src = wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, null);`);
    expect(face(src)).toEqual("boolean");
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
  })();
(() => {

    for (const recv of ["1", "undefined", "null", `"s"`]) {
      expect(
        effects(wrap(`const o = { k: 0 }; return Reflect.set(o, "k", 1, ${recv});`)),
      ).not.toContain("TypeError");
    }
  })();
(() => {

    expect(face(wrap(`const o = { k: 0 }; Reflect.set(o, "k", 1, 1); return String(o.k);`)))
      .toEqual('"0"');
    expect(face(wrap(`const o = { k: 0 }; Reflect.set(o, "k", 1, null); return String(o.k);`)))
      .toEqual('"0"');
  })();
(() => {

    expect(
      face(
        wrap(
          `const t = { a: 1 }; const r = { a: 9 }; Reflect.set(t, "a", 2, r); return String(t.a) + ":" + String(r.a);`,
        ),
      ),
    ).toEqual('"1:2"');
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// non-callable iterator slot
// ---------------------------------------------------------------------------
describe("non-callable iterator slot", () => {
/**
 * `{[Symbol.iterator]: 5}`（不可调用的迭代器槽）以前被当成
 * 可迭代 ⇒ `for..of` 静默得到空循环 / 错误结果。修复：迭代器槽存在但
 * 不可调用 ⇒ 定抛 TypeError。
 */




const SRC = `
export function consume() {
  const o = { [Symbol.iterator]: 5 };
  let total = 0;
  for (const x of o) total += x;
  return total;
}
export function consumeNull() {
  const o = { [Symbol.iterator]: null };
  let total = 0;
  for (const x of o) total += x;
  return total;
}
export function okIt() {
  const o = { [Symbol.iterator]() { let i = 0; return { next() { return i++ < 2 ? { value: i, done: false } : { value: undefined, done: true }; } }; } };
  let total = 0;
  for (const x of o) total += x;
  return total;
}
`;

describe("non-callable iterator slot", () => {
  it("throws TypeError instead of silently iterating nothing；valid user iterators keep working", () => {
(() => {

    const r = checkSource("/t/bug-215.js", SRC, pTrue);
    expect(sigOf(r, "consume")).toBe("never throws TypeError");
    expect(sigOf(r, "consumeNull")).toBe("never throws TypeError");
    expect(l2Count(r, "consume")).toBe(1);
    expect(l2Count(r, "consumeNull")).toBe(1);
  })();
(() => {

    const r = checkSource("/t/bug-215.js", SRC, pTrue);
    expect(sigOf(r, "okIt")).toBe("3");
    expect(l2Count(r, "okIt")).toBe(0);
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// 抽象可迭代构造的 Set/Map 基数不得折成确定值
// ---------------------------------------------------------------------------
describe("抽象可迭代构造的 Set/Map 基数不得折成确定值", () => {
/**
 * `new Set(抽象可迭代)` / `new Map(抽象可迭代)` 的**基数**曾被建模
 * 成确定值 ⇒ 引擎印出宿主不可能产出的 exact `0` / `1` / `false`（自信的错值），
 * 且同一个 Set 的基数在 `size` 与 `Array.from(...).length` 两条读取路径上
 * 结论相反（exact 0 vs number）。
 *
 * 根因：`elementsFrom` 把抽象/未知可迭代映射成一份有限的「代表元素表」，该表
 * 随后又被当成**真实条目表**建表 ⇒ `setSizeAbs`/`mapSizeAbs` 按条目数折
 * exact 字面量、`setHasEntry` 对字面量键折 exact false。
 *
 * 修复：代表表只定**元素类型**；基数走独立通道（`cardinalityUnknown`）——
 * size 回 `number`(path)、has 回 partial、for-of/Array.from 的确切长度回
 * undefined（与 `collectionExactLen` 同口径）。确切迭代源（tuple / 字符串
 * 字面量 / nullish 空容器）仍折 exact。
 */




/** 无界抽象数组（契约 `array(number())` 的同款形态）：元素已知、长度未知 */
const numArray = (): Abs___nudojs_core =>
  abs___nudojs_core(
    { k: "arr", element: abs___nudojs_core({ k: "prim", type: "number" }, undefined, undefined, "path") },
    undefined,
    undefined,
    "path",
  );

const tupleOf = (...els: Abs___nudojs_core[]): Abs___nudojs_core =>
  abs___nudojs_core({ k: "tuple", elements: els }, undefined, undefined, "exact");

const SRC = `
export function setSize(xs) { return new Set(xs).size; }
export function setLen(xs) { return Array.from(new Set(xs)).length; }
export function setHas(xs) { return new Set(xs).has("a"); }
export function mapSize(xs) { return new Map(xs).size; }
`;

describe("抽象可迭代构造的 Set/Map 基数不得折成确定值", () => {
  it("new Set(xs).size（xs: any）是 number(path)，不是 exact 0；new Set(xs).size（xs: number[]）不再是 exact 1——长度不可知；同一 Set 的 size 与 Array.from(...).length 同结论（都非 exact number）；new Set(xs).has(\"a\") 是 partial boolean，不是 exact false；new Map(xs).size 是 number(", () => {
(() => {

    const r = call(SRC, "setSize", [anyAbs___nudojs_core]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "number" });
    expect(r.result.conf).toBe("path");
  })();
(() => {

    const r = call(SRC, "setSize", [numArray()]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "number" });
    expect(r.result.conf).not.toBe("exact");
  })();
(() => {

    for (const arg of [anyAbs___nudojs_core, numArray()]) {
      const size = call(SRC, "setSize", [arg]);
      const len = call(SRC, "setLen", [arg]);
      expect(size.result.shape).toMatchObject({ k: "prim", type: "number" });
      expect(len.result.shape).toMatchObject({ k: "prim", type: "number" });
      expect(size.result.conf).not.toBe("exact");
      expect(len.result.conf).not.toBe("exact");
    }
  })();
(() => {

    const r = call(SRC, "setHas", [anyAbs___nudojs_core]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "boolean" });
    expect(r.result.conf).not.toBe("exact");
    // 不得折出确定的 false
    expect(litValue(r.result).ok).toBe(false);
  })();
(() => {

    const r = call(SRC, "mapSize", [anyAbs___nudojs_core]);
    expect(r.result.shape).toMatchObject({ k: "prim", type: "number" });
    expect(r.result.conf).toBe("path");
  })();
(() => {

    for (const arg of [anyAbs___nudojs_core, numArray()]) {
      expect(setSizeAbs(makeSetAbs(arg)).conf).toBe("path");
      expect(setHasEntry(makeSetAbs(arg), strLit___nudojs_core("a")).conf).toBe("partial");
      expect(collectionExactLen(makeSetAbs(arg))).toBeUndefined();
    }
    expect(mapSizeAbs(makeMapAbs(anyAbs___nudojs_core)).conf).toBe("path");
    expect(mapHasEntry(makeMapAbs(anyAbs___nudojs_core), strLit___nudojs_core("a")).conf).not.toBe("exact");
    expect(collectionExactLen(makeMapAbs(anyAbs___nudojs_core))).toBeUndefined();
  })();
(() => {

    expect(litValue(setSizeAbs(makeSetAbs(tupleOf(numLit___nudojs_core(1), numLit___nudojs_core(2), numLit___nudojs_core(2)))))).toEqual({
      ok: true,
      value: 2,
    });
    // native new Set(undefined).size === 0
    expect(litValue(setSizeAbs(makeSetAbs(undefAbs())))).toEqual({ ok: true, value: 0 });
    expect(litValue(setSizeAbs(makeSetAbs()))).toEqual({ ok: true, value: 0 });

    const onePair = makeMapAbs(tupleOf(tupleOf(strLit___nudojs_core("a"), numLit___nudojs_core(1))));
    expect(litValue(mapSizeAbs(onePair))).toEqual({ ok: true, value: 1 });
    expect(litValue(mapSizeAbs(makeMapAbs()))).toEqual({ ok: true, value: 0 });
    // 确切源仍保留确切长度（for-of 有界展开路径不变）
    expect(collectionExactLen(makeSetAbs(tupleOf(numLit___nudojs_core(1), numLit___nudojs_core(2))))).toBe(2);
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// sort/reverse on array-like receivers
// ---------------------------------------------------------------------------
describe("sort/reverse on array-like receivers", () => {
/**
 * 数组样（array-like）接收者上的 `sort` / `reverse` / `copyWithin` /
 * `fill` 此前**既不建模写面、又记 may-throw** ⇒
 * ① 宿主能跑通的代码被判 error 级 `nudo:entry-may-throw`（L1 **假红**）；
 * ② 接收者内容被当结果交回 ⇒ 印出「未排序 / 未反转」的旧值（`conf: exact`
 * 的**自信错值**）。
 *
 * 规范事实（ES2023 22.1.3.x）：这四个方法的算法只依赖 `Get` / `Set` /
 * `DeletePropertyOrThrow` + 可写 `length` ⇒ 数组样接收者与真数组**同义**，
 * 原生不抛。同族 `push` 早已建模（对照组）。
 */




const lit = (src: string): unknown => {
  const r = litValue_____abs_ts(call(src).result);
  return r.ok ? r.value : `NOT-LIT(${JSON.stringify(r)})`;
};

describe("sort/reverse on array-like receivers", () => {
  it("sort writes the sorted order back (host: 'a')；reverse writes the reversed order back (host: 'b')；fill writes the window (host: 'x')；copyWithin copies within the receiver (host: 'b' at 0)；no may-throw is recorded for array-like receivers (na", () => {
(() => {

    expect(
      lit(`export function f() {
        const o = { length: 2, 0: "b", 1: "a" };
        Array.prototype.sort.call(o);
        return o[0];
      }`),
    ).toBe("a");
  })();
(() => {

    expect(
      lit(`export function f() {
        const o = { length: 2, 0: "a", 1: "b" };
        Array.prototype.reverse.call(o);
        return o[0];
      }`),
    ).toBe("b");
  })();
(() => {

    expect(
      lit(`export function f() {
        const o = { length: 3, 0: "a", 1: "b", 2: "c" };
        Array.prototype.fill.call(o, "x", 1, 3);
        return o[1];
      }`),
    ).toBe("x");
  })();
(() => {

    expect(
      lit(`export function f() {
        const o = { length: 3, 0: "a", 1: "b", 2: "c" };
        Array.prototype.copyWithin.call(o, 0, 1);
        return o[0];
      }`),
    ).toBe("b");
  })();
(() => {

    // 原生这四个方法对数组样接收者不抛 ⇒ 记 may-throw 即 L1 假红。
    expect(
      effects(`export function f() {
        const o = { length: 2, 0: "b", 1: "a" };
        Array.prototype.sort.call(o);
        Array.prototype.reverse.call(o);
        Array.prototype.fill.call(o, "z");
        Array.prototype.copyWithin.call(o, 0, 1);
        return o[0];
      }`),
    ).toEqual([]);
  })();
(() => {

    expect(
      lit(`export function f() {
        const o = { length: 1, 0: "a" };
        Array.prototype.push.call(o, "b");
        return o.length;
      }`),
    ).toBe(2);
  })();
(() => {

    expect(
      lit(`export function f() {
        const o = { length: 3, 0: 3, 1: 1, 2: 2 };
        Array.prototype.sort.call(o, (a, b) => a - b);
        return o[0];
      }`),
    ).toBe(1);
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// binary recursion
// ---------------------------------------------------------------------------
describe("binary recursion", () => {
/**
 * 二元递归（`bin(n-1)+bin(n-2)`）在 α 泛化求值里让 term/预算键
 * 指数增长 ⇒ `check`/`health`/`test` 全部 OOM 死亡、stdout 0 字节。
 * 修复：自递归函数不走 B（求值）路径（解释路径有界展开）；L2 入口求值对
 * 多自引用实参剥掉 term 身份，恢复环检测。
 */




const BIN = `export function bin(n) { return n < 2 ? n : bin(n - 1) + bin(n - 2); }`;
const LIN = `export function bin(n) { return n < 2 ? n : bin(n - 1); }`;

describe("binary recursion", () => {
  it("binary recursion terminates and reports recursion truncation；linear recursion keeps working (control)", () => {
(() => {

      const r = checkSource("/t/bug-248-bin.js", BIN, pTrue);
      expect(r.issues.some((i) => i.code === "nudo:recursion-truncated")).toBe(true);
      expect(sigOf(r, "bin")).toBe("unknown throws TypeError");
    })();
(() => {

      const r = checkSource("/t/bug-248-lin.js", LIN, pTrue);
      expect(r.issues.some((i) => i.code === "nudo:recursion-truncated")).toBe(true);
      expect(r.signatures.find((s) => s.name === "bin")).toBeDefined();
    })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// HOF / for-of 读当前容器（live 元素 + live 长度）
// ---------------------------------------------------------------------------
describe("HOF / for-of 读当前容器（live 元素 + live 长度）", () => {
/**
 * HOF 回调族（forEach/map/filter/reduce/…）与 `for..of` 用**进体前
 * 快照**的元素表：体内对接收者的变异（`a[1]=9` / `a.length=1` / `a.shift()`）
 * 对后续迭代不可见（陈旧值）；`for..of` 的长度也按进体前快照 ⇒ 迭代期间的
 * push/shift 不可见。
 *
 * 根修：HOF 逐位读**当前容器**（原生 `Get(O,k)` / `HasProperty(O,k)` 逐步
 * 现读）；`for..of` 走数组迭代器的 **live 视图**（`next()` 每步重读长度）。
 *
 * 口径说明（原生事实）：HOF 的 `len` 在**进体前取一次**（`ToLength(O.length)`
 * 只读一次）⇒ 体内 push 不会多跑；少跑靠 `HasProperty` 缺席达成。
 * find/findIndex/findLast/findLastIndex **不查 HasProperty**——hole 位照样
 * 回调（值取 Get ⇒ undefined）。
 *
 * 已知边界（不在本片范围）：体内变异若发生在 **fork 分支**（条件语句）内，
 * 转译层 `$copy` 深拷贝绑定 ⇒ 变异落在副本上，接收者看不到（见报告「剩余
 * 风险」）。本钉覆盖**无条件**变异（绑定不被拷贝 ⇒ 接收者与回调同容器）。
 */



const s = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  const t = r.result as { shape?: { k?: string } };
  if (t.shape?.k === "tuple") {
    const els = (r.result as { shape: { elements: unknown[] } }).shape.elements;
    return els.length === 1 ? (els[0] as { term?: { value?: unknown } })?.term?.value : els;
  }
  return (r.result as { term?: { value?: unknown } })?.term?.value;
};

describe("HOF / for-of 读当前容器（live 元素 + live 长度）", () => {
  it("forEach：体内改写元素值对后续迭代可见（原生 1,9,3）；forEach：体内截断长度 ⇒ 缺席位不再回调（原生只剩第 0 位）；forEach：体内 shift ⇒ 缺席位跳过（原生 1,3）；map / filter / reduce：同样读当前容器；for-of：元素值现读（原生 1,9,3）；for-of：长度现读——体内 shift 收缩（原生 1,3）；for-of：长度现读——体内截断（原生只剩 1）；对照：无体内变异时行为不变（原生 1,2,3）", () => {
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); a[1]=9; }); return out.join(",");`),
    ).toBe("1,9,3");
  })();
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); a.length=1; }); return out.join(",")+"|"+a.length;`),
    ).toBe("1|1");
  })();
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); a.shift(); }); return out.join(",");`),
    ).toBe("1,3");
  })();
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; a.map((v,i)=>{ out.push(v); a[1]=9; return v; }); return out.join(",");`),
    ).toBe("1,9,3");
    expect(
      s(`const a=[1,2,3]; const out=[]; a.filter((v,i)=>{ out.push(v); a[1]=9; return true; }); return out.join(",");`),
    ).toBe("1,9,3");
    expect(
      s(`const a=[1,2,3]; const out=[]; a.reduce((acc,v)=>{ out.push(v); a[1]=9; return acc; }, 0); return out.join(",");`),
    ).toBe("1,9,3");
  })();
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); a[1]=9; } return out.join(",");`),
    ).toBe("1,9,3");
  })();
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); a.shift(); } return out.join(",");`),
    ).toBe("1,3");
  })();
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); a.length=1; } return out.join(",");`),
    ).toBe("1");
  })();
(() => {

    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); }); return out.join(",");`),
    ).toBe("1,2,3");
    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); } return out.join(",");`),
    ).toBe("1,2,3");
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// [merged] mutator-arraylike-receiver
// ---------------------------------------------------------------------------
describe("mutator-arraylike-receiver", () => {
// MERGED (topic-related bug pins): mutator-arraylike-receiver + mutator-arraylike-wiring
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






describe("mutator-arraylike-receiver", () => {
/**
 * 数组 mutator 的**泛型接收者**（数组样对象 `{length, 0: …}`）：
 * `$arrMutContainer` 对非 tuple/arr 形状**早退**（原样返回接收者）⇒ 写入被
 * 静默丢弃（长度不变、元素不变、不记 may-throw）。
 *
 * 根修：mutator 家族按 spec 泛型化——接收者 `ToObject(O)` 后按
 * `Set(O, "length", n)` / `CreateDataPropertyOrThrow(O, k, v)` /
 * `DeletePropertyOrThrow(O, k)` 写面落地（闭 obj 数组样接收者）；不可判定
 * 形态（open obj / 抽象 length / 带访问器侧表）⇒ 记 may-throw 后不写。
 *
 * 本钉打**写面本身**（`invokeArrMethod` 直接吃闭 obj 接收者）：端到端触发
 * `Array.prototype.push.call(o, 5)` 走 invoke.ts 的 `home === "Array"` 物化
 * 通道（E3 区段）——该通道先把接收者物化成**副本**再派发 mutator ⇒ 写入落在
 * 副本上（端到端症状仍在，见交付报告「越界发现」）。
 */






const S = (s: string): Abs_____abs_ts =>
  abs({ k: "prim", type: "string" }, { op: "lit", value: s }, undefined, "exact");

function mkObj(slots: Record<string, Abs_____abs_ts>): Abs_____abs_ts {
  const s: Record<string, { value: Abs_____abs_ts }> = {};
  for (const [k, v] of Object.entries(slots)) s[k] = { value: v };
  return objOf(s as never);
}

/** 变更后的槽面（字面量值） */
function slotsOf(o: Abs_____abs_ts): Record<string, unknown> {
  const shape = o.shape as { k: string; slots: Record<string, { value: Abs_____abs_ts }> };
  const out: Record<string, unknown> = {};
  for (const [k, sl] of Object.entries(shape.slots ?? {})) {
    const t = sl.value.term;
    out[k] = t && t.op === "lit" ? t.value : "<nonlit>";
  }
  return out;
}

describe("mutator 家族的泛型（数组样）接收者写面", () => {
  it("push：写 length + 索引槽，返回新长度；pop：删末位 + 收缩 length，返回被删元素；shift：前移 + 收缩 length，返回原首位；unshift：整体右移 + 插入，返回新长度；splice：删窗口 + 插入 items + 写回 length（原生语义）；splice 零实参：原生不删（长度与内容不变）", () => {
(() => {

    const o = mkObj({ length: numLit_____abs_ts(0) });
    const ret = invokeArrMethod(o, "push", [numLit_____abs_ts(5)]);
    expect(slotsOf(o)).toEqual({ "0": 5, length: 1 });
    expect(ret?.term?.op).toBe("lit");
    expect((ret?.term as { value?: unknown })?.value).toBe(1);
  })();
(() => {

    const o = mkObj({ length: numLit_____abs_ts(1), "0": numLit_____abs_ts(9) });
    const ret = invokeArrMethod(o, "pop", []);
    expect(slotsOf(o)).toEqual({ length: 0 });
    expect((ret?.term as { value?: unknown })?.value).toBe(9);
  })();
(() => {

    const o = mkObj({ length: numLit_____abs_ts(2), "0": numLit_____abs_ts(9), "1": numLit_____abs_ts(8) });
    const ret = invokeArrMethod(o, "shift", []);
    expect(slotsOf(o)).toEqual({ length: 1, "0": 8 });
    expect((ret?.term as { value?: unknown })?.value).toBe(9);
  })();
(() => {

    const o = mkObj({ length: numLit_____abs_ts(1), "0": numLit_____abs_ts(9) });
    const ret = invokeArrMethod(o, "unshift", [numLit_____abs_ts(1)]);
    expect(slotsOf(o)).toEqual({ "0": 1, "1": 9, length: 2 });
    expect((ret?.term as { value?: unknown })?.value).toBe(2);
  })();
(() => {

    const o = mkObj({ length: numLit_____abs_ts(2), "0": S("a"), "1": S("b") });
    invokeArrMethod(o, "splice", [numLit_____abs_ts(0), numLit_____abs_ts(1)]);
    expect(slotsOf(o)).toEqual({ "0": "b", length: 1 });

    const o2 = mkObj({ length: numLit_____abs_ts(3), "0": S("a"), "1": S("b"), "2": S("c") });
    invokeArrMethod(o2, "splice", [numLit_____abs_ts(1), numLit_____abs_ts(1), S("X"), S("Y")]);
    expect(slotsOf(o2)).toEqual({ "0": "a", "1": "X", "2": "Y", "3": "c", length: 4 });

    const o3 = mkObj({ length: numLit_____abs_ts(2), "0": S("a"), "1": S("b") });
    invokeArrMethod(o3, "splice", [numLit_____abs_ts(0), numLit_____abs_ts(0), S("Z")]);
    expect(slotsOf(o3)).toEqual({ "0": "Z", "1": "a", "2": "b", length: 3 });
  })();
(() => {

    const o = mkObj({ length: numLit_____abs_ts(2), "0": S("a"), "1": S("b") });
    invokeArrMethod(o, "splice", []);
    expect(slotsOf(o)).toEqual({ "0": "a", "1": "b", length: 2 });
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

describe("mutator-arraylike-wiring", () => {
/**
 * （主 agent 接线）—— mutator 在**端到端**路径上必须**就地改接收者**。
 *
 * E4 的写面钉（`core--mutator-arraylike-receiver.part.ts`）直接调
 * `invokeArrMethod(闭 obj 接收者, ...)`，只覆盖**写面本身**。
 * 但端到端路径 `Array.prototype.push.call(o, 5)` 走
 * `exec/class/invoke.ts` 的 `home === "Array"` 通道 —— 该通道先把接收者
 * **物化成副本**再派发 mutator ⇒ 写入落在副本上：
 * 改前：`o.length` 仍 0、`o[0]` 仍 undefined、返回值 1（返回值对、写面丢）
 * 改后：`o.length` = 1、`o[0]` = 5（与原生 `push.call({length:0},5)` 一致）
 *
 * 接线修法：mutator 家族在**闭 obj 数组样接收者**上改走**原接收者**
 * （`invokeArrMethod` 的泛型接收者臂 → `$arrMutContainer` → `mutateArrayLike`）。
 *
 * 同批修掉的**族内回归**：`Array.prototype.shift.call([])` 原生返回 `undefined`，
 * 但「tuple 且非空」才进 shift 臂 ⇒ 空元组落到泛型接收者臂 ⇒ `arrayLikeLen()`
 * 对 tuple 返回 undefined ⇒ 折 `unknown`。
 * ⚠ **实测勘误**：数组**字面量** `[]` 在引擎里是抽象 `arr`（不是 0-tuple）⇒
 * 它的 OOB 读（`[][0]` / `[].shift()` / `[].pop()` / `[].at(0)`）**改前改后都是**
 * `unknown`，与原生 `undefined` 不符 —— 那是**建模限制**（空数组应折 undefined），
 * **不属本族**，已记入遗留；本钉只覆盖本族能修好的部分。
 *
 * 原生 oracle（node v26，sloppy + strict 一致）：
 * Array.prototype.shift.call([]) → undefined
 * Array.prototype.shift.call(5) → undefined
 * Array.prototype.shift.call("ab") → TypeError（只读 length）
 * Array.prototype.push.call({length:0},5) → 1，且 o.length = 1、o[0] = 5
 */




/** 返回值的字面量值（非字面量 → undefined） */
function litOf(v: unknown): unknown {
  const r = litValue_____abs_ts_1(v as never);
  return r.ok ? r.value : undefined;
}

describe("mutator 端到端就地改接收者（主 agent 接线）", () => {
  it("push.call({length:0},5)：写回原接收者的 length 与索引槽；push.call({length:0},5)：接收者的索引槽被写入；push.call({length:0},5)：返回值是新长度；pop.call({length:1,0:9})：返回被删元素；shift.call([1,2])：返回原首位；shift.call(\"ab\")：字符串接收者原生定抛 TypeError（只读 length）", () => {
(() => {

    const src = `
      export function f() {
        const o = { length: 0 };
        Array.prototype.push.call(o, 5);
        return o.length;
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(1);
  })();
(() => {

    const src = `
      export function f() {
        const o = { length: 0 };
        Array.prototype.push.call(o, 5);
        return o[0];
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(5);
  })();
(() => {

    const src = `
      export function f() {
        return Array.prototype.push.call({ length: 0 }, 5);
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(1);
  })();
(() => {

    const src = `
      export function f() {
        return Array.prototype.pop.call({ length: 1, 0: 9 });
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(9);
  })();
(() => {

    const src = `
      export function f() {
        return Array.prototype.shift.call([1, 2]);
      }
    `;
    expect(litOf(call(src, "f").result)).toBe(1);
  })();
(() => {

    const src = `
      export function f() {
        return Array.prototype.shift.call("ab");
      }
    `;
    expect(throwsError(call(src, "f").throws, "TypeError")).toBe(true);
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});
});

// ---------------------------------------------------------------------------
// fill() 零实参
// ---------------------------------------------------------------------------
describe("fill() 零实参", () => {
/**
 * `Array.prototype.fill()` **无实参**：整条 fill 分支被跳过（守卫
 * `args.length >= 1`），数组原样保留（原生整数组被填成 `undefined`、
 * length 不变）。
 *
 * 根修：去掉零实参守卫；fill 的 value 缺省按原生取 `undefined`
 * （`ToIntegerOrInfinity` 之外的缺省语义：`fill(value = undefined)`）。
 */




const val = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  return (r.result as { term?: { op?: string; value?: unknown } })?.term?.value;
};

const shape = (body: string): string => formatShape___nudojs_core(call(`export function f() {\n${body}\n}`).result);

describe("fill() 零实参", () => {
  it("fill() 把整条数组填成 undefined（长度不变）；fill() 的第 0 位不再是原值 0；对照：fill(value) 语义不变", () => {
(() => {

    // 原生 [0,1,2,3].fill() → [undefined, undefined, undefined, undefined]
    // 引擎的 undefined 元素面 = lit undefined（确定 undefined，非裸 unknown）
    expect(shape(`const a=[0,1,2,3]; a.fill(); return a;`)).toBe(
      "[undefined, undefined, undefined, undefined]",
    );
    expect(val(`const a=[0,1,2,3]; a.fill(); return a.length;`)).toBe(4);
  })();
(() => {

    expect(shape(`const a=[0,1,2,3]; a.fill(); return a[0];`)).toBe("undefined");
    expect(shape(`const a=[0,1,2,3]; a.fill(); return a[3];`)).toBe("undefined");
  })();
(() => {

    expect(val(`const a=[0,1,2,3]; a.fill(7); return a.join(",");`)).toBe("7,7,7,7");
    expect(val(`const a=[0,1,2,3]; a.fill(7,1,3); return a.join(",");`)).toBe("0,7,7,3");
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 数组视图 = Shape facet（形状单一事实源）
// ---------------------------------------------------------------------------
describe("数组视图 = Shape facet（形状单一事实源）", () => {
/**
 * 回归：**数组视图**从 WeakSet 身份侧表 → **Shape facet**
 * （`{ k: "obj", view: "array" }`）。
 *
 * RegExpExecArray / String.match 结果 / 标签模板对象原生都是**数组 exotic**
 * （IsArray = true），引擎按 obj 形状建模（自有下标槽 "0".."n-1" + length
 * 槽，#136 的槽读面依赖它）。缺陷类：数组性只活在一张身份侧表里 ⇒
 * 形状拷贝（`{ ...abs }`）丢标记，类型面 / emit 产物也看不见该标注
 * （guard / zod schema / dts 三产物全部拒绝真实值）。
 *
 * 修法：facet 进形状 ⇒ 拷贝天然携带，消费方（Array.isArray / JSON 序列化
 * 视图 / 数组方法派发）只读形状 facet，侧表不存在。
 *
 * 锚定值均为 node 原生实测。
 */







describe("数组视图 = Shape facet（形状单一事实源）", () => {
  it("Array.isArray(/a(b)c/.exec(\"abc\")) 折 true（值面）；JSON.stringify(\"abc\".match(/b/)) → '[\"b\"]'（JSON 视图）；形状级：match 结果 Abs 带 view: \"array\"，浅拷贝携带（身份侧表会丢）；形状级：markArrayView 不可变替换 shape（原形状不被就地改写）；数组方法派发仍工作：/a(b)c/.exec(\"abc\").map((x) => x) → [\"abc\",\"", () => {
(() => {

    const r = call(`export function f1() { return Array.isArray(/a(b)c/.exec("abc")); }`, "f1");
    expect(litValue_____abs_ts_2(r.result)).toEqual({ ok: true, value: true });
  })();
(() => {

    const r = call(`export function f2() { return JSON.stringify("abc".match(/b/)); }`, "f2");
    expect(litValue_____abs_ts_2(r.result)).toEqual({ ok: true, value: '["b"]' });
  })();
(() => {

    const r = call(`export function f3() { return /a(b)c/.exec("abc"); }`, "f3");
    const a = r.result;
    // 形状仍是 obj（不转 tuple/arr：#136 的槽读面依赖它）
    expect(a.shape.k).toBe("obj");
    expect(a.shape.k === "obj" ? a.shape.view : undefined).toBe("array");
    expect(isArrayView(a)).toBe(true);
    expect(isMatchArrayView(a)).toBe(true);
    // 缺陷类断言：Abs 浅拷贝必须仍报数组视图（旧 WeakSet 侧表在此丢标记）
    const copy: Abs_____abs_ts_1 = { ...a };
    expect(copy).not.toBe(a);
    expect(isArrayView(copy)).toBe(true);
    expect(isMatchArrayView(copy)).toBe(true);
    // 形状拷贝同样携带
    const shapeCopy: Abs_____abs_ts_1 = { ...a, shape: { ...a.shape } };
    expect(isArrayView(shapeCopy)).toBe(true);
    // 普通 obj 形状不是数组视图
    expect(isArrayView(obj({ a: { value: numLit_____abs_ts_1(1) } }))).toBe(false);
    expect(isMatchArrayView(obj({ a: { value: numLit_____abs_ts_1(1) } }))).toBe(false);
  })();
(() => {

    const plain = obj({ 0: { value: strLit_____abs_ts("x") }, length: { value: numLit_____abs_ts_1(1) } });
    const before = plain.shape;
    expect(isArrayView(plain)).toBe(false);
    markArrayView(plain);
    expect(plain.shape).not.toBe(before);
    expect(isArrayView(plain)).toBe(true);
    // 旧形状对象未被就地打标（共享形状的其它 Abs 不受污染）
    expect(isArrayView({ shape: before, conf: plain.conf })).toBe(false);
    // 非 obj 形状不标注
    const prim = numLit_____abs_ts_1(1);
    markArrayView(prim);
    expect(isArrayView(prim)).toBe(false);
  })();
(() => {

    const r = call(`export function f5() { return /a(b)c/.exec("abc").map((x) => x); }`, "f5");
    expect(tupleEls(r.result)).toEqual(["abc", "b"]);
    // 端到端值面同样逐字一致（原生：["abc","b"]）
    const j = call(
      `export function f6() { return JSON.stringify(/a(b)c/.exec("abc").map((x) => x)); }`,
      "f6",
    );
    expect(litValue_____abs_ts_2(j.result)).toEqual({ ok: true, value: '["abc","b"]' });
  })();
(() => {

    const slots = {
      0: { value: strLit_____abs_ts("abc") },
      length: { value: numLit_____abs_ts_1(1) },
    };
    const viewA = obj(slots);
    const viewB = obj(slots);
    markArrayView(viewA);
    markArrayView(viewB);
    const plain = obj(slots);
    expect(isArrayView(viewA)).toBe(true);
    expect(isArrayView(viewB)).toBe(true);
    // 两侧都是数组视图 ⇒ join 结果仍是数组视图（重建 shape 时必须传递 facet）
    expect(isArrayView(joinObjects(viewA, viewB))).toBe(true);
    // 一侧是普通对象 ⇒ join 结果不是数组视图（保守丢弃 ⇒ 不让四面按数组判据
    // 校验一个可能是普通对象的值）
    expect(isArrayView(joinObjects(viewA, plain))).toBe(false);
    expect(isArrayView(joinObjects(plain, viewA))).toBe(false);
  })();
(() => {

    const r = call(`export function f7() { return /a(b)c/.exec("abc"); }`, "f7");
    const expr = denoteGuard(r.result, "value");
    expect(expr).toContain("Array.isArray(value)");
    expect(expr).not.toContain("!Array.isArray(value)");
    const guard = new Function("value", `return (${expr});`) as (v: unknown) => boolean;
    // 原生真值（槽全为自有属性）
    expect(guard(/a(b)c/.exec("abc"))).toBe(true);
    // 槽面逐字同形但**不是数组** ⇒ 拒绝（facet 是唯一判据）
    expect(guard({ 0: "abc", 1: "b", length: 2, index: 0, input: "abc", groups: undefined })).toBe(
      false,
    );
    // 普通 obj 形状仍是原判据（排除数组）
    const plain = call(`export function f8() { return { a: 1 }; }`, "f8");
    expect(denoteGuard(plain.result, "value")).toContain("!Array.isArray(value)");
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// Array.prototype mutator 只在字符串接收者上定抛
// ---------------------------------------------------------------------------
describe("Array.prototype mutator 只在字符串接收者上定抛", () => {
/**
 * `Array.prototype` 的 **mutator** 在**非字符串**原始值接收者上**假抛**
 * TypeError（node 实测：`Array.prototype.push.call(5, 1)` → 1；`pop.call(5)` →
 * undefined）。ToObject(prim) 得到的是**普通可扩展对象**（length 0），mutator
 * 正常成功；只有**字符串**接收者的 length 不可写 ⇒ 才定抛
 * （`push.call("ab", 1)` → TypeError: Cannot assign to read only property 'length'）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：mutator 守卫**收窄到字符串接收者**
 * （原生语义分类，非引擎拍脑袋）；其它原始值接收者按 ToObject(prim) 的
 * length-0 普通对象语义派发。
 */




describe("Array.prototype mutator 只在字符串接收者上定抛", () => {
  it("push.call(5, 1) = 1（原生；此前定抛 TypeError）；unshift.call(5, 1) = 1（原生）；pop.call(5) / shift.call(5) 不抛（原生 pop → undefined、shift → undefined）；字符串接收者仍定抛（push.call('ab',1) / pop.call('ab') → TypeError）；数组 / 对象接收者不受影响（push.call([1],2)=2 / push.call({", () => {
(() => {

    const r = call(`export function f() { return Array.prototype.push.call(5, 1); }`);
    expect(litValue_____abs_ts_3(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.throws.shape.k).toBe("never");
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.unshift.call(5, 1); }`);
    expect(litValue_____abs_ts_3(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.throws.shape.k).toBe("never");
  })();
(() => {

    const pop = call(`export function f() { return Array.prototype.pop.call(5); }`);
    expect(litValue_____abs_ts_3(pop.result)).toEqual({ ok: true, value: undefined });
    expect(pop.throws.shape.k).toBe("never");
    // shift 的**取值**由空元组 shift 面决定（invoke-arr.ts——他片所有）；
    // 本钉锁本 bug 的核心面：原始值接收者上 mutator **不抛**。
    const shift = call(`export function f() { return Array.prototype.shift.call(5); }`);
    expect(shift.throws.shape.k).toBe("never");
  })();
(() => {

    const push = call(`export function f() { return Array.prototype.push.call("ab", 1); }`);
    expect(isNever(push.result)).toBe(true);
    expect(throwsError(push.throws, "TypeError")).toBe(true);
    const pop = call(`export function f() { return Array.prototype.pop.call("ab"); }`);
    expect(isNever(pop.result)).toBe(true);
    expect(throwsError(pop.throws, "TypeError")).toBe(true);
  })();
(() => {

    expect(
      litValue_____abs_ts_3(call(`export function f() { return Array.prototype.push.call([1], 2); }`).result),
    ).toEqual({ ok: true, value: 2 });
    expect(
      litValue_____abs_ts_3(call(`export function f() { return Array.prototype.push.call({}, 2); }`).result),
    ).toEqual({ ok: true, value: 1 });
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.slice.call(5).length; }`);
    expect(litValue_____abs_ts_3(r.result)).toEqual({ ok: true, value: 0 });
    expect(r.throws.shape.k).toBe("never");
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// Map 迭代按宿主插入序（字面量键与身份键混插）
// ---------------------------------------------------------------------------
describe("Map 迭代按宿主插入序（字面量键与身份键混插）", () => {
/**
 * Map 的 Abs 表被拆成 `byLit`（字面量键）与 `identEntries`（引用
 * 身份键）两个通道，却**没有插入序**字段 ⇒ 键/值/条目迭代恒先吐字面量键、
 * 再吐身份键 ⇒ 与宿主插入序相反 ⇒ 依赖迭代序的 L1 契约假红 + `#exact` 的
 * 自信错值（Map 是 JS 里唯一保证插入序的集合）。
 *
 * 修复：MapTable 记录插入序（`order`），写面（set/delete/clear/fork 合并）
 * 维护宿主语义（重写既有键不换位、delete 后再写排到末尾），keys/values/
 * entries 按插入序投影。
 *
 * 用例必须**混插**字面量键与身份键：只有字面量键时两通道顺序恰好一致，
 * 缺陷测不出来。
 */




const objAbs = (): Abs___nudojs_core_1 => abs___nudojs_core_1({ k: "obj", slots: {} }, undefined, undefined, "exact");

/** entry 元组的键 Abs（迭代序断言用） */
const keyOfEntry = (e: Abs___nudojs_core_1): Abs___nudojs_core_1 =>
  e.shape.k === "tuple" ? e.shape.elements[0]! : e;

const KEYS_SRC = `
export function f() {
  const m = new Map();
  const o = { z: 1 };
  m.set(o, 1);
  m.set("a", 2);
  const out = [];
  for (const k of m.keys()) { out.push(typeof k === "string" ? k : "obj"); }
  return out.join(",");
}
`;

const VALUES_SRC = `
export function f() {
  const m = new Map();
  const o = { z: 1 };
  m.set(o, "first");
  m.set("a", "second");
  const out = [];
  for (const v of m.values()) out.push(v);
  return out.join(",");
}
`;

const ENTRIES_SRC = `
export function f() {
  const m = new Map();
  const o = { z: 1 };
  m.set(o, "first");
  m.set("a", "second");
  let s = "";
  for (const [k, v] of m) { s += (typeof k === "string" ? k : "obj") + ":" + v + ";"; }
  return s;
}
`;

describe("Map 迭代按宿主插入序（字面量键与身份键混插）", () => {
  it("keys()：身份键先插 → 迭代在前（宿主 obj,a）；values()：值顺序同样跟插入序（宿主 first,second）；entries() / for-of 解构：条目顺序同样跟插入序；table 面：字面量键与身份键混插时按写入序投影；重写既有键不换位；delete 后再写排到末尾（宿主语义）", () => {
(() => {

    // 宿主：const m=new Map(); m.set(o,1); m.set("a",2) → [...m.keys()] = [o, "a"]
    expect(litValue(call(KEYS_SRC, "f").result)).toEqual({ ok: true, value: "obj,a" });
  })();
(() => {

    expect(litValue(call(VALUES_SRC, "f").result)).toEqual({
      ok: true,
      value: "first,second",
    });
  })();
(() => {

    expect(litValue(call(ENTRIES_SRC, "f").result)).toEqual({
      ok: true,
      value: "obj:first;a:second;",
    });
  })();
(() => {

    const m = makeMapAbs();
    const obj = objAbs();
    mapSetEntry(m, obj, numLit___nudojs_core_1(1));
    mapSetEntry(m, strLit___nudojs_core_1("a"), numLit___nudojs_core_1(2));

    const entries = mapEntriesAbs(m);
    expect(entries).toHaveLength(2);
    // 第一项必须是身份键（修复前恒为字面量键 "a"）
    expect(keyOfEntry(entries[0]!)).toBe(obj);
    expect(litValue(keyOfEntry(entries[1]!))).toEqual({ ok: true, value: "a" });
    expect(mapValuesAbs(m).map((v) => litValue(v))).toEqual([
      { ok: true, value: 1 },
      { ok: true, value: 2 },
    ]);
  })();
(() => {

    const m = makeMapAbs();
    const obj = objAbs();
    mapSetEntry(m, obj, numLit___nudojs_core_1(1));
    mapSetEntry(m, strLit___nudojs_core_1("a"), numLit___nudojs_core_1(2));

    // m.set(o, v2)：值更新、位置不变
    mapSetEntry(m, obj, numLit___nudojs_core_1(9));
    expect(mapValuesAbs(m).map((v) => litValue(v))).toEqual([
      { ok: true, value: 9 },
      { ok: true, value: 2 },
    ]);

    // m.delete(o); m.set(o, v3)：重新插入 → 排到末尾
    mapDeleteEntry(m, obj);
    mapSetEntry(m, obj, numLit___nudojs_core_1(7));
    expect(mapValuesAbs(m).map((v) => litValue(v))).toEqual([
      { ok: true, value: 2 },
      { ok: true, value: 7 },
    ]);
    expect(keyOfEntry(mapEntriesAbs(m)[1]!)).toBe(obj);
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// concat 的非数组接收者整体作为单元素
// ---------------------------------------------------------------------------
describe("concat 的非数组接收者整体作为单元素", () => {
/**
 * `Array.prototype.concat` 的**泛型接收者**被当数组展开 ⇒
 * `Array.prototype.concat.call("ab")` 折出 **2 个元素**（原生是 **1 个**：
 * `["ab"]`）⇒ 元素数 / 首元素全错 ⇒ `nudo test` 对**正确代码**报假红。
 *
 * 规范：`concat` 只在 **IsArray(O)** 为真时把 this 的元素拷进结果；否则 this
 * **整体作为第一个元素**追加（不是泛型数组算法）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：物化通道的 concat 分支——非数组
 * exotic 接收者**整体作为单元素**进结果（种子元组 [this]）。
 */



describe("concat 的非数组接收者整体作为单元素", () => {
  it("concat.call('ab') = 1 个元素（原生；此前 2 个）；concat.call('ab')[0] = 'ab'（原生；此前 'a'）；concat.call(闭 obj) = 1 个元素（原生；此前 2 个）；数组接收者不受影响（concat.call([7,8]) = 2 个元素）；普通数组路径不受影响（[].concat('ab') = 1 个元素）", () => {
(() => {

    const r = call(`export function f() { return Array.prototype.concat.call("ab"); }`);
    expect(tupleEls(r.result)).toEqual(["ab"]);
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.concat.call("ab")[0]; }`);
    expect(tupleEls(r.result)).toBeUndefined(); // 标量结果（非元组）
    const lit = r.result;
    expect(lit.shape.k).toBe("prim");
    expect(lit.term?.op).toBe("lit");
    const t = lit.term;
    expect(t?.op === "lit" ? t.value : undefined).toBe("ab");
  })();
(() => {

    const r = call(
      `export function f() { return Array.prototype.concat.call({ length: 2, 0: "x", 1: "y" }); }`,
    );
    // 元素是接收者对象本身（非字面量）⇒ 断言元组长度
    expect(r.result.shape.k).toBe("tuple");
    expect(r.result.shape.k === "tuple" ? r.result.shape.elements.length : -1).toBe(1);
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.concat.call([7, 8]); }`);
    expect(tupleEls(r.result)).toEqual([7, 8]);
  })();
(() => {

    const r = call(`export function f() { return [].concat("ab"); }`);
    expect(tupleEls(r.result)).toEqual(["ab"]);
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// sort / reverse / fill / copyWithin 返回接收者
// ---------------------------------------------------------------------------
describe("sort / reverse / fill / copyWithin 返回接收者", () => {
/**
 * `Array.prototype.sort/reverse/fill/copyWithin.call(<对象>)` ⇒ 引擎
 * 返回**物化出来的空数组**而非**接收者对象**（原生返回 this 本身：
 * `Array.prototype.sort.call({a:1})` → `{a:1}`）⇒ 错值（内容 + 身份全丢）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：物化通道分族——「就地操作并返回
 * this」的方法（sort / reverse / fill / copyWithin）不走物化，直接返回接收者
 * Abs（原始值接收者：原生返回 ToObject(prim) 包装对象，引擎无该形态 ⇒ unknown）。
 */



describe("sort / reverse / fill / copyWithin 返回接收者", () => {
  it("sort.call({a:1}) = 接收者对象（此前折空数组）；reverse.call({a:1}) = 接收者对象；fill.call({a:1}, 0) = 接收者对象；copyWithin.call({a:1}, 0) = 接收者对象；数组接收者不受影响（sort.call([3,1,2]) 仍折排序元组）", () => {
(() => {

    const r = call(`export function f() { return Array.prototype.sort.call({ a: 1 }); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.reverse.call({ a: 1 }); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.fill.call({ a: 1 }, 0); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.copyWithin.call({ a: 1 }, 0); }`);
    expect(r.result.shape.k).toBe("obj");
    expect(objSlots(r.result)).toEqual({ a: 1 });
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.sort.call([3, 1, 2]); }`);
    expect(r.result.shape.k).toBe("tuple");
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// Array.prototype.with 在原始值接收者上定抛 RangeError
// ---------------------------------------------------------------------------
describe("Array.prototype.with 在原始值接收者上定抛 RangeError", () => {
/**
 * `Array.prototype.with.call(<原始值>)` ⇒ native 必抛 `RangeError`
 * （`with.call(1, 0, 2)` → RangeError: Invalid index : 0——ToObject(prim).length
 * = 0 ⇒ 下标必越界），引擎**恒不抛** ⇒ L2 门禁**假绿**（throws 面折 never）。
 *
 * 修法（core/algebra/exec/class/invoke.ts）：原始值接收者分支按原生语义补域
 * 错误——`with` 在非字符串原始值接收者上定抛 RangeError（负下标原生写 "-1"
 * 属性不抛；字符串接收者走字符元组路径，长度有效下标不抛）。
 */




describe("Array.prototype.with 在原始值接收者上定抛 RangeError", () => {
  it("with.call(1, 0, 2) 定抛 RangeError（原生；此前恒不抛 ⇒ 假绿）；with.call(true, 0, 'x') 同样定抛 RangeError；负下标也越界（with.call(1, -1, 2) → RangeError；RelativeIndex 钳到 0）；字符串接收者不抛（with.call('ab', 0, 'x') 走字符元组）；数组接收者不受影响（with.call([1,2], 0, 9) = [9,2]）", () => {
(() => {

    const r = call(`export function f() { return Array.prototype.with.call(1, 0, 2); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.with.call(true, 0, "x"); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.with.call(1, -1, 2); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "RangeError")).toBe(true);
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.with.call("ab", 0, "x"); }`);
    expect(r.throws.shape.k).toBe("never");
    expect(r.result.shape.k).toBe("tuple");
  })();
(() => {

    const r = call(`export function f() { return Array.prototype.with.call([1, 2], 0, 9); }`);
    expect(r.throws.shape.k).toBe("never");
    expect(litValue_____abs_ts_4(r.result)).toEqual({ ok: false });
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// toSpliced 删除窗口（零实参 / 显式 undefined）
// ---------------------------------------------------------------------------
describe("toSpliced 删除窗口（零实参 / 显式 undefined）", () => {
/**
 * `Array.prototype.toSpliced()` 的删除窗口：`skipCount` **缺省**与
 * `skipCount` **显式 undefined** 被混为一谈（`toIOI` 对两者都返回
 * undefined）⇒ `toSpliced()` / `toSpliced(0, undefined)` 把整个数组删空
 * （原生**原样保留**）。
 *
 * 原生规则（ES2023 Array.prototype.toSpliced）：
 * - `toSpliced()` **start 缺省** ⇒ `actualSkipCount = 0`（不删）；
 * - `toSpliced(0)` skipCount 缺省 ⇒ 删到尾；
 * - `toSpliced(0, undefined)` skipCount **在场** ⇒ `ToIntegerOrInfinity(undefined) = 0`
 * ⇒ 不删。
 *
 * 根修：删除窗口走 `spliceWindow`（arr-methods.ts）——splice / toSpliced 两臂
 * 共用同一实现；`toIOIArg` 提供「缺省 / 显式 undefined / 数值」第三态。
 */



const val = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  return (r.result as { term?: { op?: string; value?: unknown } })?.term?.value;
};

describe("toSpliced 删除窗口（零实参 / 显式 undefined）", () => {
  it("toSpliced() 零实参：原样保留（原生 1,2,3）；toSpliced(0, undefined)：skipCount 在场（undefined ⇒ 0）⇒ 原样保留；对照：toSpliced(0) skipCount 缺省 ⇒ 删到尾（原生空）；对照：toSpliced(1,1) ⇒ 删一个（原生 1,3）；对照：splice() 零实参 ⇒ 原生不删（被删数组为空）；对照：splice(0, undefined) ⇒ deleteCount 在场（0）⇒ 不删（", () => {
(() => {

    expect(val(`return [1,2,3].toSpliced().join(",");`)).toBe("1,2,3");
  })();
(() => {

    expect(val(`return [1,2,3].toSpliced(0, undefined).join(",");`)).toBe("1,2,3");
  })();
(() => {

    expect(val(`return [1,2,3].toSpliced(0).join(",");`)).toBe("");
  })();
(() => {

    expect(val(`return [1,2,3].toSpliced(1, 1).join(",");`)).toBe("1,3");
  })();
(() => {

    expect(val(`const a=[1,2,3]; return a.splice().join(",");`)).toBe("");
  })();
(() => {

    expect(val(`const a=[1,2,3]; return a.splice(0, undefined).join(",");`)).toBe("");
  })();
(() => {

    expect(val(`const a=[1,2,3]; return a.splice(1).join(",");`)).toBe("2,3");
  })();
});;

  ;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// array 缺元素约束守卫
// ---------------------------------------------------------------------------
describe("array 缺元素约束守卫", () => {
/**
 * `array()` **少传元素约束**：`asNestedConstraint(undefined, …)`
 * 静默变成 `lit(undefined)` ⇒ 契约变成「元素必须是 undefined」⇒ 任何
 * **合法**数组实参都被判违反（假红：`a[0] ∈ lit(undefined)`），且零诊断
 * 说明缺参。
 *
 * 修法：`array` 入口拒绝缺省元素 ⇒ Nudo 原生诊断；
 * 「元素可为 undefined」有显式写法：`array(lit(undefined))`。
 */








describe("array 缺元素约束守卫", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  });

  it("array() 抛 Nudo 原生诊断（点名构造器 + 给出写法）；array(undefined) 与 array() 同口径（不得静默变 lit(undefined)）；显式写法 array(lit(undefined)) 仍然合法（元素可为 undefined）；正常元素约束不受影响；产品面：合法数组实参不再被判违反（改前 3 条假红）；对照组：显式元素契约仍然执法（array(number()) 抓非数字元素）", () => {
(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  

    // 少传实参：零参调用与 `array(undefined)` 同口径（守卫判的是实参值，
    // 不是实参个数）⇒ 用显式 undefined 表达「缺参」。
    expect(() => array_____index_ts(undefined)).toThrow(/nudo array\(\)/);
    expect(() => array_____index_ts(undefined)).toThrow(/element constraint is required/);
  })();
(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  

    expect(() => array_____index_ts(undefined)).toThrow(/element constraint is required/);
  })();
(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  

    expect(() => array_____index_ts(litC(undefined))).not.toThrow();
  })();
(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  

    expect(() => array_____index_ts(number_____index_ts())).not.toThrow();
  })();
(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  

    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, array, any } from "@nudojs/core";
export const f = fn({ a: array() }, any());`,
    });
    const src = `
export function f(a) {
  return a;
}
export function g() {
  return f([1, 2, 3]);
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("nudo array()");
    // 改前：3 条 nudo:constraint-violated（合法实参 [1,2,3] 判违规 = 假红）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  })();
(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  

    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, array, number, any } from "@nudojs/core";
export const f = fn({ a: array(number()) }, any());`,
    });
    const src = `
export function f(a) {
  return a;
}
export function g() {
  return f(["x"]);
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 数组元素的长度界被执法（此前静默丢弃 = 门禁假绿）
// ---------------------------------------------------------------------------
describe("数组元素的长度界被执法（此前静默丢弃 = 门禁假绿）", () => {
/**
 * 侧车 `array(string().max(1))` 的**元素长度界整条被丢弃** ⇒
 * L3 前置条件**假绿**（门禁 0 error），而 **zod 产物面**同时在执法 ⇒
 * **跨产物面自相矛盾**（CI 判绿、运行时校验器判红）。
 *
 * 根因：`min` / `max` 把界写成 `ge/le(length(self), n)`，其中 `self` 是
 * **当前 builder 自己的项**。当 builder 是 `string()` 时 `self` 就是被检查的
 * 那个字符串 ⇒ `length(s) ≤ 1` 可执法；当它被 `array(item)` 消费时 `item`
 * 变成**数组的元素约束** ⇒ `self` 变成**元素项** ⇒ 元素执法路径里没有
 * 「对元素求 length」的位置 ⇒ 该 pred **既不被求值、也不被报告**（静默丢弃）。
 *
 * 修法：数组的**元素**长度界进 Abs 投影（元素项带自己的 pred）+ 执法面按
 * 元素位（`length(a[0])`）求值 ⇒ 与 zod 面的 `z.array(z.string().max(1))`
 * 给出同一个裁决。
 */




const SIDE = `
import { fn, array, string, number } from "@nudojs/core";
export const f = fn({ a: array(string().max(1)) }, number());
`;

const LIB = `export function f(a) { return a.length; }`;

const CALLER = `
import { f } from "./file.js";
export function g() { return f(["abc"]); }
`;

/** 跨文件形态：被调方 file.js + 它的同名侧车 file.nudo.js 在调用方 caller.js 里被 import */
function checkCaller(caller: string) {
  const files = makeFiles({
    "/t/file.js": LIB,
    "/t/file.nudo.js": SIDE,
  });
  return checkSource("/t/caller.js", caller, pTrue, {
    loadModule: files.loadModule,
    fromFile: "/t/caller.js",
  });
}

function violated(caller: string): number {
  return checkCaller(caller).issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

describe("数组元素的长度界被执法（此前静默丢弃 = 门禁假绿）", () => {
  it("元素超长 ⇒ 报违例（改前 0 error 假绿）；元素合规 ⇒ 不报违例（负控制）；违例文案点名元素位（length(a[0]) ≤ 1）而不是整个数组", () => {
(() => {

    expect(violated(CALLER)).toBe(1);
  })();
(() => {

    const ok = `
import { f } from "./file.js";
export function g() { return f(["a", "b"]); }
`;
    expect(violated(ok)).toBe(0);
  })();
(() => {

    const r = checkCaller(CALLER);
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue).toBeDefined();
    expect(issue!.expected).toContain("length(a[0])");
    expect(issue!.expected).toContain("≤ 1");
  })();
});;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// 原型环：Object.setPrototypeOf 抛 TypeError
// ---------------------------------------------------------------------------
describe("原型环：Object.setPrototypeOf 抛 TypeError", () => {
/**
 * `Object.setPrototypeOf` **不做原型环检测**：引擎建出一棵**活原型环**，
 * native 在建环瞬间抛 `TypeError: Cyclic __proto__ value`。
 *
 * 修前（HEAD）：`setProtoAbs` 直接 `protoTable.set(o, proto)` ⇒ 环被静默建出
 * （native 不存在该状态）⇒ 之后所有原型链观察都跑在环上，产出与 native 不可比的值。
 *
 * 修后：**同一事实源**（`protoChangeAllowed`，builtins/object/methods.ts）——
 * - `Object.setPrototypeOf` 据此**抛 TypeError**（native 同款）
 * - `Reflect.setPrototypeOf` 据此**返 false**（native 口径：Reflect 不抛，返 boolean）
 * 环检测本体在 objects.ts（`protoChainContains`：沿新原型的 [[Prototype]] 链上溯）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */



describe("原型环：Object.setPrototypeOf 抛 TypeError", () => {
  it("`a→b` 后 `b→a` ⇒ 抛 TypeError（native：TypeError: Cyclic __proto__ value）；用户 try/catch 捕到（native：\"threw\"）；自环 `Object.setPrototypeOf(a, a)` ⇒ 抛 TypeError（native：同款）", () => {
(() => {

    const rec = call(
      `export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); Object.setPrototypeOf(b, a); return 1; }`,
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  })();
(() => {

    expect(
      val(
        `export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); try { Object.setPrototypeOf(b, a); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  })();
(() => {

    expect(
      val(`export function f() { const a = {}; try { Object.setPrototypeOf(a, a); } catch { return "threw"; } return "no-throw"; }`),
    ).toEqual({ ok: true, value: "threw" });
  })();
});;

  ;

  ;
});

describe("原型环：Reflect.setPrototypeOf 返 false（Reflect 口径不抛）", () => {
  it("`Reflect.setPrototypeOf(b, a)`（a→b 已成环）⇒ false（native：false）；自环 ⇒ false（native：false）", () => {
(() => {

    expect(
      val(`export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); return Reflect.setPrototypeOf(b, a); }`),
    ).toEqual({ ok: true, value: false });
  })();
(() => {

    expect(
      val(`export function f() { const a = {}; return Reflect.setPrototypeOf(a, a); }`),
    ).toEqual({ ok: true, value: false });
  })();
});;

  ;
});

describe("对照组（合法原型设定）不得回归", () => {
  it("`Object.setPrototypeOf(a, b)` 生效（native：getPrototypeOf(a) === b）；`Reflect.setPrototypeOf(a, b)` 返 true（native：true）", () => {
(() => {

    expect(
      val(`export function f() { const a = {}, b = {}; Object.setPrototypeOf(a, b); return Object.getPrototypeOf(a) === b; }`),
    ).toEqual({ ok: true, value: true });
  })();
(() => {

    expect(
      val(`export function f() { const a = {}, b = {}; return Reflect.setPrototypeOf(a, b); }`),
    ).toEqual({ ok: true, value: true });
  })();
});;

  ;
});
});

// ---------------------------------------------------------------------------
// array pattern signature rendering
// ---------------------------------------------------------------------------
describe("array pattern signature rendering", () => {
/**
 * 数组解构形参在签名面被渲染成对象解构 `{ x, y }`。
 *
 * 根因：`FormalParam.kind === "pattern"` 同时覆盖 `ObjectPattern` 与
 * `ArrayPattern`，模型层**不记录模式种类** ⇒ 渲染层没有区分依据，一律输出
 * `{ … }`（数组解构的签名面看得出是对象）。
 *
 * 修法（族 08 · S3）：`FormalParam` 的 pattern 变体加 `patternKind`
 * （`"object"` / `"array"`），`formalParamSignatureNames` 按种类渲染。
 *
 * 反向钉：HEAD（未修）上 `patternKind` 为 undefined、签名渲染是 `{ x, y }`
 * ⇒ 本文件的两条渲染断言**必失败**。
 */







/** 数组解构 AST：`[x, y]` */
const arrayPatternNode = {
  type: "ArrayPattern",
  elements: [
    { type: "Identifier", name: "x" },
    { type: "Identifier", name: "y" },
  ],
};

/** 对象解构 AST：`{ a, b }` */
const objectPatternNode = {
  type: "ObjectPattern",
  properties: [
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "a" },
      value: { type: "Identifier", name: "a" },
    },
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "b" },
      value: { type: "Identifier", name: "b" },
    },
  ],
};

describe("array pattern signature rendering", () => {
  it("array destructured param records pattern kind array；object destructured param records pattern kind object；array pattern renders as [ x, y ] not { x, y }；object pattern still renders as { a, b }；generalize keeps array pattern signature name；", () => {
(() => {

    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(formals).toHaveLength(1);
    expect(formals[0]).toMatchObject({ kind: "pattern", patternKind: "array" });
  })();
(() => {

    const formals = formalParamsFromNodes([objectPatternNode] as never);
    expect(formals[0]).toMatchObject({ kind: "pattern", patternKind: "object" });
  })();
(() => {

    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(formalParamSignatureNames(formals)).toEqual(["[ x, y ]"]);
  })();
(() => {

    const formals = formalParamsFromNodes([objectPatternNode] as never);
    expect(formalParamSignatureNames(formals)).toEqual(["{ a, b }"]);
  })();
(() => {

    const g = generalizeFromAst("f", "export function f([x, y]) { return x + y; }\n");
    expect(g?.params).toEqual(["_p0"]);
    expect(formalParamSignatureNames(g?.formals ?? [])).toEqual(["[ x, y ]"]);
  })();
(() => {

    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const r = checkSource(
      "/t/f.js",
      "export function f([x, y]) { return x + y; }\n",
      pTrue,
      {},
    );
    expect(r.signatures.map((s) => s.params)).toEqual([["[ x, y ]"]]);
  })();
});;

  ;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// array pattern contract addressing is by index
// ---------------------------------------------------------------------------
describe("array pattern contract addressing is by index", () => {
/**
 * 数组解构形参的**字段级契约**被按**属性键**寻址 ⇒ 假红。
 *
 * 根因：`locateContractParam` 对 `kind: "pattern"` 默认「bound 名即属性键」
 * （对对象解构成立）。对数组解构不成立：`[a, b]` 的 `a` 是**下标 0 的元素**
 * ⇒ 契约被投影到 `arg.a` ⇒ 投影找不到 ⇒ 报「missing field a」**假红**。
 *
 * 修法（族 08 · S3 = **模型层**）：形参表面记录模式种类与**元素下标表**
 * （`patternKind: "array"` + `boundIndex`），`locateContractParam` 对数组解构
 * 返回**下标** `fieldIndex`（且**不给** `fieldPath`——fieldPath 是对象 slot
 * 投影路径，对数组无意义）。
 *
 * ⚠ **执法侧（实参投影 + 报假红）在 S4**（`scan-literal-calls.ts`）：
 * S4 需要 `hit.fieldIndex`（数组解构 ⇒ 按下标投影实参的元素）与
 * `hit.field`（展示名）两个字段；对象解构的 `fieldPath` 口径**不变**。
 *
 * 反向钉：HEAD（未修）上 `locateContractParam` 返回
 * `{index, field, fieldPath}`（属性键口径）⇒ 本文件的数组解构断言**必失败**。
 */



const arrayPatternNode = {
  type: "ArrayPattern",
  elements: [
    { type: "Identifier", name: "a" },
    { type: "Identifier", name: "b" },
  ],
};

const objectPatternNode = {
  type: "ObjectPattern",
  properties: [
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "a" },
      value: { type: "Identifier", name: "a" },
    },
  ],
};

describe("array pattern contract addressing is by index", () => {
  it("array pattern bound name resolves to the element index；array pattern contract hit carries no object-slot fieldPath；object pattern contract hit keeps the property-key addressing；whole-param contract name still resolves to the pattern index", () => {
(() => {

    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(locateContractParam(formals, "a")).toEqual({
      index: 0,
      field: "a",
      fieldIndex: 0,
    });
    expect(locateContractParam(formals, "b")).toEqual({
      index: 0,
      field: "b",
      fieldIndex: 1,
    });
  })();
(() => {

    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    const hit = locateContractParam(formals, "a");
    expect(hit).toBeDefined();
    expect(hit!.fieldPath).toBeUndefined();
  })();
(() => {

    const formals = formalParamsFromNodes([objectPatternNode] as never);
    expect(locateContractParam(formals, "a")).toEqual({
      index: 0,
      field: "a",
      fieldPath: ["a"],
    });
  })();
(() => {

    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    expect(locateContractParam(formals, "_p0")).toEqual({ index: 0 });
    expect(locateContractParam(formals, "_")).toEqual({ index: 0 });
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// array pattern param shape model
// ---------------------------------------------------------------------------
describe("array pattern param shape model", () => {
/**
 * 数组解构形参的契约把形参投影成**对象 shape**（错形态）
 * ⇒ 函数体按**数组下标**读绑定名 `a` ⇒ 读到 `never` ⇒ 返回面塌成 `never`。
 *
 * 修法（族 08 · S3 = **模型层**）：形参表面必须记录「这是数组解构」以及
 * **每个顶层绑定名对应的元素下标**——投影侧（`generalize.ts` 的
 * `buildPatternObjAbs`）据此建 **tuple/arr** 而不是对象 shape。
 *
 * ⚠ **投影侧在 S4**（`generalize.ts`）：S4 需要的字段形状 =
 * `FormalParam.patternKind === "array"`（判形态）+ `FormalParam.boundIndex`
 * （绑定名 → 下标）+ `FormalParam.propKey`（数组解构**恒空**——数组没有
 * 属性键）。S4 建 tuple 时按下标取 `boundIndex` 的值。
 *
 * 反向钉：HEAD（未修）上 `patternKind` 为 undefined、`boundIndex` 不存在
 * ⇒ 本文件的断言**必失败**。
 */





const arrayPatternNode = {
  type: "ArrayPattern",
  elements: [
    { type: "Identifier", name: "a" },
    { type: "Identifier", name: "b" },
  ],
};

const objectPatternNode = {
  type: "ObjectPattern",
  properties: [
    {
      type: "ObjectProperty",
      key: { type: "Identifier", name: "a" },
      value: { type: "Identifier", name: "a" },
    },
  ],
};

describe("array pattern param shape model", () => {
  it("array pattern exposes the element index of every top-level binding；array pattern has no property-key table (arrays have no slots)；object pattern keeps the property-key table and no index table；default + array pattern still records the array", () => {
(() => {

    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    const f = formals[0]!;
    expect(f.kind).toBe("pattern");
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.patternKind).toBe("array");
    expect(f.bound).toEqual(["a", "b"]);
    expect(f.boundIndex).toEqual({ a: 0, b: 1 });
  })();
(() => {

    const formals = formalParamsFromNodes([arrayPatternNode] as never);
    const f = formals[0]!;
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.propKey).toEqual({});
  })();
(() => {

    const formals = formalParamsFromNodes([objectPatternNode] as never);
    const f = formals[0]!;
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.patternKind).toBe("object");
    expect(f.propKey).toEqual({ a: "a" });
    expect(f.boundIndex).toEqual({});
  })();
(() => {

    const formals = formalParamsFromNodes([
      {
        type: "AssignmentPattern",
        left: {
          type: "ArrayPattern",
          elements: [{ type: "Identifier", name: "a" }],
        },
      },
    ] as never);
    const f = formals[0]!;
    if (f.kind !== "pattern") throw new Error("unreachable");
    expect(f.patternKind).toBe("array");
    expect(f.boundIndex).toEqual({ a: 0 });
  })();
(() => {

    const r = callLit(
      "export function f([a, b]) { return a; }\n",
      "f",
      [1, 2],
    );
    expect(litValue_____abs_ts_5(r.result)).toEqual({ ok: true, value: 1 });
  })();
});;

  ;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// bigint ⊗ array in + is string concat (never throws)
// ---------------------------------------------------------------------------
describe("bigint ⊗ array in + is string concat (never throws)", () => {
/**
 * `+` 的 bigint 臂**排在数组臂之前** ⇒ `1n + []` 被短路进数值臂。
 *
 * 根因（两段，见 AGENT-CONTEXT §4 / SURVEY-08 §1 第 5 行）：
 * ① `arithmetic/addsub.ts` 的 `add()`：bigint 臂（`foldBigintBinOp`）在数组臂
 * 之前 ⇒ `+` 的第一步 ToPrimitive 被跳过（数组侧恒 join(",") ⇒ string）。
 * 原生 `1n + []` = string "1"（**从不抛**），引擎却硬抛 TypeError ⇒ 折
 * `never` ⇒ L2 `nudo:entry-may-throw` **假红**（exit 1）。
 * ② `arithmetic/coerce.ts` 的 `isMaybeBigintOperand`：kind 清单漏 `arr`/
 * `tuple` ⇒ 数组 ⊗ bigint 落不进「数组专属分流」，只能落进兜底路径。
 *
 * 修法：`add()` 的数组臂**前移**到 bigint 臂之前（ToPrimitive 先行）；kind
 * 清单补 `arr`/`tuple`，并由 `foldBigintBinOp` 的数组分支**显式硬抛**
 * （数组 ToPrimitive 恒 string ⇒ ToNumber ⇒ number ⇒ 算术面混型 TypeError
 * **确定**且可被 catch 吸收 ⇒ 不得走软 may-throw 通道）；同时把数组/元组从
 * `isMaybeCoercionThrowOperand` 排除（数组 ToPrimitive 恒 string ⇒ 既不会成
 * bigint 也不会成 Symbol ⇒ `1 + []` / `[] < 1` 原生从不抛，不得记假
 * may-throw）。
 *
 * 原生 oracle（node 实跑）：
 * 1n + [] => string "1" 1n + [1,2] => string "11,2"
 * [] + 1n => string "1" 1n + "s" => string "1s"
 * [1] + 1n => string "11" 1n + 1 => THROW TypeError
 * 1 + [] => string "1" 1n - [] => THROW TypeError
 */







const BIG_PRIM = abs_____index_ts_2({ k: "prim", type: "bigint" }, undefined, undefined, "path");
const ARR_ABS = abs_____index_ts_2(
  { k: "arr", element: abs_____index_ts_2({ k: "prim", type: "number" }, undefined, undefined, "exact") },
  undefined,
  undefined,
  "path",
);

describe("bigint ⊗ array in + is string concat (never throws)", () => {
  it("1n + [] folds to string \"1\" (native), not never/TypeError；[] + 1n / [1] + 1n / 1n + [1,2] fold to the native join strings；bigint ⊗ array records NO may-throw (原生从不抛 ⇒ 不得进 L2 假红)；抽象 bigint 面 ⊗ 数组 / 抽象数组 ⊗ bigint ⇒ string，不折 unknown/never", () => {
(() => {

    const r = call(`export function f() { return 1n + []; }`);
    expect(isNever(r.result)).toBe(false);
    expect(val(`export function f() { return 1n + []; }`)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(formatShape(r.result)).toBe('"1"');
  })();
(() => {

    expect(val(`export function f() { return [] + 1n; }`)).toEqual({ ok: true, value: "1" });
    expect(val(`export function f() { return [1] + 1n; }`)).toEqual({ ok: true, value: "11" });
    expect(val(`export function f() { return 1n + [1,2]; }`)).toEqual({ ok: true, value: "11,2" });
  })();
(() => {

    expect(effects(`export function f() { return 1n + []; }`)).toEqual([]);
    expect(effects(`export function f() { return [] + 1n; }`)).toEqual([]);
    // 对照：确定混型（bigint ⊗ number）仍走硬抛面（throws 通道，非效果通道）
    const mixed = call(`export function f() { return 1n + 1; }`);
    expect(isNever(mixed.result)).toBe(true);
    expect(throwsError(mixed.throws, "TypeError")).toBe(true);
  })();
(() => {

    const bigSide = call(`export function f(x) { return x + []; }`, "f", [BIG_PRIM]);
    expect(isNever(bigSide.result)).toBe(false);
    expect(formatShape(bigSide.result)).toBe("string");
    expect(throwsError(bigSide.throws, "TypeError")).toBe(false);

    const arrSide = call(`export function f(x) { return 1n + x; }`, "f", [ARR_ABS]);
    expect(isNever(arrSide.result)).toBe(false);
    expect(formatShape(arrSide.result)).toBe("string");
    expect(throwsError(arrSide.throws, "TypeError")).toBe(false);
  })();
});;

  ;

  ;

  ;
});

describe("反向：不得改动既有口径", () => {
  it("number ⊗ 数组仍是 string 拼接（1 + [] = \"1\"，无 may-throw）；bigint ⊗ string 仍是拼接（1n + \"s\" = \"1s\"）；确定混型 bigint ⊗ number 仍硬抛 TypeError（never）；无字符串分支的算子仍抛：1n - [] / 1n * []（原生恒抛 TypeError，硬抛可被 catch 吸收）；catch 语义：1n + [] 原生不抛 ⇒ try 块正常走完（改前误进 catch）", () => {
(() => {

    expect(val(`export function f() { return 1 + []; }`)).toEqual({ ok: true, value: "1" });
    expect(effects(`export function f() { return 1 + []; }`)).toEqual([]);
    expect(val(`export function f() { return [1] + 1; }`)).toEqual({ ok: true, value: "11" });
  })();
(() => {

    expect(val(`export function f() { return 1n + "s"; }`)).toEqual({ ok: true, value: "1s" });
    expect(val(`export function f() { return "s" + 1n; }`)).toEqual({ ok: true, value: "s1" });
  })();
(() => {

    const r = call(`export function f() { return 1n + 1; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  })();
(() => {

    for (const op of ["-", "*"]) {
      const r = call(`export function f() { return 1n ${op} []; }`);
      expect(isNever(r.result), op).toBe(true);
      expect(throwsError(r.throws, "TypeError"), op).toBe(true);
      // catch 可吸收：原生进 catch 分支
      expect(
        val(`export function f() { try { 1n ${op} []; } catch (e) { return "caught"; } return "missed"; }`),
        op,
      ).toEqual({ ok: true, value: "caught" });
    }
  })();
(() => {

    expect(
      val(`export function f() { try { 1n + []; } catch (e) { return "caught"; } return "missed"; }`),
    ).toEqual({ ok: true, value: "missed" });
    // 对照：确定混型 1n + 1 原生抛 ⇒ 进 catch
    expect(
      val(`export function f() { try { 1n + 1; } catch (e) { return "caught"; } return "missed"; }`),
    ).toEqual({ ok: true, value: "caught" });
  })();
});;

  ;

  ;

  ;

  ;
});

describe("成员级：sum 含 arr/tuple 成员不连坐 may-throw", () => {
  // 单源化批次（coerce/surface 谓词收敛）曾把 arr/tuple 成员带进 may-throw
  // 通道 ⇒ `x & 1`（x: number|[]）记假 TypeError may-throw ⇒ L2 假红。
  // 原生 oracle：5 & 1 = 1、[] & 1 = 0、1 - 5 / 1 - [] 均不抛。
  const NUM = abs_____index_ts_2({ k: "prim", type: "number" }, undefined, undefined, "path");
  const sumOf = (...members: Abs_____abs_ts_2[]): Abs_____abs_ts_2 =>
    abs_____index_ts_2({ k: "sum", members }, undefined, undefined, "path");
  /** effects 助手固定以 anyAbs 调用；本段需指定实参域 ⇒ 本地变体 */
  const effectsWithArgs = (src: string, args: Abs_____abs_ts_2[]): string[] => {
    const exports = runTranspiled(src, { mode: "analyze" });
    const eff: MayThrowEffect[] = [];
    runWithMayThrowSession(() => {
      setMayThrowCollector((e) => eff.push(e));
      try {
        callTranspiledExportFull(exports, "f", args);
      } catch {
        /* 入口整抛：效果经 throws 面表达 */
      }
      setMayThrowCollector(null);
    });
    return [...new Set(eff.map((e) => e.kind))];
  };

  it("x & 1 / 1 - x（x: number|[]，无 bigint 参与）不记任何 may-throw；对照：1n + x（x: number|[]）记 may-throw 是 sound 的——number 成员混型原生恒抛（1n+1 THROW），arr 成员不抛（1n+[] = \"1\"）⇒ 并集恰为 may；对照：any/obj 成员（可 @@toPrimitive 成 Symbol/bigint）仍记 may-throw；对照：unknown 成员照记 may-t", () => {
(() => {

    const xs = [sumOf(NUM, ARR_ABS)];
    expect(effectsWithArgs(`export function f(x) { return x & 1; }`, xs)).toEqual([]);
    expect(effectsWithArgs(`export function f(x) { return 1 - x; }`, xs)).toEqual([]);
  })();
(() => {

    const xs = [sumOf(NUM, ARR_ABS)];
    expect(effectsWithArgs(`export function f(x) { return 1n + x; }`, xs)).toEqual([
      "TypeError",
    ]);
  })();
(() => {

    const anyAbs = abs_____index_ts_2({ k: "any" }, undefined, undefined, "path");
    const obj = abs_____index_ts_2({ k: "obj", slots: {} }, undefined, undefined, "path");
    for (const member of [anyAbs, obj]) {
      const xs = [sumOf(member, ARR_ABS)];
      expect(effectsWithArgs(`export function f(x) { return x & 1; }`, xs)).toEqual([
        "TypeError",
      ]);
    }
  })();
(() => {

    const unk = abs_____index_ts_2({ k: "unknown" }, undefined, undefined, "partial");
    const xs = [sumOf(unk, ARR_ABS)];
    expect(effectsWithArgs(`export function f(x) { return x & 1; }`, xs)).toEqual(["TypeError"]);
  })();
});;

  ;

  ;

  ;
});
});

// ---------------------------------------------------------------------------
// CJS getter / setter 不是可调用入口
// ---------------------------------------------------------------------------
describe("CJS getter / setter 不是可调用入口", () => {
/**
 * core 的 CJS 对象字面量收集器把 **getter / setter**（`ObjectMethod`
 * 的 `kind` 是 `get` / `set`）当成**导出函数** ⇒ `nudo check` **凭空造出**
 * `f() => unknown`（getter）/ `f(v: any) => unknown`（setter）+ **假的 L2
 * `nudo:entry-may-throw`**（假红，exit 1）⇒ 而 dts / health 面（service 普查）
 * 根本没有这个导出 ⇒ **两面矛盾**。
 *
 * 根因：`scan-top-functions.ts` 的 CJS 对象字面量收集段只看 `prop2.type`，**不看
 * `prop2.kind`** ⇒ getter / setter（不是可调用入口）进了普查。
 *
 * 修法：收集段排除 `kind === "get" / "set"`（与 service 侧 `analyzer-ast.ts`
 * 的 `module.exports = { … }` 分支同口径 —— 那边本来就判 `prop.kind !== "method"`）。
 */




const GETTER = `module.exports = {
  get f() {
    return 1;
  },
};
`;

const SETTER = `module.exports = {
  set f(v) {
    this._v = v;
  },
};
`;

const PLAIN_METHOD = `module.exports = {
  f() {
    return 1;
  },
};
`;

describe("CJS getter / setter 不是可调用入口", () => {
  it("getter 不进普查；setter 不进普查；普通方法仍进普查（对照）；getter ⇒ check 不造假的入口 may-throw（无 error）；setter ⇒ check 不造假的入口 may-throw（无 error）", () => {
(() => {

    expect(listTopFunctions(GETTER)).toEqual([]);
  })();
(() => {

    expect(listTopFunctions(SETTER)).toEqual([]);
  })();
(() => {

    expect(listTopFunctions(PLAIN_METHOD)).toEqual(["f"]);
  })();
(() => {

    const r = issuesOf(GETTER, "/t/b996/getter.js");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.signatures.filter((s) => s.name === "f")).toEqual([]);
  })();
(() => {

    const r = issuesOf(SETTER, "/t/b996/setter.js");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.signatures.filter((s) => s.name === "f")).toEqual([]);
  })();
});;

  ;

  ;

  ;

  ;
});
});

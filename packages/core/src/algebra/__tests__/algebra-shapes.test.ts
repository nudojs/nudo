/**
 * 模块套件：shape/union/品牌/槽位面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { val, call, resetEngineCaches } from "./eval-helpers.ts";
import { checkSource, pTrue, fn, number as number_____index_ts, shape } from "../index.ts";
import { abs, absLit, num, unknown, litValue, type Abs, numLit, strLit, anyAbs } from "../abs.ts";
import { app as termApp, v as termVar, lit } from "../term.ts";
import { nullable, number, instantiateConstraint, string } from "../constraint.ts";
import { assertImplies } from "../postcondition.ts";
import { makeFiles, sidecarOpts, issuesOf } from "./nudo-constraints.ts";
import type { CheckIssue } from "../check/check-report.ts";
import { takeRefineDiags, resetNudoModuleExecCache } from "../refine.ts";
import { takeContractDiags, resetSidecarLoadFailureCache } from "../contract/contract.ts";
import { $lit } from "../exec/runtime/state.ts";
import { resetCheckSourceMemo, checkSource as checkSource_____check_check_ts } from "../check/check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { absFunction, markPureFn } from "../abs-fn.ts";
import { pTrue as pTrue_____pred_ts, predToString, } from "../pred.ts";
import { $call, clearPureMemo } from "../exec/call.ts";
import { clearPureCallMemo } from "../exec/calls.ts";
import { checkSource as checkSource___nudojs_core, pTrue as pTrue___nudojs_core, resetCheckSourceMemo as resetCheckSourceMemo___nudojs_core, resetGeneralizeMemo as resetGeneralizeMemo___nudojs_core } from "@nudojs/core";
import { formatShape } from "../format/format.ts";
import { listTopFunctions } from "../scan/scan.ts";

// ---------------------------------------------------------------------------
// own 属性遮蔽原型方法
// ---------------------------------------------------------------------------
describe("own 属性遮蔽原型方法", () => {
/**
 * 回归：[[Get]] 是 **own → prototype**。内置 brand 实例 / 数组上的
 * `a.push = 1` 确实建了自有槽，读面不得再被原型方法表（BUILTIN_BRAND_METHODS /
 * ARRAY_PROTO_METHOD_NAMES）顶掉。此前 typeof a.push 恒折 "function"。
 */



const wrap = (body: string) => `export function f() { ${body} }`;


  it("数组 a.push = 1 读回 1（改前折函数）；Map 实例 m.get = 1 读回 number；Date / Set / RegExp 实例同形态；非表内键保持既有 unknown 口径（不假精确）；未写时表内键仍折函数", () => {
  {
    expect(val(wrap(`const a = []; a.push = 1; return a.push;`))).toEqual({ ok: true, value: 1 });
    expect(val(wrap(`const a = []; a.push = 1; return typeof a.push;`))).toEqual({ ok: true, value: "number" });
  }
  {
    expect(val(wrap(`const m = new Map(); m.get = 1; return typeof m.get;`))).toEqual({ ok: true, value: "number" });
  }
  {
    for (const [init, key] of [
      [`new Date(0)`, "getTime"],
      [`new Set()`, "add"],
      [`/a/`, "test"],
    ] as const) {
      expect(val(wrap(`const o = ${init}; o.${key} = 1; return typeof o.${key};`)), key).toEqual({
        ok: true,
        value: "number",
      });
    }
  }
  {
    const r = call(wrap(`const a = [1,2,3]; a.zzz = 1; return a.zzz;`));
    expect(r.result.shape.k).toBe("unknown");
    expect(val(wrap(`const a = [1,2]; return typeof a.push;`))).toEqual({ ok: true, value: "function" });
  }
});




});

// ---------------------------------------------------------------------------
// nullable(...) 对结构化返回值必须判违约（error）
// ---------------------------------------------------------------------------
describe("nullable(...) 对结构化返回值必须判违约（error）", () => {
/**
 * 回归：含 nullish 字面量成员的 union（`nullable(...)`）无法**证违**
 * 结构化返回值 ⇒ 违约事实被降级成 `nudo:unproven-return`（warning）⇒ 门禁
 * 判 OK、exit 0（假绿）。同一条契约在参数侧是 error 级拦截。
 *
 * 根因（两环）：
 * 1. `lit(null)` / `lit(undefined)` 的约束**没有 prim**（域靠 `eq(self, null)`
 * 承载）⇒ `assertScalar` 的 prim 门不触发；值相等义务随后落到
 * `isBoundedEvidenceMissing` 的兜底「无证据」⇒ `unprovable`——该函数把
 * **值相等义务**误分类成**带界义务**（gt/ge/lt/le），而结构化形状本身
 * 已确定「不是 nullish」。
 * 2. union 聚合「任一成员 unprovable ⇒ 整体 unprovable」⇒ 已被确定证伪的
 * `number()` 成员被伪不可判定的 nullish 成员掩盖 ⇒ disproved 降级 unprovable。
 *
 * 修法：值相等义务在返回项形状与其字面量域**不相交**时可判定 ⇒ 不蕴含即
 * `disproved`；于是全部成员被证伪 ⇒ union 整体 `disproved`（error）。
 */







const SIDECAR = `
export const maybeNumber = nullable(number());
export const numOrNull = union(number(), lit(null));
`;

const opts = {
  loadModule: (spec: string) => (spec.includes("nullish.nudo.js") ? SIDECAR : undefined),
  fromFile: "/t/app.js",
};

function check(contract: string, body: string) {
  const src = `/// @nudo:import { maybeNumber, numOrNull } from "./nullish.nudo.js"
/**
 * @nudo:contract return ${contract}
 */
export function f() {
  return ${body};
}
`;
  return checkSource("/t/app.js", src, pTrue, opts);
}

const violation = (r: ReturnType<typeof check>) =>
  r.issues.find((i) => i.code === "nudo:constraint-violated" && i.fn === "f");

const unproven = (r: ReturnType<typeof check>) =>
  r.issues.find((i) => i.code === "nudo:unproven-return" && i.fn === "f");

{
  it.each([
    ["[]", "空数组"],
    ["{}", "空对象"],
    ["{ a: 1 }", "普通对象"],
  ])("返回 %s（%s）⊭ nullable(number()) ⇒ error", (body) => {
    const r = check("maybeNumber", body);
    const v = violation(r);
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    // 旧口径的假绿症状：只出 warning
    expect(unproven(r)).toBeUndefined();
  });

  it("union(number(), lit(null)) 同口径：数组返回值 ⇒ error；不制造假红：null / undefined / number 返回值仍放行；单元面：结构臂 ⊭ union ⇒ disproved（不是 unprovable）；护栏：同域值相等义务（lit(5) 对无 pred 的 number 返回值）不得升级成 error", () => {
  {
    const v = violation(check("numOrNull", "[1]"));
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
  }
  {
    expect(violation(check("maybeNumber", "null"))).toBeUndefined();
    expect(violation(check("maybeNumber", "undefined"))).toBeUndefined();
    expect(violation(check("maybeNumber", "1"))).toBeUndefined();
    expect(unproven(check("maybeNumber", "null"))).toBeUndefined();
  }
  {
    const numAbs = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    const arrAbs = abs({ k: "arr", element: numAbs }, undefined, undefined, "path");
    const tup = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
    const obj = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    expect(assertImplies(arrAbs, nullable(number())).status).toBe("disproved");
    expect(assertImplies(tup, nullable(number())).status).toBe("disproved");
    expect(assertImplies(obj, nullable(number())).status).toBe("disproved");
    // nullish 字面量仍按域隶属放行
    const nullLit = absLit(null);
    expect(assertImplies(nullLit, nullable(number())).status).toBe("proved");
  }
  {
    // 返回项形状与字面量**同域** ⇒ 不可判定 ⇒ 仍是 unprovable（warning），
    // 不得因本条修法变成 disproved（假红）。
    const numNoPred = abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
    expect(assertImplies(numNoPred, number().gt(0)).status).toBe("unprovable");
    const derived = abs(
      { k: "prim", type: "number" },
      termApp("abs", [termVar("x")]),
      undefined,
      "path",
    );
    expect(assertImplies(derived, number().gt(0)).status).toBe("unprovable");
  }
});



}
});

// ---------------------------------------------------------------------------
// 跨槽 ref 的 binder 传递
// ---------------------------------------------------------------------------
describe("跨槽 ref 的 binder 传递", () => {
/**
 * 回归钉：跨槽 `ref()` 的 binder 表必须进 generalize 的形参投影。
 *
 * 修前：`constraintToEntryAbs(c, param)` 未传 `eff.binders` ⇒ `ref("a")` 在
 * 别的槽位的树里 ⇒ `resolveRef` 抛错 ⇒ 被 generalize 的裸 `catch {}` 吞掉
 * ⇒ 该位静默退回 `any()` ⇒ `y(x)` 被判「调用任意值」⇒ 合法代码假红，且契约
 * 义务在 check 面静默失效。
 *
 * 钉两面：① 诊断面无 error；② 签名面 y 位拿到 `number`（不是 any）。
 */




const SIDECAR = `import { fn, any, number, bind, ref } from "@nudojs/core";
export const t = fn({ x: bind("a", number()), y: fn({ z: ref("a") }, any()) }, any());`;
const CONTROL = `import { fn, any, number, bind } from "@nudojs/core";
export const t = fn({ x: bind("a", number()), y: fn({ z: any() }, any()) }, any());`;

const SOURCE = `export function t(x, y) { return y(x); }`;

function run(sidecar: string) {
  const { loadModule } = makeFiles({ "/t/b018.nudo.js": sidecar });
  return checkSource("/t/b018.js", SOURCE, pTrue, {
    loadModule,
    fromFile: "/t/b018.js",
    entryThrows: "off",
  });
}


  it("ref(\"a\") 解析到另一槽位的 bind ⇒ 无 error，y 位是 number；对照：y 位写 any() 时逐字不变（无回归）", () => {
  {
    const r = run(SIDECAR);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const sig = r.signatures.find((s) => s.name === "t");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[1]).toContain("number");
    expect(sig!.paramTypes?.[1]).not.toBe("any");
  }
  {
    const r = run(CONTROL);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const sig = r.signatures.find((s) => s.name === "t");
    expect(sig!.paramTypes?.[1]).toBe("(any) => any");
  }
});


});

// ---------------------------------------------------------------------------
// 顶层结构约束对 nullish 实参不再零诊断
// ---------------------------------------------------------------------------
describe("顶层结构约束对 nullish 实参不再零诊断", () => {
/**
 * 顶层「结构约束」位对 `null` / `undefined` 实参**零诊断**（假绿）
 * ⇒ 同一个实参位、同一个 nullish 实参，仅因约束是 `shape()` 而非标量就
 * 给出相反裁决 ⇒ 引擎内部第 4 套「nullish 是否满足契约」口径。
 *
 * 修法：消费侧（`scan/literal-shapes.ts` 的 `checkShapeAgainstAbs`）的排除
 * 条件从「`shape.k` 字面等于 unknown」改成「**无 term 的** unknown / any /
 * never 才跳过」⇒ nullish（有 term）落入「不是 object ⇒ 报违例」。
 */





const NUDO_SRC = `
import { fn, number, shape } from "@nudojs/core";
export const g = fn({ o: shape({ a: number() }) });
export const gScalar = fn({ x: number() });
`;

const opts = sidecarOpts("core-bug-1021.nudo.js", NUDO_SRC, "/t/core-bug-1021.js");

function check(src: string) {
  return checkSource("/t/core-bug-1021.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function g(o) { return o; }
export function gScalar(x) { return x; }
`;


  it("null 实参报违例（object shape at o）；undefined 实参报违例；同口径：顶层标量位对 null 也报违例（两套口径已统一）；合规实参零诊断（nullish 执法没有误伤合法调用）", () => {
  {
    const r = check(`${DECLS}\ng(null);\n`);
    const v = violated(r, "g");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at o");
  }
  {
    const r = check(`${DECLS}\ng(undefined);\n`);
    const v = violated(r, "g");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at o");
  }
  {
    const r = check(`${DECLS}\ngScalar(null);\n`);
    const v = violated(r, "gScalar");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof x = "number"');
  }
  {
    const r = check(`${DECLS}\ng({ a: 1 });\ngScalar(1);\n`);
    expect(violated(r)).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// union 的不可判定成员不再被当成失败
// ---------------------------------------------------------------------------
describe("union 的不可判定成员不再被当成失败", () => {
/**
 * `or`（union / nullable）契约中「**不可判定**」的成员被当成失败
 * ⇒ 假红（P1）。
 *
 * 复现：`union(number().gt(0), lit("a"))` 收到**非字面量 number**
 * （`n = Number(process.argv[2])`）⇒ 报 `(x > 0 ∨ x = "a")`（act = number）。
 *
 * 根因（`scan/literal-shapes.ts` 的 `judgeOrMember` + `checkReqs` 的 `or`
 * 聚合臂）：
 * - `instantiateOnTerm` 对「prim + preds」的成员**不带** typeof 原子 ⇒
 * `union(number().gt(0), lit("a"))` 实例化成 `or(gt(x,0), eq(x,"a"))`；
 * - `gt(x,0)` 对**非字面量** number 实参**不可判定**（值未知）；
 * - `eq(x,"a")` 的类型级兜底按形态判 ⇒ number ≠ string ⇒ **false**；
 * - 旧聚合规则「**任一支 false ⇒ 违例**」⇒ 把「不可判定且域兼容（number）」
 * 的成员误判成违例 ⇒ 假红（实参完全可能满足 `x > 0` 那支）。
 *
 * 修法：三值聚合改成「**全部**成员确定假才报」；成员「不可判定」时再看**域
 * 类型**（`memberDomainKind`）：域与实参形态**兼容**（或判不出）⇒ 整条 union
 * 保持未决 ⇒ 跳过（fail-closed：不猜）。`unionPredDecides`（结构通道让位闸）
 * 同步改成同一口径 ⇒ 两条通道不会双报 / 互不越权。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDE = `import { number, string, lit, union } from "@nudojs/core";
export const posOrLit = union(number().gt(0), lit("a"));
export const litOrLit = union(lit(1), lit("a"));
export const numOrStr = union(number(), string());
export const posOrNull = union(number().gt(0), lit(null));
`;

function check(src: string, file = "/t/union.js") {
  const imp = `/// @nudo:import { posOrLit, litOrLit, numOrStr, posOrNull } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

function violations(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}


  it("union(number().gt(0), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）；union(lit(1), lit('a')) 收到非字面量 number ⇒ 不报（域兼容 ⇒ 未决）；负控制：字面量不在 union 内 ⇒ 仍报违例；负控制：类型完全不符（boolean 实参 vs union(number(), string())）⇒ 仍报违例；负控制：满足其中一支（字面量 'a'）⇒ 不报", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x posOrLit */
function u(x) { return x; }
const n = Number(process.argv[2]);
export function use() { return u(n); }
`);
    expect(violations(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x litOrLit */
function u(x) { return x; }
const n = Number(process.argv[2]);
export function use() { return u(n); }
`);
    expect(violations(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x litOrLit */
function u(x) { return x; }
export function use() { return u("b"); }
`);
    expect(violations(r)).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x numOrStr */
function u(x) { return x; }
export function use() { return u(true); }
`);
    expect(violations(r)).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x posOrLit */
function u(x) { return x; }
export function use() { return u("a"); }
`);
    expect(violations(r)).toBe(0);
  }
});






/**
 * A3 残留回归钉（review F34 其它线索）：`union(number().gt(0), lit(null))`
 * 收到**对象 / 数组**实参时，数值界成员「不可判定」且 null 成员类型为假
 * ⇒ 旧口径会把「不可判定」当「不违反」静默放过。三值聚合修法后，域不兼容
 * （object / array vs number|null）⇒ **不得**静默 ⇒ 必须报 1 条违例；
 * 合法成员（null / 正数字面量）仍不报。
 */
describe("残留 —— union(number().gt(0), lit(null)) 的域不兼容实参不得静默", () => {
  it.each([["{}"], ["[]"]])(
    "对象/数组实参 %s ⇒ 恰好 1 条 nudo:constraint-violated",
    (arg) => {
      const r = check(`/** @nudo:contract x posOrNull */
function u(x) { return x; }
export function use() { return u(${arg}); }
`);
      expect(violations(r)).toBe(1);
    },
  );

  it.each([["null"], ["1"]])("合法成员 %s ⇒ 不报", (arg) => {
    const r = check(`/** @nudo:contract x posOrNull */
function u(x) { return x; }
export function use() { return u(${arg}); }
`);
    expect(violations(r)).toBe(0);
  });
});
});

// ---------------------------------------------------------------------------
// fn() 字段表实参守卫
// ---------------------------------------------------------------------------
describe("fn() 字段表实参守卫", () => {
/**
 * `fn()` 缺少**字段表实参守卫**（ 同源）。
 *
 * 缺陷：
 * - `fn()`（缺参）⇒ 宿主 `Object.entries(undefined)` 抛
 * "Cannot convert undefined or null to object" ⇒ **宿主原文泄进产品诊断**
 * （用户看不懂、也不是 Nudo 诊断）。
 * - `fn(42)`（非对象）⇒ `Object.entries(42)` ⇒ `{}` ⇒ 契约被**静默削弱成空参表**
 * （门禁零诊断 = 假绿：用户以为声明了参数约束，其实一条都没生效）。
 *
 * 修法：复用 `constraint.ts` 里 `shape()` 用的 `requireFieldsObject("fn", …)`
 * —— 缺参 / 非对象都**点名构造器 + 说明缺参**，宿主原文不进产品。
 */






beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});


  it("fn() 缺参 ⇒ 点名构造器报错，不泄露宿主原文；fn(42) 非对象 ⇒ 报错（不再静默变成 fn({})）；fn(null) ⇒ 报错；fn({ id: number() }) 正常构造（负控制）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    let err: unknown;
    try {
      (fn as unknown as () => unknown)();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("fn()");
    expect(msg).not.toContain("Cannot convert undefined or null to object");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    let err: unknown;
    try {
      (fn as unknown as (x: unknown) => unknown)(42);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("fn()");
    expect(msg).not.toContain("Cannot convert undefined or null to object");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (fn as unknown as (x: unknown) => unknown)(null)).toThrow(/fn\(\)/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => fn({ id: number_____index_ts() })).not.toThrow();
  }
});




});

// ---------------------------------------------------------------------------
// union 里的 unknown 同样算引擎债
// ---------------------------------------------------------------------------
describe("union 里的 unknown 同样算引擎债", () => {
/**
 * `nudo:unknown-inference`（引擎债诊断）在 **unknown 出现在 union 里**
 * 时漏报 ⇒ 同一个 `document` 对象上「一个报一个不报」；违反设计文档
 * `cli-semantics` 的**禁止条款**「在 check 中对 unknown（失败）静默通过而不报
 * 引擎债相关诊断」。
 *
 * env 把未建模的宿主对象建模成 `unknown | null`（`web.ts` 的
 * `unionOf(prim.unknown, nullLit())`、`es.ts` 等）——本套件用同一形态的
 * sum Abs 注入 envGlobals（等价于 env 面产出），钉：
 * - `unknown | null` ⇒ 报（旧口径只认裸 unknown ⇒ 漏报）；
 * - 裸 unknown ⇒ 仍报（对照组）；
 * - 有值证据（`lit` term，如 `undefined`）不是引擎债 ⇒ 不报。
 */










/**
 * env 面「未建模宿主对象」形态：`unionOf(prim.unknown, nullLit())`
 * （`packages/env/src/abs-helpers.ts:68` 的 nullLit = brand("null") + lit term）
 */
const NULL_BRAND = abs(
  { k: "brand", name: "null", shape: abs({ k: "unknown" }, lit(null), undefined, "exact") },
  lit(null),
  undefined,
  "exact",
);
const UNKNOWN_OR_NULL = abs(
  { k: "sum", members: [unknown, NULL_BRAND] },
  undefined,
  undefined,
  "exact",
);

function check(globals: Record<string, unknown>) {
  return checkSource(
    "/t/w.js",
    `export function q(sel) {\n  return ${Object.keys(globals)[0]};\n}\n`,
    pTrue,
    { inject: { envGlobals: globals as never } },
  );
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();
  });

  it("unknown | null 的返回 ⇒ nudo:unknown-inference；裸 unknown ⇒ 仍报（对照组，行为不变）；有值证据（unknown 形状 + lit(undefined) term）不是引擎债 ⇒ 不报；具体类型不受影响 ⇒ 不报", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check({ doc: UNKNOWN_OR_NULL });
    const warn = r.issues.filter((i) => i.code === "nudo:unknown-inference");
    expect(warn).toHaveLength(1);
    expect(warn[0]!.severity).toBe("warning");
    expect(warn[0]!.fn).toBe("q");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check({ doc: unknown });
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toHaveLength(1);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check({ doc: $lit(undefined) });
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check({ doc: num() });
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
  }
});



}
});

// ---------------------------------------------------------------------------
// mock 名与模块级绑定同名 ⇒ 不撞名（文件不再 fail-closed）
// ---------------------------------------------------------------------------
describe("mock 名与模块级绑定同名 ⇒ 不撞名（文件不再 fail-closed）", () => {
/**
 * `@nudo:mock <名>` 与**模块级绑定同名**时整份文件求值静默失败。
 *
 * 改前：env/mock 注入面把 mock 与 env **合进同一张表**并**无条件前置注入**
 * `let <name> = …`；而 `rewriteUserImports` 也生成 `let <name> = …`
 * ⇒ 同名 `let` 重复声明 ⇒ `new Function` SyntaxError ⇒ 整文件求值失败
 * ⇒ fail-closed `unknown` ⇒ 门禁绿灯 exit 0（假绿）。
 *
 * 改后：撞名的注入**跳过**（模块级绑定优先）；import 绑定的 mock 由
 * `rewriteUserImports` 直接改写为读 mock 值（mock 覆盖 import）。
 */






const num = (v: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue_____pred_ts, "exact");

/** mock 值本身是一个 Abs（函数）——与 service 侧 mock 种子同形 */
const mockFn = (v: number) =>
  absFunction(["x"], { apply: () => num(v) });


  it("mock 名与 import 绑定同名：mock 覆盖 import，文件正常求值；mock 名与用户顶层声明同名：模块级绑定胜出，文件照常求值（不抛）；env 全局名与模块级绑定同名：同样不撞名（env 注入被跳过）", () => {
  {
    const src = `import { getPort } from "./v-port.js";
/** @nudo:mock getPort = stub().returns(8080) */
export function readPort() { return getPort(); }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./v-port.js": { named: { getPort: num(1234) } } },
      mocks: { getPort: mockFn(8080) },
    });
    expect(Object.keys(exports)).toContain("readPort");
    const full = callTranspiledExportFull(exports, "readPort", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: 8080 });
  }
  {
    const src = `/** @nudo:mock getPort = stub().returns(8080) */
export function getPort() { return 1234; }
export function readPort() { return getPort(); }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      mocks: { getPort: mockFn(8080) },
    });
    expect(Object.keys(exports).sort()).toEqual(["getPort", "readPort"]);
    const full = callTranspiledExportFull(exports, "readPort", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: 1234 });
  }
  {
    const src = `export const helper = 1;
export function readHelper() { return helper; }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      envGlobals: { helper: num(7) },
    });
    expect(Object.keys(exports).sort()).toEqual(["helper", "readHelper"]);
    const full = callTranspiledExportFull(exports, "readHelper", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: 1 });
  }
});



});

// ---------------------------------------------------------------------------
// pure memo 键值基（同一变量重绑定不得命中旧缓存）
// ---------------------------------------------------------------------------
describe("pure memo 键值基（同一变量重绑定不得命中旧缓存）", () => {
/**
 * @nudo:pure 的记忆化键必须是**值基**，不能是**变量身份**（term）。
 *
 * 旧实现：pureMemoKey = callBudgetKey("pure", "", args) ⇒ 键 = shape 种类 +
 * termToString(term) ⇒ term 是**变量 id**（不是值内容）⇒ 同一变量重绑定为
 * 不同值后仍命中旧缓存 ⇒ **陈旧结果**（宿主路径 use() 得 "2,2"，native 期望
 * "2,4"）。
 *
 * 本钉锁住：
 * - Abs 层（$call + markPureFn）：同一变量重绑定 ⇒ 缓存失效（重算）；
 * - Abs 层：不同变量同值 ⇒ 缓存命中（记忆化按**值**承诺）；
 * - 宿主函数路径（_memoize = "p"，同 service/eval-pure.ts 的落法）：同一变量
 * 重绑定 ⇒ use() 得 "2,4"；不同变量同值 ⇒ 命中；不同变量不同值 ⇒ 不得命中；
 * - 不可比较的实参（函数值）⇒ **不缓存**（宁可不算命中，也不能算出错误的
 * 命中——错误的命中 = 陈旧值 = 本条 bug 的根因）。
 */







beforeEach(() => {
  clearPureMemo();
  clearPureCallMemo();
});

/** 对象实参：shape = obj{v: <字面量>}，term = 变量 id（身份与内容解耦） */
function objArg(varId: string, v: number): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        v: { value: abs({ k: "prim", type: "number" }, { op: "lit", value: v }, undefined, "exact") },
      },
    },
    { op: "var", id: varId },
    undefined,
    "exact",
  );
}

/** 纯函数 p(o) = o.v * 2（apply 钩子；调用次数即「是否重算」） */
function pureDouble(counter: { n: number }): Abs {
  const fn = absFunction(["o"], {
    apply: (args) => {
      counter.n += 1;
      const s = args[0]!.shape;
      if (s.k !== "obj") throw new Error("expect obj arg");
      const inner = litValue(s.slots["v"]!.value);
      if (!inner.ok) throw new Error("expect lit slot");
      return abs(
        { k: "prim", type: "number" },
        { op: "lit", value: Number(inner.value) * 2 },
        undefined,
        "exact",
      );
    },
  });
  markPureFn(fn as unknown as object, "p");
  return fn;
}

/** 宿主 JS 函数路径：_memoize = "p"（同 service/eval-pure.ts 的落法） */
function hostUse(src: string, entry = "use"): string {
  const exports = runTranspiled(src, { mode: "exec", maxLoopIters: 2000 });
  (exports["p"] as { _memoize?: string })._memoize = "p";
  const full = callTranspiledExportFull(exports, entry, []);
  const v = litValue(full.result);
  return v.ok ? String(v.value) : "<no-lit>";
}


  it("Abs 层：同一变量重绑定为不同值 ⇒ 缓存失效（重算）；Abs 层：不同变量同值 ⇒ 缓存命中（记忆化按值承诺）；Abs 层：不可比较的实参（函数值）⇒ 不缓存（不算命中）；宿主函数路径：同一变量重绑定 ⇒ use() 得 \"2,4\"（native 口径）；宿主函数路径：不同变量同值 ⇒ 命中（函数体只跑一次）；宿主函数路径：不同变量不同值 ⇒ 不得命中（\"2,4,calls=2\"）", () => {
  {
  clearPureMemo();
  clearPureCallMemo();


    const c = { n: 0 };
    const fn = pureDouble(c);
    const r1 = $call(fn, [objArg("o", 1)]);
    const r2 = $call(fn, [objArg("o", 2)]);
    expect(litValue(r1)).toEqual({ ok: true, value: 2 });
    // 陈旧命中会得 2（= 旧缓存）；正确行为 = 重算得 4
    expect(litValue(r2)).toEqual({ ok: true, value: 4 });
    expect(c.n).toBe(2);
  }
  {
  clearPureMemo();
  clearPureCallMemo();


    const c = { n: 0 };
    const fn = pureDouble(c);
    const a = $call(fn, [objArg("a", 1)]);
    const b = $call(fn, [objArg("b", 1)]);
    expect(litValue(a)).toEqual({ ok: true, value: 2 });
    expect(litValue(b)).toEqual({ ok: true, value: 2 });
    // 值相同 ⇒ 命中 ⇒ 函数体只跑一次
    expect(c.n).toBe(1);
  }
  {
  clearPureMemo();
  clearPureCallMemo();


    const c = { n: 0 };
    const fn = absFunction(["f"], {
      apply: () => {
        c.n += 1;
        return abs({ k: "prim", type: "number" }, { op: "lit", value: 1 }, undefined, "exact");
      },
    });
    markPureFn(fn as unknown as object, "pFnArg");
    const arg = absFunction([], { apply: () => abs({ k: "never" }, undefined, undefined, "exact") });
    $call(fn, [arg]);
    $call(fn, [arg]);
    // 函数值不可比 ⇒ 不缓存 ⇒ 两次都真跑（保守：宁可不算命中）
    expect(c.n).toBe(2);
  }
  {
  clearPureMemo();
  clearPureCallMemo();


    const out = hostUse(`export function p(o) { return o.v * 2; }
export function use() {
  let o = { v: 1 };
  const a = p(o);
  o = { v: 2 };
  const b = p(o);
  return String(a) + "," + String(b);
}`);
    expect(out).toBe("2,4");
  }
  {
  clearPureMemo();
  clearPureCallMemo();


    const out = hostUse(`let calls = 0;
export function p(o) { calls = calls + 1; return o.v * 2; }
export function use() {
  const a = { v: 1 };
  const b = { v: 1 };
  const x = p(a);
  const y = p(b);
  return String(x) + "," + String(y) + ",calls=" + calls;
}`);
    expect(out).toBe("2,2,calls=1");
  }
  {
  clearPureMemo();
  clearPureCallMemo();


    const out = hostUse(`let calls = 0;
export function p(o) { calls = calls + 1; return o.v * 2; }
export function use() {
  const a = { v: 1 };
  const b = { v: 2 };
  const x = p(a);
  const y = p(b);
  return String(x) + "," + String(y) + ",calls=" + calls;
}`);
    expect(out).toBe("2,4,calls=2");
  }
});






});

// ---------------------------------------------------------------------------
// prim + 界契约实例化保留 typeof 类型义务
// ---------------------------------------------------------------------------
describe("prim + 界契约实例化保留 typeof 类型义务", () => {
/**
 * 「prim + 界」契约（`number().gt(0)` / `string().max(3)`）实例化时
 * **丢掉 prim 的类型义务**：`instantiateConstraint` 只在 `preds.length === 0`
 * 时补 `typeof` 谓词 ⇒ 有界契约的实例化结果里没有类型义务 ⇒ 执法层无从判类型。
 *
 * 修法（core/algebra/constraint.ts `instantiateConstraint`）：
 * 只要约束带 `prim`，就把 `typeof` 谓词与界谓词**合取**（不再二选一）。
 */







  it("number().gt(0) 实例化 = typeof 义务 ∧ 数值界；string().max(3) 实例化 = typeof 义务 ∧ 长度界；裸 prim 契约口径不变（仍是单条 typeof）；产品面：类型错配的实参被抓住（此前零诊断静默放行）", () => {
  {
    const p = predToString(instantiateConstraint(number().gt(0), "ms"));
    expect(p).toContain('typeof ms = "number"');
    expect(p).toContain("ms > 0");
  }
  {
    const p = predToString(instantiateConstraint(string().max(3), "s"));
    expect(p).toContain('typeof s = "string"');
    expect(p).toContain("length(s) ≤ 3");
  }
  {
    expect(predToString(instantiateConstraint(number(), "ms"))).toBe(
      'typeof ms = "number"',
    );
  }
  {
    const opts = sidecarOpts(
      "std.nudo.js",
      `export const positive = number().gt(0);`,
    );
    const r = checkSource(
      "/t/f.js",
      `/// @nudo:import { positive } from "./std.nudo.js"
/** @nudo:contract x positive */
function needsPos(x) { return x; }
needsPos("a");
`,
      pTrue,
      opts,
    );
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.code === "nudo:constraint-violated",
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(
      errs.some((i) => (i.expected ?? "").includes('typeof x = "number"')),
    ).toBe(true);
  }
});




});

// ---------------------------------------------------------------------------
// 非标量合取不再误报 nudo:contract-conflict
// ---------------------------------------------------------------------------
describe("非标量合取不再误报 nudo:contract-conflict", () => {
/**
 * 非标量约束的合取被误报成「语义不可满足」。
 *
 * `and()` 的两类 throw 被 `conjoinOrConflict` 一律当成 conflict：
 * - 形态不支持（shape/array/union/fn 合取）——Phase 1 的能力边界，两条
 * 约束可能**逐字相同**（最常见：源码 @nudo:contract 与同名侧车绑定
 * 都写 shape）；
 * - 语义真矛盾（number() ∧ string()）。
 *
 * 误报的后果是双面的：
 * - 门禁假红：一条说「不可满足」的 nudo:contract-conflict（实际只是合不了）；
 * - 门禁假绿：conflict 位让该形参的**义务被整条跳过** ⇒ 调用点不再校验。
 *
 * 修法：只有第二类才标 conflict（contract.ts `conjoinOrConflict`）。
 */








const SHAPES = `import { shape, number, string } from "@nudojs/core";\nexport const userShape = shape({ id: number(), name: string() });`;
const SIDECAR = `import { fn, shape, number, string } from "@nudojs/core";\nexport const t = fn({ o: shape({ id: number(), name: string() }) }, number());`;

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("shape 约束（源码指令 × 同名侧车）⇒ 无 conflict 假红；conflict 位不再吃掉该形参的义务 ⇒ 调用点仍报违例（假绿修复）；语义真矛盾（number() ∧ string()）仍然报 conflict", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();


    const { loadModule } = makeFiles({
      "/t/shapes.nudo.js": SHAPES,
      "/t/t.nudo.js": SIDECAR,
    });
    const src = `/// @nudo:import { userShape } from "./shapes.nudo.js"\n/**\n * @nudo:contract o userShape\n */\nexport function t(o) { return o.id; }`;
    const r = checkSource("/t/t.js", src, pTrue, {
      loadModule,
      fromFile: "/t/t.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:contract-conflict")).toEqual([]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();


    const { loadModule } = makeFiles({
      "/t/shapes2.nudo.js": SHAPES,
      "/t/t2.nudo.js": SIDECAR,
    });
    const src = `/// @nudo:import { userShape } from "./shapes2.nudo.js"\n/**\n * @nudo:contract o userShape\n */\nexport function t(o) { return o.id; }\nexport function caller() { return t({ id: "not-a-number", name: "x" }); }`;
    const r = checkSource("/t/t2.js", src, pTrue, {
      loadModule,
      fromFile: "/t/t2.js",
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();


    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const num = number();`,
      "/t/prim.nudo.js": `import { fn, string } from "@nudojs/core";\nexport const f = fn({ x: string() }, string());`,
    });
    const src = `/// @nudo:import { num } from "./std.nudo.js"\n/**\n * @nudo:contract x num\n */\nexport function f(x) { return x; }`;
    const r = checkSource("/t/prim.js", src, pTrue, {
      loadModule,
      fromFile: "/t/prim.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:contract-conflict").length).toBeGreaterThan(0);
  }
});


}
});

// ---------------------------------------------------------------------------
// check 签名面：fn 形参不出现内部占位 term
// ---------------------------------------------------------------------------
describe("check 签名面：fn 形参不出现内部占位 term", () => {
/**
 * check 签名面里 fn 形参的**内部占位 term** 不回显。
 *
 * 契约 fn（`fn({ x: number() }, number())`）的槽位 term 是 constraint.ts 生成的
 * 内部占位名（`x${i}` / `ret`），回显进签名面长成 TS 默认参数：
 * `f(cb: (number = x0) => number = ret) => number` —— 用户源码里根本没有这些名字。
 *
 * 关系 fn 槽位的 α 名（A1/B1…）**照旧回显**（hof-relation 的既有口径）。
 */






const SIDE = `import { fn, number } from "@nudojs/core";
export const f = fn({ cb: fn({ x: number() }, number()) }, number());
`;

const SRC = `export function f(cb) { return cb(1); }`;

{
  const r = checkSource___nudojs_core("/t/b349.js", SRC, pTrue___nudojs_core, {
    loadModule: (spec: string): string | undefined =>
      spec.includes("b349.nudo.js") ? SIDE : undefined,
    fromFile: "/t/b349.js",
  });
  const sig = r.signatures.find((s) => s.name === "f");

  it("形参类型是 (number) => number（无 x0 / ret）；签名面不含占位名", () => {
  {
    expect(sig).toBeDefined();
    expect(sig!.paramTypes![0]).toBe("(number) => number");
  }
  {
    const line = r.signatures
      .map((s) => s.paramTypes!.join(" | "))
      .join(" ");
    expect(line).not.toContain("x0");
    expect(line).not.toContain("ret");
  }
});
}

describe("formatShape：fn 内层槽位压占位 term、留 α 名", () => {
  it("占位 term（x0 / ret）不回显；关系 fn 的 α 名（A1 / B1）照旧回显", () => {
  {
    const slot = abs({ k: "prim", type: "number" }, termVar("x0"), undefined, "exact");
    const ret = abs({ k: "prim", type: "number" }, termVar("ret"), undefined, "exact");
    const f = abs(
      { k: "fn", params: ["x"], paramTypes: [slot], returnType: ret },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(f)).toBe("(number) => number");
  }
  {
    const slot = abs({ k: "any" }, termVar("A1"), undefined, "exact");
    const ret = abs({ k: "any" }, termVar("B1"), undefined, "exact");
    const f = abs(
      { k: "fn", params: ["x"], paramTypes: [slot], returnType: ret },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(f)).toBe("(A1) => B1");
  }
});

});
});

// ---------------------------------------------------------------------------
// shape 缺参诊断（宿主原文不得冒泡）
// ---------------------------------------------------------------------------
describe("shape 缺参诊断（宿主原文不得冒泡）", () => {
/**
 * `shape()` **少传实参**：宿主原生 TypeError 原文
 * 「Cannot convert undefined or null to object」直接进产品诊断 ⇒
 * 误导诊断（用户看不出是哪个构造器缺参）+ 整份契约当场丢失。
 *
 * 修法：实参守卫（切片① 的共用校验 `requireFieldsObject`）——
 * 缺参 ⇒ 点名构造器 + 说明缺参的 Nudo 原生诊断，宿主异常不冒泡。
 */








{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  });

  it("shape() 抛 Nudo 原生诊断，点名构造器并说明缺参；诊断不含宿主 TypeError 原文；shape(undefined) 与 shape() 同口径；产品面：侧车诊断是 Nudo 原生文案，不是宿主原文", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    // 少传实参：零参调用与 `shape(undefined)` 同口径（守卫判的是实参值，
    // 不是实参个数）⇒ 用显式 undefined 表达「缺参」。
    expect(() => shape(undefined as never)).toThrow(/nudo shape\(\)/);
    expect(() => shape(undefined as never)).toThrow(/fields object is required/);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    let msg = "";
    try {
      shape(undefined as never);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toContain("Cannot convert undefined or null to object");
    expect(msg).not.toContain("TypeError");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => shape(undefined as never)).toThrow(/fields object is required/);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, any } from "@nudojs/core";
export const f = fn({ o: shape() }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("nudo shape()");
    expect(load!.message).not.toContain("Cannot convert undefined or null to object");
  }
});



}
});

// ---------------------------------------------------------------------------
// formatShape 的数组元素给函数类型加括号
// ---------------------------------------------------------------------------
describe("formatShape 的数组元素给函数类型加括号", () => {
/**
 * `formatShape` 的**数组元素**不给**函数类型**加括号。
 *
 * 症状（改前）：`arr(fn)` 渲染成 `(1) => 1[]` ⇒ 按 TS 解析规则，`[]` 绑定到
 * **函数的返回类型**而不是数组元素 ⇒ 「函数数组」被读成「返回 `1[]` 的函数」
 * （类型被显示反了）。姊妹渲染器 `absToTSType`（dts 面）对同一 Abs 给的是
 * `((a: 1) => 1)[]` ⇒ **同一个 Abs 两个渲染器两种读法**。
 *
 * 根因：`formatShapeInner` 的 `case "arr"` 只有一条「需要分组」谓词
 * （`s.element.shape.k === "sum"`），`fn` 不在其中。
 *
 * 修法（族 09 · S1）：抽出模块私有谓词 `needsGrouping`（**本片只对 `fn`
 * 生效**；`brand` / `obj` / `tuple` 的同类缺口不在本片范围），`case "arr"`
 * 与 `case "sum"` 共用；既有的 `sum` 分组判定**保留**。
 */





/** fn Abs（形参 `a: number`，返回 `number`） */
function fnAbs(): Abs {
  return abs(
    { k: "fn", params: ["a"], paramTypes: [numLit(1)], returnType: numLit(1) },
    undefined,
    undefined,
    "exact",
  );
}


  it("arr(fn)：函数元素加括号（改前 `(1) => 1[]`）；arr(arr(fn))：嵌套数组同样带括号；控制：union 元素的既有分组判定保留；控制：prim 元素不加冗余括号；控制：tuple 元素里的 fn 不在本片范围（不加括号）；控制：对象槽里的 fn 不在本片范围（不加括号）；端到端：真实源码返回「函数数组」时不得渲染成「返回数组的函数」", () => {
  {
    const a = abs({ k: "arr", element: fnAbs() }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("((1) => 1)[]");
  }
  {
    const inner = abs({ k: "arr", element: fnAbs() }, undefined, undefined, "exact");
    const outer = abs({ k: "arr", element: inner }, undefined, undefined, "exact");
    expect(formatShape(outer)).toBe("((1) => 1)[][]");
  }
  {
    const sum = abs(
      { k: "sum", members: [numLit(1), strLit("x")] },
      undefined,
      undefined,
      "exact",
    );
    const a = abs({ k: "arr", element: sum }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe('(1 | "x")[]');
  }
  {
    const a = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("1[]");
  }
  {
    const a = abs({ k: "tuple", elements: [fnAbs()] }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("[(1) => 1]");
  }
  {
    const a = abs(
      { k: "obj", slots: { cb: { value: fnAbs() } } },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("{ cb: (1) => 1 }");
  }
  {
    const r = call(
      `export function f() { return Array.from([1], (x) => () => x); }`,
      "f",
    );
    expect(r.result.shape.k).toBe("arr");
    const text = formatShape(r.result);
    // 改前是 `() => ?[]`（`[]` 被读成函数的返回类型）
    expect(text).not.toContain("=> ?[]");
    expect(text).toMatch(/\)\[\]$/);
  }
});







});

// ---------------------------------------------------------------------------
// formatShape 的 union 成员给函数类型加括号
// ---------------------------------------------------------------------------
describe("formatShape 的 union 成员给函数类型加括号", () => {
/**
 * `formatShape` 的 **union 成员**不给**函数类型**加括号。
 *
 * 症状（改前）：`sum(fn, number)` 渲染成 `(1) => 1 | 2` ⇒ 按 TS 解析规则，
 * `|` 绑定到**函数的返回类型** ⇒ 「函数或 number」被读成「返回 `1 | 2` 的
 * 函数」。姊妹渲染器 `absToTSType`（dts 面）对同一 Abs 给的是
 * `((a: 1) => 1) | 2` ⇒ **同一个 Abs 两个渲染器两种读法**。
 *
 * 根因：`formatShapeInner` 的 `case "sum"` 把成员文本用 `" | "` 直接拼接、
 * **不做分组**。与 是**同一处缺口**（缺「需要分组」谓词），只是位置
 * 在 `sum` 臂而不是 `arr` 臂 ⇒ 同一处谓词（`needsGrouping`）两处共用。
 *
 * 修法（族 09 · S1）：`case "sum"` 的成员文本在 `needsGrouping` 命中时加括号
 * （**只对 `fn`**；`brand` / `obj` / `tuple` 不在本片范围）；去重 key 仍用
 * **未包裹**的文本（避免把 `fn` 成员与别的成员误去重）。
 */





/** fn Abs（形参 `a: number`，返回 `number`） */
function fnAbs(): Abs {
  return abs(
    { k: "fn", params: ["a"], paramTypes: [numLit(1)], returnType: numLit(1) },
    undefined,
    undefined,
    "exact",
  );
}

/** fn Abs（形参 `a: number`，返回 `string`） */
function fnStrAbs(): Abs {
  return abs(
    { k: "fn", params: ["a"], paramTypes: [numLit(1)], returnType: strLit("s") },
    undefined,
    undefined,
    "exact",
  );
}


  it("sum(fn, number)：函数成员加括号（改前 `(1) => 1 | 2`）；sum(fn, fn)：两个函数成员都加括号；sum(arr(fn), number)：数组成员靠 arr 臂自己加括号（成员本身不是 fn）；控制：非函数成员的 union 不加括号；去重：文本相同的两个 fn 成员只留一条（去重 key 用未包裹文本）；端到端：真实源码返回「函数或 number」时 `|` 不得被返回类型吃掉", () => {
  {
    const a = abs(
      { k: "sum", members: [fnAbs(), numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("((1) => 1) | 2");
  }
  {
    const a = abs(
      { k: "sum", members: [fnAbs(), fnStrAbs()] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe('((1) => 1) | ((1) => "s")');
  }
  {
    const arrFn = abs({ k: "arr", element: fnAbs() }, undefined, undefined, "exact");
    const a = abs(
      { k: "sum", members: [arrFn, numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("((1) => 1)[] | 2");
  }
  {
    const a = abs(
      { k: "sum", members: [numLit(1), strLit("x")] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe('1 | "x"');
  }
  {
    const a = abs(
      { k: "sum", members: [fnAbs(), fnAbs()] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("((1) => 1)");
  }
  {
    // 实参取 any（未约束）⇒ 三元两臂都可达 ⇒ 返回面是 union
    const r = call(
      `export function f(flag) { return flag ? () => 1 : 2; }`,
      "f",
      [anyAbs],
    );
    expect(r.result.shape.k).toBe("sum");
    const text = formatShape(r.result);
    // 改前是 `() => ? | 2`（`|` 绑定到函数的返回类型）
    expect(text).not.toContain("=> ? |");
    expect(text).toMatch(/^\(.+\) \| 2$/);
  }
});






});

// ---------------------------------------------------------------------------
// [merged] union-nullish-false-red
// ---------------------------------------------------------------------------
describe("union-nullish-false-red", () => {
// MERGED (topic-related bug pins): union-nullish-false-red + union-nullish-member-obligation
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>





{
/**
 * union / nullable 契约的**假红那一半**：`or` 析取臂对 nullish
 * 实参**无条件报违例** ⇒ **合法实参被报红**。
 *
 * 症状（族 11 / S6 修前实测，闸① oracle；S1 只钉了「假绿那一半」）：
 * - `union(number().gt(0), lit(null))` 收到 `null` ⇒ 1 违例（**假红**）
 * - `nullable(number().gt(0))` 收到 `null` ⇒ 1 违例（**假红**）
 * - `nullable(number().gt(0))` 收到 `undefined` ⇒ 1 违例（**假红**）
 * - `union(number(), lit(null))` 收到 `null` ⇒ 1 违例（**假红**）
 * - `union(number().gt(0), lit(undefined))` 收到 `undefined` ⇒ 1 违例（**假红**）
 *
 * 根因：`scan/literal-shapes.ts` 的 `checkReqs` 里「确定 undefined」早退臂
 * （nullish 实参）对 `gt/ge/lt/le/eq/**or**` 一律报违例 ⇒ 析取契约**没有
 * 逐支求值** ⇒ 落在 union 域内的合法 nullish 实参也被报红。
 *
 * 修法（S6，`scan/literal-shapes.ts`）：早退臂**不再**对 `or` 报违例 ⇒ `or`
 * 落到 `or` 聚合臂，**逐支求值**（任一支真即过）。
 *
 * ── 与 S1 的 429 钉的分工 ────────────────────────────────────────────────
 * - `union-nullish-member-obligation`（S1 已钉）
 * ⇒ **假绿那一半**（nullish 成员判不了 ⇒ 整条 union 零义务）
 * - **本钉** ⇒ **假红那一半**（合法 nullish 实参撞 union 契约被报红）
 *
 * ⚠ **不要**把这个口径搬到别处：nullish 是**两个域**（`null` 与 `undefined`
 * 互不相等）——`union(number().gt(0), lit(null))` 收到 `undefined` 仍然**该
 * 报红**（本钉的负控制钉住了这一点）。
 */





const SIDE = `import { number, lit, union, nullable } from "@nudojs/core";
export const posOrNull = union(number().gt(0), lit(null));
export const posOrUndef = union(number().gt(0), lit(undefined));
export const maybePositive = nullable(number().gt(0));
export const numOrNull = union(number(), lit(null));
export const numOrUndef = union(number(), lit(undefined));
`;

const IMP = `/// @nudo:import { posOrNull, posOrUndef, maybePositive, numOrNull, numOrUndef } from "./std429b.nudo.js"\n`;

const FILE = "/t/std429b.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo___nudojs_core();
  resetGeneralizeMemo___nudojs_core();
  return checkSource___nudojs_core(FILE, IMP + src, pTrue___nudojs_core, sidecarOpts("std429b", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated） */
function violated(r: { issues: CheckIssue[] }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: string, arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }`;
}

describe("union / nullable 契约的假红那一半（合法 nullish 实参不再报红）", () => {
  it("union(number().gt(0), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）；nullable(number().gt(0)) 收到 null ⇒ 放行（改前 1 违例 = 假红）；nullable(number().gt(0)) 收到 undefined ⇒ 放行（改前 1 违例 = 假红）；union(number(), lit(null)) 收到 null ⇒ 放行（改前 1 违例 = 假红）；union(number(), l", () => {
  {
    const r = check(call("posOrNull", "null"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("maybePositive", "null"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("maybePositive", "undefined"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("numOrNull", "null"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("numOrUndef", "undefined"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("posOrUndef", "undefined"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("posOrNull", "undefined"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null)");
  }
  {
    const r = check(call("posOrUndef", "null"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = undefined)");
  }
  {
    const r = check(call("numOrNull", "undefined"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = null)');
  }
  {
    const r = check(call("posOrNull", "0"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null)");
  }
  {
    const r = check(`export function f(x) { return x; }
export function use() { return f(null); }`);
    expect(violated(r).length).toBe(0);
  }
});










});
}

describe("union-nullish-member-obligation", () => {
/**
 * union / nullable 契约的**成员义务**：or 析取臂对 **nullish 成员**
 * 判不了 ⇒ 聚合臂的 `unknown` 抑制 ⇒ **整条 union 契约零义务**（越界实参全放行）。
 *
 * 症状（族 11 / S1 修前实测，闸① oracle）：
 * - `union(number().gt(0), lit(null))` 收到 `0` ⇒ 0 违例（**假绿**）
 * - `nullable(number().gt(0))` 收到 `0` ⇒ 0 违例（**假绿**）
 * - `union(number(), lit(null))` 收到 `"x"` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-preds.ts` 的 `judgeLiteralPred` 判不了 nullish 的 eq 原子
 * （裸值表达不了 `undefined` ⇒ 此前只能取 undefined 哨兵）⇒ or 聚合臂拿到
 * `unknown` ⇒ 「含 undefined 不猜」⇒ 整条契约被跳过。
 *
 * 修法（S1，`scan/literal-preds.ts`）：`judgeLiteralPred` 的 eq 分支先走
 * `predEqNullish`（契约端 tagged 形态）+ 实参的**精确字面量**（实参端）分档判定
 * —— `null` 与 `undefined` 是**两个域**（`===` 天然区分）。
 *
 * ── 与 434 的形态分工（族 11 / S5 已钉）──────────────────────────────────
 * | 形态 | 契约长什么样 | 执法通道 | 归属 |
 * |---|---|---|---|
 * | 裸字面量 | 契约**自身**就是 `lit(null)` | 单条 eq 原子 | 434（S5 已钉） |
 * | union / nullable | 契约**含** nullish **成员** | or 析取分支 | **本钉（429）** |
 *
 * ⚠ **不在本钉范围内（消费侧 `scan/literal-shapes.ts`，S2 在途）**：
 * nullish 实参撞上 union 契约时仍会**假红**（「确定 undefined」早退臂对 `or`
 * 无条件报违例 ⇒ 合法 `null` 也报）。该臂要改成**逐支求值**（任一支真即过）
 * 才行 —— 需要 `nullishKindOf` 分档，不是本片能单独收口的。本钉因此**只钉
 * 成员义务（假绿那一半）**，不钉假红那一半（钉了就是钉住中间形态）。
 */





const SIDE = `import { number, lit, union, nullable } from "@nudojs/core";
export const posOrNull = union(number().gt(0), lit(null));
export const maybePositive = nullable(number().gt(0));
export const numOrNull = union(number(), lit(null));
`;

const IMP = `/// @nudo:import { posOrNull, maybePositive, numOrNull } from "./std429.nudo.js"\n`;

const FILE = "/t/std429.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo___nudojs_core();
  resetGeneralizeMemo___nudojs_core();
  return checkSource___nudojs_core(FILE, IMP + src, pTrue___nudojs_core, sidecarOpts("std429", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated） */
function violated(r: { issues: CheckIssue[] }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: string, arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }`;
}

describe("union / nullable 契约的成员义务（or 析取臂不再被 unknown 抑制）", () => {
  it("union(number().gt(0), lit(null)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）；nullable(number().gt(0)) 收到 0 ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), lit(null)) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), lit(null)) 收到 1 ⇒ 放行（成员义务不误伤合法实参）；union(number().gt(0), lit(nu", () => {
  {
    const r = check(call("posOrNull", "0"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null)");
    expect(vs[0]?.actual).toContain("0");
  }
  {
    const r = check(call("maybePositive", "0"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x > 0 ∨ x = null ∨ x = undefined)");
  }
  {
    const r = check(call("numOrNull", '"x"'));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = null)');
  }
  {
    const r = check(call("numOrNull", "1"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("posOrNull", "3"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(`export function f(x) { return x; }
export function use() { return f(0); }`);
    expect(violated(r).length).toBe(0);
  }
});





});
});
});

// ---------------------------------------------------------------------------
// 布尔字面量实参走快路径（顶层与函数体内同判）
// ---------------------------------------------------------------------------
describe("布尔字面量实参走快路径（顶层与函数体内同判）", () => {
/**
 * 实参快路径**不认 `BooleanLiteral`** ⇒ 同一个调用点，
 * **顶层语句报错、函数体内静默放行**（作用域相关的假绿）。
 *
 * 根因：`scan/literal-args.ts` 的 `parseCallArgs` 快路径分派表
 * （NumericLiteral / Unary(-) / Object / Array / String / Null / **缺 Boolean** /
 * Identifier / MemberExpression / SpreadElement / CallExpression / 兜底）里
 * **没有 `BooleanLiteral` 分支** ⇒ `f(true)` 落到兜底 `absUnknown()` ⇒
 * `hasInfo = false` ⇒ 静态路径整条跳过 ⇒ 只剩「执行态实参回退」能救场，
 * 而执行态记录**只在模块顶层语句真的被执行过**时才有 ⇒ 函数体内的调用点
 * 永远没有记录 ⇒ 静默。
 *
 * 修法（S0）：分派表补 `BooleanLiteral` 一个分支（`prim boolean` + `lit` term，
 * 与 `NullLiteral` 分支同款）⇒ `hasInfo` 不再依赖执行态回退 ⇒
 * **顶层与函数体内给出同一条诊断**。
 *
 * 注：`NullLiteral` 分支由族 06（）补上；本条只剩 `BooleanLiteral`。
 */






const SIDE = `
import { number, boolean } from "@nudojs/core";
export const numC = number();
export const boolC = boolean();
export const posC = number().gt(0);
`;

const IMP = `/// @nudo:import { numC, boolC, posC } from "./std430.nudo.js"\n`;

/** checkSource + 侧车（共享脚手架 sidecarOpts，不内联副本） */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource_____check_check_ts(
    "/t/std430.js",
    IMP + src,
    pTrue_____pred_ts,
    sidecarOpts("std430", SIDE),
  );
}

/** 契约违例（调用点前置条件）诊断 */
function violations(r: {
  issues: { code: string; severity: string; actual?: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && i.severity === "error",
  );
}


  it("顶层 `f(true)` ⇒ 报违例（改前也报，走的是执行态回退）；★ 函数体内 `f(true)` ⇒ 报违例（改前**零诊断**——假绿）；★ 函数体内 `f(false)` ⇒ 报违例（改前零诊断）；作用域不再决定裁决：顶层与函数体内的诊断**逐字相同**；负控制：契约是 boolean() 时 `f(true)` ⇒ 不报违例；负控制：契约是 boolean() 时 `f(false)` ⇒ 不报违例；回归：`f(null)` 仍照常执法（族 06 的 NullLit", () => {
  {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
f(true);
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("true");
  }
  {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(true); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("true");
    expect(vs[0].expected).toContain("number");
  }
  {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(false); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("false");
  }
  {
    const top = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
f(true);
`);
    const body = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(true); return 1; }
`);
    const a = violations(top)[0];
    const b = violations(body)[0];
    expect(a.actual).toBe(b.actual);
    expect(a.expected).toBe(b.expected);
  }
  {
    const r = check(`
/** @nudo:contract x boolC */
export function f(x) { return x; }
export function g() { f(true); return 1; }
`);
    expect(violations(r).length).toBe(0);
  }
  {
    const r = check(`
/** @nudo:contract x boolC */
export function f(x) { return x; }
export function g() { f(false); return 1; }
`);
    expect(violations(r).length).toBe(0);
  }
  {
    const r = check(`
/** @nudo:contract x numC */
export function f(x) { return x; }
export function g() { f(null); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("null");
  }
  {
    const r = check(`
/** @nudo:contract x posC */
export function f(x) { return x; }
export function g() { f(0); return 1; }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("0");
  }
});








});

// ---------------------------------------------------------------------------
// 缺字段违例只报一次
// ---------------------------------------------------------------------------
describe("缺字段违例只报一次", () => {
/**
 * 同一条「缺字段」违例被**上报两次**（`checkShapeReqs` + `checkReqs`
 * 两条并行通道各发一份）⇒ `nudo check` 的错误计数翻倍。
 *
 * 修法：「投影失败 → missing field」的报告**收敛到一处**——`checkReqs`
 * 独占（它对每条 req 都跑，`checkShapeReqs` 的闸门会跳过部分条目），
 * `checkShapeReqs` 的投影失败分支只 `continue`（不再自己发一份）。
 * 诊断文本不变（仍是 `missing field b`）。
 */





const NUDO_SRC = `
import { fn, number } from "@nudojs/core";
export const fObj = fn({ a: number(), b: number() }, number());
`;

const opts = sidecarOpts("core-bug-436.nudo.js", NUDO_SRC, "/t/core-bug-436.js");

function check(src: string) {
  return checkSource("/t/core-bug-436.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

const DECL = `
export function fObj({ a, b }) {
  return a + b;
}
`;


  it("缺字段只产出 1 条诊断（不是 2 条）；诊断文本与去重前一致（missing field b）；两条**不同**的违例各报一次（缺字段 + 类型违例）；合规实参零诊断（去重没有把合法调用打成红）", () => {
  {
    const r = check(`${DECL}\nfObj({ a: 1 });\n`);
    const v = violated(r);
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("missing field b");
  }
  {
    const r = check(`${DECL}\nfObj({ a: 1 });\n`);
    const v = violated(r);
    expect(v[0]!.message).toContain("fObj");
    expect(String(v[0]!.expected)).toBe("missing field b");
  }
  {
    const r = check(`${DECL}\nfObj({ a: "x" });\n`);
    const texts = violated(r).map((i) => String(i.expected));
    // 缺字段：恰好一条（去重的核心断言）
    expect(texts.filter((t) => t.includes("missing field b"))).toHaveLength(1);
    // 字段类型违例：恰好一条（与缺字段是**不同**的违例，不该被合并）
    expect(texts.filter((t) => t.includes('typeof a = "number"'))).toHaveLength(1);
  }
  {
    const r = check(`${DECL}\nfObj({ a: 1, b: 2 });\n`);
    expect(violated(r)).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// 静态与实例同名：普查名不得重复
// ---------------------------------------------------------------------------
describe("静态与实例同名：普查名不得重复", () => {
/**
 * **静态**类方法与**实例**方法**同名**（都叫 `C.m`）→ 静态方法的签名被
 * **报错成实例方法的**（native `"stat"` vs 引擎 `"inst"`）→ **错误类型声明**。
 *
 * 根因：类方法名由 `${cname}.${keyName}` 合成，**不区分 `static` 与实例** ⇒ 同一个
 * 类里 `m`（实例）与 `m`（静态）得到**同一个名字** ⇒ 按名字索引的签名表里两条记录
 * **互相顶替**（形参取自一个、返回值取自另一个 ⇒ 半真半假的签名）。
 *
 * 修法（`scan-top-functions.ts` 的 `collectClassMethods`）：同名时**只登记实例
 * 方法**。⚠ 不能给静态方法另起一个普查名 —— 方法体也按 `Class.method` 这个键
 * 登记（`generalize.ts` 的 `env.fns`），另起名字会查不到方法体 ⇒ 凭空造出 L2 入口
 * may-throw 假红。service 侧 `analyzer-ast.ts` 的 `collectClassMethods` 同口径。
 */




const SAME_NAME = `export class C {
  m(x) {
    return "inst";
  }
  static m(y) {
    return "stat";
  }
}
`;

const DIFF_NAME = `export class C {
  m(x) {
    return "inst";
  }
  static n(x) {
    return "stat";
  }
}
`;


  it("同名 ⇒ 普查名只出现一次（静态方法不另起名）；不同名 ⇒ 两个都在（静态方法仍是入口可见的）；同名 ⇒ check 签名面只有一条 C.m（不再两条互相顶替）；同名 ⇒ 实例方法的返回值不被静态方法顶替（native \"inst\"）；不同名 ⇒ 两条签名都在（对照）", () => {
  {
    const names = listTopFunctions(SAME_NAME);
    expect(names).toEqual(["C.m"]);
    expect(new Set(names).size).toBe(names.length);
  }
  {
    expect(listTopFunctions(DIFF_NAME)).toEqual(["C.m", "C.n"]);
  }
  {
    const r = issuesOf(SAME_NAME, "/t/b437/k.js");
    const sigs = r.signatures.filter((s) => s.name === "C.m");
    expect(sigs.length).toBe(1);
  }
  {
    const r = issuesOf(SAME_NAME, "/t/b437/k.js");
    const sig = r.signatures.find((s) => s.name === "C.m");
    expect(sig?.display).toContain('"inst"');
  }
  {
    const r = issuesOf(DIFF_NAME, "/t/b437/j.js");
    expect(r.signatures.filter((s) => s.name === "C.m").length).toBe(1);
    expect(r.signatures.filter((s) => s.name === "C.n").length).toBe(1);
  }
});





});

// ---------------------------------------------------------------------------
// lazy 包装的结构义务不再丢失
// ---------------------------------------------------------------------------
describe("lazy 包装的结构义务不再丢失", () => {
/**
 * `lazy(() => shape(...))` / `lazy(() => array(...))` 的**结构义务
 * 整体丢失**（假绿）——`lazy` 包装自身 `fields` / `element` / `prim` 全空，
 * 执法侧的闸门只看约束自身 ⇒ 整条结构义务被 `continue` 掉。
 *
 * 修法：消费侧（`scan/literal-shapes.ts`）在判闸门前**先 deref** lazy 包装
 * （`derefDeep`：按 `LAZY_TEMPLATE_DEPTH` 预算递归解包，`derefConstraint`
 * 只解一层）。
 */





const NUDO_SRC = `
import { fn, number, shape, array, lazy, any } from "@nudojs/core";
export const takeShape = fn({ x: lazy(() => shape({ a: number() })) }, any());
export const takeArr = fn({ x: lazy(() => array(number())) }, any());
export const takeNested = fn({ x: lazy(() => lazy(() => shape({ a: number() }))) }, any());
`;

const opts = sidecarOpts("core-bug-439.nudo.js", NUDO_SRC, "/t/core-bug-439.js");

function check(src: string) {
  return checkSource("/t/core-bug-439.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function takeShape(x) { return x; }
export function takeArr(x) { return x; }
export function takeNested(x) { return x; }
`;


  it("lazy(() => shape(...))：非对象实参报违例；lazy(() => array(...))：元素类型不符报违例；嵌套 lazy 包装（两层）也能解包；合规实参零诊断（deref 没有把合法调用打成红）", () => {
  {
    const r = check(`${DECLS}\ntakeShape(1);\n`);
    const v = violated(r, "takeShape");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at x");
  }
  {
    const r = check(`${DECLS}\ntakeArr(["x"]);\n`);
    const v = violated(r, "takeArr");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof x[0] = "number"');
  }
  {
    const r = check(`${DECLS}\ntakeNested(1);\n`);
    const v = violated(r, "takeNested");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain("object shape at x");
  }
  {
    const r = check(`${DECLS}\ntakeShape({ a: 1 });\ntakeArr([1, 2]);\ntakeNested({ a: 1 });\n`);
    expect(violated(r)).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// 字段 / 元素位的 nullish 实参不再零诊断
// ---------------------------------------------------------------------------
describe("字段 / 元素位的 nullish 实参不再零诊断", () => {
/**
 * 字段位 / 数组元素位的 `null` / `undefined` 实参**完全不被执法**
 * （假绿）——顶层标量位与返回值面判违例，字段 / 元素位静默放行 ⇒ 引擎内
 * 3 套「nullish 是否满足契约」口径。
 *
 * 修法：消费侧（`scan/literal-shapes.ts` 的 `checkFieldConstraint`）
 * ① prim 门：nullish 实参（有 term 的 unknown）**不满足**裸 prim 契约；
 * ② 数值界门：nullish / boolean 实参不满足数值界（与顶层标量面同口径）。
 */





const NUDO_SRC = `
import { fn, number, shape, array, any } from "@nudojs/core";
export const top = fn({ x: number() }, any());
export const fld = fn({ o: shape({ v: number() }) }, any());
export const arr = fn({ a: array(number()) }, any());
export const fldBounded = fn({ o: shape({ v: number().gt(0) }) }, any());
`;

const opts = sidecarOpts("core-bug-914.nudo.js", NUDO_SRC, "/t/core-bug-914.js");

function check(src: string) {
  return checkSource("/t/core-bug-914.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function top(x) { return x; }
export function fld(o) { return o; }
export function arr(a) { return a; }
export function fldBounded(o) { return o; }
`;


  it("顶层标量位：null 报违例（基线口径不变）；字段位：{ v: null } 报违例；数组元素位：[null] 报违例；字段位 undefined 同样报违例；带界的字段位：null 不满足数值界；合规实参零诊断（nullish 执法没有误伤合法调用）", () => {
  {
    const r = check(`${DECLS}\ntop(null);\n`);
    const v = violated(r, "top");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof x = "number"');
  }
  {
    const r = check(`${DECLS}\nfld({ v: null });\n`);
    const v = violated(r, "fld");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof o.v = "number"');
  }
  {
    const r = check(`${DECLS}\narr([null]);\n`);
    const v = violated(r, "arr");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof a[0] = "number"');
  }
  {
    const r = check(`${DECLS}\nfld({ v: undefined });\n`);
    const v = violated(r, "fld");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof o.v = "number"');
  }
  {
    const r = check(`${DECLS}\nfldBounded({ v: null });\n`);
    const v = violated(r, "fldBounded");
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
  }
  {
    const r = check(`${DECLS}\ntop(1);\nfld({ v: 1 });\narr([1, 2]);\nfldBounded({ v: 5 });\n`);
    expect(violated(r)).toEqual([]);
  }
});






});

// ---------------------------------------------------------------------------
// CJS 普查名取导出槽名，不取内层函数 id
// ---------------------------------------------------------------------------
describe("CJS 普查名取导出槽名，不取内层函数 id", () => {
/**
 * CJS 成员赋值用**具名函数表达式**时，普查名取**内层函数 id** 而不是
 * **导出槽名** ⇒ **侧车契约整个不绑定** ⇒ L1 门禁**假绿**（零诊断）；且
 * `nudo check` 的签名表里**导出符号整个消失**（只剩内层名）、`nudo contract
 * --draft` 报 0 个可草拟导出 ⇒ CLI 各面互相矛盾。
 *
 * 根因：`scan-top-functions.ts` 的 `pushFnFromInit` 写的是 `r.id?.name ?? fallbackName`
 * （内层 id 优先）；service 侧 `analyzer-ast.ts` 的 `namedFnExprId(fn) ??
 * assignmentChainName(expr)` 同。
 *
 * 修法：**导出槽名优先**（`fallbackName ?? r.id?.name`）—— 内层 id 不是导出槽名，
 * 取它会让侧车契约（键 = 导出槽名）整个查不到。
 */






const NAMED_FN_EXPR = `exports.greet = function inner() {
  return "hi";
};
`;

const ANON_FN_EXPR = `exports.greet = function () {
  return "hi";
};
`;

const OBJ_LITERAL = `module.exports = {
  greet: function inner() {
    return "hi";
  },
};
`;


  it("成员赋值 + 具名函数表达式 ⇒ 普查名是导出槽名；成员赋值 + 匿名函数表达式 ⇒ 普查名是导出槽名（对照）；对象字面量成员 + 具名函数表达式 ⇒ 普查名是导出槽名（键名）；侧车契约按导出槽名绑定 ⇒ 契约义务真的执法（不假绿）", () => {
  {
    expect(listTopFunctions(NAMED_FN_EXPR)).toEqual(["greet"]);
  }
  {
    expect(listTopFunctions(ANON_FN_EXPR)).toEqual(["greet"]);
  }
  {
    expect(listTopFunctions(OBJ_LITERAL)).toEqual(["greet"]);
  }
  {
    // 侧车 `greet` 槽上的契约：返回 number() —— 实现返回 "hi" ⇒ 违例
    const src = `exports.greet = function inner() {
  return "hi";
};
`;
    const sidecar = `import { fn, number } from "@nudojs/core";
export const greet = fn({}, number());
`;
    const { loadModule } = makeFiles({ "/t/b997/D.nudo.js": sidecar });
    const r = checkSource_____check_check_ts("/t/b997/D.js", src, pTrue_____pred_ts, { loadModule, fromFile: "/t/b997/D.js" });
    // 普查名是 greet（不是 inner）⇒ 侧车契约绑定得上 ⇒ 违例被报出来
    expect(r.signatures.some((s) => s.name === "greet")).toBe(true);
    expect(r.signatures.some((s) => s.name === "inner")).toBe(false);
    expect(
      r.issues.some(
        (i) => i.code === "nudo:constraint-violated" && /greet/.test(i.message),
      ),
    ).toBe(true);
  }
});




});

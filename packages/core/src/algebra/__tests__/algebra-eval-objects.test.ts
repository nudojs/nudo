/**
 * 模块套件：求值面：对象/类/成员/访问器。
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { abs, type Abs, litValue, numLit, strLit } from "../abs.ts";
import { objOf, joinAbs } from "../objects.ts";
import { absFunction } from "../abs-fn.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { definitelyUncallableMember, PROTOTYPED_BRAND_NAMES } from "../exec/member-diag.ts";
import { BUILTIN_BRAND_METHODS, BUILTIN_BRAND_ACCESSORS } from "../exec/runtime/members.ts";
import { checkSource, resetCheckSourceMemo as resetCheckSourceMemo_____check_check_ts } from "../check/check.ts";
import { pTrue } from "../pred.ts";
import { isNever, throwsError, call, val, callLit, tupleEls } from "./eval-helpers.ts";
import { l2Count, sigOf, sidecarOpts } from "./nudo-constraints.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetCheckSourceMemo } from "../check/check-memo.ts";
import { runWithMayThrowSession, setMayThrowCollector, throwPayloadOf, type MayThrowEffect } from "../diagnostics/may-throw.ts";
import { $invoke } from "../exec/class/invoke.ts";
import { litValue as litValue___nudojs_core, litValue as litValue___nudojs_core_1, litValue as litValue___nudojs_core_2, litValue as litValue___nudojs_core_3, litValue as litValue___nudojs_core_4, litValue as litValue___nudojs_core_5, litValue as litValue___nudojs_core_6, checkSource as checkSource___nudojs_core, pTrue as pTrue___nudojs_core, litValue as litValue___nudojs_core_7, transpileSource, litValue as litValue___nudojs_core_8, litValue as litValue___nudojs_core_9, litValue as litValue___nudojs_core_10, litValue as litValue___nudojs_core_11, litValue as litValue___nudojs_core_12, litValue as litValue___nudojs_core_13, litValue as litValue___nudojs_core_14, litValue as litValue___nudojs_core_15, litValue as litValue___nudojs_core_16, litValue as litValue___nudojs_core_17, litValue as litValue___nudojs_core_18, litValue as litValue___nudojs_core_19, litValue as litValue___nudojs_core_20, litValue as litValue___nudojs_core_21, litValue as litValue___nudojs_core_22, litValue as litValue___nudojs_core_23, litValue as litValue___nudojs_core_24, litValue as litValue___nudojs_core_25, litValue as litValue___nudojs_core_26, litValue as litValue___nudojs_core_27, litValue as litValue___nudojs_core_28, litValue as litValue___nudojs_core_29, litValue as litValue___nudojs_core_30, litValue as litValue___nudojs_core_31, litValue as litValue___nudojs_core_32, litValue as litValue___nudojs_core_33, litValue as litValue___nudojs_core_34, litValue as litValue___nudojs_core_35, formatShape as formatShape___nudojs_core, litValue as litValue___nudojs_core_36, litValue as litValue___nudojs_core_37 } from "@nudojs/core";
import { formatShape, formatAbs } from "../format/format.ts";
import { denoteGuard } from "../denote.ts";
import { absToConstraint } from "../contract/projection.ts";
import { checkSource as checkSource_____index_ts, pTrue as pTrue_____index_ts } from "../index.ts";
import { diffBody } from "./differential/harness.ts";
import { deleteProtoMethod, findMethod, findStaticMethod } from "../exec/class/declare.ts";
import { $call } from "../exec/call.ts";
import { parseSource } from "../parse-source.ts";
import { transpileSource as transpileSource_____exec_transpile_ts } from "../exec/transpile.ts";
import { bodyIdentNames } from "../exec/body-fn.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// brand 接收者的「确定缺失」判定
// ---------------------------------------------------------------------------
describe("brand 接收者的「确定缺失」判定", () => {
/**
 * **brand 接收者**的「确定缺失」判定（族 46 · 片 S12）。
 *
 * 背景（族 35 · 片 S1 的遗留）：
 * env node 的 `Response.json(...)` 返回域已修对（brand `Response`），但
 * `Response.json(x).then(cb)` **仍不被 L2 门禁标出** ⇒ L2 假绿只关了一半。
 * 根因在 core：`definitelyUncallableMember` 首行 `if (s.k !== "obj") return false;`
 * ⇒ 只判**平 obj 接收者**；brand 接收者的缺槽成员被调用时**不记抛**。
 * （web env 能标出，只因它把 `Response` 建成**平 obj** ⇒ 同一个缺陷 env 侧
 * 表现不一致：web 假红 / node 假绿。）
 *
 * 修法：brand 接收者 ⇒ 取内层 shape；**内层是闭合 obj** ⇒ 走既有「表外 ⇒
 * 确定缺失」逻辑；**内层不是闭合 obj** ⇒ 维持现状（不记抛）。
 *
 * 口径要点（soundness 护栏）：
 * - 内层 unknown / prim / arr / open / 带 index 键 ⇒ 域不封闭 ⇒ 不判；
 * - 引擎已为该 brand 建模原型面（内建 brand / 装箱 brand / Proxy / Intl.* /
 * 原型对象 brand）⇒ 表外名**不可证缺席** ⇒ 不判；
 * - 注册用户类（类注册表持有原型方法面）⇒ 不判（域不同）；
 * - Object.prototype 名 ⇒ 原型上恒有 ⇒ 不判。
 *
 * 本文件同时是**同步守卫**：`exec/runtime/members.ts` 的两张内建 brand 原型
 * 表的键集必须 ⊆ `PROTOTYPED_BRAND_NAMES`（新增内建 brand 时同步排除名单，
 * 否则本守卫会红 ⇒ 防止「漏排除 ⇒ 合法调用被误判成确定抛」的假红）。
 */












const strPrim: Abs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const numPrim: Abs = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

/** env 形 brand：内层是**闭合** obj（objOf ⇒ closed + exact） */
function envBrand(name: string, slots: Record<string, Abs>): Abs {
  const wrapped: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) wrapped[k] = { value: v };
  return abs({ k: "brand", name, shape: objOf(wrapped) }, undefined, undefined, "path");
}

/** 内层是 **unknown** 的 brand（域不封闭 ⇒ 缺席不可证） */
function unknownInnerBrand(name: string): Abs {
  return abs(
    {
      k: "brand",
      name,
      shape: abs({ k: "unknown" }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "path",
  );
}

/** 内层是 **open** obj（带 index 键域）的 brand ⇒ 域不封闭 */
function openInnerBrand(name: string): Abs {
  return abs(
    {
      k: "brand",
      name,
      shape: abs(
        { k: "obj", slots: {}, open: true, index: { key: strPrim, value: strPrim } },
        undefined,
        undefined,
        "exact",
      ),
    },
    undefined,
    undefined,
    "path",
  );
}

/** 跑一段源码（可注入 env 全局），返回求值结果与 throws 面 */
function evalSrc(
  src: string,
  globals: Record<string, Abs> = {},
): { result: Abs; throws: unknown } {
  const exports = runTranspiled(src, { mode: "analyze", envGlobals: globals });
  const rec = callTranspiledExportFull(exports, "f", []);
  return { result: rec.result as Abs, throws: rec.throws };
}

/** env 声明形的 Response 实例面（的形状）：json / text / status 在槽表里 */
const jsonFn = absFunction([], { apply: () => strPrim }, { name: "json" });
const textFn = absFunction([], { apply: () => strPrim }, { name: "text" });
const RESPONSE = envBrand("Response", {
  status: numPrim,
  ok: abs({ k: "prim", type: "boolean" }, undefined, undefined, "path"),
  json: jsonFn,
  text: textFn,
});

describe("brand 接收者的「确定缺失」判定", () => {
  it("表外记抛/表内不抛/数据成员不误报/非封闭不判/平 obj 不变/内建原型不判/L2 同口径/同步守卫/模式排除", () => {
    const then = evalSrc(`export function f() { return resp.then(function () {}); }`, { resp: RESPONSE });
    expect(isNever(then.result)).toBe(true);
    expect(throwsError(then.throws, "TypeError")).toBe(true);

    for (const expr of [`export function f() { return resp.json(); }`, `export function f() { return resp.text(); }`]) {
      const r = evalSrc(expr, { resp: RESPONSE });
      expect(isNever(r.result), expr).toBe(false);
      expect(throwsError(r.throws, "TypeError"), expr).toBe(false);
    }
    const data = evalSrc(`export function f() { return resp.status(); }`, { resp: RESPONSE });
    expect(isNever(data.result)).toBe(false);
    expect(throwsError(data.throws, "TypeError")).toBe(false);

    for (const brand of [unknownInnerBrand("UnknownThing"), openInnerBrand("OpenThing")]) {
      const r = evalSrc(`export function f() { return u.then(function () {}); }`, { u: brand });
      expect(isNever(r.result)).toBe(false);
      expect(throwsError(r.throws, "TypeError")).toBe(false);
      expect(definitelyUncallableMember(brand, "then")).toBe(false);
    }

    const plain = objOf({ a: { value: numPrim } });
    const missing = evalSrc(`export function f() { return p.nope(); }`, { p: plain });
    expect(isNever(missing.result)).toBe(true);
    expect(throwsError(missing.throws, "TypeError")).toBe(true);
    const inTable = evalSrc(`export function f() { return p.a(); }`, { p: plain });
    expect(isNever(inTable.result)).toBe(false);
    expect(throwsError(inTable.throws, "TypeError")).toBe(false);

    for (const expr of [
      `export function f() { return new Map().get("k"); }`,
      `export function f() { return new ArrayBuffer(8).slice(0); }`,
      `export function f() { return new Date().getTime(); }`,
    ]) {
      const r = evalSrc(expr);
      expect(isNever(r.result), expr).toBe(false);
      expect(throwsError(r.throws, "TypeError"), expr).toBe(false);
    }

    const reportThen = checkSource("/t/b1044-brand-missing.js", `\nexport function f() {\n  return resp.then(function () {});\n}\n`, pTrue, { inject: { envGlobals: { resp: RESPONSE } } });
    expect(l2Count(reportThen, "f")).toBeGreaterThan(0);
    const reportJson = checkSource("/t/b1044-brand-in-table.js", `\nexport function f() {\n  return resp.json();\n}\n`, pTrue, { inject: { envGlobals: { resp: RESPONSE } } });
    expect(l2Count(reportJson, "f")).toBe(0);

    const engineModelled = new Set([...Object.keys(BUILTIN_BRAND_METHODS), ...Object.keys(BUILTIN_BRAND_ACCESSORS)]);
    const covered = (n: string) => PROTOTYPED_BRAND_NAMES.has(n) || n.endsWith(".prototype") || n.endsWith(".generatorProto") || n.startsWith("Intl.");
    expect([...engineModelled].filter((n) => !covered(n))).toEqual([]);
    for (const name of ["Map.prototype", "Set.prototype", "Symbol.prototype", "Intl.NumberFormat", "Intl.DateTimeFormat"]) {
      expect(definitelyUncallableMember(envBrand(name, { x: numPrim }), "nope"), name).toBe(false);
    }
  });
});
;
});

// ---------------------------------------------------------------------------
// 后续（S16）: sum 里的 fn（构造器）成员的静态成员派发
// ---------------------------------------------------------------------------
describe("后续（S16）: sum 里的 fn（构造器）成员的静态成员派发", () => {
/**
 * 后续（S16）：sum 里的**构造器成员**（fn 形状）被误判「确定没有此方法」。
 *
 * 背景（族 36 / 片 S2 把 `@nudo:env` 多名合并改成**并集**引出的精度回退）：
 * 合并后 `Response` 是两个构造器声明的 **sum** ⇒ core 的 `$invoke` sum 臂用
 * `memberLikelyHasMethod` 过滤成员，而它**没有 fn 分支** ⇒ fn 成员一律落
 * 「确定没有此方法」⇒ 被跳过 ⇒ 合并 fn 全局的**静态成员调用**
 * （`Response.json(x)`）折 `unknown`（`mk(x: any) => unknown` + 一条
 * `nudo:unknown-inference` warning）。修前 `node, web` 顺序下 `mk` 是 web 的
 * Response 对象面 ⇒ 这是**精度回退**。
 *
 * 病灶：`packages/core/src/algebra/exec/class/invoke.ts` 的
 * `memberLikelyHasMethod` —— 旧判据只有 prim / brand / obj / arr / tuple / eff
 * 分支，fn 落尾部 `return false`。
 *
 * 修法：补 **fn 分支**——判据改为「fn 的**静态槽**（dual-facet：构造器的静态
 * 成员挂在 fn 的 `shape.slots` 上）里有没有这个名」：
 * - 静态槽里有 ⇒ 可派发；
 * - 静态槽**明确不含** ⇒ 确定没有（原生读 undefined ⇒ 调用 TypeError ⇒ 记
 * may-throw + 跳过该成员——该分支不贡献值）；
 * - fn **没有静态面模型**（`shape.slots` 缺席）⇒ 判据不足 ⇒ **保守放行**
 * （不可判不可抛：宁可多派发一次，不可凭空造 may-throw ⇒ 假红）。
 *
 * 断言面：
 * 1. fn⊕fn 上调用**两臂都有**的静态成员 ⇒ 值域是**两臂返回域之并**（不是 unknown）；
 * 2. fn⊕fn 上调用**只有一臂有**的静态成员 ⇒ 该臂派发；另一臂按原生记 may-throw
 * （**不要**把两臂都当有）；
 * 3. 负控：fn 静态面模型为**空**（确实没有该静态成员）⇒ 仍判「确定没有」（记
 * may-throw + 不贡献值）；
 * 4. 负控：fn **无**静态面模型 ⇒ 判据不足 ⇒ 保守放行（**不记** may-throw）；
 * 5. 负控：Function.prototype / Object.prototype 名（toString）⇒ 沿函数对象恒
 * 可得 ⇒ 不得判缺席（不记 may-throw）；
 * 6. 负控：prim / brand / obj / arr / tuple / eff 的既有 sum 派发行为**逐字不变**；
 * 7. 端到端：env 全局是 fn⊕fn sum 时，`Response.json(x)` 的签名**不是 unknown**。
 */











/** 造一个「构造器」fn Abs：静态成员挂在 shape.slots 上（dual-facet 事实源） */
function ctorFn(name: string, statics: Record<string, Abs>): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(statics)) slots[k] = { value: v };
  return absFunction(["x"], { apply: () => strLit(name) }, { name, ctor: true, slots });
}

/** 静态成员（返回值域可辨：字符串 / 数字） */
const strMember = (v: string): Abs => absFunction(["body"], { apply: () => strLit(v) });
const numMember = (v: number): Abs => absFunction(["body"], { apply: () => numLit(v) });

/** 调一次 $invoke 并抓 may-throw 效果（与 eval-helpers.ts 的 effects 同机制） */
function invokeAndEffects(
  recv: Abs,
  method: string,
  args: Abs[] = [],
): { result?: Abs; thrown?: Abs; throws: MayThrowEffect[] } {
  const eff: MayThrowEffect[] = [];
  let result: Abs | undefined;
  let thrown: Abs | undefined;
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => eff.push(e));
    try {
      result = $invoke(recv, method, args);
    } catch (e) {
      thrown = throwPayloadOf(e);
    } finally {
      setMayThrowCollector(null);
    }
  });
  return { result, thrown, throws: eff };
}

/** sum 成员的字面量值（字符串化后排序——与成员顺序无关） */
function sumMemberLiterals(a: Abs): string[] {
  const s = a.shape;
  if (s.k !== "sum") return [];
  return s.members
    .map((m) => {
      const lv = litValue(m);
      return lv.ok ? JSON.stringify(lv.value) : "(non-lit)";
    })
    .sort();
}

describe("后续（S16）: sum 里的 fn（构造器）成员的静态成员派发", () => {
  const ctorFn = (name: string, statics: Record<string, Abs>): Abs => {
    const slots: Record<string, { value: Abs }> = {};
    for (const [k, v] of Object.entries(statics)) slots[k] = { value: v };
    return absFunction(["x"], { apply: () => strLit(name) }, { name, ctor: true, slots });
  };
  const strMember = (v: string): Abs => absFunction(["body"], { apply: () => strLit(v) });
  const numMember = (v: number): Abs => absFunction(["body"], { apply: () => numLit(v) });
  const invokeAndEffects = (recv: Abs, method: string, args: Abs[] = []) => {
    const eff: MayThrowEffect[] = [];
    let result: Abs | undefined;
    let thrown: Abs | undefined;
    runWithMayThrowSession(() => {
      setMayThrowCollector((e) => eff.push(e));
      try { result = $invoke(recv, method, args); } catch (e) { thrown = throwPayloadOf(e); } finally { setMayThrowCollector(null); }
    });
    return { result, thrown, throws: eff };
  };
  const sumMemberLiterals = (a: Abs): string[] => {
    const s = a.shape;
    if (s.k !== "sum") return [];
    return s.members.map((m) => { const lv = litValue(m); return lv.ok ? JSON.stringify(lv.value) : "(non-lit)"; }).sort();
  };
  it("fn 两臂/单臂/空静态面/无面/原型名；prim/brand/obj/tuple/eff 既有派发；端到端响应", () => {
    const a = ctorFn("CtorA", { json: strMember("A-json") });
    const b = ctorFn("CtorB", { json: numMember(42) });
    const both = invokeAndEffects(joinAbs(a, b), "json");
    expect(both.thrown).toBeUndefined();
    expect(both.throws).toEqual([]);
    expect(both.result?.shape.k).toBe("sum");
    expect(sumMemberLiterals(both.result!)).toEqual(['"A-json"', "42"]);

    const onlyA = invokeAndEffects(joinAbs(ctorFn("CtorA", { onlyA: strMember("A-only") }), ctorFn("CtorB", { json: numMember(42) })), "onlyA");
    expect(litValue(onlyA.result!)).toEqual({ ok: true, value: "A-only" });
    expect(onlyA.throws.length).toBe(1);
    expect(onlyA.throws[0]?.kind).toBe("TypeError");
    expect(onlyA.throws[0]?.recv).toBe("CtorB");
    expect(onlyA.throws[0]?.name).toBe("onlyA");

    const onlyB = invokeAndEffects(joinAbs(ctorFn("CtorA", { json: strMember("A-json") }), ctorFn("CtorB", { onlyB: numMember(7) })), "onlyB");
    expect(litValue(onlyB.result!)).toEqual({ ok: true, value: 7 });
    expect(onlyB.throws.length).toBe(1);
    expect(onlyB.throws[0]?.recv).toBe("CtorA");

    const bare = invokeAndEffects(joinAbs(ctorFn("BareCtor", {}), ctorFn("CtorB", { json: numMember(42) })), "json");
    expect(bare.throws.length).toBe(1);
    expect(bare.throws[0]?.recv).toBe("BareCtor");
    expect(litValue(bare.result!)).toEqual({ ok: true, value: 42 });

    const noFace = absFunction(["x"], { apply: () => strLit("nf") }, { name: "NoFace", ctor: true });
    expect(invokeAndEffects(joinAbs(noFace, ctorFn("CtorB", { json: numMember(42) })), "json").throws).toEqual([]);
    expect(invokeAndEffects(joinAbs(a, b), "toString").throws).toEqual([]);

    const str2 = joinAbs(strLit("a"), strLit("b"));
    const num2 = joinAbs(numLit(1), numLit(2));
    expect(str2.shape.k).toBe("sum");
    expect(num2.shape.k).toBe("sum");
    const up = invokeAndEffects(str2, "toUpperCase");
    expect(up.throws).toEqual([]);
    expect(sumMemberLiterals(up.result!)).toEqual(['"A"', '"B"']);
    const bad = invokeAndEffects(str2, "toFixed");
    expect(bad.throws.length).toBe(2);
    expect(bad.throws.every((e) => e.kind === "TypeError" && e.recv === "string")).toBe(true);
    expect(bad.result?.shape.k).toBe("unknown");
    const tf = invokeAndEffects(num2, "toFixed", [numLit(1)]);
    expect(tf.throws).toEqual([]);
    expect(sumMemberLiterals(tf.result!)).toEqual(['"1.0"', '"2.0"']);

    const objSum = joinAbs(
      { shape: { k: "obj", slots: { a: { value: numLit(1) } } }, conf: "exact" } as Abs,
      { shape: { k: "obj", slots: { b: { value: numLit(2) } } }, conf: "exact" } as Abs,
    );
    expect(invokeAndEffects(objSum, "nope").thrown?.shape).toMatchObject({ k: "brand", name: "TypeError" });

    const tupSum = joinAbs(
      { shape: { k: "tuple", elements: [numLit(1)] }, conf: "exact" } as Abs,
      { shape: { k: "tuple", elements: [strLit("x")] }, conf: "exact" } as Abs,
    );
    const tup = invokeAndEffects(tupSum, "join");
    expect(tup.throws).toEqual([]);
    expect(sumMemberLiterals(tup.result!)).toEqual(['"1"', '"x"']);

    const effSum = joinAbs(
      { shape: { k: "eff", eff: "promise", inner: numLit(1) }, conf: "exact" } as Abs,
      { shape: { k: "eff", eff: "promise", inner: strLit("x") }, conf: "exact" } as Abs,
    );
    const eff = invokeAndEffects(effSum, "then");
    expect(eff.throws).toEqual([]);
    expect(eff.result?.shape.k).toBe("sum");
    expect((eff.result!.shape as { members: Abs[] }).members.every((m) => m.shape.k === "eff")).toBe(true);

    const brandSum = joinAbs(
      { shape: { k: "brand", name: "Map", shape: { shape: { k: "obj", slots: { a: { value: numLit(1) } } }, conf: "exact" } }, conf: "exact" } as Abs,
      { shape: { k: "brand", name: "Map", shape: { shape: { k: "obj", slots: { b: { value: numLit(2) } } }, conf: "exact" } }, conf: "exact" } as Abs,
    );
    expect(invokeAndEffects(brandSum, "nope").thrown?.shape).toMatchObject({ k: "brand", name: "TypeError" });

    resetGeneralizeMemo();
    resetCheckSourceMemo();
    const merged = joinAbs(ctorFn("Response", { json: strMember("A-json") }), ctorFn("Response", { json: numMember(42) }));
    const r = checkSource("/t/s16-fn-sum.js", `export function mk(x) {\n  return Response.json(x);\n}\n`, pTrue, { inject: { envGlobals: { Response: merged } } });
    expect(r.signatures.find((s) => s.name === "mk")?.display ?? "(missing)").not.toContain("unknown");
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference").length).toBe(0);
  });
});
;
});

// ---------------------------------------------------------------------------
// 实例字段计算键：定义期求值一次
// ---------------------------------------------------------------------------
describe("实例字段计算键：定义期求值一次", () => {
/**
 * 回归：实例字段的**计算键**求值时机/次数。
 *
 * ES 语义（ClassDefinitionEvaluation → ClassFieldDefinitionEvaluation）：
 * 计算属性键 `class A { [k()] = 1 }` 的键表达式在**类定义期**求值**一次**，
 * 构造期只按已定键安装字段（InitializeInstanceElements）。
 *
 * 修复前：键表达式编成实例字段的 `key` thunk（逐实例求值）——定义期 0 次、
 * 每构造 1 次；键可能每次不同 ⇒ 字段名漂移（两次构造得到两个键），且
 * 定义期副作用（计数器/抛错）缺失。
 *
 * 不变量（负控制钉住）：静态字段/方法的计算键仍各求值 1 次（定义期），
 * 公有实例字段不受影响。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("实例字段计算键：定义期求值一次", () => {
  const v = (src: string) => litValue___nudojs_core(call(src, "f").result);
  const throwName = (src: string): string => {
    const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
    if (!t?.shape || t.shape.k === "never") return "";
    return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
  };
  const wrap = (body: string) => `export function f() { ${body} }`;
  it("定义期一次/构造不重复/键不漂移/抛错在定义期/两处定义各一次；静态键与公有字段不变；抽象键不挂名", () => {
    expect(v(wrap(`let n = 0; function k(){ n++; return "x"; } class A { [k()] = 1; } return n;`))).toEqual({ ok: true, value: 1 });
    expect(v(wrap(`let n = 0; function k(){ n++; return "x"; } class A { [k()] = 1; } new A(); new A(); new A(); return n;`))).toEqual({ ok: true, value: 1 });
    expect(v(wrap(`let n = 0; function k(){ n++; return "f"+n; } class A { [k()] = n; } const a = new A(), b = new A(); return Object.keys(a).join(",")+"|"+Object.keys(b).join(",");`))).toEqual({ ok: true, value: "f1|f1" });
    expect(v(wrap(`let hits = 0; function k(){ if (hits++ > 0) throw new Error("second"); return "m"; } class A { [k()] = 1; } new A(); try { new A(); return "no-throw"; } catch (e) { return "threw:" + e.constructor.name; }`))).toEqual({ ok: true, value: "no-throw" });
    expect(v(wrap(`let n = 0; function k(){ n++; return "x"; } function make(){ class A { [k()] = 1; } return A; } make(); make(); return n;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`let n = 0; function k(){ n++; return "x"; } class A { static [k()] = 1; } return n;`))).toEqual({ ok: true, value: 1 });
    expect(v(wrap(`let n = 0; function k(){ n++; return "x"; } class A { [k()](){ return 1; } } return n;`))).toEqual({ ok: true, value: 1 });
    expect(v(wrap(`class A { pub = 7; } return new A().pub;`))).toEqual({ ok: true, value: 7 });
    expect(throwName(`export function f(x) { class A { [x] = 1; } return 1; }`)).toBe("");
  });
});
;
});

// ---------------------------------------------------------------------------
// static 块与静态字段按源码顺序执行
// ---------------------------------------------------------------------------
describe("static 块与静态字段按源码顺序执行", () => {
/**
 * 回归：static 块与静态字段初始化器的**类体源码顺序**。
 *
 * ES 语义（ClassDefinitionEvaluation → InitializeStaticElements）：静态元素
 * （静态字段初始化器 + static 块）按**类体源码顺序**依次执行。
 *
 * 修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进
 * statics 表由 $class 求值，static 块另走独立尾段）——类体源码
 * 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2，
 * 引擎折 NaN（q 未定义）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_1(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("static 块与静态字段按源码顺序执行", () => {
  const v = (src: string) => litValue___nudojs_core_1(call(src, "f").result);
  const wrap = (body: string) => `export function f() { ${body} }`;
  it("块在前/三段交错/副作用序；字段在前/外层变量/块内 this 负控", () => {
    expect(v(wrap(`class A { static { A.q = 1; } static r = A.q + 1; } return A.r;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`class A { static r = 1; static { A.s = 2; } static t = A.r + A.s; } return A.t;`))).toEqual({ ok: true, value: 3 });
    expect(v(wrap(`let log = ""; class A { static a = log += "1"; static { log += "b"; } static c = log += "2"; } return log;`))).toEqual({ ok: true, value: "1b2" });
    expect(v(wrap(`class A { static n = 1; static { A.m = A.n + 1; } } return A.m;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`let y = 0; class C { static { y = 5; } } return y;`))).toEqual({ ok: true, value: 5 });
    expect(v(wrap(`class S { static t = 0; static { this.t = 5; } } return S.t;`))).toEqual({ ok: true, value: 5 });
  });
});
;
});

// ---------------------------------------------------------------------------
// 重复键：后写的数据属性覆盖先写的访问器
// ---------------------------------------------------------------------------
describe("重复键：后写的数据属性覆盖先写的访问器", () => {
  const v = (src: string) => litValue___nudojs_core_2(call(src, "f").result);
  const throwName = (src: string): string => {
    const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
    if (!t?.shape || t.shape.k === "never") return "";
    return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
  };
  const wrap = (body: string) => `export function f() { ${body} }`;
  it("数据属性胜出/最后一个定义/展开与拷贝/副作用与枚举/symbol 与动态键；负控单访问器/对/数据-数据/其它键", () => {
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return o.x;`))).toEqual({ ok: true, value: 2 });
    const write = wrap(`const o = { get x(){ return 1; }, x: 2 }; o.x = 9; return o.x;`);
    expect(throwName(write)).toBe("");
    expect(v(write)).toEqual({ ok: true, value: 9 });
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return Object.getOwnPropertyDescriptor(o, "x").value;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`const o = { x: 1, get x(){ return 2; }, x: 3 }; return o.x;`))).toEqual({ ok: true, value: 3 });
    expect(v(wrap(`const o = { ...{ get x(){ return 1; }, x: 2 } }; return o.x;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`const o = Object.assign({}, { get x(){ return 1; }, x: 2 }); return o.x;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`let n = 0; const o = { get x(){ n++; return 1; }, x: 2 }; return o.x + "/" + n;`))).toEqual({ ok: true, value: "2/0" });
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return Object.keys(o).join(",");`))).toEqual({ ok: true, value: "x" });
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2 }; return "x" in o;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`const o = { get x(){}, x(){} }; return typeof o.x;`))).toEqual({ ok: true, value: "function" });
    expect(v(wrap(`const o = { get [Symbol.iterator](){ return 1; }, [Symbol.iterator]: 2 }; return o[Symbol.iterator];`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`const k = "x"; const o = { get [k](){ return 1; }, [k]: 2 }; return o.x;`))).toEqual({ ok: true, value: 2 });
    const dynWrite = wrap(`const k = "x"; const o = { get [k](){ return 1; }, [k]: 2 }; o.x = 9; return o.x;`);
    expect(throwName(dynWrite)).toBe("");
    expect(v(dynWrite)).toEqual({ ok: true, value: 9 });
    expect(v(wrap(`let n = 0; const k = (n++, "x"); const o = { get [k](){ return 1; }, [k]: 2 }; return n;`))).toEqual({ ok: true, value: 1 });

    expect(v(wrap(`const o = { get x(){ return 7; } }; return o.x;`))).toEqual({ ok: true, value: 7 });
    expect(v(wrap(`const o = { x: 2, get x(){ return 1; } }; return o.x;`))).toEqual({ ok: true, value: 1 });
    expect(throwName(wrap(`const o = { x: 2, get x(){ return 1; } }; o.x = 9; return o.x;`))).toBe("TypeError");
    expect(v(wrap(`const o = { get x(){ return 1; }, set x(v){} }; return o.x;`))).toEqual({ ok: true, value: 1 });
    const setter = wrap(`const o = { set x(v){ this._v = v; } }; o.x = 5; return o._v;`);
    expect(throwName(setter)).toBe("");
    expect(v(setter)).toEqual({ ok: true, value: 5 });
    expect(v(wrap(`const o = { get x(){ return 1; }, get x(){ return 2; } }; return o.x;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`const o = { x: 1, x: 2 }; return o.x;`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2, get x(){ return 3; } }; return o.x;`))).toEqual({ ok: true, value: 3 });
    expect(v(wrap(`const o = { [Symbol.iterator]: 2, get [Symbol.iterator](){ return 1; } }; return o[Symbol.iterator];`))).toEqual({ ok: true, value: 1 });
    expect(v(wrap(`const k = "x"; const o = { [k]: 2, get [k](){ return 1; } }; return o.x;`))).toEqual({ ok: true, value: 1 });
    expect(v(wrap(`const k = "x", j = "y"; const o = { get [k](){ return 1; }, [j]: 2 }; return o.x + "/" + o.y;`))).toEqual({ ok: true, value: "1/2" });
    expect(v(wrap(`const o = { x(){}, get x(){} }; return typeof o.x;`))).toEqual({ ok: true, value: "undefined" });
    expect(v(wrap(`const o = { get x(){ return 1; }, x: 2, y: 3 }; return o.y;`))).toEqual({ ok: true, value: 3 });
    expect(v(wrap(`const o = { a: 1, b: 2 }; return o.a + o.b;`))).toEqual({ ok: true, value: 3 });
  });
});
;

// ---------------------------------------------------------------------------
// 调用点成员访问器先于实参求值
// ---------------------------------------------------------------------------
describe("调用点成员访问器先于实参求值", () => {
/**
 * 回归（core exec/transpile）：调用点成员**访问器**在**实参之后**才求值。
 *
 * 原生 CallExpression（`o.m(args)`）的求值顺序：
 * ① 求 `o` → ② 取 `o.m`（**访问器 getter 在此触发**）→ ③ 求实参 → ④ 调用。
 * 修复前引擎把接收者/成员名作为 `$invoke(recv, name, [args])` 的实参传入，
 * 实参数组字面量**先于** $invoke 内的成员读求值 ⇒ getter 跑晚了
 * （`o.m(b())` 原生 "mbc" / 引擎 "bmc"）。
 *
 * 修法：发射调用表达式时把实参包成 **thunk**（`() => [args]`）——
 * $invoke 先读成员（预读），再求实参，最后派发；派发复用预读值
 * （不再二次读 ⇒ getter 只跑一次）。
 *
 * 负控制钉住：非访问器成员（数据槽方法）、普通函数调用、super 调用、
 * 私有名调用、数组方法——行为不变。
 */




/** 求值结果的字面量值 */
function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : `<not-lit:${(call(src, "f").result as { shape?: { k?: string } }).shape?.k}>`;
}

describe("调用点成员访问器先于实参求值", () => {
  const v = (src: string): unknown => {
    const r = litValue(call(src, "f").result);
    return r.ok ? r.value : `<not-lit:${(call(src, "f").result as { shape?: { k?: string } }).shape?.k}>`;
  };
  const S = (body: string) => `export function f() { ${body} }`;
  it("getter 先于实参：对象/类/静态/嵌套/计算键/抛错/非函数/只读一次", () => {
    expect(v(S(`let s = ""; const o = { get m() { s += "m"; return function () { s += "c"; }; } }; function b() { s += "b"; } o.m(b()); return s;`))).toBe("mbc");
    expect(v(S(`let s = ""; const o = { get m() { s += "m"; return function () { s += "c"; }; } }; function a() { s += "a"; } function b() { s += "b"; } o.m(a(), b()); return s;`))).toBe("mabc");
    expect(v(S(`let s = ""; class A { get m() { s += "gm"; return () => { s += "c"; }; } } function b() { s += "b"; } new A().m(b()); return s;`))).toBe("gmbc");
    expect(v(S(`let s = ""; class A { static get m() { s += "sm"; return function () { s += "c"; }; } } function b() { s += "b"; } A.m(b()); return s;`))).toBe("smbc");
    expect(v(S(`let s = ""; const inner = { get m() { s += "m"; return function () { s += "c"; }; } }; const o = { get p() { s += "p"; return inner; } }; function b() { s += "b"; } o.p.m(b()); return s;`))).toBe("pmbc");
    expect(v(S(`let s = ""; const o = { get m() { s += "m"; return function () { s += "c"; }; } }; function k() { s += "k"; return "m"; } function b() { s += "b"; } o[k()](b()); return s;`))).toBe("kmbc");
    expect(v(S(`let s = ""; const o = { get m() { s += "m"; throw new Error("x"); } }; function b() { s += "b"; } try { o.m(b()); } catch (e) { s += "T"; } return s;`))).toBe("mT");
    expect(v(S(`let s = ""; const o = { get m() { s += "m"; return 42; } }; function b() { s += "b"; } try { o.m(b()); } catch (e) { s += "T"; } return s;`))).toBe("mbT");
    expect(v(S(`let s = ""; const o = { get m() { s += "m"; return function () { s += "c"; }; } }; o.m(); return s;`))).toBe("mc");
  });
  it("负控：数据槽/super/私有名/数组方法/this 绑定不变", () => {
    expect(v(S(`let s = ""; const o = { m() { s += "m"; } }; function b() { s += "b"; } o.m(b()); return s;`))).toBe("bm");
    expect(v(S(`let s = ""; function g(x) { s += "f"; } function a() { s += "a"; } function b() { s += "b"; } g(a(), b()); return s;`))).toBe("abf");
    expect(v(S(`let s = ""; const o = { m() { s += "m"; } }; function k() { s += "k"; return "m"; } function b() { s += "b"; } o[k()](b()); return s;`))).toBe("kbm");
    expect(v(S(`let s = ""; class A { m(x) { s += "A" + x; } } class B extends A { m(x) { s += "B"; super.m(x); } } function b() { s += "b"; } new B().m(b()); return s;`))).toBe("bBAundefined");
    expect(v(S(`let s = ""; class A { #m() { s += "m"; } run() { s += "r"; this.#m(); } } new A().run(); return s;`))).toBe("rm");
    expect(v(S(`let s = ""; const a = [1, 2]; a.map(function (v) { s += "m"; }); return s;`))).toBe("mm");
    expect(v(S(`const o = { n: 7, m() { return this.n; } }; return o.m();`))).toBe(7);
  });
});
;

;
});

// ---------------------------------------------------------------------------
// static 块内 super 读父类静态成员
// ---------------------------------------------------------------------------
describe("static 块内 super 读父类静态成员", () => {
/**
 * 回归：static 块里的 `super`（home object = 类自身）。
 *
 * ES 语义：static 块/静态字段/静态方法体内的 `super` 以**类自身**为 home
 * object——`super.<父类静态成员>` 读父类构造器面。
 *
 * 修复前：static 块未注入 staticSuperSrc——`super` 落 `$getSuper` 实例原型
 * 链（接收者是类值）⇒ 折 exact undefined（父类静态成员读不到）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_3(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("static 块内 super 读父类静态成员", () => {
  it("static { this.x = super.m } → 父类静态成员值（原生 1）", () => {
    expect(
      v(wrap(`class A { static m = 1; } class B extends A { static { this.x = super.m; } } return B.x;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("static 块内 super.m 参与运算（原生 3）", () => {
    expect(
      v(
        wrap(
          `class A { static m = 2; } class B extends A { static { this.x = super.m + 1; } } return B.x;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("负控制：静态字段里的 super 仍读父类静态成员", () => {
    expect(
      v(wrap(`class A { static m = 1; } class B extends A { static z = super.m; } return B.z;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：静态方法里的 super 仍读父类静态成员", () => {
    expect(
      v(
        wrap(
          `class A { static m = 1; } class B extends A { static z() { return super.m; } } return B.z();`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：实例方法里的 super 仍读父类原型链（不被静态口径污染）", () => {
    expect(
      v(
        wrap(
          `class A { m() { return 1; } } class B extends A { m() { return super.m(); } } return new B().m();`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });
});
});

// ---------------------------------------------------------------------------
// 私有名按声明类作用域化
// ---------------------------------------------------------------------------
describe("私有名按声明类作用域化", () => {
/**
 * 回归：私有名（Private Name）的**类作用域**。
 *
 * ES 语义：Private Name 逐**类定义**——A 的 #x 与 B 的 #x 是两个不同私有名：
 * - 不同类的同名私有互不串值（各自 brand 独立）；
 * - 派生类同名私有不覆盖基类私有（基类槽与派生类槽并存）；
 * - 读/写外类私有抛 TypeError（brand 不匹配）；
 * - `#x in o` 只看**本类**私有的 brand。
 *
 * 修复前：私有名键是裸 "#x" 混淆键（全局共享）——跨类串值、派生覆盖基类、
 * 读外类私有返回别人的值（不抛 TypeError）。
 *
 * 修法（transpile/class-emit.ts）：类体内所有 PrivateName 的 id.name 改写为
 * "<类名>::<私有名>"（声明点与使用点同键）；运行时沿用既有 privateNameGuard
 * （"#" 前缀 brand 校验）——键按类作用域化后，跨类访问命中"非本类槽" ⇒
 * 确定 TypeError。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_4(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("私有名按声明类作用域化", () => {
  const wrap = (body: string) => `export function f() { ${body} }`;
  const v = (src: string) => litValue___nudojs_core_4(call(src, "f").result);
  const throwName = (src: string): string => {
    const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
    if (!t?.shape || t.shape.k === "never") return "";
    return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
  };
  it("跨类读写/调用/静态私有抛 TypeError；派生同名不覆盖；in 只看本类；同类与 introspection 负控", () => {
    expect(throwName(wrap(`class A { #x = 1; read(o){ return o.#x; } } class B { #x = 2; } return new A().read(new B());`))).toBe("TypeError");
    expect(throwName(wrap(`class A { #m(){ return 1; } read(o){ return o.#m(); } } class B { #m(){ return 2; } } return new A().read(new B());`))).toBe("TypeError");
    expect(throwName(wrap(`class A { #x = 1; write(o){ o.#x = 5; } } class B { #x = 2; } new A().write(new B()); return 1;`))).toBe("TypeError");
    expect(v(wrap(`class A { #x = 1; readA(){ return this.#x; } } class B extends A { #x = 2; readB(){ return this.#x; } } const b = new B(); return b.readA() + "|" + b.readB();`))).toEqual({ ok: true, value: "1|2" });
    expect(v(wrap(`class A { #x = 1; static has(o){ return #x in o; } } class B { #x = 2; } return A.has(new B());`))).toEqual({ ok: true, value: false });
    expect(throwName(wrap(`class A { static #c = 1; static read(o){ return o.#c; } } class B { static #c = 2; } return A.read(B);`))).toBe("TypeError");
    expect(v(wrap(`class A { #x = 1; read(){ return this.#x; } write(v){ this.#x = v; return this.#x; } } const a = new A(); return a.read() + "|" + a.write(9);`))).toEqual({ ok: true, value: "1|9" });
    expect(v(wrap(`class A { #x = 1; pub = 2; } return Object.getOwnPropertyDescriptor(new A(), "#x") === undefined;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`const o = { "#x": 7 }; return o["#x"];`))).toEqual({ ok: true, value: 7 });
  });
});
;
});

// ---------------------------------------------------------------------------
// 解构成员目标带默认值 → 写回不丢
// ---------------------------------------------------------------------------
describe("解构成员目标带默认值 → 写回不丢", () => {
/**
 * 回归：解构的**成员目标**带**默认值**时（`({ a: o.x = 1 } = src)`），
 * 赋值**写回不能丢**。
 *
 * 修复前：成员目标落进「嵌套 + 默认」分支后被当子模式递归——成员写回
 * **静默丢弃** ⇒ 目标成员保持旧值（错值）。原生语义是
 * 「读属性 → undefined 取默认 → 写回目标成员」。
 */



describe("解构成员目标带默认值 → 写回不丢", () => {
  it("属性为 undefined → 取默认值并写回成员", () => {
    expect(
      val(`export function f() { const src = { a: undefined }; const o = { x: 0 }; ({ a: o.x = 1 } = src); return o.x; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("属性有值 → 写回该值（默认值不生效）", () => {
    expect(
      val(`export function f() { const o = { x: 0 }; ({ a: o.x = 1 } = { a: 5 }); return o.x; }`),
    ).toEqual({ ok: true, value: 5 });
  });

  it("嵌套成员目标（o.x.y = 7）同样写回", () => {
    expect(
      val(`export function f() { const o = { x: { y: 0 } }; ({ a: o.x.y = 7 } = { a: undefined }); return o.x.y; }`),
    ).toEqual({ ok: true, value: 7 });
  });

  it("数组模式的成员目标带默认值（[o.x = 1] = src）同样写回", () => {
    expect(
      val(`export function f() { const o = { x: 0 }; [o.x = 1] = [undefined]; return o.x; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { const o = { x: 0 }; [o.x = 1] = [9]; return o.x; }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("负控制：标识符目标带默认值（{ a = 1 }）行为不变", () => {
    expect(val(`export function f() { const { a = 1 } = {}; return a; }`))
      .toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const { a = 1 } = { a: 5 }; return a; }`))
      .toEqual({ ok: true, value: 5 });
  });

  it("负控制：成员目标**不带**默认值仍写回（既有行为不回归）", () => {
    expect(
      val(`export function f() { const o = { x: 0 }; ({ a: o.x } = { a: 3 }); return o.x; }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("负控制：嵌套模式 + 默认（{ a: { b } = {} }）行为不变", () => {
    expect(val(`export function f() { const { a: { b } = { b: 4 } } = {}; return b; }`))
      .toEqual({ ok: true, value: 4 });
  });
});
});

// ---------------------------------------------------------------------------
// 默认参数表达式的 this 是本函数自己的 this
// ---------------------------------------------------------------------------
describe("默认参数表达式的 this 是本函数自己的 this", () => {
/**
 * 回归：默认参数表达式里的 `this` 绑到**外层作用域**的 this。
 *
 * 原生语义：默认参数表达式在**被调函数自己的作用域**求值 ⇒ 其中的 `this`
 * 是**被调函数自己的** this（严格模式：undefined / 调用接收者），**不是**外层
 * 作用域的 this。
 *
 * 修复前：`fnBodyHasThis` 只扫函数**体** ⇒ 形参默认值里的 `this` 不可见 ⇒
 * 默认表达式沿用外层 `thisParam`：
 * - `const o = { v: 3, m(){ return (function (x = this.v) { return x; })(); } }`
 * 原生抛 TypeError（严格模式 this = undefined ⇒ `undefined.v`），引擎给 3
 * （**外层对象**的 v）——自信错值 + 漏抛；
 * - `function (x = this) {}` + `.call({ v: 1 })` 原生返回接收者，引擎给
 * undefined（外层 this = undefined）。
 *
 * 不变量（负控制钉住）：普通调用仍是 undefined（严格模式）；箭头表达式的
 * `this` 仍词法继承外层；方法**自身**的默认值（`m(x = this.v)`）仍是 3。
 */




/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue___nudojs_core_5(callLit(src, "f", ...args).result);
}

describe("默认参数表达式的 this 是本函数自己的 this", () => {
  it("函数表达式 + .call(receiver)：默认值读到接收者", () => {
    const src = `export function f() {
      const g = function (x = this) { return x; };
      return g.call({ v: 1 }) === undefined ? "undef" : "recv";
    }`;
    expect(v(src)).toEqual({ ok: true, value: "recv" });
  });

  it("函数声明 + .call(receiver)：默认值读到接收者", () => {
    const src = `export function g(x = this) { return x; }
    export function f() {
      return g.call({ v: 1 }) === undefined ? "undef" : "recv";
    }`;
    expect(v(src)).toEqual({ ok: true, value: "recv" });
  });

  it("方法体内的函数表达式：默认值 this = undefined ⇒ TypeError（原生同）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ return (function (x = this.v) { return x; })(); } };
      return o.m();
    }`;
    const rec = callLit(src, "f");
    expect(isNever(rec.result)).toBe(true);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("方法体内的函数声明：默认值 this = undefined ⇒ TypeError（原生同）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ function h(x = this.v) { return x; } return h(); } };
      return o.m();
    }`;
    const rec = callLit(src, "f");
    expect(isNever(rec.result)).toBe(true);
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });
});

describe("负控制：this 归属不被改写", () => {
  it("普通调用（严格模式）this = undefined（不是全局对象）", () => {
    const src = `export function f() {
      const g = function (x = this) { return x; };
      return g() === undefined ? "undef" : "recv";
    }`;
    expect(v(src)).toEqual({ ok: true, value: "undef" });
  });

  it("箭头表达式的 this 仍词法继承外层（箭头无自己的 this）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ return (() => this.v)(); } };
      return o.m();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  });

  it("方法自身的默认值（m(x = this.v)）仍是 3", () => {
    const src = `export function f() {
      const o = { v: 3, m(x = this.v){ return x; } };
      return o.m();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  });

  it("箭头默认值的 this 词法继承外层方法（`() => this.v` 同）", () => {
    const src = `export function f() {
      const o = { v: 3, m(){ return ((x = this.v) => x)(); } };
      return o.m();
    }`;
    expect(v(src)).toEqual({ ok: true, value: 3 });
  });
});
});

// ---------------------------------------------------------------------------
// for (o.x of …) 成员头每轮写回成员槽
// ---------------------------------------------------------------------------
describe("for (o.x of …) 成员头每轮写回成员槽", () => {
/**
 * 回归：`for (o.x of …)` / `for (o.x in …)` 的**成员表达式头**。
 *
 * ES 语义（ForIn/OfHeadEvaluation 的 AssignmentElement 形态）：头目标是
 * **赋值目标**——每轮把迭代项**写回**该成员槽（`o.x` = 末轮项）。
 *
 * 修复前：头绑定只认「声明符 / 标识符」两种形态 ⇒ `MemberExpression` 头
 * **落不到任何一支** ⇒ 头只绑到回调形参 `_item`，**没有任何**对 `o.x` 的
 * 赋值发射 ⇒ `o.x` 保持循环前的旧值（引擎折出 exact `0`，原生是末轮值
 * `3` / `"b"`）⇒ L2 假绿 + `nudo test` 假红。
 *
 * 不变量（负控制钉住）：`const` / `let` 头仍是块级每轮新绑定（不写回外层
 * 绑定）；未被头赋值的成员保持旧值。
 */





/** 引擎求值结果字面量值 */
function v(src: string) {
  return litValue___nudojs_core_6(call(src, "f").result);
}

/** 原生 oracle（new Function） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("for (o.x of …) 成员头每轮写回成员槽", () => {
  it("for (o.x of [1,2,3]) 后 o.x === 3", () => {
    const src = wrap(`const o={x:0}; for (o.x of [1,2,3]) {} return o.x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`const o={x:0}; for (o.x of [1,2,3]) {} return o.x;`)).toBe(3);
  });

  it("for (o.x in {a:1,b:2}) 后 o.x === 'b'", () => {
    const src = wrap(`const o={x:0}; for (o.x in {a:1,b:2}) {} return o.x;`);
    expect(v(src)).toEqual({ ok: true, value: "b" });
    expect(native(`const o={x:0}; for (o.x in {a:1,b:2}) {} return o.x;`)).toBe("b");
  });

  it("头写回后体内可读到当轮值", () => {
    const src = wrap(`const o={x:0,y:0}; for (o.x of [1,2]) { o.y = o.x * 2; } return o.y;`);
    expect(v(src)).toEqual({ ok: true, value: 4 });
    expect(native(`const o={x:0,y:0}; for (o.x of [1,2]) { o.y = o.x * 2; } return o.y;`)).toBe(4);
  });

  it("计算键成员头：o[key] 写回生效", () => {
    const src = wrap(`const o={x:0}; const key="x"; for (o[key] of [1,2,3]) {} return o.x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`const o={x:0}; const key="x"; for (o[key] of [1,2,3]) {} return o.x;`)).toBe(3);
  });

  it("多层成员头：o.a.x 写回生效", () => {
    const src = wrap(`const o={a:{x:0}}; for (o.a.x of [1,2,3]) {} return o.a.x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`const o={a:{x:0}}; for (o.a.x of [1,2,3]) {} return o.a.x;`)).toBe(3);
  });

  it("标识符头：for (x of …) 写回既有绑定", () => {
    const src = wrap(`let x=0; for (x of [1,2,3]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 3 });
    expect(native(`let x=0; for (x of [1,2,3]) {} return x;`)).toBe(3);
  });

  it("标识符头（for-in）：for (k in …) 写回既有绑定", () => {
    const src = wrap(`let k=""; for (k in {a:1,b:2}) {} return k;`);
    expect(v(src)).toEqual({ ok: true, value: "b" });
    expect(native(`let k=""; for (k in {a:1,b:2}) {} return k;`)).toBe("b");
  });

  it("标识符头写 const 绑定 = 原生 TypeError（写回通道的 const 守卫）", () => {
    const src = wrap(`const c = 1; try { for (c of [1,2]) {} return c; } catch (e) { return "TypeError"; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
    expect(
      native(`const c = 1; try { for (c of [1,2]) {} return c; } catch (e) { return "TypeError"; }`),
    ).toBe("TypeError");
  });
});

describe("产品面：nudo check 签名不再折出旧值", () => {
  const NUDO_SRC = `
export const num = number();
`;
  const opts = sidecarOpts("std178c", NUDO_SRC, "/t/b178.js");
  const IMP = `/// @nudo:import { num } from "./std178c.nudo.js"\n`;

  it("for (o.x of [1,2,3]) 后 o.x 折出 3（不再是旧值 0）", () => {
    const r = checkSource___nudojs_core(
      "/t/b178.js",
      IMP +
        `
export function f() {
  const o = { x: 0 };
  for (o.x of [1, 2, 3]) {}
  return o.x;
}
`,
      pTrue___nudojs_core,
      opts,
    );
    expect(r.summary.errors).toBe(0);
    expect(sigOf(r, "f")).toMatch(/3/);
    expect(sigOf(r, "f")).not.toMatch(/=> 0$/);
  });
});

describe("负控制：无头赋值的目标保持旧值", () => {
  it("const 头不写回外层绑定（仍是块级每轮新绑定）", () => {
    const src = wrap(`let x=0; for (const y of [1,2]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 0 });
    expect(native(`let x=0; for (const y of [1,2]) {} return x;`)).toBe(0);
  });

  it("let 头不写回外层绑定", () => {
    const src = wrap(`let x=0; for (let y of [1,2]) {} return x;`);
    expect(v(src)).toEqual({ ok: true, value: 0 });
  });

  it("未被头赋值的成员保持旧值", () => {
    const src = wrap(`const o={x:0,y:7}; for (const y of [1,2]) {} return o.x+"/"+o.y;`);
    expect(v(src)).toEqual({ ok: true, value: "0/7" });
  });

  it("成员头不影响其它成员", () => {
    const src = wrap(`const o={x:0,y:7}; for (o.x of [1,2]) {} return o.y;`);
    expect(v(src)).toEqual({ ok: true, value: 7 });
  });
});
});

// ---------------------------------------------------------------------------
// 成员目标自增的写回时刻（测试位 / 判别位 / 步进位）
// ---------------------------------------------------------------------------
describe("成员目标自增的写回时刻（测试位 / 判别位 / 步进位）", () => {
/**
 * 回归（core 转译层）：**成员目标** `o.n++` 的写回必须发生在宿主
 * 表达式求值的**那一刻**（先读旧值参与比较，再写回）⇒ if 测试位 / switch
 * 判别位 / for·while 步进位都走对分支。
 *
 * 修复前（报告口径）：成员臂的 `UpdateExpression` **不自包含**——表达式位
 * 只发射纯读，写回被外包给语句级 rebind pass；而 rebind 的发射位置在
 * if/switch 里排在宿主表达式**之前**（⇒ 测试读到写回后的值 ⇒ 走错分支），
 * 在 for/while 步进闭包里干脆**不存在**（⇒ 计数器不前进 ⇒ 跑到迭代上限）。
 *
 * 现状：成员臂已随 的修法**自包含**（一次 Get + 一次 Put，写回
 * 下沉到表达式内）⇒ 四个位同时正确。本测试把这四个位**钉住**，防止回退。
 *
 * 负控制钉住：标识符目标（本就正确）、`+=` 复合赋值、语句位 `o.n++`。
 */




/** 调用结果的字面量值（val 返回 litValue 的 {ok,value} 包装） */
function valOf(src: string): unknown {
  const r = val(src);
  return r.ok ? r.value : "not-lit";
}

describe("成员目标自增的写回时刻（测试位 / 判别位 / 步进位）", () => {
  it("if 测试位：比较用旧值，写回在求值点", () => {
    // 原生：[1]（o.n++ 读旧值 0 参与比较 → then；写回后 o.n = 1）
    expect(valOf(`export function f() {
  const o = { n: 0 };
  const r = [];
  if (o.n++ === 0) { r.push(o.n); } else { r.push(-1); }
  return r.join(",");
}`)).toBe("1");
  });

  it("if 测试位：前缀与字符串分支同样走对", () => {
    expect(valOf(`export function f() {
  const o = { n: 0 };
  const r = [];
  if (o.n++ === 0) { r.push("a"); } else { r.push("b"); }
  return r.join(",");
}`)).toBe("a");
    expect(valOf(`export function f() {
  const o = { n: 5 };
  const r = [];
  if (o.n-- === 5) { r.push(o.n); } else { r.push(-1); }
  return r.join(",");
}`)).toBe("4");
  });

  it("switch 判别位：判别式取旧值（匹配 case 0）", () => {
    expect(valOf(`export function f() {
  const o = { n: 0 };
  const r = [];
  switch (o.n++) { case 0: r.push("zero"); break; case 1: r.push("one"); break; default: r.push("other"); }
  return r.join(",");
}`)).toBe("zero");
  });

  it("for 步进位：计数器前进（不撞迭代上限）", () => {
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  for (o.n = 0; o.n < 3; o.n++) { c++; }
  return [o.n, c].join(",");
}`)).toBe("3,3");
  });

  it("while 测试位：写回在求值点（多一次自增）", () => {
    // 原生：[4,3]
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  while (o.n++ < 3) { c++; }
  return [o.n, c].join(",");
}`)).toBe("4,3");
  });

  it("负控制：标识符目标 / 复合赋值 / 语句位不受影响", () => {
    expect(valOf(`export function f() {
  let n = 0;
  const r = [];
  if (n++ === 0) { r.push(n); } else { r.push(-1); }
  return r.join(",");
}`)).toBe("1");
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  for (o.n = 0; o.n < 5; o.n += 1) { c++; }
  return [o.n, c].join(",");
}`)).toBe("5,5");
    expect(valOf(`export function f() {
  const o = { n: 0 };
  let c = 0;
  while (o.n < 3) { o.n++; c++; }
  return [o.n, c].join(",");
}`)).toBe("3,3");
  });
});
});

// ---------------------------------------------------------------------------
// __proto__ 值表达式在其属性位置求值（原生源码序）
// ---------------------------------------------------------------------------
describe("__proto__ 值表达式在其属性位置求值（原生源码序）", () => {
/**
 * 回归：对象字面量 `__proto__: <表达式>` 的**值表达式**必须在其
 * 属性位置求值（原生按源码序），不得被推迟到字面量末尾。
 *
 * ES 语义（PropertyDefinitionEvaluation）：`{ a: A, __proto__: P, b: B }` 的
 * 求值序是 A → P → B；`__proto__` 是**原型设定**（不是自有键），值表达式
 * 与普通属性值一样按源码序求值。
 *
 * 修复前：转译层把 `__proto__` 的值从字面量里摘出来、在整段 `$obj({...})`
 * 构造完成后才 `$setProto` ⇒ 值表达式被移到**最后**（副作用顺序颠倒：
 * 原生 "a,p,b" / 引擎 "a,b,p"）。
 *
 * 不变量（负控制钉住）：无 `__proto__` 的字面量发射形态不变（不引入
 * IIFE/盒子）；`__proto__` 仍不是自有键；原型设定本身仍生效；primitive
 * 原型值仍被忽略；`__proto__` 方法名仍是自有键。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_7(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("__proto__ 值表达式在其属性位置求值（原生源码序）", () => {
  it("{ __proto__: P, b: B } → 副作用序 P → B", () => {
    expect(
      v(wrap(`const log = []; const o = { __proto__: (log.push("a"), null), b: log.push("b") }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("{ b: B, __proto__: P } → 副作用序 B → P", () => {
    expect(
      v(wrap(`const log = []; const o = { b: log.push("b"), __proto__: (log.push("a"), null) }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "b,a" });
  });

  it("{ a: A, __proto__: P, b: B } → 副作用序 A → P → B", () => {
    expect(
      v(
        wrap(
          `const log = []; const o = { a: log.push("a"), __proto__: (log.push("p"), null), b: log.push("b") }; return log.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,p,b" });
  });

  it("只有 __proto__ 的字面量 → 值表达式仍求值一次", () => {
    expect(
      v(wrap(`const log = []; const o = { __proto__: (log.push("a"), null) }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("__proto__ 的值表达式只求值一次", () => {
    expect(
      v(
        wrap(
          `let n = 0; const o = { __proto__: (n++, null), b: 1 }; return n;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("原型设定仍生效（getPrototypeOf 命中该原型）", () => {
    expect(
      v(wrap(`const p = { q: 1 }; const o = { __proto__: p, x: 1 }; return Object.getPrototypeOf(o) === p;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("__proto__ 仍不是自有键（Object.keys 不含它）", () => {
    expect(
      v(wrap(`const o = { __proto__: null, x: 1 }; return Object.keys(o).join(",") + "/" + (Object.getPrototypeOf(o) === null);`)),
    ).toEqual({ ok: true, value: "x/true" });
  });
});

describe("负控制：既有语义不回归", () => {
  it("primitive 原型值被忽略（原型仍是 Object.prototype）", () => {
    expect(
      v(wrap(`const o = { __proto__: 5, x: 1 }; return Object.getPrototypeOf(o) === Object.prototype;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("普通字面量的属性求值序不变（无 __proto__ 时不插 IIFE）", () => {
    const src = transpileSource(`const o = { a: 1, b: 2 };`, {});
    expect(src.includes("__nudoProtoBox")).toBe(false);
  });

  it("带 __proto__ 的字面量才引入盒子 IIFE（求值序载体）", () => {
    const src = transpileSource(`const o = { __proto__: p, a: 1 };`, {});
    expect(src.includes("__nudoProtoBox")).toBe(true);
  });

  it("无 __proto__ 的字面量：属性值求值序不变", () => {
    expect(
      v(wrap(`const log = []; const o = { a: log.push("a"), b: log.push("b") }; return log.join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("方法名 __proto__ 仍是自有键（不是原型设定）", () => {
    expect(
      v(wrap(`const o = { __proto__(){ return 1; } }; return Object.keys(o).join(",");`)),
    ).toEqual({ ok: true, value: "__proto__" });
  });

  it("字面量里的 this 仍指向外层（IIFE 不得改 this 绑定）", () => {
    expect(
      v(wrap(`function g(){ const t = this; const o = { t2: this === t }; return o.t2; } return g();`)),
    ).toEqual({ ok: true, value: true });
  });

  it("带 __proto__ 的字面量里 this 绑定同样不变（IIFE 路径）", () => {
    expect(
      v(
        wrap(
          `function g(){ const t = this; const o = { __proto__: null, t2: this === t }; return o.t2; } return g();`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });
});
});

// ---------------------------------------------------------------------------
// 成员路径写回不得打到根（中间层是访问器时）
// ---------------------------------------------------------------------------
describe("成员路径写回不得打到根（中间层是访问器时）", () => {
/**
 * 成员路径写回链在「中间层是访问器」时仍把写回打到**根对象** ⇒
 * `o.a.b = 2`（`a` 是 getter）写错了对象（原生只改 getter 返回的对象，
 * **永不**对 `o.a` 做 [[Set]]）。
 *
 * 根因（转译层，core/src/algebra/exec/transpile/member-path.ts）：写回链把
 * 每层都当**写入目标**——`o.a.b = v` 发射成
 * `o = $set(o, "a", $set($get(o, "a"), "b", v))`：末层写在了 getter 返回的
 * 对象上（对），但**中间层**又被打了一次 [[Set]]（错）——访问器层因此：
 * - 只读访问器 ⇒ strict 定抛 TypeError（L2 门禁假红，原生永不抛）；
 * - 有 setter ⇒ setter 被误调（原生不调）。
 *
 * 修法：[[Set]] 只落**末层**——中间层只**取值**（原生语义）；引擎的不可变
 * 更新（$set 返回新 Abs）才把新值补写回上层（原生是就地改，补写只是引擎
 * 建模的可见性补偿）。
 *
 * 负控制：单层路径的 Put 仍走原生访问器语义（setter 被调 / 只读访问器定抛）。
 */




function v(src: string) {
  return litValue___nudojs_core_8(call(src, "f").result);
}

/** 抛错面（brand 名 = 错误构造器名） */
function throwsName(src: string): string | null {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t || !t.shape || t.shape.k === "never") return null;
  return t.shape.k === "brand" ? (t.shape.name ?? "brand") : (t.shape.k as string);
}

describe("成员路径写回不得打到根（中间层是访问器时）", () => {
  const v = (src: string) => litValue(call(src, "f").result);
  const throwsName = (src: string): string => {
    const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
    if (!t?.shape || t.shape.k === "never") return "";
    return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
  };
  it("getter 中间层：新对象/同对象/不触发 setter/冻结根内层可写/复合与 delete 不抛", () => {
    expect(v(`export function f() { const o = { get a() { return { b: 1 }; } }; o.a.b = 2; return o.a.b; }`)).toEqual({ ok: true, value: 1 });
    expect(v(`export function f() { class Holder { constructor(){ this._inner = {c:1}; } get inner(){ return this._inner; } } const h = new Holder(); h.inner.c += 1; return h._inner.c; }`)).toEqual({ ok: true, value: 2 });
    expect(v(`export function f() { const o = { _a:{b:1}, calls:0, get a(){ return this._a; }, set a(v){ this.calls++; } }; o.a.b = 2; return o.calls; }`)).toEqual({ ok: true, value: 0 });
    expect(v(`export function f() { const o = Object.freeze({a:{b:1}}); o.a.b = 2; return o.a.b; }`)).toEqual({ ok: true, value: 2 });
    expect(v(`export function f() { const o = { get a() { return { b: 1 }; } }; o.a.b += 2; return o.a.b; }`)).toEqual({ ok: true, value: 1 });
    expect(v(`export function f() { const o = { get a() { return { b: 1 }; } }; try { o.a.b = 2; } catch (e) { return "THROW:" + e.constructor.name; } return "ok"; }`)).toEqual({ ok: true, value: "ok" });
    expect(v(`export function f() { const o = { get a() { return { b: 1 }; } }; try { delete o.a.b; } catch (e) { return "THROW:" + e.constructor.name; } return "ok"; }`)).toEqual({ ok: true, value: "ok" });
    expect(v(`export function f() { const o = { get a() { return { b: 1 }; } }; try { o.a.b++; } catch (e) { return "THROW:" + e.constructor.name; } return "ok"; }`)).toEqual({ ok: true, value: "ok" });
  });
  it("负控：单层 Put 访问器语义与数据属性链不变", () => {
    expect(v(`export function f() { const o = {a:{b:1}}; o.a = {b:5}; return o.a.b; }`)).toEqual({ ok: true, value: 5 });
    expect(v(`export function f() { const o = { get a(){ return 1; }, set a(v){ this._v = v; } }; o.a = 5; return o._v; }`)).toEqual({ ok: true, value: 5 });
    expect(throwsName(`export function f() { const o = { get a(){ return 1; } }; o.a = 5; return "no-throw"; }`)).toBe("TypeError");
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b = 2; return o.a.b; }`)).toEqual({ ok: true, value: 2 });
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b += 2; return o.a.b; }`)).toEqual({ ok: true, value: 3 });
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b++; return o.a.b; }`)).toEqual({ ok: true, value: 2 });
    expect(v(`export function f() { const o={a:{b:1}}; delete o.a.b; return "b" in o.a ? "still" : "gone"; }`)).toEqual({ ok: true, value: "gone" });
  });
});
;
});

// ---------------------------------------------------------------------------
// 访问器占位槽不得投影成 exact undefined
// ---------------------------------------------------------------------------
describe("访问器占位槽不得投影成 exact undefined", () => {
/**
 * （对象字面量访问器的**投影面**把 getter 占位槽渲染成 exact `undefined`）。
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

describe("访问器占位槽不得投影成 exact undefined", () => {
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
    // 口径更新（族 09 / + 410）：guard 面现在还带
    // ① 数组排除（`!Array.isArray(data)`）② 必填槽的**独立存在性子句**
    // （`Object.hasOwn(data, "ab") || ("ab" in data && …)`）——
    // 访问器键的**读域判定**（`data.ab === 1`）不变。
    expect(guardOf(src)).toBe(
      'typeof data === "object" && data !== null && !Array.isArray(data) && (Object.hasOwn(data, "ab") || ("ab" in data && !Object.hasOwn(Object.prototype, "ab"))) && data.ab === 1',
    );
  });

  it("契约投影（zod / standard 面的同源）取 getter 读域", () => {
    const src = `export function f() { return { get ab() { return 1; } }; }`;
    expect(fieldLit(call(src, "f").result, "ab")).toBe(1);
  });

  it("契约门禁：getter 返回值满足 shape 契约（改前假红）", () => {
    const accNudo = `
import {number, shape} from "@nudojs/core";
export const numShape = shape({ ab: number() });
`;
    const src = `
/// @nudo:import {numShape} from "./acc.nudo.js"
/// @nudo:contract return numShape
export function f() { return { get ab() { return 1; } }; }
`;
    const r = checkSource_____index_ts(
      "/t/acc.js",
      src,
      pTrue_____index_ts,
      sidecarOpts("acc.nudo.js", accNudo),
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("负控制：非 getter 槽不受影响", () => {
  it("普通数据属性仍渲染成它的值类型", () => {
    const src = `export function f() { return { plain: 5 }; }`;
    expect(shapeOf(src)).toBe("{ plain: 5 }");
    expect(guardOf(src)).toBe(
      'typeof data === "object" && data !== null && !Array.isArray(data) && (Object.hasOwn(data, "plain") || ("plain" in data && !Object.hasOwn(Object.prototype, "plain"))) && data.plain === 5',
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
      'typeof data === "object" && data !== null && !Array.isArray(data) && (Object.hasOwn(data, "ab") || ("ab" in data && !Object.hasOwn(Object.prototype, "ab"))) && data.ab === undefined',
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
});

// ---------------------------------------------------------------------------
// X.prototype 上的 owner 实例方法：值读 / in
// ---------------------------------------------------------------------------
describe("X.prototype 上的 owner 实例方法：值读 / in", () => {
/**
 * 回归：`X.prototype.<ownMethod>` 的**值读**与 `in` 判定必须认 owner 类。
 *
 * ES 语义：类体的实例方法就挂在 `X.prototype` 上——`typeof A.prototype.m` 是
 * "function"、`"m" in A.prototype` 是 true、`A.prototype.hasOwnProperty("m")`
 * 是 true（自有属性）。
 *
 * 修复前：`evalClassChain("A.prototype")` 的链**不含 owner**（owner 只 push
 * 父类）→ 成员读落 exact undefined、`in` 落 exact false（wrong-exact）——
 * 同一方法在 `new A().m` 上却是对的（两条面不一致）。
 *
 * 本文件覆盖**值读**与 **in** 两个面；`hasOwnProperty` / `propertyIsEnumerable`
 * 面由 builtins/object-proto.ts 的 hasOwnDecision 接线 members.ts 的
 * protoBrandOwnMember 补齐（S1 交接，见报告）；gOPD 面由
 * builtins/object/methods.ts 的 class-own-member 描述符臂补齐。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_9(call(src, "f").result);
}

describe("X.prototype 上的 owner 实例方法：值读 / in", () => {
  it("typeof A.prototype.m → \"function\"（owner 自有方法）", () => {
    expect(v(wrap(`class A { m(){ return 1; } } return typeof A.prototype.m;`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("\"m\" in A.prototype → true", () => {
    expect(v(wrap(`class A { m(){} } return "m" in A.prototype;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("派生类自有方法：B.prototype.own → \"function\" / in → true", () => {
    expect(v(wrap(`class A {} class B extends A { own(){} } return typeof B.prototype.own;`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class A {} class B extends A { own(){} } return "own" in B.prototype;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("祖先类方法（原型链继承）：B.prototype.base → \"function\"", () => {
    expect(v(wrap(`class A { base(){} } class B extends A {} return typeof B.prototype.base;`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("方法恒等：A.prototype.m === new A().m（同一函数对象）", () => {
    expect(v(wrap(`class A { m(){ return 1; } } return A.prototype.m === new A().m;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：缺席方法仍是 undefined / in → false", () => {
    expect(v(wrap(`class A { m(){} } return typeof A.prototype.nope;`))).toEqual({
      ok: true,
      value: "undefined",
    });
    expect(v(wrap(`class A { m(){} } return "nope" in A.prototype;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("负控制：A.prototype instanceof A → false（owner 不在自己的原型链上）", () => {
    expect(v(wrap(`class A {} return A.prototype instanceof A;`))).toEqual({ ok: true, value: false });
  });

  it("负控制：B.prototype instanceof A → true（原型链继承）", () => {
    expect(v(wrap(`class A {} class B extends A {} return B.prototype instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("A.prototype.hasOwnProperty(\"m\") → true（owner 自有方法）", () => {
    expect(v(wrap(`class A { m(){} } return String(A.prototype.hasOwnProperty("m"));`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("负控制：祖先类方法不在 B.prototype 自有面 → false", () => {
    expect(
      v(wrap(`class A { m(){} } class B extends A {} return String(B.prototype.hasOwnProperty("m"));`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("负控制：缺席键 → false", () => {
    expect(
      v(wrap(`class A { m(){} } return String(A.prototype.hasOwnProperty("nope"));`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("A.prototype.propertyIsEnumerable(\"m\") → false（类方法非枚举）", () => {
    expect(
      v(wrap(`class A { m(){} } return String(A.prototype.propertyIsEnumerable("m"));`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("Object.getOwnPropertyDescriptor(A.prototype,\"m\") → 精确描述符（此前折并 ⇒ 读 .value 定抛）", () => {
    expect(
      v(wrap(`class A { m(){} } return typeof Object.getOwnPropertyDescriptor(A.prototype,"m").value;`)),
    ).toEqual({ ok: true, value: "function" });
    expect(
      v(
        wrap(
          `class A { m(){} } const d = Object.getOwnPropertyDescriptor(A.prototype,"m"); return String(d.enumerable) + "/" + String(d.writable) + "/" + String(d.configurable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false/true/true" });
  });
});
});

// ---------------------------------------------------------------------------
// 原型方法删除钩子（deleteProtoMethod）
// ---------------------------------------------------------------------------
describe("原型方法删除钩子（deleteProtoMethod）", () => {
/**
 * 回归：`delete X.prototype.m` 不从**方法注册表**移除（删除后仍可调用
 * / 继承面不更新）。
 *
 * 根因：方法在**方法注册表**（`spec.methods`）里，不在原型对象的槽上；
 * `$del`（runtime/members.ts）只删内层 obj 的槽 ⇒ 删的是一个不存在的键 ⇒
 * 删除事件**不留任何痕迹**，注册表侧无人通知 ⇒ `findMethod` 继续沿链命中。
 *
 * 修法（本片，packages/core/src/algebra/exec/class/declare.ts）：新增
 * `deleteProtoMethod(ctorName, key)`——把方法条目从注册表摘掉（读面 / 调用面
 * / in 面三面同步缺席）。
 *
 * **接线点在 runtime/members.ts 的 `$del`（S16 已接线）**：删除的
 * 接收者是 `.prototype` brand（`A.prototype`）时，按名取 owner 类并调用本
 * 钩子。端到端用例（`delete A.prototype.m`）见文件末尾。
 */






const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_10(call(src, "f").result);
}

describe("原型方法删除钩子（deleteProtoMethod）", () => {
  const wrap = (body: string) => `export function f() { ${body} }`;
  const v = (src: string) => litValue___nudojs_core_10(call(src, "f").result);
  const throwsType = (src: string) => {
    const r = call(src, "f");
    return isNever(r.result) && throwsError(r.throws, "TypeError");
  };
  it("钩子摘条目/继承面同步/不误伤静态与别的类/幂等；端到端读面与 in 面", () => {
    call(wrap(`class DelMe194 { m(){ return 1; } } class DelMe194Sub extends DelMe194 {} return 1;`), "f");
    expect(findMethod("DelMe194", "m")).toBeDefined();
    expect(findMethod("DelMe194Sub", "m")).toBeDefined();
    expect(deleteProtoMethod("DelMe194", "m")).toBe(true);
    expect(findMethod("DelMe194", "m")).toBeUndefined();
    expect(findMethod("DelMe194Sub", "m")).toBeUndefined();

    call(wrap(`class DelMe194b { m(){ return 1; } static sm(){ return 2; } } return 1;`), "f");
    expect(findStaticMethod("DelMe194b", "sm")).toBeDefined();
    expect(deleteProtoMethod("DelMe194b", "m")).toBe(true);
    expect(findStaticMethod("DelMe194b", "sm")).toBeDefined();

    call(wrap(`class DelMe194c { m(){ return 1; } } return 1;`), "f");
    expect(deleteProtoMethod("DelMe194c", "nope")).toBe(false);
    expect(deleteProtoMethod("DelMe194c", "m")).toBe(true);
    expect(deleteProtoMethod("DelMe194c", "m")).toBe(false);

    call(wrap(`class DelMe194d { m(){ return 1; } } class DelMe194e { m(){ return 2; } } return 1;`), "f");
    expect(deleteProtoMethod("DelMe194d", "m")).toBe(true);
    expect(findMethod("DelMe194e", "m")).toBeDefined();

    expect(v(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; return String(A.prototype.m);`))).toEqual({ ok: true, value: "undefined" });
    expect(v(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; return String(B.prototype.m);`))).toEqual({ ok: true, value: "undefined" });
    expect(v(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; return String("m" in B.prototype);`))).toEqual({ ok: true, value: "false" });
    expect(v(wrap(`class DelMe194f { m(){ return 1; } } class DelMe194g { m(){ return 2; } } delete DelMe194f.prototype.m; return typeof DelMe194g.prototype.m;`))).toEqual({ ok: true, value: "function" });
    expect(v(wrap(`class DelMe194h { m(){ return 1; } } delete DelMe194h.prototype.nope; return typeof DelMe194h.prototype.m;`))).toEqual({ ok: true, value: "function" });
  });
  it("调用面：删除/从未定义/非函数值均抛；try/catch 可吸收；读面与静态/内建负控", () => {
    expect(throwsType(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return a.m();`))).toBe(true);
    expect(diffBody(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return a.m();`)).toBeNull();
    expect(throwsType(wrap(`class A { m(){ return 1; } } delete A.prototype.m; const a = new A(); return a.m();`))).toBe(true);
    expect(throwsType(wrap(`class A { m(){ return 1; } } const a = new A(); return a.neverDefined();`))).toBe(true);
    expect(diffBody(`class A { m(){ return 1; } } const a = new A(); return a.neverDefined();`)).toBeNull();
    expect(throwsType(wrap(`class A { constructor(){ this.m = undefined; } } return new A().m();`))).toBe(true);
    expect(diffBody(`class A { constructor(){ this.m = undefined; } } return new A().m();`)).toBeNull();

    expect(v(wrap(`class A { m(){ return 1; } } delete A.prototype.m; const a = new A(); try { a.m(); } catch (e) { return e.name; } return "no-throw";`))).toEqual({ ok: true, value: "TypeError" });
    expect(v(wrap(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return String(a.m);`))).toEqual({ ok: true, value: "undefined" });
    expect(diffBody(`class A { m(){ return 1; } } class B extends A {} delete A.prototype.m; const a = new B(); return String(a.m);`)).toBeNull();
    expect(v(wrap(`class A { m(){ return 1; } } class B extends A {} const a = new B(); return a.m();`))).toEqual({ ok: true, value: 1 });
    expect(v(wrap(`class DelMe194i { m(){ return 1; } } class DelMe194j { m(){ return 2; } } delete DelMe194i.prototype.m; return new DelMe194j().m();`))).toEqual({ ok: true, value: 2 });
    expect(v(wrap(`class A { m(){ return 1; } } delete A.prototype.m; const a = new A(); return typeof a.toString;`))).toEqual({ ok: true, value: "function" });
    expect(v(wrap(`class A { m(){ return 1; } static s(){ return 2; } } delete A.prototype.m; return A.s();`))).toEqual({ ok: true, value: 2 });
    expect(isNever(call(wrap(`const d = new Date(); return typeof d.getTime();`), "f").result)).toBe(false);
    expect(v(wrap(`class A { constructor(){ this.m = function(){ return 42; }; } } return new A().m();`))).toEqual({ ok: true, value: 42 });
    expect(isNever(call(wrap(`class MyMap extends Map {} return new MyMap().nope();`), "f").result)).toBe(false);
  });
});
;

/**
 * S19（**调用面**）：`delete X.prototype.m` 之后**调用** `a.m()`——
 * 原生定抛 TypeError（`a.m is not a function`），引擎此前折 unknown
 * （never throws ⇒ L2 `nudo:entry-may-throw` 门禁假绿）。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用点读不到
 * **可调用**目标时记 TypeError——两种情形原生同抛：
 * - 方法确实不存在（delete 之后 / 从未定义）；
 * - 方法在但值不是函数（`a.m = undefined`）。
 * 读面**不抛**（读 `a.m` 得 undefined 不抛）——本片只改调用面。
 */
;
});

// ---------------------------------------------------------------------------
// 标签模板对象是冻结的数组 exotic
// ---------------------------------------------------------------------------
describe("标签模板对象是冻结的数组 exotic", () => {
/**
 * 回归：标签模板对象（GetTemplateObject）必须是**冻结的数组 exotic**。
 *
 * ES 语义（GetTemplateObject）：`CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)`
 * ⇒ 模板对象是**真数组**，且
 * - `length` / `raw` / `@@iterator` 是**非枚举**自有属性（原生三者全非枚举；
 * `Object.keys(s)` 只有下标 "0".."n-1"）；
 * - `Object.isFrozen(s)` / `Object.isFrozen(s.raw)` 均为 true；
 * - `JSON.stringify(s)` 走**数组序列化**（`["a","b"]`）。
 *
 * 修复前（引擎把模板对象建模成普通 obj，元槽平铺为可枚举）：
 * - `Object.keys(s)` → `"0,1,length,raw,@@iterator"`（错值）；
 * - `Object.isFrozen(s)` / `Object.isFrozen(s.raw)` → false（错值）；
 * - `JSON.stringify(s)` → `{"0":"a","1":"b","length":2,...}`（错值：走了 obj 面）。
 *
 * 负控制：模板对象的**元素面**（下标读 / length / raw / 展开）不受影响。
 */



/** 标签函数：把模板对象交给 body 表达式 */
const TPL = (expr: string) =>
  `export function f() { function tag(s) { return ${expr}; } return tag\`a\${1}b\`; }`;

describe("标签模板对象是冻结的数组 exotic", () => {
  it("冻结/枚举/序列化/for-in/数组方法；普通对象不外溢", () => {
    expect(val(TPL("Object.isFrozen(s)"))).toEqual({ ok: true, value: true });
    expect(val(TPL("Object.isFrozen(s.raw)"))).toEqual({ ok: true, value: true });
    expect(val(TPL('Object.keys(s).join(",")'))).toEqual({ ok: true, value: "0,1" });
    expect(val(TPL("JSON.stringify(s)"))).toEqual({ ok: true, value: '["a","b"]' });
    expect(val(TPL('s.propertyIsEnumerable("length")'))).toEqual({ ok: true, value: false });
    expect(val(TPL('Object.getOwnPropertyDescriptor(s, "length").enumerable'))).toEqual({ ok: true, value: false });
    expect(val(TPL('(() => { let k = ""; for (const x in s) k += x; return k; })()'))).toEqual({ ok: true, value: "01" });
    expect(val(TPL("s[0]"))).toEqual({ ok: true, value: "a" });
    expect(val(TPL("s.length"))).toEqual({ ok: true, value: 2 });
    expect(val(TPL("s.raw.length"))).toEqual({ ok: true, value: 2 });
    expect(val(TPL("s.raw[1]"))).toEqual({ ok: true, value: "b" });
    expect(val(TPL("[...s].join('|')"))).toEqual({ ok: true, value: "a|b" });
    expect(val(TPL('s.join(",")'))).toEqual({ ok: true, value: "a,b" });
    expect(val(TPL("String(typeof s.join)"))).toEqual({ ok: true, value: "function" });
    expect(val(TPL('s.indexOf("a")'))).toEqual({ ok: true, value: 0 });
    expect(val(TPL('s.concat(["c"]).join(",")'))).toEqual({ ok: true, value: "a,b,c" });
    expect(val(TPL("s.map((x) => x).join(\",\")"))).toEqual({ ok: true, value: "a,b" });
    expect(val(TPL('s.slice(0, 1).join(",")'))).toEqual({ ok: true, value: "a" });
    expect(val(`export function f() { return String(typeof ({}).join); }`)).toEqual({ ok: true, value: "undefined" });
    expect(val(`export function f() { return Object.isFrozen({}); }`)).toEqual({ ok: true, value: false });
  });
});
describe("Array.isArray(标签模板对象) → true", () => {
  it("模板对象与多段均 true；普通对象/字符串/迭代器 false", () => {
    expect(val(TPL("Array.isArray(s)"))).toEqual({ ok: true, value: true });
    expect(val(`export function f() { function tag(s) { return Array.isArray(s); } return tag\`a\${1}b\`; }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { return Array.isArray({}); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Array.isArray("x"); }`)).toEqual({ ok: true, value: false });
    expect(val(`export function f() { return Array.isArray([1,2].entries()); }`)).toEqual({ ok: true, value: false });
  });
});
;

/**
 * `Array.isArray(模板对象)` 必须是 **true**——原生 GetTemplateObject =
 * `CreateArrayFromList(cooked)` + `SetIntegrityLevel(frozen)` ⇒ 标签模板对象
 * 是**数组 exotic**（不是普通对象）。
 *
 * 修复前：引擎 isArray 只认 arr/tuple 形状 ⇒ 模板对象（obj 形状）折
 * **false**（wrong-exact）。
 */
;
});

// ---------------------------------------------------------------------------
// 借用类方法按方法体执行（this = 接收者），不按接收者成员表反查
// ---------------------------------------------------------------------------
describe("借用类方法按方法体执行（this = 接收者），不按接收者成员表反查", () => {
/**
 * 回归：**借用类方法**（`.call` / `.apply` / `.bind` / HOF 传递）按
 * **接收者成员表**反查被调用者 ⇒ 非本类实例的接收者一律假抛 TypeError。
 *
 * 修复前：`class A { m(){ return this.x; } } const m = new A().m;
 * m.call({ x: 1 })` → 折 never + throws=TypeError；原生 → 1（方法体是那个
 * 函数，`this` = 调用位给的接收者）。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts 的 protoMethodDispatch
 * 注册回调）：用户类方法值按**方法体 + this = 接收者**执行——借用调用不再
 * 反查接收者的成员表；接收者 brand 校验只在**私有名**（#m）时保留。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_11(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

describe("借用类方法按方法体执行（this = 接收者），不按接收者成员表反查", () => {
  it(".call(外来对象) → 方法体以该对象为 this 执行", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call({ x: 1 });`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it(".apply(外来对象) → 同口径", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.apply({ x: 2 });`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it(".bind(外来对象)() → 同口径", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const f = a.m.bind({ x: 3 }); return f();`)),
    ).toEqual({ ok: true, value: 3 });
  });

  it(".call(undefined) → this=undefined，方法体不碰 this 时不抛", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } const a = new A(); const m = a.m; return m.call(undefined);`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("静态方法借用（.call）→ 静态方法体 + 该接收者", () => {
    expect(
      v(wrap(`class A { static sm(){ return 1; } } return A.sm.call({});`)),
    ).toEqual({ ok: true, value: 1 });
    expect(
      v(wrap(`class A { static sm(){ return this.x; } } return A.sm.call({ x: 7 });`)),
    ).toEqual({ ok: true, value: 7 });
  });

  it("静态方法摘下后借用 → 静态方法体", () => {
    expect(
      v(wrap(`class A { static sm(){ return 1; } } const { sm } = A; return sm.call({});`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("HOF 传递（数组 map 回调）→ 方法体正常执行（this=undefined 不抛）", () => {
    expect(
      v(wrap(`class A { m(){ return 1; } } const a = new A(); const { m } = a; return [1].map(m).length;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("派生类实例的方法借用 → 沿派生类方法体执行", () => {
    expect(
      v(wrap(`class B extends Object { m(){ return this.x; } } const b = new B(); const m = b.m; return m.call({ x: 9 });`)),
    ).toEqual({ ok: true, value: 9 });
  });

  it("借用给本类实例 → this = 该实例（this.x 为 undefined）", () => {
    expect(
      v(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call(a);`)),
    ).toEqual({ ok: true, value: undefined });
  });

  it("借用不记 may-throw（throws 域干净）", () => {
    const rec = call(
      wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call({ x: 1 });`),
      "f",
    );
    expect(throwsError(rec.throws, "TypeError")).toBe(false);
  });

  it("负控制：对象字面量方法的借用不受影响（原本就正确）", () => {
    expect(
      v(wrap(`const o = { m(){ return this.x; } }; const m = o.m; return m.call({ x: 5 });`)),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：方法体真读 undefined 接收者的 this 时定抛 TypeError", () => {
    expect(
      throwName(wrap(`class A { m(){ return this.x; } } const a = new A(); const m = a.m; return m.call(undefined);`)),
    ).toBe("TypeError");
  });
});
});

// ---------------------------------------------------------------------------
// [merged] class-instance-set-gate
// ---------------------------------------------------------------------------
describe("class-instance-set-gate", () => {
  const v = (src: string) => litValue(call(src, "f").result);
  const threw = (src: string, name = "TypeError"): boolean => {
    const r = call(src, "f");
    return isNever(r.result) && throwsError(r.throws, name);
  };
  it("类实例 Reflect.set：原型 writable:false/getter-only/派生类返 false；可写与新键负控", () => {
    expect(v(`export function f() {
      class Ag197a {}
      Object.defineProperty(Ag197a.prototype, "x", { value: 1, writable: false, configurable: true });
      return String(Reflect.set(new Ag197a(), "x", 2));
    }`)).toEqual({ ok: true, value: "false" });
    expect(v(`export function f() {
      class Ag197b {}
      Object.defineProperty(Ag197b.prototype, "y", { get() { return 7; }, configurable: true });
      return String(Reflect.set(new Ag197b(), "y", 2));
    }`)).toEqual({ ok: true, value: "false" });
    expect(v(`export function f() {
      class Ag197c {}
      class Ag197d extends Ag197c {}
      Object.defineProperty(Ag197c.prototype, "x", { value: 1, writable: false, configurable: true });
      return String(Reflect.set(new Ag197d(), "x", 2));
    }`)).toEqual({ ok: true, value: "false" });
    expect(v(`export function f() {
      class Ag197e {}
      Object.defineProperty(Ag197e.prototype, "z", { value: 1, writable: true, configurable: true });
      return String(Reflect.set(new Ag197e(), "z", 2));
    }`)).toEqual({ ok: true, value: "true" });
    expect(v(`export function f() {
      class Ag197f {}
      const a = new Ag197f();
      const r = Reflect.set(a, "w", 2);
      return String(r) + "/" + String(a.w);
    }`)).toEqual({ ok: true, value: "true/2" });
    expect(v(`export function f() {
      class Ag197g { constructor() { this.n = 1; } }
      const a = new Ag197g();
      const r = Reflect.set(a, "n", 5);
      return String(r) + "/" + String(a.n);
    }`)).toEqual({ ok: true, value: "true/5" });
  });
  it("类实例 strict：原型 writable:false/getter-only 抛；可写与自有字段不抛", () => {
    expect(threw(`export function f() {
      class Ag197h {}
      Object.defineProperty(Ag197h.prototype, "x", { value: 1, writable: false, configurable: true });
      const a = new Ag197h();
      a.x = 2;
      return "no-throw";
    }`)).toBe(true);
    expect(threw(`export function f() {
      class Ag197i {}
      Object.defineProperty(Ag197i.prototype, "y", { get() { return 7; }, configurable: true });
      const a = new Ag197i();
      a.y = 2;
      return "no-throw";
    }`)).toBe(true);
    expect(threw(`export function f() {
      class Ag197j {}
      Object.defineProperty(Ag197j.prototype, "x", { value: 1, writable: true, configurable: true });
      const a = new Ag197j();
      a.x = 2;
      return "no-throw";
    }`)).toBe(false);
    expect(threw(`export function f() {
      class Ag197k { constructor() { this.n = 1; } }
      const a = new Ag197k();
      a.n = 5;
      return "no-throw";
    }`)).toBe(false);
  });
  it("Reflect.set 镜像返 false 不抛；原型槽落地可见；strict 赋值仍抛", () => {
    for (const body of [
      `const p = { get a() { return 7; } };
       const o = Object.create(p);
       return String(Reflect.set(o, "a", 5));`,
      `const p = {};
       Object.defineProperty(p, "x", { value: 1, writable: false });
       const o = Object.create(p);
       return String(Reflect.set(o, "x", 2));`,
      `const o = Object.freeze({ a: 1 });
       return String(Reflect.set(o, "a", 5));`,
    ]) expect(v(`export function f() { ${body} }`), body).toEqual({ ok: true, value: "false" });
    expect(v(`export function f() {
      let seen = "";
      const p = { set a(v) { seen = String(v); } };
      const o = Object.create(p);
      return String(Reflect.set(o, "a", 5)) + "/" + seen;
    }`)).toEqual({ ok: true, value: "true/5" });
    expect(v(`export function f() {
      const o = { a: 1 };
      const r = Reflect.set(o, "a", 5);
      return String(r) + "/" + String(o.a);
    }`)).toEqual({ ok: true, value: "true/5" });
    expect(v(`export function f() {
      const o = {};
      const r = Reflect.set(o, "b", 5);
      return String(r) + "/" + String(o.b);
    }`)).toEqual({ ok: true, value: "true/5" });
    expect(threw(`export function f() {
      const p = { get a() { return 7; } };
      const o = Object.create(p);
      o.a = 5;
      return "no-throw";
    }`)).toBe(true);

    expect(v(`export function f() {
      class A {}
      Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
      return String(A.prototype.hasOwnProperty("x"));
    }`)).toEqual({ ok: true, value: "true" });
    expect(v(`export function f() {
      class A {}
      Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
      return String(A.prototype.x);
    }`)).toEqual({ ok: true, value: "1" });
    expect(v(`export function f() {
      class A {}
      Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
      const a = new A();
      return String(a.x);
    }`)).toEqual({ ok: true, value: "1" });
    expect(v(`export function f() {
      class A {}
      Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
      return String(Reflect.set(new A(), "x", 2));
    }`)).toEqual({ ok: true, value: "false" });
    expect(threw(`export function f() {
      class A {}
      Object.defineProperty(A.prototype, "x", { value: 1, writable: false, configurable: true });
      const a = new A();
      a.x = 2;
      return "no-throw";
    }`)).toBe(true);
    expect(v(`export function f() {
      class A197w {}
      Object.defineProperty(A197w.prototype, "w", { value: 1, writable: true, configurable: true });
      return String(Reflect.set(new A197w(), "w", 2));
    }`)).toEqual({ ok: true, value: "true" });
    expect(v(`export function f() {
      class A197n {}
      const a = new A197n();
      const r = Reflect.set(a, "w", 2);
      return String(r) + "/" + String(a.w);
    }`)).toEqual({ ok: true, value: "true/2" });
  });
  it("[[Set]] 原型链写门：getter/writable:false/frozen/两级链/fn/数组下标抛；负控成功", () => {
    for (const body of [
      `const p = { get a() { return 7; } };
       const o = Object.create(p);
       o.a = 5;
       return "no-throw";`,
      `const p = {};
       Object.defineProperty(p, "x", { value: 1, writable: false });
       const o = Object.create(p);
       o.x = 2;
       return "no-throw";`,
      `const p = { a: 1 };
       Object.freeze(p);
       const o = Object.create(p);
       o.a = 2;
       return "no-throw";`,
      `const p = { get x() { return 1; } };
       const o = Object.create(p);
       const q = Object.create(o);
       q.x = 5;
       return "no-throw";`,
      `function g() {}
       Object.defineProperty(g, "x", { value: 3, writable: false });
       g.x = 4;
       return "no-throw";`,
      `const a = [1, 2];
       Object.defineProperty(a, "0", { value: 5, writable: false });
       a[0] = 6;
       return "no-throw";`,
      `class A { get y() { return 7; } }
       class B extends A {}
       const b = new B();
       b.y = 1;
       return "no-throw";`,
      `const p = {};
       Object.defineProperty(p, "x", { value: 1, writable: false });
       const t = Object.create(p);
       Object.assign(t, { x: 2 });
       return "no-throw";`,
    ]) expect(threw(`export function f() { ${body} }`), body).toBe(true);
    expect(v(`export function f() {
      let seen = 0;
      const p = { set a(v) { seen = v; } };
      const o = Object.create(p);
      o.a = 9;
      return seen;
    }`)).toEqual({ ok: true, value: 9 });
    expect(v(`export function f() {
      const o = { a: 1 };
      o.a = 5;
      return o.a;
    }`)).toEqual({ ok: true, value: 5 });
    expect(v(`export function f() {
      const p = { a: 1 };
      const o = Object.create(p);
      o.a = 5;
      return o.a;
    }`)).toEqual({ ok: true, value: 5 });
    expect(threw(`export function f() {
      function g() {}
      g.x = 4;
      return "no-throw";
    }`)).toBe(false);
  });
});
;

// ---------------------------------------------------------------------------
// [merged] brand-proto-write
// ---------------------------------------------------------------------------
describe("brand-proto-write", () => {
// MERGED (topic-related bug pins): brand-proto-write + for-in-proto-keys
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>




describe("brand-proto-write", () => {
  const v = (src: string) => litValue(call(src, "f").result);
  it("assign/defineProperty 写进原型对象：for-in/实例读/原型读/hasOwn 可见；非 obj 源与负控", () => {
    expect(v(`export function f() {
      class P1 {}
      Object.assign(P1.prototype, { b: 1 });
      const keys = [];
      for (const k in new P1()) keys.push(k);
      return keys.join(",");
    }`)).toEqual({ ok: true, value: "b" });
    expect(v(`export function f() {
      class P2 {}
      Object.defineProperty(P2.prototype, "c", { value: 2, enumerable: true, configurable: true });
      const keys = [];
      for (const k in new P2()) keys.push(k);
      return keys.join(",");
    }`)).toEqual({ ok: true, value: "c" });
    expect(v(`export function f() {
      class P3 {}
      Object.assign(P3.prototype, { b: 1 });
      return String(new P3().b);
    }`)).toEqual({ ok: true, value: "1" });
    expect(v(`export function f() {
      class P4 {}
      Object.assign(P4.prototype, { b: 1 });
      return String(Object.prototype.hasOwnProperty.call(P4.prototype, "b"));
    }`)).toEqual({ ok: true, value: "true" });
    expect(v(`export function f() {
      class P5 {}
      Object.assign(P5.prototype, { b: 1 });
      return String(P5.prototype.b);
    }`)).toEqual({ ok: true, value: "1" });
    expect(v(`export function f() {
      class P6 {}
      Object.assign(P6.prototype, [7, 8]);
      return String(P6.prototype[0]) + "/" + String(P6.prototype[1]);
    }`)).toEqual({ ok: true, value: "7/8" });
    expect(v(`export function f() {
      class P7 { m() {} }
      Object.assign(P7.prototype, { b: 1 });
      const keys = [];
      for (const k in new P7()) keys.push(k);
      return keys.join(",");
    }`)).toEqual({ ok: true, value: "b" });
    expect(v(`export function f() {
      const o = { x: 1 };
      const t = { y: 2 };
      Object.assign(o, t);
      const keys = [];
      for (const k in o) keys.push(k);
      return keys.join(",") + "/" + String(o.y);
    }`)).toEqual({ ok: true, value: "x,y/2" });
  });
  it("for..in 沿 brand 原型链枚举：实例/个数/function/派生链/覆写；方法与自有键负控", () => {
    expect(val(`export function f() {
      class A200t1 { constructor() { this.a = 1; } }
      A200t1.prototype.b = 2;
      let k = "";
      for (const x in new A200t1()) k += x;
      return k;
    }`)).toEqual({ ok: true, value: "ab" });
    expect(val(`export function f() {
      class A200t2 { constructor() { this.a = 1; } }
      A200t2.prototype.b = 2;
      let n = 0;
      for (const x in new A200t2()) n++;
      return n;
    }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() {
      function F() { this.a = 1; }
      F.prototype.b = 2;
      let n = 0;
      for (const x in new F()) n++;
      return n;
    }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() {
      class A200t4 { constructor() { this.a = 1; } }
      class B200t4 extends A200t4 { constructor() { super(); this.b = 2; } }
      A200t4.prototype.p = 9;
      let k = "";
      for (const x in new B200t4()) k += x;
      return k;
    }`)).toEqual({ ok: true, value: "abp" });
    expect(val(`export function f() {
      class A200t5 { constructor() { this.a = 1; } }
      class B200t5 extends A200t5 { m() {} constructor() { super(); this.b = 2; } }
      let k = "";
      for (const x in new B200t5()) k += x;
      return k;
    }`)).toEqual({ ok: true, value: "ab" });
    expect(val(`export function f() {
      class A200t6 { constructor() { this.a = 1; } }
      A200t6.prototype.b = 2;
      A200t6.prototype.b = 3;
      let k = "";
      for (const x in new A200t6()) k += x;
      return k;
    }`)).toEqual({ ok: true, value: "ab" });
    expect(val(`export function f() {
      class A200t7 { m() {} constructor() { this.a = 1; } }
      let n = 0;
      for (const x in new A200t7()) n++;
      return n;
    }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { const o = { a: 1, b: 2 }; let k = ""; for (const x in o) k += x; return k; }`)).toEqual({ ok: true, value: "ab" });
    expect(val(`export function f() {
      class A200t9 { constructor() { this.a = 1; } }
      A200t9.prototype.b = 2;
      return Object.keys(new A200t9()).join(",");
    }`)).toEqual({ ok: true, value: "a" });
    expect(val(`export function f() {
      class A200t10 { constructor() { this.a = 1; } }
      A200t10.prototype.b = 2;
      return String(new A200t10().b);
    }`)).toEqual({ ok: true, value: "2" });
  });
});
;

;
});

// ---------------------------------------------------------------------------
// [merged] class-static-symbol-hasinstance
// ---------------------------------------------------------------------------
describe("class-static-symbol-hasinstance", () => {
// MERGED (topic-related bug pins): class-static-symbol-hasinstance + hasinstance-string-key
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>





describe("class-static-symbol-hasinstance", () => {
  const wrap = (body: string) => `export function f() { ${body} }`;
  const v = (src: string) => litValue(call(src, "f").result);
  it("类体字符串键不当钩子；可读可调/继承/实参口径不变；符号键仍是钩子；槽标记区分", () => {
    expect(v(wrap(`class A { static "@@hasInstance"() { return true; } } return 1 instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A { static "@@hasInstance"() { return false; } } return 1 instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A { static "@@hasInstance" = () => true; } return 1 instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A { static get "@@hasInstance"() { return true; } } return 1 instanceof A;`))).toEqual({ ok: true, value: false });

    expect(v(wrap(`class A { static "@@hasInstance"() { return "u"; } } return typeof A["@@hasInstance"];`))).toEqual({ ok: true, value: "function" });
    expect(v(wrap(`class A { static "@@hasInstance"() { return "u"; } } return A["@@hasInstance"]();`))).toEqual({ ok: true, value: "u" });
    expect(v(wrap(`class A { static "@@hasInstance"() {} } return A["@@hasInstance"] === A["@@hasInstance"];`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class A { static "@@hasInstance"() { return this === A; } } return A["@@hasInstance"]();`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class A { static "@@hasInstance"() { return "A"; } } class B extends A {} return B["@@hasInstance"]();`))).toEqual({ ok: true, value: "A" });
    expect(v(wrap(`class A { static "@@hasInstance"() { return "u"; } static x = A["@@hasInstance"](); } return A.x;`))).toEqual({ ok: true, value: "u" });
    expect(v(wrap(`class A { static "@@hasInstance"() { return true; } } return new A() instanceof A;`))).toEqual({ ok: true, value: true });

    expect(v(wrap(`const K = class { static "@@hasInstance"() { return true; } }; return 1 instanceof K;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`const K = class { static "@@hasInstance"() { return "u"; } }; return K["@@hasInstance"]();`))).toEqual({ ok: true, value: "u" });
    expect(v(wrap(`const K = class Named { static "@@hasInstance"() { return Named; } }; return K["@@hasInstance"]() === K;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class A { static "@@hasInstance"(a, b) { return a + b; } } return A["@@hasInstance"](1, 2);`))).toEqual({ ok: true, value: 3 });
    expect(v(wrap(`class A { static "@@hasInstance"(...a) { return a.length; } } return A["@@hasInstance"](1, 2, 3);`))).toEqual({ ok: true, value: 3 });

    expect(v(wrap(`class A { static [Symbol.hasInstance](v) { return true; } } return 1 instanceof A;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class A { static [Symbol.hasInstance](v) { return v === 5; } } return 5 instanceof A;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class A { static [Symbol.hasInstance](v) { return v === 5; } } return 3 instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A { static [Symbol.hasInstance](v) { return false; } } return new A() instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A { static [Symbol.hasInstance] = () => true; } return 1 instanceof A;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class A { static [Symbol.hasInstance](v) { return true; } } return typeof A[Symbol.hasInstance];`))).toEqual({ ok: true, value: "function" });

    for (const [src, want] of [
      [`export class A { static [Symbol.hasInstance](v) { return true; } }`, true],
      [`export class A { static "@@hasInstance"() { return true; } }`, undefined],
    ] as const) {
      const cls = (runTranspiled(src, { mode: "analyze" }) as Record<string, Abs>).A!;
      const inner = (cls.shape as { k: "brand"; name: string; shape: Abs }).shape;
      const objShape = inner.shape as { k: string; slots: Record<string, { symbolKey?: boolean }> };
      expect(objShape.k).toBe("obj");
      expect(objShape.slots["@@hasInstance"]).toBeDefined();
      expect(objShape.slots["@@hasInstance"]!.symbolKey).toBe(want);
    }
  });
});
;

describe("hasinstance-string-key", () => {
  const wrap = (body: string) => `export function f() { ${body} }`;
  const v = (src: string) => litValue(call(src, "f").result);
  it("obj 字符串键 TypeError；类值字符串键 false；真 Symbol 钩子生效；普通对象 RHS TypeError", () => {
    for (const body of [
      `const o={}; o["@@hasInstance"]=function(){return false;}; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`,
      `const o={}; o["@@hasInstance"]=function(){return true;}; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`,
      `const o={}; o["@@hasInstance"]=1; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`,
      `const o={}; o.foo=1; try { return 1 instanceof o; } catch(e) { return e.constructor.name; }`,
    ]) expect(v(wrap(body)), body).toEqual({ ok: true, value: "TypeError" });
    expect(throwsError(call(wrap(`const o={}; return 1 instanceof o;`)).throws, "TypeError")).toBe(true);

    expect(v(wrap(`class A{} A["@@hasInstance"]=function(){return true;}; return 1 instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A{} A["@@hasInstance"]=function(){return false;}; return 1 instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A{} A["@@hasInstance"]=1; try { return 1 instanceof A; } catch(e) { return e.constructor.name; }`))).toEqual({ ok: true, value: false });

    expect(v(wrap(`const o={}; o[Symbol.hasInstance]=function(){return true;}; return 1 instanceof o;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`const o={}; o[Symbol.hasInstance]=function(){return 0;}; return 1 instanceof o;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A{ static [Symbol.hasInstance](x){ return true; } } return 1 instanceof A;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class C{ static [Symbol.hasInstance](x){ return true; } } class D extends C{} return 1 instanceof D;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`class A{ static [Symbol.hasInstance] = function(){ return true; }; } return 1 instanceof A;`))).toEqual({ ok: true, value: true });
  });
});
;
});

// ---------------------------------------------------------------------------
// 内建原型对象上的 well-known Symbol 成员
// ---------------------------------------------------------------------------
describe("内建原型对象上的 well-known Symbol 成员", () => {
/**
 * 回归：内建**原型对象**上的 well-known Symbol 成员必须可读
 * （`Map.prototype[Symbol.toStringTag]` / `Array.prototype[Symbol.unscopables]`
 * / `Date.prototype[Symbol.toPrimitive]` …）。
 *
 * ES 语义：这些成员是原型对象上的 **symbol 键**自有成员。引擎内部把 symbol
 * 键投影成 "@@X" 槽键 ⇒ 成员表按 "@@X" 建键。
 *
 * 修复前：原型对象的符号成员读**整体缺席** → 折 exact `"undefined"`
 * （wrong-exact：原生是字符串 / 函数 / 对象）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_12(call(src, "f").result);
}

describe("内建原型对象上的 well-known Symbol 成员", () => {
  it("Symbol.toStringTag：Map / Set / Promise 原型上是字符串标签", () => {
    expect(v(wrap(`return String(Map.prototype[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Map",
    });
    expect(v(wrap(`return String(Set.prototype[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Set",
    });
    expect(v(wrap(`return String(Promise.prototype[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Promise",
    });
  });

  it("Symbol.iterator：Map / Set / Array / String 原型上是函数", () => {
    for (const expr of [
      "Map.prototype[Symbol.iterator]",
      "Set.prototype[Symbol.iterator]",
      "Array.prototype[Symbol.iterator]",
      "String.prototype[Symbol.iterator]",
    ]) {
      expect(v(wrap(`return String(typeof ${expr});`))).toEqual({
        ok: true,
        value: "function",
      });
    }
  });

  it("Symbol.toPrimitive：Date 原型上是函数", () => {
    expect(v(wrap(`return String(typeof Date.prototype[Symbol.toPrimitive]);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("RegExp 原型上的 match / replace / search / split 是函数", () => {
    for (const sym of ["match", "replace", "search", "split"]) {
      expect(v(wrap(`return String(typeof RegExp.prototype[Symbol.${sym}]);`))).toEqual({
        ok: true,
        value: "function",
      });
    }
  });

  it("Symbol.unscopables：Array 原型上是 16 键对象", () => {
    expect(v(wrap(`return String(typeof Array.prototype[Symbol.unscopables]);`))).toEqual({
      ok: true,
      value: "object",
    });
    expect(v(wrap(`return Object.keys(Array.prototype[Symbol.unscopables]).length;`))).toEqual({
      ok: true,
      value: 16,
    });
    expect(v(wrap(`return String(Array.prototype[Symbol.unscopables].at);`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("实例面经原型链继承同一成员（new Map()[Symbol.toStringTag]）", () => {
    expect(v(wrap(`return String(new Map()[Symbol.toStringTag]);`))).toEqual({
      ok: true,
      value: "Map",
    });
    expect(v(wrap(`return String(typeof new Date()[Symbol.toPrimitive]);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("Map 原型的 @@iterator 借调落到集合迭代派发（不再假抛）", () => {
    expect(
      v(wrap(`const m = new Map([["a", 1]]); const it = Map.prototype[Symbol.iterator].call(m); return String(it.next().value[0]);`)),
    ).toEqual({ ok: true, value: "a" });
  });

  it("负控制：字符串键成员不受影响（Map.prototype.get 仍是函数）", () => {
    expect(v(wrap(`return String(typeof Map.prototype.get);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
});

// ---------------------------------------------------------------------------
// [merged] instanceof-proto-chain
// ---------------------------------------------------------------------------
describe("instanceof-proto-chain", () => {
// MERGED (topic-related bug pins): instanceof-proto-chain + instanceof-prototype-chain
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>





;
;

describe("instanceof-prototype-chain", () => {
/**
 * 回归：`instanceof` 必须沿实例的**真实原型链**判定，不得按构造器
 * **名字**匹配折 exact true。
 *
 * ES 语义：`Object.setPrototypeOf(f, null)` 之后 `f instanceof F` → false
 * （[[Prototype]] 链终止，OrdinaryHasInstance 无从命中 `F.prototype`）。
 * 修复前：brand 实例的 brand 名就是构造器名，`$instanceof` 用
 * `evalClassChain(name).includes(rightName)` 名字匹配 → 折 exact true
 * （unsound 的肯定判断——类型守卫会走错分支）。
 *
 * 原型**替换**面（`F.prototype = {}` / `= 5`）需要「实例记录真实
 * [[Prototype]]」的建模（构造期捕获 + 写面更新）——S22 落地：
 * - `member.ts`：`$set` 对**宿主函数**建 facade，让 `F.prototype = {}` 的写
 * 落进槽（此前写穿后引擎完全无感）；
 * - `declare.ts`：实例**构造期**记录 [[Prototype]]（brand 实例带一条原型
 * 链记录）；
 * - `objects.ts`：`setPrototypeOf` 对 **brand 接收者**也记（此前只对 obj
 * 接收者记）；
 * - `members.ts`：`$instanceof` 沿**记录的链**做**身份**比较（RHS 的
 * prototype 身份，不是名字）；原型不可判时降 boolean（不得 exact true）；
 * RHS 的 `prototype` 为非对象时按 spec 抛 TypeError。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛面探针：throws 是 brand 且 name 匹配 */
function threw(src: string, name: string): boolean {
  return throwsError(call(src, "f").throws, name);
}

describe("原型被改写后 instanceof 不得折 exact true", () => {
  it("函数构造器实例：Object.setPrototypeOf(f, null) → false", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,null); return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("类实例：Object.setPrototypeOf(a, null) → false", () => {
    expect(
      v(wrap(`class A{} const a=new A(); Object.setPrototypeOf(a,null); return a instanceof A;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("负控制：未改写原型的实例仍折 exact true", () => {
    expect(v(wrap(`function F(){} const f=new F(); return f instanceof F;`))).toEqual({
      ok: true,
      value: true,
    });
    expect(v(wrap(`class A{} const a=new A(); return a instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：派生类实例 instanceof 父类 → true", () => {
    expect(v(wrap(`class A{} class B extends A{} const b=new B(); return b instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：原型对象 instanceof 自身 → false；instanceof 父类 → true", () => {
    expect(v(wrap(`class A{} return A.prototype instanceof A;`))).toEqual({ ok: true, value: false });
    expect(v(wrap(`class A{} class B extends A{} return B.prototype instanceof A;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("F.prototype = {} 之后 f instanceof F → false（实例记录真实 [[Prototype]]）", () => {
    expect(
      v(wrap(`function F(){} const f=new F(); F.prototype={}; return f instanceof F;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("F.prototype = 5 之后 f instanceof F → TypeError（RHS prototype 非对象）", () => {
    expect(
      threw(
        wrap(`function F(){} const f=new F(); F.prototype=5; return f instanceof F;`),
        "TypeError",
      ),
    ).toBe(true);
  });

  it("换原型前造的旧实例与换后造的新实例可区分（原生 \"false|true\"）", () => {
    expect(
      v(
        wrap(
          `function F(){} const f=new F(); F.prototype={x:1}; const g=new F(); return (f instanceof F)+"|"+(g instanceof F);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false|true" });
  });

  it("原型替换后新造的实例仍 instanceof 构造器 → true", () => {
    expect(
      v(wrap(`function F(){} F.prototype={}; const g=new F(); return g instanceof F;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("原型替换写成 null → TypeError（RHS prototype 非对象）", () => {
    expect(
      threw(wrap(`function F(){} const f=new F(); F.prototype=null; return f instanceof F;`), "TypeError"),
    ).toBe(true);
  });

  it("setPrototypeOf 到普通对象后不再折 exact true（原型链不可判 → 降 boolean）", () => {
    const r = call(
      wrap(`function F(){} const f=new F(); Object.setPrototypeOf(f,{}); return f instanceof F;`),
      "f",
    );
    // 原生 false；引擎不得折 exact true（链不可判 → boolean），也不得折
    // exact false（那需要「替换进来的原型」的 [[Prototype]] 链可判）
    expect(litValue(r.result)).not.toEqual({ ok: true, value: true });
    expect(litValue(r.result)).not.toEqual({ ok: true, value: false });
  });

  it("负控制：原型替换后 fn 仍可调用、prototype 读回是新原型", () => {
    expect(v(wrap(`function F(){ return 7; } F.prototype={}; return F();`))).toEqual({
      ok: true,
      value: 7,
    });
  });
});
});
});

// ---------------------------------------------------------------------------
// 类值的 prototype 不可写：写必抛 strict TypeError
// ---------------------------------------------------------------------------
describe("类值的 prototype 不可写：写必抛 strict TypeError", () => {
/**
 * 回归：类值的 `prototype` 是**不可写** own property——
 * `A.prototype = {}` 在 strict 下原生定抛 TypeError。
 *
 * ES 语义（ClassDefinitionEvaluation）：类定义的 `prototype` 属性是
 * `{writable: false, enumerable: false, configurable: false}` 的 own
 * property——给类重新指派原型在 strict 下抛 TypeError（模块/类体恒 strict）。
 *
 * 修复前：类值走通用槽写（brand inner 落一个 "prototype" 槽）——写穿无声，
 * 类照常工作，「换原型」这件事在引擎侧完全无感（既不抛，也不改行为面）。
 *
 * 不变量（负控制钉住）：
 * - 类实例面 / 原型面照常可写（`A.prototype.m = 1` 是原型对象的普通写）；
 * - `Object.defineProperty(C.prototype, ...)` 的**就地改原型**写回不受本门影响；
 * - 类的静态成员写照常（`A.x = 1`）；
 * - 子类 `extends` 的类值同样不可写原型。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_13(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("类值的 prototype 不可写：写必抛 strict TypeError", () => {
  it("A.prototype = {} → TypeError（catch 吸收）", () => {
    const src = wrap(`class A {} try { A.prototype = {}; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("A.prototype = {} 无 catch → 函数抛 TypeError（throws 面）", () => {
    expect(throwName(wrap(`class A {} A.prototype = {}; return "ok";`))).toBe("TypeError");
  });

  it("写穿后类的实例方法仍在（写没生效）", () => {
    const src = wrap(
      `class A { m(){} } try { A.prototype = {}; const a = new A(); return typeof a.m; } catch (e) { return "threw:" + e.constructor.name; }`,
    );
    expect(v(src)).toEqual({ ok: true, value: "threw:TypeError" });
  });

  it("子类（extends）同样不可写原型", () => {
    const src = wrap(`class B {} class S extends B {} try { S.prototype = {}; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("有体类表达式的原型同样不可写", () => {
    const src = wrap(`const C = class { m(){} }; try { C.prototype = {}; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });
});

describe("负控制：原型对象面 / 静态面 / defineProperty 写回不回归", () => {
  it("原型对象上的普通写不受影响（A.prototype.m = 1 → 读回 1）", () => {
    const src = wrap(`class A {} A.prototype.m = 1; return A.prototype.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("类的静态成员写照常（A.x = 1）", () => {
    const src = wrap(`class A {} A.x = 1; return A.x;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("静态方法写不受影响", () => {
    const src = wrap(`class A { static m(){} } A.m = 1; return A.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("Object.defineProperty(C.prototype, ...) 的就地改原型写回不受本门影响", () => {
    const src = wrap(`class C {} Object.defineProperty(C.prototype, "m", { value: 4 }); return C.prototype.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 4 });
  });

  it("读 A.prototype 仍是原型对象（读面不受写门影响）", () => {
    const src = wrap(`class A {} return typeof A.prototype;`);
    expect(v(src)).toEqual({ ok: true, value: "object" });
  });

  it("实例字段写不受影响", () => {
    const src = wrap(`class A { constructor(){ this.n = 1; } } return new A().n;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });
});
});

// ---------------------------------------------------------------------------
// 内建父类子类实例的内建原型面
// ---------------------------------------------------------------------------
describe("内建父类子类实例的内建原型面", () => {
/**
 * 回归：内建父类（`class M extends Set/Map/Date/…`）的**实例**必须
 * 读得到内建原型面（方法值读 / `@@iterator` / `size`）。
 *
 * ES 语义：派生类实例的 [[Prototype]] 是内建父类的.prototype ⇒ 内建方法
 * （`s.add`）经原型链可见。
 *
 * 修复前：`constructClass` 的「宿主内建父」臂把内建 brand 嫁接到**派生类名**
 * 的新 Abs 上 ⇒ 值读路径按 `o.shape.name` 直查内建方法表（`BUILTIN_BRAND_METHODS["M"]`
 * 不存在）→ 折 exact `"undefined"`；而 `in` 面走 `brandHasProtoMember`
 * （沿 `evalClassChain`）→ 折 true —— 同一对象两面自相矛盾。
 *
 * 修复：值读按**类链**解析内建 owner（与 `in` 面同口径）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_14(call(src, "f").result);
}

describe("内建父类子类实例的内建原型面", () => {
  it("Set / Map / WeakMap 子类实例读得到内建方法", () => {
    expect(v(wrap(`class M extends Set {} const s = new M([1,2]); return String(typeof s.add);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends Map {} const m = new M([["a",1]]); return String(typeof m.get);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends WeakMap {} const w = new M(); return String(typeof w.get);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("Date / RegExp 子类实例读得到内建方法", () => {
    expect(v(wrap(`class M extends Date {} const d = new M(0); return String(typeof d.getTime);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends RegExp {} const r = new M("a"); return String(typeof r.test);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("prim 包装父类（Number / String）子类实例读得到原型方法", () => {
    expect(v(wrap(`class M extends Number {} const n = new M(5); return String(typeof n.toFixed);`))).toEqual({
      ok: true,
      value: "function",
    });
    expect(v(wrap(`class M extends String {} const s = new M("ab"); return String(typeof s.toUpperCase);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("@@iterator：子类实例经原型链继承（typeof → function）", () => {
    expect(v(wrap(`class M extends Set {} const s = new M(); return String(typeof s[Symbol.iterator]);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("读面与 in 面一致（不再「in 说有、读说 undefined」）", () => {
    const src = wrap(`class M extends Set {} const s = new M(); return String("add" in s) + ":" + String(typeof s.add);`);
    expect(v(src)).toEqual({ ok: true, value: "true:function" });
  });

  it("size 不再折 exact undefined（集合状态丢失时诚实降级为 number）", () => {
    expect(v(wrap(`class M extends Set {} const s = new M([1,2]); return String(s.size === undefined);`))).toEqual({
      ok: true,
      value: "false",
    });
    expect(v(wrap(`class M extends Set {} const s = new M([1,2]); return String(typeof s.size);`))).toEqual({
      ok: true,
      value: "number",
    });
  });

  it("派生类自己定义的同名成员优先（原生覆盖内建）", () => {
    expect(v(wrap(`class M extends Set { add(x) { return 42; } } const s = new M(); return String(s.add(1));`))).toEqual({
      ok: true,
      value: "42",
    });
  });

  it("负控制：内建父类本身的实例面不变", () => {
    expect(v(wrap(`const s = new Set([1,2]); return String(typeof s.add) + ":" + String(s.size);`))).toEqual({
      ok: true,
      value: "function:2",
    });
  });

  it("负控制：用户类父的子类实例面不变", () => {
    expect(v(wrap(`class A { m() { return 1; } } class B extends A {} return String(typeof new B().m);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
});

// ---------------------------------------------------------------------------
// 内建原型对象上的自有写优先于内建方法表（调用面）
// ---------------------------------------------------------------------------
describe("内建原型对象上的自有写优先于内建方法表（调用面）", () => {
/**
 * 回归：内建**原型对象**上的写被**内建方法表遮蔽**——读面 / 调用面
 * 都不认用户的改写（改成非函数也不抛 TypeError）。
 *
 * 修复前：`Array.prototype.push = function(){ return 99; }; [1].push(2)` → 2
 * （内建方法表直接命中，用户的写被完全遮蔽）；原生 → 99。改成非函数时
 * `[1].push(2)` 也不抛（原生定抛 TypeError：`Array.prototype.push is not a
 * function`）。
 *
 * 修法（packages/core/src/algebra/exec/class/invoke.ts）：调用面按原生属性
 * 查找序（own → prototype）——接收者自身没有同名自有槽时，内建原型链上的
 * **自有写**优先于内建方法实现；改写为非函数则定抛 TypeError。
 * 读面（packages/core/src/algebra/exec/runtime/containers/member.ts 的
 * `.prototype` 臂）：同样按 own → prototype——原型对象上的**自有槽**优先于
 * 内建方法表（否则读回内建实现，借用面也拿内建版）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_15(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

// 内建原型对象是**进程级单例**——本文件对它们的改写会漏进后续用例
// （原生里原型对象也是全局单例，但每个用例是独立进程/独立 realm）。
// 用例后把改写删掉，保持用例间隔离。
afterEach(() => {
  call(
    wrap(
      `delete Array.prototype.push; delete Array.prototype.join; delete Map.prototype.get;` +
        ` delete String.prototype.toUpperCase; delete Number.prototype.toFixed;` +
        ` delete Object.prototype.toString; return 1;`,
    ),
    "f",
  );
});

describe("内建原型对象上的自有写优先于内建方法表（调用面）", () => {
  it("Array.prototype.push 改写后 → 数组实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Array.prototype.push = function(){ return 99; }; const a = [1]; return a.push(2);`)),
    ).toEqual({ ok: true, value: 99 });
  });

  it("Array.prototype.join 改写后 → 数组实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Array.prototype.join = function(){ return "P"; }; return [1,2].join(",");`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("Map.prototype.get 改写后 → 实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Map.prototype.get = function(){ return "P"; }; const m = new Map([["a",1]]); return m.get("a");`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("String.prototype.toUpperCase 改写后 → 字符串实例调用走用户写的实现", () => {
    expect(
      v(wrap(`String.prototype.toUpperCase = function(){ return "P"; }; return "a".toUpperCase();`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("Number.prototype.toFixed 改写后 → 数字实例调用走用户写的实现", () => {
    expect(
      v(wrap(`Number.prototype.toFixed = function(){ return "P"; }; return (1).toFixed(2);`)),
    ).toEqual({ ok: true, value: "P" });
  });

  it("Object.prototype.toString 改写后 → 闭对象调用走用户写的实现", () => {
    expect(
      v(wrap(`Object.prototype.toString = function(){ return "patched"; }; return ({}).toString();`)),
    ).toEqual({ ok: true, value: "patched" });
  });

  it("改写为非函数 → 调用定抛 TypeError（原生 is not a function）", () => {
    expect(
      v(wrap(`Array.prototype.push = 5; const a=[1]; try { a.push(2); } catch(e) { return e.constructor.name; }`)),
    ).toEqual({ ok: true, value: "TypeError" });
    expect(
      throwName(wrap(`Array.prototype.push = 5; const a=[1]; return a.push(2);`)),
    ).toBe("TypeError");
  });

  it("负控制：未改写时内建实现照旧（不误伤）", () => {
    expect(v(wrap(`return [1,2].join(",");`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`return "a".toUpperCase();`))).toEqual({ ok: true, value: "A" });
    expect(v(wrap(`const m = new Map([["a",1]]); return m.get("a");`))).toEqual({ ok: true, value: 1 });
  });

  it("负控制：原型对象上的普通数据槽（expand）照旧可读", () => {
    expect(
      v(wrap(`Array.prototype.myExpando = 5; return typeof Array.prototype.myExpando;`)),
    ).toEqual({ ok: true, value: "number" });
  });

  it("读面：Array.prototype.push 改写后 typeof → number（原生读回用户写的值）", () => {
    expect(
      v(wrap(`Array.prototype.push = 5; return typeof Array.prototype.push;`)),
    ).toEqual({ ok: true, value: "number" });
  });

  it("借用面：Array.prototype.join.call([1,2]) → 用户写的实现", () => {
    expect(
      v(
        wrap(
          `Array.prototype.join = function(){ return "P"; }; return String(Array.prototype.join.call([1,2]));`,
        ),
      ),
    ).toEqual({ ok: true, value: "P" });
  });
});
});

// ---------------------------------------------------------------------------
// Symbol.prototype.description 定抛 TypeError
// ---------------------------------------------------------------------------
describe("Symbol.prototype.description 定抛 TypeError", () => {
/**
 * 回归：`Symbol.prototype.description` 必须**定抛 TypeError**
 * （getter 的 thisSymbolValue brand check——`Symbol.prototype` 不是 symbol）。
 *
 * ES 语义：`Symbol.prototype.description` 是 Symbol.prototype 上的**自有
 * getter**（无 setter）；读它 → this 不是 symbol → TypeError。
 *
 * 修复前：漏槽 → 折 exact undefined（wrong-exact），且**不记 throws**
 * ——L2 门禁（entry may-throw）假绿：原生必抛的读被当成「读到 undefined」。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_16(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

describe("Symbol.prototype.description 定抛 TypeError", () => {
  const wrap = (body: string) => `export function f() { ${body} }`;
  const v = (src: string) => litValue(call(src, "f").result);
  const throwName = (src: string): string => {
    const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
    if (!t?.shape || t.shape.k === "never") return "";
    return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
  };
  it("prototype 读 description 抛；L2 记抛；实例与其它键负控", () => {
    expect(v(wrap(`try { return String(Symbol.prototype.description); } catch(e) { return e.constructor.name; }`))).toEqual({ ok: true, value: "TypeError" });
    expect(throwsError(call(wrap(`return Symbol.prototype.description;`), "f").throws, "TypeError")).toBe(true);
    expect(v(wrap(`return String(Symbol("x").description);`))).toEqual({ ok: true, value: "x" });
    expect(v(wrap(`return String(typeof Symbol.prototype.valueOf);`))).toEqual({ ok: true, value: "function" });
    expect(throwName(wrap(`return typeof Symbol.prototype.toString;`))).toBe("");
  });
});
;
});

// ---------------------------------------------------------------------------
// prim 读不存在的成员 → undefined（不是 unknown）
// ---------------------------------------------------------------------------
describe("prim 读不存在的成员 → undefined（不是 unknown）", () => {
/**
 * 回归：number / boolean / bigint **原始值**读不存在的成员 →
 * 原生 undefined（不是 unknown），且**后续读该值**记 may-throw TypeError。
 *
 * ES 语义：原始值的属性访问走 `ToObject(v)` 后的 [[Get]]——原型链上没有
 * 该键 → undefined（不抛）。`5..foo` → undefined；`5..foo.bar` → 读
 * undefined 的成员 → TypeError（undefined/null 的 [[Get]] 必抛）。
 *
 * 修复前：这类 prim 无「确定缺失」臂 → 一路落尾部 unknown 接收者分支：
 * 既折了错值（unknown 而非 undefined），又**丢掉 may-throw**（unknown 接收者
 * 不记 throws）⇒ `n.foo.bar` 不记 TypeError ⇒ **L2 门禁假绿**（引擎声称
 * 「保证不抛」，原生确定抛）。
 *
 * 不变量（负控制钉住）：
 * - string prim 早有同款语义（不回归）；
 * - prim 自己的原型方法照常可读可调（toFixed / toString …）；
 * - Object.prototype 继承名（toString / valueOf / hasOwnProperty）不是
 * 「确定缺失」；
 * - 对象（obj）面的缺失成员读语义不受影响。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_17(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("prim 读不存在的成员 → undefined（不是 unknown）", () => {
  const v = (src: string) => litValue___nudojs_core_17(call(src, "f").result);
  const throwName = (src: string): string => {
    const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
    if (!t?.shape || t.shape.k === "never") return "";
    return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
  };
  const wrap = (body: string) => `export function f() { ${body} }`;
  it("number/boolean/bigint/属性读缺失 → undefined；后续读记 TypeError；string 同款", () => {
    for (const body of [`const n = 5; return n.foo;`, `const b = true; return b.foo;`, `const g = 1n; return g.foo;`, `const o = {a:1}; return o.a.b;`]) {
      expect(v(wrap(body)), body).toEqual({ ok: true, value: undefined });
    }
    for (const body of [`const n = 5; return n.foo.bar;`, `const b = true; return b.foo.bar;`, `const g = 1n; return g.foo.bar;`, `const o = {a:1}; return o.a.b.c;`, `const s = "ab"; return s.foo.bar;`]) {
      expect(throwName(wrap(body)), body).toBe("TypeError");
    }
  });
  it("负控：prim 原型方法/继承名/对象面不变", () => {
    expect(v(wrap(`const n = 5; return n.toFixed(2);`))).toEqual({ ok: true, value: "5.00" });
    expect(v(wrap(`const n = 5; return typeof n.toString;`))).toEqual({ ok: true, value: "function" });
    expect(v(wrap(`const n = 5; return n.valueOf();`))).toEqual({ ok: true, value: 5 });
    expect(v(wrap(`const n = 5; return n.constructor.name;`))).toEqual({ ok: true, value: "Number" });
    expect(v(wrap(`const o = {a:1}; return o.zzz;`))).toEqual({ ok: true, value: undefined });
    expect(throwName(wrap(`const o = {a:1}; return o.zzz.yy;`))).toBe("TypeError");
    expect(v(wrap(`const a = [1,2]; return a[0];`))).toEqual({ ok: true, value: 1 });
  });
});
;

;

;
});

// ---------------------------------------------------------------------------
// Symbol 实例的 toString / toLocaleString 走 Symbol.prototype
// ---------------------------------------------------------------------------
describe("Symbol 实例的 toString / toLocaleString 走 Symbol.prototype", () => {
/**
 * 回归：Symbol 实例上的 `toString` / `toLocaleString` 解析到
 * **Symbol.prototype 自己的面**（带 brand check），不是 Object.prototype 泛型版。
 *
 * ES 语义：
 * - `Symbol.prototype.toString` 是 Symbol.prototype **自有**方法（thisSymbolValue
 * brand check）——借用调用非 symbol 接收者定抛 TypeError
 * （`Symbol().toString.call(1)` 抛）；返回 "Symbol(desc)"；
 * - `Symbol.prototype.valueOf` 自有（brand check）——返回符号自身；
 * - `Symbol.prototype.toLocaleString` **不存在**（继承 Object.prototype 的
 * toLocaleString → ToObject(this).toString()）——symbol 接收者得 "Symbol(desc)"。
 *
 * 修复前：这些成员值读落 Object.prototype 泛型版（**无 brand check**）→
 * 错值 "[object Number]" / "[object Symbol]"，且借用调用漏抛 TypeError。
 *
 * 不变量（负控制钉住）：
 * - Symbol.prototype 上的直呼（callAbsMethod 臂）语义不变；
 * - number / string / boolean 的 toString 调用面不变；
 * - Symbol.prototype.toString.call(1) 仍抛（原生同款，负控制钉住 brand check）；
 * - Object.prototype.toString 的泛型面不受影响。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_18(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Symbol 实例的 toString / toLocaleString 走 Symbol.prototype", () => {
  it("Symbol('x').toString() → \"Symbol(x)\"", () => {
    expect(v(wrap(`return Symbol("x").toString();`))).toEqual({ ok: true, value: "Symbol(x)" });
  });

  it("Symbol('x').toLocaleString() → \"Symbol(x)\"（不是 \"[object Symbol]\"）", () => {
    expect(v(wrap(`return Symbol("x").toLocaleString();`))).toEqual({ ok: true, value: "Symbol(x)" });
  });

  it("Symbol().toString.call(1) → TypeError（brand check 不再丢）", () => {
    const src = wrap(`try { return Symbol().toString.call(1); } catch (e) { return "caught:" + e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "caught:TypeError" });
  });

  it("Symbol.prototype.toString.call(1) → TypeError（负控制：原生同款）", () => {
    const src = wrap(`try { return Symbol.prototype.toString.call(1); } catch (e) { return "caught:" + e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "caught:TypeError" });
  });

  it("typeof Symbol().toString → \"function\"", () => {
    expect(v(wrap(`return typeof Symbol().toString;`))).toEqual({ ok: true, value: "function" });
  });

  it("Symbol('x').valueOf() 仍是符号自身（既有语义）", () => {
    const src = wrap(`const s = Symbol("x"); return s.valueOf() === s;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: true });
  });
});

describe("负控制：其它 prim 的 toString / 泛型 Object.prototype 面不回归", () => {
  it("(5).toString() → \"5\"", () => {
    expect(v(wrap(`return (5).toString();`))).toEqual({ ok: true, value: "5" });
  });

  it("\"ab\".toString() → \"ab\"", () => {
    expect(v(wrap(`return "ab".toString();`))).toEqual({ ok: true, value: "ab" });
  });

  it("true.toString() → \"true\"", () => {
    expect(v(wrap(`return true.toString();`))).toEqual({ ok: true, value: "true" });
  });

  it("Object.prototype.toString.call({}) → \"[object Object]\"（泛型面不受影响）", () => {
    expect(v(wrap(`return Object.prototype.toString.call({});`))).toEqual({
      ok: true,
      value: "[object Object]",
    });
  });

  it("Object.prototype.toString.call([]) → \"[object Array]\"（泛型面不受影响）", () => {
    expect(v(wrap(`return Object.prototype.toString.call([]);`))).toEqual({
      ok: true,
      value: "[object Array]",
    });
  });

  it("Symbol('x').description → \"x\"（既有语义）", () => {
    expect(v(wrap(`return Symbol("x").description;`))).toEqual({ ok: true, value: "x" });
  });
});
});

// ---------------------------------------------------------------------------
// sealed 数组 length 截断写 / mutator
// ---------------------------------------------------------------------------
describe("sealed 数组 length 截断写 / mutator", () => {
/**
 * `Object.seal` 过的数组——截断型 `length` 写 / `pop()` / `shift()`
 * 不抛 TypeError（原生硬抛）。
 *
 * 修法（containers/member.ts 的 $set length 写面 + exec/runtime/array-length.ts）：
 * sealed 数组的 length **截断**写要删除被截掉的元素（sealed 的元素是不可
 * 配置自有属性）→ 原生 TypeError；增长合法（只新增 hole）。
 * preventExtensions（nonext）**不**冻结元素 → 截断不抛（node 实测）。
 *
 * pop()/shift() 的 sealed 门在 `containers/arr-methods.ts`
 * （$arrMutContainer，r22-s14 分片补上）：sealed 数组的元素是不可配置自有
 * 属性 → 删除即 TypeError；**空数组原生不抛**（不删任何属性）；空洞（hole）
 * 不是自有属性 → 删它不抛（`Object.seal([1,,]).pop()` 原生不抛），但 shift
 * 把后续元素前移到空洞位 → 在不可扩展数组上新增自有属性 → 抛
 * （`Object.seal([,,3]).shift()` 原生抛）。
 */




function v(src: string) {
  return litValue___nudojs_core_19(call(src, "f").result);
}

function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("sealed 数组 length 截断写 / mutator", () => {
  it("sealed 截断/pop/shift 抛；增长/同长/未 seal/preventExtensions/frozen 口径", () => {
    for (const body of [
      `const a = [1, 2, 3]; Object.seal(a); a.length = 1; return "nothrow";`,
      `const a = [1, 2, 3]; Object.freeze(a); a.length = 1; return "nothrow";`,
      `const a = [1, 2, 3]; Object.seal(a); a.push(4); return "nothrow";`,
      `const a = [1, 2, 3]; Object.seal(a); a.pop(); return "nothrow";`,
      `const a = [1, 2, 3]; Object.seal(a); a.shift(); return "nothrow";`,
      `const a = [, , 3]; Object.seal(a); a.shift(); return "nothrow";`,
    ]) expect(threw(`export function f() { ${body} }`), body).toBe(true);
    expect(v(`export function f() { const a = [1, 2, 3]; Object.seal(a); a.length = 5; return a.length; }`)).toEqual({ ok: true, value: 5 });
    expect(threw(`export function f() { const a = [1, 2, 3]; Object.seal(a); a.length = 3; return "nothrow"; }`)).toBe(false);
    expect(v(`export function f() { const a = [1, 2, 3]; a.length = 1; return a.length; }`)).toEqual({ ok: true, value: 1 });
    expect(v(`export function f() { const a = [1, 2, 3]; Object.preventExtensions(a); a.length = 1; return a.length; }`)).toEqual({ ok: true, value: 1 });
    expect(v(`export function f() { const a = [1, 2, 3]; a.pop(); return a.length; }`)).toEqual({ ok: true, value: 2 });
    expect(v(`export function f() { const a = []; Object.seal(a); a.pop(); return a.length; }`)).toEqual({ ok: true, value: 0 });
    expect(v(`export function f() { const a = []; Object.seal(a); a.shift(); return a.length; }`)).toEqual({ ok: true, value: 0 });
    expect(v(`export function f() { const a = [1, 2]; Object.preventExtensions(a); a.pop(); a.shift(); return a.length; }`)).toEqual({ ok: true, value: 0 });
    expect(v(`export function f() { const a = [1, ,]; Object.seal(a); a.pop(); return a.length; }`)).toEqual({ ok: true, value: 1 });
  });
});
;
});

// ---------------------------------------------------------------------------
// getter-only 静态访问器的写定抛 strict TypeError
// ---------------------------------------------------------------------------
describe("getter-only 静态访问器的写定抛 strict TypeError", () => {
/**
 * 回归：getter-only **静态**访问器的写不抛 strict TypeError。
 *
 * ES 语义（ClassStaticElement / Set）：类定义体恒 strict——`A.g = v`（g 是
 * static getter，无 static setter）原生定抛 TypeError（与实例面
 * `a.g = v` 同款）。getter-only 的静态访问器是**不可写**的（无 setter ⇒
 * Set 走 OrdinarySetWithOwnDescriptor → 描述符无 setter ⇒ 抛）。
 *
 * 修复前：$set 的类值分支 `sacc.set ? sacc.set(o, value) : o`——getter-only
 * 的静态访问器**静默吞写**（`o` 原样返回，写穿无声、读值不变），而实例面
 * 同款访问器是定抛 TypeError（两面不一致）。
 *
 * 不变量（负控制钉住）：
 * - 实例面 getter-only 访问器仍定抛（既有语义）；
 * - static getter **配** setter 时写照常走 setter；
 * - static getter 读仍得 getter 值；
 * - 静态数据属性写照常（`A.x = 1`）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_20(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("getter-only 静态访问器的写定抛 strict TypeError", () => {
  it("A.g = 5（static getter-only）→ TypeError（catch 吸收）", () => {
    const src = wrap(`class A { static get g(){ return 1; } } try { A.g = 5; return "no-throw"; } catch (e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("A.g = 5 无 catch → 函数抛 TypeError（throws 面）", () => {
    expect(throwName(wrap(`class A { static get g(){ return 1; } } A.g = 5; return "ok";`))).toBe("TypeError");
  });

  it("写抛后 getter 值不变（仍 1）", () => {
    const src = wrap(`class A { static get g(){ return 1; } } try { A.g = 5; } catch (e) {} return A.g;`);
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });
});

describe("负控制：实例面 / 带 setter 的静态面 / 静态数据属性不回归", () => {
  it("实例面 getter-only 仍定抛（既有语义）", () => {
    expect(throwName(wrap(`class A { get g(){ return 1; } } const a = new A(); a.g = 5; return "ok";`))).toBe(
      "TypeError",
    );
  });

  it("static getter 配 setter → 写走 setter（不抛）", () => {
    const src = wrap(`class A { static get g(){ return 1; } static set g(v){} } A.g = 5; return "ok";`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: "ok" });
  });

  it("static getter 读仍得 getter 值", () => {
    expect(v(wrap(`class A { static get g(){ return 1; } } return A.g;`))).toEqual({ ok: true, value: 1 });
  });

  it("静态数据属性写照常（A.x = 1）", () => {
    const src = wrap(`class A {} A.x = 1; return A.x;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });

  it("静态方法写照常", () => {
    const src = wrap(`class A { static m(){} } A.m = 1; return A.m;`);
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 1 });
  });
});
});

// ---------------------------------------------------------------------------
// for (let i) 的 continue 之前的循环变量写不得丢弃
// ---------------------------------------------------------------------------
describe("for (let i) 的 continue 之前的循环变量写不得丢弃", () => {
/**
 * 回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对
 * 循环变量的写不得被丢弃。
 *
 * 修复前：循环变量是**状态线程形参**（`(i) => { … return i; }`），体对它的写
 * 留在形参槽里；`continue` 抛信号跳出体 ⇒ 体的 `return i` 不执行 ⇒ `$for` 的
 * continue 臂只能拿「体入口的旧 state」⇒ 迭代次数与结果全错
 * （`for (var i)` 走 fallback 路径、循环变量是真绑定 ⇒ 行为分叉）。
 * `for (let i=0;i<3;i++){ c=c+1; i=5; continue; }` 原生 c=1，修复前 c=3。
 *
 * 修复后：体用 try/finally 把「体退出瞬间的循环变量最新写」写回共享槽，
 * `$for` 的 continue 臂经 `loopVar` 回调取用 ⇒ 步进基于本轮真实值
 * （原生：for (let i…) 每轮绑定独立，continue 前的 `i = 5` 写进本轮绑定
 * ⇒ 下一轮 i++ 得 6 ⇒ 6 < 3 为假 ⇒ 只跑 1 轮）。
 *
 * 负控制钉住：① `for (var i)` 路径不变；② 无写时 continue 行为不变；
 * ③ 不带 continue 的写仍生效（步进基于最新值）；④ break 路径不变。
 */




/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string): unknown {
  const r = call(`export function f() { ${body} }`, "f");
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}

describe("for (let i) 的 continue 之前的循环变量写不得丢弃", () => {
  it("continue 之前的写生效：只跑 1 轮", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; continue; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("continue 之前的写生效（条件 continue 形态）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; if(c<9){ continue; } } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("continue 之前的写生效（累加形态）", () => {
    const body = `let s=0; for(let i=0;i<4;i++){ s=s+i; i=i+2; continue; } return s;`;
    expect(native(body)).toBe(3);
    expect(engine(body)).toBe(3);
  });

  it("continue 之前的写生效（if 臂内 continue）", () => {
    const body = `let c=0; for(let i=0;i<5;i++){ if(i===1){ i=9; continue; } c=c+1; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：for (var i) 路径不变（循环变量是真绑定）", () => {
    const body = `let c=0; for(var i=0;i<3;i++){ c=c+1; i=5; continue; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：无写时 continue 行为不变（跑满 3 轮）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; continue; } return c;`;
    expect(native(body)).toBe(3);
    expect(engine(body)).toBe(3);
  });

  it("负控制：不带 continue 的写仍生效（步进基于最新值）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：break 路径不变（退出循环，计数停在 break 点）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; break; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：同块多个 for 循环不互相污染（捕获槽唯一）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; continue; } for(let j=0;j<3;j++){ c=c+1; } return c;`;
    expect(native(body)).toBe(4);
    expect(engine(body)).toBe(4);
  });
});
});

// ---------------------------------------------------------------------------
// [merged] delete-array-length
// ---------------------------------------------------------------------------
describe("delete-array-length", () => {
  const v = (src: string) => litValue(call(src, "f").result);
  const threw = (src: string, name = "TypeError"): boolean => {
    const r = call(src, "f");
    return isNever(r.result) && throwsError(r.throws, name);
  };
  it("delete a.length 各通道抛；元素/普通属性/不存在/普通 length/frozen 负控", () => {
    for (const body of [
      `const a = [1, 2, 3]; const r = delete a.length; return [r, a.length];`,
      `const a = [1, 2, 3]; delete a.length; return a.length;`,
      `const a = [1, 2, 3]; const r = delete a["length"]; return [r, a.length];`,
      `const a = [1, 2, 3]; Object.preventExtensions(a); delete a.length; return "nothrow";`,
      `const o = Object.freeze({ x: 1 }); delete o.x; return "nothrow";`,
    ]) expect(threw(`export function f() { ${body} }`), body).toBe(true);
    for (const body of [
      `const a = [1, 2, 3]; const r = delete a[0]; return r;`,
      `const o = { x: 1 }; const r = delete o.x; return r;`,
      `const o = { x: 1 }; const r = delete o.zzz; return r;`,
      `const o = { length: 5 }; const r = delete o.length; return r;`,
    ]) expect(v(`export function f() { ${body} }`), body).toEqual({ ok: true, value: true });
  });
  it("Proxy [[Delete]] 不变量与字符串 length 门；负控", () => {
    expect(threw(`export function f() {
      const t = {};
      Object.defineProperty(t, "x", { value: 1, configurable: false });
      const p = new Proxy(t, { deleteProperty: () => true });
      Reflect.deleteProperty(p, "x");
      return "no-throw";
    }`)).toBe(true);
    expect(v(`export function f() {
      const t = { x: 1 };
      const p = new Proxy(t, { deleteProperty: () => true });
      return String(Reflect.deleteProperty(p, "x"));
    }`)).toEqual({ ok: true, value: "true" });
    expect(v(`export function f() {
      const t = {};
      const p = new Proxy(t, { deleteProperty: () => true });
      return String(Reflect.deleteProperty(p, "nope"));
    }`)).toEqual({ ok: true, value: "true" });
    expect(v(`export function f() {
      const t = {};
      Object.defineProperty(t, "x", { value: 1, configurable: false });
      const p = new Proxy(t, { deleteProperty: () => false });
      return String(Reflect.deleteProperty(p, "x"));
    }`)).toEqual({ ok: true, value: "false" });
    expect(threw(`export function f() {
      const t = {};
      Object.defineProperty(t, "x", { value: 1, configurable: false });
      const p = new Proxy(t, { deleteProperty: () => true });
      delete p.x;
      return "no-throw";
    }`)).toBe(true);
    expect(v(`export function f() {
      const t = { x: 1 };
      const p = new Proxy(t, { deleteProperty: () => true });
      return String(delete p.x);
    }`)).toEqual({ ok: true, value: "true" });
    expect(v(`export function f() {
      const t = {};
      const p = new Proxy(t, { deleteProperty: () => true });
      return String(delete p.nope);
    }`)).toEqual({ ok: true, value: "true" });
    expect(threw(`export function f() {
      const t = {};
      Object.defineProperty(t, "x", { value: 1, configurable: false });
      const p = new Proxy(t, { deleteProperty: () => false });
      delete p.x;
      return "no-throw";
    }`)).toBe(true);
    expect(threw(`export function f() {
      const s = "ab";
      delete s.length;
      return "no-throw";
    }`)).toBe(true);
    expect(threw(`export function f() {
      const a = [1, 2];
      delete a.length;
      return "no-throw";
    }`)).toBe(true);
    expect(threw(`export function f() {
      const s = "ab";
      delete s.other;
      return "no-throw";
    }`)).toBe(false);
  });
});
;

// ---------------------------------------------------------------------------
// 类值的 constructor 是内建 Function
// ---------------------------------------------------------------------------
describe("类值的 constructor 是内建 Function", () => {
/**
 * 回归：类值（class 声明 / 有体类表达式）的 `constructor` 槽解析成
 * **内建 Function**（原生 `Widget.constructor === Function`、`.name` 是
 * "Function"），不是「以类名命名的内建构造器」。
 *
 * ES 语义：类构造器的 [[Prototype]] 是 Function.prototype ⇒ `constructor`
 * 继承自那里 = 内建 Function（与函数声明、箭头函数同款）。
 *
 * 修复前：$get 的 constructor 分支对类值走 `builtinCtorAbs(类名)`——一个
 * 「以类名命名的内建构造器」brand：`Widget.constructor === Function` 折
 * **确定 false**（自信错值）、`.constructor.name` 折类名 "Widget"（原生
 * "Function"）。
 *
 * 不变量（负控制钉住）：
 * - 实例面 / 原型面的 constructor 仍解析到类值本身（`new W().constructor === W`）；
 * - `Widget.constructor === Widget` 仍折 false；
 * - 内建 brand（Date / Error 等）的 constructor 解析不受影响。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_21(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("类值的 constructor 是内建 Function", () => {
  it("Widget.constructor === Function → true", () => {
    expect(v(wrap(`class Widget {} return Widget.constructor === Function;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Widget.constructor.name → \"Function\"", () => {
    expect(v(wrap(`class Widget {} return Widget.constructor.name;`))).toEqual({
      ok: true,
      value: "Function",
    });
  });

  it("子类的 constructor 同样是 Function", () => {
    expect(v(wrap(`class Base {} class Sub extends Base {} return Sub.constructor === Function;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("有体类表达式的 constructor 同样是 Function", () => {
    expect(v(wrap(`const C = class Inner { m(){} }; return C.constructor === Function;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("typeof Widget.constructor → \"function\"", () => {
    expect(v(wrap(`class Widget {} return typeof Widget.constructor;`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});

describe("负控制：实例面 / 原型面 / 内建 brand 的 constructor 不回归", () => {
  it("new Widget().constructor === Widget → true（实例面解析到类值）", () => {
    expect(v(wrap(`class Widget {} return new Widget().constructor === Widget;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Widget.prototype.constructor === Widget → true", () => {
    expect(v(wrap(`class Widget {} return Widget.prototype.constructor === Widget;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Widget.constructor === Widget → false（不是同一个东西）", () => {
    expect(v(wrap(`class Widget {} return Widget.constructor === Widget;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("内建 brand（Date）的 constructor 仍解析到 Date", () => {
    expect(v(wrap(`return new Date(0).constructor === Date;`))).toEqual({ ok: true, value: true });
  });
});
});

// ---------------------------------------------------------------------------
// [merged] proxy-fresh-instance-mark
// ---------------------------------------------------------------------------
describe("proxy-fresh-instance-mark", () => {
// MERGED (topic-related bug pins): proxy-fresh-instance-mark + proxy-get-receiver
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>




describe("proxy-fresh-instance-mark", () => {
/**
 * 回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)`
 * 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。⇒ 引擎在**构造点**
 * （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的
 * `p === t` / `p1 === p2` 也**可判**（折 false）。
 *
 * 修复前：标只在 **Proxy 读面**懒打（首次经 Proxy 面读时）⇒ 不经任何
 * Proxy 面读的 `p === t` 不可判（结果非精确字面量）。
 *
 * 注：读面懒打（member.ts，S2b）保留为兜底——$set 后的新 Abs 会丢标，
 * 读面补打；本分片只做构造点打标这一半。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Proxy 新鲜实例标打在构造点（不经 Proxy 面读也可判）", () => {
  it("p === t → false（代理与靶不同引用，无需读 Proxy 面）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return p === t;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("p === t（别名传播后，仍不经 Proxy 面读）→ false", () => {
    expect(
      v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); const q = p; return p === t;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("p1 === p2（两个代理）→ false（每次 new Proxy 都是新对象）", () => {
    expect(
      v(wrap(`const t = { a: 1 }; const p1 = new Proxy(t, {}); const p2 = new Proxy(t, {}); return p1 === p2;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("p === p → true（同一代理自反）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return p === p;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("靶自反仍为 true（代理构造不污染靶的新鲜身份）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return t === t;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("无陷阱代理的读面仍走靶（S2b 读面口径不回归）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return p.a;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("无 get 陷阱时回退读靶、this 绑 receiver（proxy ≠ target）", () => {
    expect(
      v(wrap(`const t = { get a() { return this === t; } }; const p = new Proxy(t, {}); return p.a;`)),
    ).toEqual({ ok: true, value: false });
  });
});
});

describe("proxy-get-receiver", () => {
/**
 * 回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须
 * 绑到 **receiver（= proxy）**，不是 target。
 *
 * ES 语义（Proxy [[Get]]）：无 get 陷阱时 `proxy.[[Get]](P, key, Receiver)`
 * 转发 `target.[[Get]](P, key, Receiver)`——Receiver 一路传下去 ⇒ 靶上
 * getter 的 this 是 **proxy**（原生 `p.self`（this === t）折 false）。
 *
 * 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this
 * 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。
 *
 * 不变量（负控制钉住）：
 * - 有 get 陷阱时陷阱优先（实参 target/key/receiver 不变）；
 * - 直接读靶（不经 proxy）的 getter this 仍是靶（true）；
 * - 无 getter 的普通属性读穿透不变（p.x === 1）；
 * - Proxy 的 set 陷阱路径不受影响。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Proxy 无 get 陷阱：靶上 getter 的 this 是 proxy", () => {
  it("p.self（this === t）→ false（receiver = proxy）", () => {
    expect(v(wrap(`const t = { get self(){ return this === t; } }; const p = new Proxy(t, {}); return p.self;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("p.self === p → true（this 就是 proxy 自己）", () => {
    expect(
      v(wrap(`const t = { get self(){ return this; } }; const p = new Proxy(t, {}); return p.self === p;`)),
    ).toEqual({ ok: true, value: true });
  });
});

describe("负控制：直接读靶 / 有 get 陷阱 / 普通属性穿透不回归", () => {
  it("直接读靶：t.self（this === t）→ true（this 是靶）", () => {
    expect(v(wrap(`const t = { get self(){ return this === t; } }; return t.self;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("有 get 陷阱：陷阱优先（实参 target/key/receiver 不变）", () => {
    const src = wrap(
      `const t = { get self(){ return 1; } }; let seen = "?"; const p = new Proxy(t, { get(tg, k, r){ seen = (k === "self") ? "key-ok" : "key-bad"; return 42; } }); return p.self + "/" + seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "42/key-ok" });
  });

  it("无 getter 的普通属性读穿透不变（p.x === 1）", () => {
    expect(v(wrap(`const t = {x:1}; const p = new Proxy(t, {}); return p.x;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("无 getter 的普通属性写穿透不变（p.x = 2 → 靶变）", () => {
    const src = wrap(`const t = {x:1}; const p = new Proxy(t, {}); p.x = 2; return t.x;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
  });

  it("get 陷阱里的 receiver 仍是 proxy（this 语义不变）", () => {
    const src = wrap(
      `const t = {x:1}; let ok = "no"; const p = new Proxy(t, { get(tg, k, r){ ok = (r === p) ? "yes" : "no"; return 1; } }); p.x; return ok;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "yes" });
  });
});
});
});

// ---------------------------------------------------------------------------
// 内建原型对象上的字符串键成员值读
// ---------------------------------------------------------------------------
describe("内建原型对象上的字符串键成员值读", () => {
/**
 * 回归：内建**原型对象**上的字符串键成员值读必须取到原生值
 * （`RegExp.prototype.flags` / `Error.prototype.name` / …）。
 *
 * ES 语义：原型对象上的自有数据属性（RegExp.prototype.source === "(?:)"、
 * flags === ""、Error.prototype.name === "Error"、message === ""）与**实例面**
 * 取值不同（`/x/gim.flags === "gim"`），须分别建模。
 *
 * 修复前：内建方法/访问器表按**实例** brand 名建键 ⇒ 原型 brand 名（带
 * ".prototype" 后缀）必然查不到 → 落「内层闭 obj 槽 miss」→ 折 exact
 * undefined（wrong-exact）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_22(call(src, "f").result);
}

describe("内建原型对象上的字符串键成员值读", () => {
  it("RegExp 原型：source === \"(?:)\"、flags === \"\"", () => {
    expect(v(wrap(`return String(RegExp.prototype.source);`))).toEqual({
      ok: true,
      value: "(?:)",
    });
    expect(v(wrap(`return String(RegExp.prototype.flags);`))).toEqual({
      ok: true,
      value: "",
    });
  });

  it("RegExp 原型：global 等布尔 getter 在原型上读 undefined（原生同）", () => {
    expect(v(wrap(`return String(RegExp.prototype.global === undefined);`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("Error 家族原型：name / message 是原生值", () => {
    expect(v(wrap(`return String(Error.prototype.name);`))).toEqual({
      ok: true,
      value: "Error",
    });
    expect(v(wrap(`return String(Error.prototype.message);`))).toEqual({
      ok: true,
      value: "",
    });
    expect(v(wrap(`return String(TypeError.prototype.name);`))).toEqual({
      ok: true,
      value: "TypeError",
    });
  });

  it("Intl 原型上的自有方法是函数（resolvedOptions / formatToParts）", () => {
    for (const expr of [
      "Intl.NumberFormat.prototype.resolvedOptions",
      "Intl.NumberFormat.prototype.formatToParts",
      "Intl.DateTimeFormat.prototype.resolvedOptions",
      "Intl.Collator.prototype.resolvedOptions",
      "Intl.ListFormat.prototype.format",
    ]) {
      expect(v(wrap(`return String(typeof ${expr});`))).toEqual({
        ok: true,
        value: "function",
      });
    }
  });

  it("负控制：实例面不受影响（/x/gim.flags === \"gim\"）", () => {
    expect(v(wrap(`return String(/x/gim.flags);`))).toEqual({
      ok: true,
      value: "gim",
    });
    expect(v(wrap(`return String(new Error("m").name);`))).toEqual({
      ok: true,
      value: "Error",
    });
  });

  it("负控制：其它原型方法读仍是函数（缺席面不误伤）", () => {
    expect(v(wrap(`return String(typeof Array.prototype.map);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
});

// ---------------------------------------------------------------------------
// Map/Set.prototype.size 定抛 TypeError
// ---------------------------------------------------------------------------
describe("Map/Set.prototype.size 定抛 TypeError", () => {
/**
 * 回归：`Map.prototype.size` / `Set.prototype.size` 必须**定抛
 * TypeError**（getter 的 brand check——`Map.prototype` 不是 Map 实例）。
 *
 * ES 语义：`size` 是 Map.prototype / Set.prototype 上的**自有 getter**
 * （无 setter）；读原型对象上的它 → this 不是实例 → TypeError。
 *
 * 修复前：漏槽 → 折 exact undefined（wrong-exact），且**不记 throws**
 * ——L2 门禁（entry may-throw）假绿。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_23(call(src, "f").result);
}

describe("Map/Set.prototype.size 定抛 TypeError", () => {
  it("Map.prototype.size → TypeError", () => {
    const src = wrap(`try { return String(Map.prototype.size); } catch(e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("Set.prototype.size → TypeError", () => {
    const src = wrap(`try { return String(Set.prototype.size); } catch(e) { return e.constructor.name; }`);
    expect(v(src)).toEqual({ ok: true, value: "TypeError" });
  });

  it("throws 域记 TypeError（L2 门禁不再假绿）", () => {
    const rec = call(wrap(`return Map.prototype.size;`), "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：new Map().size → 0（实例面不受影响）", () => {
    expect(v(wrap(`return String(new Map().size);`))).toEqual({ ok: true, value: "0" });
  });

  it("负控制：new Set().size → 0（实例面不受影响）", () => {
    expect(v(wrap(`return String(new Set().size);`))).toEqual({ ok: true, value: "0" });
  });

  it("\"size\" in Map.prototype → true（原型上的自有访问器在 presence 面可见）", () => {
    expect(v(wrap(`return "size" in Map.prototype;`))).toEqual({ ok: true, value: true });
    expect(v(wrap(`return "size" in Set.prototype;`))).toEqual({ ok: true, value: true });
  });

  it("负控制：Map.prototype 上的方法面不受影响（typeof → \"function\"）", () => {
    expect(v(wrap(`return typeof Map.prototype.get;`))).toEqual({ ok: true, value: "function" });
  });
});
});

// ---------------------------------------------------------------------------
// Intl.<Sub>.prototype 的 brand-check getter 定抛 TypeError
// ---------------------------------------------------------------------------
describe("Intl.<Sub>.prototype 的 brand-check getter 定抛 TypeError", () => {
/**
 * 回归：`Intl.<Sub>.prototype` 上的 **brand-check getter** 读必须
 * **定抛 TypeError**（原生 getter 内 RequireInternalSlot(this, …)——this 是
 * 原型对象、不是实例）。
 *
 * 修复前：Intl 子构造器的 `.prototype` 此前连 brand 都不是（`fnProtoOf` 只装
 * constructor 一个槽的闭 obj）⇒ 成员读落槽 miss → 折 exact undefined 且
 * **不记 throws** ⇒ L2 门禁（entry may-throw）假绿：原生必抛的读被当成
 * 「读到 undefined」。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_24(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

describe("Intl.<Sub>.prototype 的 brand-check getter 定抛 TypeError", () => {
  it("Intl.NumberFormat.prototype.format → TypeError", () => {
    expect(throwName(wrap(`return Intl.NumberFormat.prototype.format;`))).toBe("TypeError");
    expect(
      v(wrap(`try { return String(typeof Intl.NumberFormat.prototype.format); } catch (e) { return e.constructor.name; }`)),
    ).toEqual({ ok: true, value: "TypeError" });
  });

  it("Intl.DateTimeFormat.prototype.format → TypeError", () => {
    expect(throwName(wrap(`return Intl.DateTimeFormat.prototype.format;`))).toBe("TypeError");
  });

  it("Intl.Collator.prototype.compare → TypeError", () => {
    expect(throwName(wrap(`return Intl.Collator.prototype.compare;`))).toBe("TypeError");
  });

  it("Intl.Locale.prototype.baseName → TypeError", () => {
    expect(throwName(wrap(`return Intl.Locale.prototype.baseName;`))).toBe("TypeError");
  });

  it("throws 域记 TypeError（L2 门禁不再假绿）", () => {
    const rec = call(wrap(`return Intl.NumberFormat.prototype.format;`), "f");
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：同原型上的普通方法读到函数（不抛）", () => {
    expect(throwName(wrap(`return typeof Intl.NumberFormat.prototype.resolvedOptions;`))).toBe("");
    expect(v(wrap(`return String(typeof Intl.NumberFormat.prototype.resolvedOptions);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("负控制：Intl.ListFormat.prototype.format 是普通方法（不抛）", () => {
    expect(throwName(wrap(`return typeof Intl.ListFormat.prototype.format;`))).toBe("");
    expect(v(wrap(`return String(typeof Intl.ListFormat.prototype.format);`))).toEqual({
      ok: true,
      value: "function",
    });
  });

  it("负控制：实例上的 format 是函数（brand check 只在原型对象上定抛）", () => {
    expect(v(wrap(`const nf = new Intl.NumberFormat(); return String(typeof nf.format);`))).toEqual({
      ok: true,
      value: "function",
    });
  });
});
});

// ---------------------------------------------------------------------------
// freeze / seal 键级标志 + isFrozen/isSealed 平凡真
// ---------------------------------------------------------------------------
describe("freeze / seal 键级标志 + isFrozen/isSealed 平凡真", () => {
/**
 * 回归：Object.freeze / Object.seal 的**键级标志**落地 +
 * isFrozen / isSealed 的**平凡真**判定 + fn 接收者。
 *
 * 原生（node v26 实测）：
 * - `Object.freeze(o)` ⇒ 每个自有键的 writable / configurable 折 false；
 * `Object.seal(o)` ⇒ configurable 折 false（writable 保持）；
 * - `Object.isFrozen(Object.seal({}))` === true（空对象密封即冻结——
 * 规范 §7.3.15/16：不可扩展 ∧ 每个自有属性不可配置 ∧（数据属性）不可写）；
 * - `Object.isSealed(Object.preventExtensions({}))` === true（空对象同理）；
 * - `Object.isFrozen(Object.preventExtensions({ a: 1 }))` === false；
 * - `Object.getOwnPropertyDescriptors({get a(){}}).a.get` 是**函数**
 * （访问器描述符是 {get, set, enumerable, configurable}——无 value/writable）。
 *
 * 修复前：freeze/seal 只打一个 extState 标签 ⇒ 描述符面完全看不到冻结
 * （gOPD(o,"a").writable 仍折 true / configurable 仍折 true）；isFrozen /
 * isSealed 只认标签 ⇒ 平凡真（seal({}) / preventExtensions({})）全折 false。
 */




function v(src: string) {
  return litValue___nudojs_core_25(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("freeze / seal 键级标志 + isFrozen/isSealed 平凡真", () => {
  it("freeze：自有键的 writable / configurable 折 false（改前仍折 true）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.freeze(o); const d = Object.getOwnPropertyDescriptor(o, "a"); return d.writable + "," + d.enumerable + "," + d.configurable;`,
        ),
      ),
    ).toEqual({ ok: true, value: "false,true,false" });
  });

  it("seal：只折 configurable false，writable 保持 true（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.seal(o); const d = Object.getOwnPropertyDescriptor(o, "a"); return d.writable + "," + d.enumerable + "," + d.configurable;`,
        ),
      ),
    ).toEqual({ ok: true, value: "true,true,false" });
  });

  it("gOPDs 同步反映冻结后的键级标志（改前仍折 true/true）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.freeze(o); const d = Object.getOwnPropertyDescriptors(o).a; return d.writable + "," + d.enumerable + "," + d.configurable;`,
        ),
      ),
    ).toEqual({ ok: true, value: "false,true,false" });
  });

  it("isFrozen：空对象密封即冻结（改前折 false）", () => {
    expect(v(wrap(`const o = {}; Object.seal(o); return Object.isFrozen(o);`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("isSealed：空对象 preventExtensions 即密封（改前折 false）", () => {
    expect(
      v(wrap(`const o = {}; Object.preventExtensions(o); return Object.isSealed(o);`)),
    ).toEqual({ ok: true, value: true });
  });

  it("isFrozen：preventExtensions + 收紧的键标志 ⇒ true（改前折 false）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.defineProperty(o, "a", { writable: false, configurable: false }); Object.preventExtensions(o); return Object.isFrozen(o);`,
        ),
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("isFrozen：seal 后仍有可写键 ⇒ false（原生同款，负控制）", () => {
    expect(v(wrap(`const o = { a: 1 }; Object.seal(o); return Object.isFrozen(o);`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("isSealed：preventExtensions 后仍有可配置键 ⇒ false（负控制）", () => {
    expect(
      v(wrap(`const o = { a: 1 }; Object.preventExtensions(o); return Object.isSealed(o);`)),
    ).toEqual({ ok: true, value: false });
  });

  it("gOPDs：访问器属性折 {get, set} 描述符（改前 .get 折 undefined）", () => {
    expect(
      v(wrap(`const o = { get a() { return 1; } }; return typeof Object.getOwnPropertyDescriptors(o).a.get;`)),
    ).toEqual({ ok: true, value: "function" });
  });

  it("fn 接收者：冻结后可写键仍折 false + 新键写抛 TypeError（原生同款）", () => {
    // 函数表达式路径（$fnVal 造的稳定 fn Abs）
    expect(v(wrap(`const f = function () {}; Object.freeze(f); return Object.isFrozen(f);`))).toEqual({
      ok: true,
      value: true,
    });
    expect(
      v(
        wrap(
          `const f = function () {}; Object.freeze(f); try { f.x = 4; return "no-throw"; } catch (e) { return "threw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "threw" });
  });
});
});

// ---------------------------------------------------------------------------
// defineProperty 实现 ValidateAndApplyPropertyDescriptor
// ---------------------------------------------------------------------------
describe("defineProperty 实现 ValidateAndApplyPropertyDescriptor", () => {
/**
 * 回归：`Object.defineProperty` 实现 ValidateAndApplyPropertyDescriptor
 * （ES2024 10.4.9）——不可配置属性的标志/值不可变、不可扩展目标不建新键、
 * ToPropertyDescriptor 的**字段存在性**语义。
 *
 * 原生（node v26 实测）：
 * - `Object.defineProperty(o,"a",{value:1,writable:false})` → 该属性
 * **不可配置**（新建属性未指定的字段缺省 false）⇒ 再次
 * `defineProperty(o,"a",{value:2})` 抛 TypeError（同值则允许）；
 * - 不可配置属性改 writable/configurable/enumerable → TypeError；
 * - seal / freeze / preventExtensions 之后 defineProperty **新键** → TypeError；
 * - `{get: undefined, value: 1}` → TypeError（Invalid property descriptor：
 * get 字段与 value 字段共存——`get: undefined` 仍是「有 get 字段」）；
 * - 已有（可配置）属性：未指定字段保持当前值，显式字段**双向**覆盖
 * （enumerable:false → enumerable:true 可恢复）。
 *
 * 修复前：只校验「数据 ↔ 访问器」机制切换，标志单向收紧、值可被改写、
 * 不可扩展目标静默建键 ⇒ 假绿（门禁恒绿且行为与原生相反）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_26(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("defineProperty 实现 ValidateAndApplyPropertyDescriptor", () => {
  it("不可写属性被改值 → TypeError（改前静默改写成功）", () => {
    expect(
      thrown(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, writable: false }); Object.defineProperty(o, "a", { value: 2 });`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("不可写属性**同值**重定义 → 允许（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, writable: false }); Object.defineProperty(o, "a", { value: 1 }); return String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("不可配置属性改 writable / configurable / enumerable → TypeError", () => {
    expect(
      thrown(wrap(`const o = {}; Object.defineProperty(o, "a", { value: 1 }); Object.defineProperty(o, "a", { writable: true });`)),
    ).toBe("TypeError");
    expect(
      thrown(wrap(`const o = {}; Object.defineProperty(o, "a", { value: 1 }); Object.defineProperty(o, "a", { configurable: true });`)),
    ).toBe("TypeError");
    expect(
      thrown(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, enumerable: true }); Object.defineProperty(o, "a", { enumerable: false });`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("不可配置属性改访问机制（data → accessor）→ TypeError", () => {
    expect(
      thrown(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1, writable: true }); Object.defineProperty(o, "a", { get(){ return 9; } });`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("seal / freeze / preventExtensions 之后建新键 → TypeError（改前静默建键）", () => {
    expect(
      thrown(wrap(`const o = {}; Object.seal(o); Object.defineProperty(o, "a", { value: 1 });`)),
    ).toBe("TypeError");
    expect(
      thrown(wrap(`const o = {}; Object.freeze(o); Object.defineProperty(o, "a", { value: 1 });`)),
    ).toBe("TypeError");
    expect(
      thrown(
        wrap(`const o = {}; Object.preventExtensions(o); Object.defineProperties(o, { a: { value: 1 } });`),
      ),
    ).toBe("TypeError");
  });

  it("冻结对象上**同值**重定义 → 允许（原生同款）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.freeze(o); Object.defineProperty(o, "a", { value: 1 }); return String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("{get: undefined, value: 1} → TypeError（字段存在性语义；改前静默折 1）", () => {
    expect(
      thrown(wrap(`const o = {}; Object.defineProperty(o, "a", { get: undefined, value: 1 });`)),
    ).toBe("TypeError");
  });

  it("已有可配置属性：未指定字段保持原值、显式字段双向覆盖（enumerable 可恢复）", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.defineProperty(o, "a", { enumerable: false }); Object.defineProperty(o, "a", { enumerable: true }); return Object.keys(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a" });
    expect(
      v(
        wrap(
          `const o = { a: 1 }; Object.defineProperty(o, "a", { value: 2 }); return String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "2" });
  });

  it("新建属性未指定字段缺省 false（原生描述符面）", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1 }); const d = Object.getOwnPropertyDescriptor(o, "a"); return String(d.writable) + ":" + String(d.enumerable) + ":" + String(d.configurable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "false:false:false" });
  });
});
});

// ---------------------------------------------------------------------------
// array-like 的访问器 length / 索引不再被忽略
// ---------------------------------------------------------------------------
describe("array-like 的访问器 length / 索引不再被忽略", () => {
/**
 * 回归：array-like 的 `length` / 索引是**访问器**时不再整体失效。
 *
 * ES 语义（node 实测）：
 * - `Array.from(arrayLike)` 走 array-like 路径时**先** GetMethod(items,
 * @@iterator)（无 ⇒ 走 length 路径），随后 `len = ToLength(Get(items,
 * "length"))`，再对 k ∈ [0, len) 逐个 `Get(items, k)`；
 * - 对象字面量的 `get length()` / `get 0()` 是**真访问器**——每次
 * Array.from 恰好读一次 length、每个索引各读一次（getter 的副作用
 * 真实发生）。
 *
 * 修复前：array-like 读数**裸读 shape 槽**，而 transpile 只在槽里留
 * `$lit(void 0)` 占位（真 getter 住 accessorTable 侧表）⇒ length 被当
 * undefined（ToLength → 0 ⇒ 折 exact 空数组）、索引读成 undefined，且
 * getter 的副作用（计数 / 写状态）整体消失。
 *
 * 修法：`evalArrayFrom` 的 array-like 臂改经 `accessorReadDomain`
 * （accessors.ts——投影面同款读法）取 length / 索引的读域；每次
 * Array.from 对同一键只读一次（原生同款）。
 *
 * 负控制钉住：data-length 形态、数组 / 字符串 / Set 迭代物、无 length
 * 槽、只有索引访问器而 length 是数据槽——全部与原生同口径不变。
 */






/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_27(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("array-like 的访问器 length / 索引不再被忽略", () => {
  it("Array.from：访问器 length 决定元素数（原生 \"a,b\"，改前 \"\"）", () => {
    expect(
      v(wrap(`const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("Array.from：getter 副作用落地且**只发生一次**（原生 \"2:1\"，改前 \"0:0\"）", () => {
    expect(
      v(
        wrap(
          `let n = 0; const o = { get length(){ n++; return 2; }, 0: "a", 1: "b" }; const a = Array.from(o); return a.length + ":" + n;`,
        ),
      ),
    ).toEqual({ ok: true, value: "2:1" });
  });

  it("Array.from：索引访问器的值被取到（原生 \"g\"，改前 \"\"）", () => {
    expect(
      v(wrap(`const o = { get 0(){ return "g"; }, length: 1 }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "g" });
  });

  it("借用调用 slice.call：访问器 length 生效（原生 \"a,b\"，改前 \"\"）", () => {
    expect(
      v(
        wrap(
          `const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.prototype.slice.call(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("借用调用 map.call：访问器 length 生效（原生 \"A,B\"，改前 \"\"）", () => {
    expect(
      v(
        wrap(
          `const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.prototype.map.call(o, x => x.toUpperCase()).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "A,B" });
  });

  it("借用调用 indexOf.call：访问器 length 生效（原生 1，改前 -1）", () => {
    expect(
      v(
        wrap(
          `const o = { get length(){ return 2; }, 0: "a", 1: "b" }; return Array.prototype.indexOf.call(o, "b");`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("索引访问器 + 数据 length：两个来源各按其读域（原生 \"a,z,\"）", () => {
    expect(
      v(wrap(`const o = { get 1(){ return "z"; }, length: 3, 0: "a" }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,z," });
  });
});

describe("负控制：非访问器形态不受影响", () => {
  it("data-length 的 array-like 仍按槽读", () => {
    expect(
      v(wrap(`const o = { length: 2, 0: "a", 1: "b" }; return Array.from(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
    expect(
      v(wrap(`const o = { length: 2, 0: "a", 1: "b" }; return Array.prototype.slice.call(o).join(",");`)),
    ).toEqual({ ok: true, value: "a,b" });
    expect(
      v(wrap(`const o = { length: 2, 0: "a", 1: "b" }; return Array.prototype.indexOf.call(o, "b");`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("迭代物（数组 / 字符串 / Set）不受 array-like 臂影响", () => {
    // 迭代物走迭代路径（返抽象 arr——元素域 join，非 tuple）：与 array-like 臂无关
    expect(call(wrap(`return Array.from([1,2]);`)).result.shape.k).toBe("arr");
    expect(call(wrap(`return Array.from("ab");`)).result.shape.k).toBe("arr");
    expect(call(wrap(`return Array.from(new Set([1,2]));`)).result.shape.k).toBe("arr");
  });

  it("无 length 槽的闭对象仍折 0 长（原生 0）", () => {
    expect(v(wrap(`const o = { 0: "a", 1: "b" }; return Array.from(o).length;`))).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("访问器 length 返回 undefined ⇒ ToLength 0（原生 0）", () => {
    expect(v(wrap(`const o = { get length(){ return undefined; }, 0: "a" }; return Array.from(o).length;`)))
      .toEqual({ ok: true, value: 0 });
  });

  it("访问器 length 返回字符串 \"2\" ⇒ ToLength 2（原生 2）", () => {
    expect(v(wrap(`const o = { get length(){ return "2"; }, 0: "a", 1: "b" }; return Array.from(o).length;`)))
      .toEqual({ ok: true, value: 2 });
  });

  it("L2 门禁：访问器 array-like 是**纯值错**——门禁恒绿，差异在签名", () => {
    // 改前改后门禁都是 0 诊断（不抛）——差异只体现在签名值上。
    const r = checkSource(
      "/t/bug294-arrlike.js",
      `export function fromAccessorLength() {
  const o = { get length() { return 2; }, 0: "a", 1: "b" };
  return Array.from(o).join(",");
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});

describe("越界待办（读面 / apply 面仍绕过访问器侧表）", () => {
  // 下列三处的读数在**我方文件之外**（arr-index.ts 的 $len / $idx、
  // invoke.ts 的 expandApplyArgs）——裸读槽 ⇒ 拿到占位 undefined。
  // 修法：同款经 accessorReadDomain（accessors.ts 已导出）取读域。
  it.todo("原生 o.length === 2（引擎当前 undefined）——需 arr-index.ts 的 $len 经 accessorReadDomain");
  it.todo("原生 o[0] === \"g\"（引擎当前 undefined）——需 arr-index.ts 的 $idx 经 accessorReadDomain");
  it.todo("原生 f.apply(null, o) === 3（引擎当前 0）——需 invoke.ts 的 expandApplyArgs 经 accessorReadDomain");
});
});

// ---------------------------------------------------------------------------
// Array.from 的第三实参 thisArg 透传给回调
// ---------------------------------------------------------------------------
describe("Array.from 的第三实参 thisArg 透传给回调", () => {
/**
 * 回归：`Array.from(items, mapFn, thisArg)` 的**第三实参**不再被丢弃。
 *
 * ES 语义（node 实测）：`Array.from(items, mapFn, thisArg)` 的 mapFn 以
 * `thisArg` 为 this 调用（GetThisBinding）；未给 thisArg ⇒ this 为
 * undefined（strict）/ globalThis（sloppy）。
 *
 * 修复前：`evalArrayFrom` 的 `mapOne` 调 `applyCallbackValue` 时**不传**
 * thisVal ⇒ 回调的 this 恒 undefined ⇒ 回调体读 `this.k` 走
 * "property 'k' on undefined" **假抛 TypeError**、把计数器永远写成 0。
 * 数组 HOF 通道（invoke-arr.ts 的 callFn）本就传 thisVal（已钉）——
 * `Array.from` 是唯一把 thisArg 传丢的高阶内建。
 *
 * 负控制钉住：数组 HOF 的 thisArg（不变）、无 thisArg 的回调（this 仍是
 * undefined）、无 mapper 的 Array.from（不变）。
 */






/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_28(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Array.from 的第三实参 thisArg 透传给回调", () => {
  it("回调 this 是 thisArg（原生 20，改前假抛 TypeError）", () => {
    const src = wrap(
      `let n = 0; Array.from([1,2], function(){ n += this.k; }, {k:10}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 20 });
  });

  it("回调 this 参与返回值计算（原生 \"v1|v2\"，改前假抛）", () => {
    const src = wrap(
      `const r = Array.from([1,2], function(x){ return this.p + x; }, {p:"v"}); return r;`,
    );
    expect(throwName(src)).toBe("");
    // 元素域是 this.p + x 的 join（抽象 string）——不抛且非 unknown 即可
    const r = call(src, "f").result;
    expect(r.shape.k).toBe("arr");
    expect(r.shape.k === "arr" ? r.shape.element.shape.k : "").not.toBe("unknown");
  });

  it("thisArg 为 null ⇒ 回调 this 是 null（原生 \"null\"，改前 \"undefined\"）", () => {
    const src = wrap(
      `let seen = "none"; Array.from([1], function(){ seen = String(this); return 0; }, null); return seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "null" });
  });

  it("thisArg 为 undefined ⇒ 回调 this 是 undefined（原生 \"undefined\"）", () => {
    const src = wrap(
      `let seen = "none"; Array.from([1], function(){ seen = String(this); return 0; }, undefined); return seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  });

  it("Set 迭代物同样透传 thisArg（原生 10，改前假抛）", () => {
    const src = wrap(
      `let n = 0; Array.from(new Set([1,2]), function(){ n += this.k; }, {k:5}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 10 });
  });

  it("字符串迭代物同样透传 thisArg（原生 6）", () => {
    const src = wrap(
      `let n = 0; Array.from("ab", function(){ n += this.k; }, {k:3}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 6 });
  });

  it("array-like 迭代物同样透传 thisArg（原生 8）", () => {
    const src = wrap(
      `let n = 0; Array.from({length:2,0:1,1:2}, function(){ n += this.k; }, {k:4}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 8 });
  });
});

describe("负控制：无 thisArg / 其它通道不受影响", () => {
  it("数组 HOF 的 thisArg 仍正确（原生 14）", () => {
    const src = wrap(`let n = 0; [1,2].map(function(){ n += this.k; }, {k:7}); return n;`);
    expect(v(src)).toEqual({ ok: true, value: 14 });
  });

  it("未给 thisArg ⇒ 回调 this 仍是 undefined（原生 \"undefined\"）", () => {
    const src = wrap(
      `let seen = "none"; Array.from([1], function(){ seen = String(this); return 0; }); return seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  });

  it("无 mapper 的 Array.from 不受影响（原生 2,4）", () => {
    const src = wrap(`return Array.from([1,2], x => x * 2);`);
    expect(throwName(src)).toBe("");
    expect(call(src, "f").result.shape.k).toBe("arr");
  });

  it("箭头回调不受 thisArg 影响（原生 2）", () => {
    const src = wrap(`let n = 0; Array.from([1,2], () => { n += 1; }, {k:10}); return n;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
  });

  it("L2 门禁不再假红：带 thisArg 的 Array.from 不再被判 may-throw", () => {
    // 改前：回调 this 恒 undefined ⇒ "property 'k' on undefined" ⇒ 假抛
    // ⇒ L2 门禁把合法的 thisArg 用法判红（原生不抛）。
    const r = checkSource(
      "/t/bug296-thisarg.js",
      `export function arrayFromThisArg() {
  let n = 0;
  Array.from([1, 2], function () { n += this.k; }, { k: 10 });
  return n;
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});

describe("越界待办（TypedArray.from 同款遗漏）", () => {
  // `Uint8Array.from(items, mapFn, thisArg)` 在 builtins/error/binary.ts
  // （G 分片地盘）有同款遗漏——mapper 调用不传 thisVal。
  it.todo("原生 Uint8Array.from([1,2], fn, {k:3}) 计数器 === 6（引擎当前假抛）——需 binary.ts 的 mapper 传 thisVal");
});
});

// ---------------------------------------------------------------------------
// [merged] proxy-get-own-property-descriptor
// ---------------------------------------------------------------------------
describe("proxy-get-own-property-descriptor", () => {
// MERGED (topic-related bug pins): proxy-get-own-property-descriptor + proxy-gopd-trap
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>




describe("proxy-get-own-property-descriptor", () => {
/**
 * 回归：Proxy 的 **getOwnPropertyDescriptor 陷阱**派发
 * （[[GetOwnProperty]]）——此前陷阱名并集里没有它 ⇒ 陷阱**从不派发**，
 * handler 提供的描述符被完全忽略（描述符面退化成「靶面 | undefined」并定抛）。
 *
 * 原生（node v26 实测）：
 * - `Reflect.getOwnPropertyDescriptor(proxy, "a")` 走 handler 的
 * getOwnPropertyDescriptor 陷阱（实参 (target, key)）→ 返回**补全后**的
 * 描述符对象（缺省字段取原生默认）；
 * - 陷阱返回**非对象** → TypeError（ToPropertyDescriptor 前置）。
 *
 * 修复前：Reflect 面恒走「靶面 | undefined」并集 ⇒ 读 .value 定抛 TypeError。
 * 注：`Object.getOwnPropertyDescriptor(proxy, k)` 面在
 * builtins/object/methods.ts（A 分片地盘）——越界诉求见分片报告。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Proxy getOwnPropertyDescriptor 陷阱派发", () => {
  it("Reflect 面：陷阱派发并返回补全后的描述符（改前定抛 TypeError）", () => {
    expect(
      v(
        wrap(
          `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 9, enumerable: true, configurable: true }) }); const d = Reflect.getOwnPropertyDescriptor(p, "a"); return String(d.value) + ":" + String(d.enumerable) + ":" + String(d.configurable) + ":" + String(d.writable);`,
        ),
      ),
    ).toEqual({ ok: true, value: "9:true:true:false" });
  });

  it("Reflect 面：陷阱返回非对象 → TypeError（原生同款）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({}, { getOwnPropertyDescriptor: () => "nope" }); Reflect.getOwnPropertyDescriptor(p, "a");`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("Reflect 面：无该陷阱 → 落回靶的 [[GetOwnProperty]]（原生同款）", () => {
    expect(
      v(wrap(`const p = new Proxy({ a: 1 }, {}); return String(Reflect.getOwnPropertyDescriptor(p, "a").value);`)),
    ).toEqual({ ok: true, value: "1" });
  });

  it("非 Proxy 目标不受影响（负控制）", () => {
    expect(
      v(wrap(`return String(Reflect.getOwnPropertyDescriptor({ a: 1 }, "a").value);`)),
    ).toEqual({ ok: true, value: "1" });
  });
});
});

describe("proxy-gopd-trap", () => {
/**
 * 回归：**`Object.getOwnPropertyDescriptor(proxy, k)` 派发 Proxy 的
 * getOwnPropertyDescriptor 陷阱**（[[GetOwnProperty]]）。
 *
 * 本文件钉的是**主 agent 刚完成的接线**：`builtins/object/methods.ts` 的
 * `getOwnPropertyDescriptor` 分支改为先调 `proxyGetOwnPropDescTrap(a0, args[1])`
 * （`builtins/object/descriptor.ts`——与 Reflect 面**同款单一实现**：陷阱派发 +
 * ToPropertyDescriptor 非对象定抛 + CompletePropertyDescriptor 描述符补全），
 * 返回 `desc` 用它、`opaque` 折 unknown；非 Proxy 接收者折 absent ⇒ **既有
 * 分支不变**。
 *
 * 修前：Proxy 接收者落不进 obj 分支 ⇒ 折「descriptor | undefined」并集 ⇒
 * 读 `.value` **定抛 TypeError**（原生给 handler 提供的描述符值）。
 *
 * 原生依据（node v26.10.0 实测）：
 * - `Object.getOwnPropertyDescriptor(new Proxy({a:1}, {getOwnPropertyDescriptor(){
 * return {value:42,writable:true,enumerable:true,configurable:true}}}), "a").value`
 * === `42`（陷阱返回的描述符被**补全**后原样给出）；
 * - 陷阱对**任意键**派发（实参 (target, key)）⇒ 键 "zz" 也得到 value 42；
 * - `Object.getOwnPropertyDescriptor({a:1}, "a").value` === `1`；
 * `Object.getOwnPropertyDescriptor({a:1}, "b")` === `undefined`；
 * - `Reflect.getOwnPropertyDescriptor(proxy, "a").value` === `42`（Reflect 面
 * 本来就有 ⇒ 两面口径一致）；
 * - 陷阱返回 `undefined` ⇒ 原生返回 `undefined`（**引擎当前折 unknown**——
 * 精度缺口，见下方 TODO(族05)）；
 * - 陷阱返回**非对象** ⇒ TypeError（原生
 * "'getOwnPropertyDescriptor' on proxy: trap returned neither object nor
 * undefined for property 'a'"）；
 * - `Object.getOwnPropertyDescriptor({}, "toString")` === `undefined`
 * （原型链上的键**不是自有属性** ⇒ 负控制）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果的 shape.k（unknown 判定用） */
function shapeK(r: unknown): string | undefined {
  return (r as { shape?: { k?: string } } | undefined)?.shape?.k;
}

describe("Object.getOwnPropertyDescriptor 派发 Proxy 陷阱", () => {
  it("陷阱派发：value 42（修前读 .value 定抛 TypeError）", () => {
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 42, writable: true, enumerable: true, configurable: true }) }); return Object.getOwnPropertyDescriptor(p, "a").value;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("陷阱派发：描述符被**补全**（value/writable/enumerable/configurable 原生同款）", () => {
    // 原生返回的是补全后的描述符对象（不是 handler 的原对象）。
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 42, writable: true, enumerable: true, configurable: true }) }); const d = Object.getOwnPropertyDescriptor(p, "a"); return String(d.value) + ":" + String(d.writable) + ":" + String(d.enumerable) + ":" + String(d.configurable);`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "42:true:true:true" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("陷阱对任意键派发：实参 (target, key) 里的 key 透传（原生同款）", () => {
    // 原生：陷阱以 (target, key) 被调用 ⇒ 键 "zz" 也走陷阱（不是靶的键集）。
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: (t, k) => ({ value: String(k), writable: true, enumerable: true, configurable: true }) }); return Object.getOwnPropertyDescriptor(p, "zz").value;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "zz" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("非 Proxy 路径不受影响：{a:1} 的自有键 value 1、缺失键 undefined", () => {
    const hit = call(wrap(`return Object.getOwnPropertyDescriptor({ a: 1 }, "a").value;`), "f");
    expect(litValue(hit.result)).toEqual({ ok: true, value: 1 });
    expect(throwsError(hit.throws, "TypeError")).toBe(false);
    const miss = call(wrap(`return Object.getOwnPropertyDescriptor({ a: 1 }, "b");`), "f");
    expect(litValue(miss.result)).toEqual({ ok: true, value: undefined });
    expect(throwsError(miss.throws, "TypeError")).toBe(false);
  });

  it("Reflect 面一致：同一陷阱经 Reflect 面拿到同一个 42", () => {
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => ({ value: 42, writable: true, enumerable: true, configurable: true }) }); return Reflect.getOwnPropertyDescriptor(p, "a").value;`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 42 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("陷阱返回 undefined：不抛，且不假精确（精度缺口 TODO(族05)）", () => {
    // 原生：陷阱返回 undefined ⇒ Object.getOwnPropertyDescriptor 返回
    // **undefined**。引擎当前折 **unknown**（更保守，不是错值）——精度缺口，
    // 不在本次接线的范围内。
    // TODO(族05): 引擎与原生不一致（unknown vs undefined）——只钉「不抛」+
    // 「不假精确」，**不钉**「等于 undefined」。
    const r = call(
      wrap(
        `const p = new Proxy({ a: 1 }, { getOwnPropertyDescriptor: () => undefined }); return Object.getOwnPropertyDescriptor(p, "a");`,
      ),
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    const lv = litValue(r.result);
    expect(shapeK(r.result) === "unknown" || (lv.ok && lv.value === undefined)).toBe(true);
  });

  it("陷阱返回非对象 → TypeError（ToPropertyDescriptor 前置，原生同款）", () => {
    const r = call(
      wrap(
        `const p = new Proxy({}, { getOwnPropertyDescriptor: () => "nope" }); return Object.getOwnPropertyDescriptor(p, "a");`,
      ),
      "f",
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});

describe("负控制（邻近形态不回归）", () => {
  it("原型链上的键不是自有属性：gOPD({}, \"toString\") === undefined", () => {
    const r = call(wrap(`return typeof Object.getOwnPropertyDescriptor({}, "toString");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "undefined" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("普通对象的描述符三标志不变（writable/enumerable/configurable 全 true）", () => {
    const r = call(
      wrap(
        `const d = Object.getOwnPropertyDescriptor({ a: 1 }, "a"); return String(d.writable) + ":" + String(d.enumerable) + ":" + String(d.configurable);`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true:true:true" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});
});
});

// ---------------------------------------------------------------------------
// freeze / seal 的 Proxy 陷阱派发
// ---------------------------------------------------------------------------
describe("freeze / seal 的 Proxy 陷阱派发", () => {
/**
 * 回归：Object.freeze / Object.seal 对 **Proxy** 的陷阱派发。
 *
 * 原生（node v26 实测）：SetIntegrityLevel（ES2024 10.4.6）=
 * 1) [[PreventExtensions]]（→ preventExtensions 陷阱）；falsy ⇒ TypeError；
 * 2) 每个自有键 [[DefineOwnProperty]]（→ defineProperty 陷阱）；falsy ⇒
 * TypeError。
 *
 * 修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的
 * 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。
 */




function v(src: string) {
  return litValue___nudojs_core_29(call(src, "f").result);
}

function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("freeze / seal 的 Proxy 陷阱派发", () => {
  it("freeze：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({ a: 1 }, { preventExtensions() { return false; } }); Object.freeze(p);`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("seal：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({ a: 1 }, { preventExtensions() { return false; } }); Object.seal(p);`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("freeze：defineProperty 陷阱返回 false ⇒ TypeError（改前不抛）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({ a: 1 }, { defineProperty() { return false; } }); Object.freeze(p);`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("freeze：preventExtensions + 逐键 defineProperty 陷阱都派发（改前一个都不派发）", () => {
    expect(
      v(
        wrap(
          `const calls = []; const p = new Proxy({ a: 1 }, { preventExtensions(t) { calls.push("preventExtensions"); return Reflect.preventExtensions(t); }, defineProperty(t, k, d) { calls.push("defineProperty:" + k); return Reflect.defineProperty(t, k, d); } }); Object.freeze(p); return calls.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "preventExtensions,defineProperty:a" });
  });

  it("seal：同样派发两个陷阱（改前一个都不派发）", () => {
    expect(
      v(
        wrap(
          `const calls = []; const p = new Proxy({ a: 1 }, { preventExtensions(t) { calls.push("preventExtensions"); return Reflect.preventExtensions(t); }, defineProperty(t, k, d) { calls.push("defineProperty:" + k); return Reflect.defineProperty(t, k, d); } }); Object.seal(p); return calls.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "preventExtensions,defineProperty:a" });
  });

  it("负控制：无陷阱的 Proxy 冻结不抛（原生同款）", () => {
    expect(thrown(wrap(`const p = new Proxy({ a: 1 }, {}); Object.freeze(p);`))).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// Reflect.defineProperty 的反射口径（失败返 false 不抛）
// ---------------------------------------------------------------------------
describe("Reflect.defineProperty 的反射口径（失败返 false 不抛）", () => {
/**
 * 回归：`Reflect.defineProperty` 走**反射口径**——失败返 **false
 * 不抛**（Object.defineProperty 才是定抛 TypeError）。
 *
 * 原生（node v26 实测）：
 * - `Reflect.defineProperty(proxy, "a", desc)` 走 handler 的 defineProperty
 * 陷阱 → 返回 ToBoolean(陷阱结果)（false ⇒ 返 false，**不抛**）；
 * - 普通对象上重定义失败（不可配置属性改值）⇒ 返 **false**（不抛）；
 * - 描述符**非法**（非对象 / get-set 与 value 共存）⇒ 仍定抛 TypeError
 * （ToPropertyDescriptor 前置，与 Object 面同款）。
 *
 * 修复前：Reflect 复用 Object 面 ⇒ 陷阱返 false 时定抛 TypeError；成功时
 * 返回抽象 boolean（恒真不可判）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_30(call(src, "f").result);
}

/** 入口 throws 面（brand 名）——未抛则 undefined */
function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Reflect.defineProperty 的反射口径（失败返 false 不抛）", () => {
  it("Proxy defineProperty 陷阱返 false → 返 false（改前定抛 TypeError）", () => {
    expect(
      v(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => false }); return String(Reflect.defineProperty(p, "a", { value: 2 }));`)),
    ).toEqual({ ok: true, value: "false" });
    expect(
      thrown(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => false }); Reflect.defineProperty(p, "a", { value: 2 });`)),
    ).toBeUndefined();
  });

  it("Proxy defineProperty 陷阱返 true → 返 true", () => {
    expect(
      v(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => true }); return String(Reflect.defineProperty(p, "a", { value: 2 }));`)),
    ).toEqual({ ok: true, value: "true" });
  });

  it("普通对象：成功 → true 且值落地", () => {
    expect(
      v(
        wrap(
          `const o = { a: 1 }; const r = Reflect.defineProperty(o, "a", { value: 2 }); return String(r) + ":" + String(o.a);`,
        ),
      ),
    ).toEqual({ ok: true, value: "true:2" });
  });

  it("普通对象：重定义失败（不可配置属性改值）→ 返 false（不抛）", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperty(o, "a", { value: 1 }); return String(Reflect.defineProperty(o, "a", { value: 2 }));`,
        ),
      ),
    ).toEqual({ ok: true, value: "false" });
  });

  it("描述符非法（非对象）→ 仍定抛 TypeError（原生同款）", () => {
    expect(
      thrown(wrap(`Reflect.defineProperty({}, "a", null);`)),
    ).toBe("TypeError");
  });

  it("Object 面保持定抛口径（负控制：Object.defineProperty 仍抛）", () => {
    expect(
      thrown(wrap(`const p = new Proxy({ a: 1 }, { defineProperty: () => false }); Object.defineProperty(p, "a", { value: 2 });`)),
    ).toBe("TypeError");
  });
});
});

// ---------------------------------------------------------------------------
// Reflect.get 查访问器侧表（getter 不再被忽略）
// ---------------------------------------------------------------------------
describe("Reflect.get 查访问器侧表（getter 不再被忽略）", () => {
/**
 * 回归：`Reflect.get` 查**访问器侧表**——对象字面量的 getter
 * （真身住 accessorTable，槽里只有 transpile 落的 `$lit(void 0)` 占位）
 * 此前被折成 exact undefined，getter **从不执行**。
 *
 * 原生（node v26 实测）：`Reflect.get` ≡ [[Get]] ⇒ 访问器属性走 getter，
 * `this` = receiver（第 3 实参；缺省 ≡ target）；只有 setter 的键读值恒
 * undefined（原生同款）。
 *
 * 修复前：只读槽占位 ⇒ 折 exact undefined（假精确——比真值更窄）。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_31(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Reflect.get 查访问器侧表（getter 不再被忽略）", () => {
  it("getter 值被取到（原生 42，改前 undefined）", () => {
    expect(
      v(wrap(`const o = { get x() { return 42; } }; return String(Reflect.get(o, "x"));`)),
    ).toEqual({ ok: true, value: "42" });
  });

  it("getter 副作用真实发生（原生 1，改前 0）", () => {
    expect(
      v(
        wrap(
          `let n = 0; const o = { get x() { n = n + 1; return 42; } }; Reflect.get(o, "x"); return String(n);`,
        ),
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("receiver（第 3 实参）作为 getter 的 this（原生 7）", () => {
    expect(
      v(
        wrap(
          `const o = { get x() { return this.v; } }; const r = { v: 7 }; return String(Reflect.get(o, "x", r));`,
        ),
      ),
    ).toEqual({ ok: true, value: "7" });
  });

  it("只有 setter 的键读值恒 undefined（原生同款，负控制）", () => {
    expect(
      v(wrap(`const o = { set x(v) {} }; return String(Reflect.get(o, "x"));`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("数据属性读值不受影响（负控制）", () => {
    expect(
      v(wrap(`const o = { a: 1 }; return String(Reflect.get(o, "a"));`)),
    ).toEqual({ ok: true, value: "1" });
  });
});
});

// ---------------------------------------------------------------------------
// Function.prototype 的 [[Prototype]] 是 Object.prototype
// ---------------------------------------------------------------------------
describe("Function.prototype 的 [[Prototype]] 是 Object.prototype", () => {
/**
 * 回归：`Object.getPrototypeOf(Function.prototype)` 必须是
 * `Object.prototype`（ES 的 [[Prototype]] 链：Function.prototype 的原型
 * 就是 Object.prototype）。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 * Object.getPrototypeOf(Function.prototype) === Object.prototype → true
 * Object.getPrototypeOf(Object.prototype) === null → true
 * Object.getPrototypeOf([]) === Array.prototype → true
 * Object.getPrototypeOf(Array.prototype) === Object.prototype → true
 * Object.getPrototypeOf(userFn) === Function.prototype → true
 * typeof Function.prototype → "function"
 *
 * 修前：引擎把 Function.prototype 的 [[Prototype]] 压成 undefined ⇒
 * `getPrototypeOf(Function.prototype) === Object.prototype` 恒 **false**
 * ⇒ 对完全合法的代码给出**自信的错值**（wrong-exact：假绿/假红同源）。
 *
 * 报告勘误（**勿照抄报告**）：原始报告称原生 `typeof Function.prototype`
 * 是 "object"——**报告是错的**。node v26 实测为 **"function"**
 * （Function.prototype 本身就是可调用的）。引擎当前也给 "function" ✅。
 * 本文件按**原生**把 typeof 钉成 "function"，并单列一条断言防回退。
 *
 * 取证（原生 oracle）：
 * node -e 'console.log(Object.getPrototypeOf(Function.prototype)===Object.prototype,
 * Object.getPrototypeOf(Object.prototype)===null,
 * Object.getPrototypeOf([])===Array.prototype,
 * Object.getPrototypeOf(Array.prototype)===Object.prototype,
 * typeof Function.prototype)'
 */




const wrap = (body: string) => `export function f() { ${body} }`;

describe("Function.prototype 的 [[Prototype]] 是 Object.prototype", () => {
  it("Object.getPrototypeOf(Function.prototype) === Object.prototype → true（修前恒 false）", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Function.prototype) === Object.prototype;`),
      "f",
    );
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("Object.getPrototypeOf(Object.prototype) === null → true（链顶恒 null）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Object.prototype) === null;`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf([]) === Array.prototype → true（实例原型面不回归）", () => {
    const r = call(wrap(`return Object.getPrototypeOf([]) === Array.prototype;`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(Array.prototype) === Object.prototype → true（内建原型上一层）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Array.prototype) === Object.prototype;`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(userFn) === Function.prototype → true（用户函数的原型面）", () => {
    const r = call(
      wrap(`function user(){} return Object.getPrototypeOf(user) === Function.prototype;`),
      "f",
    );
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });
});

describe("负控制（报告的 typeof 勘误 + 相邻原型面不回归）", () => {
  it("typeof Function.prototype → \"function\"（原生同款；报告称 \"object\" 是**报告的错误**）", () => {
    // node v26.10.0：typeof Function.prototype === "function"
    // （Function.prototype 本身可调用——它就是「所有函数共用的那个函数」）。
    // 报告里的 "object" 无原生依据，**不得**据此写断言。
    const r = call(wrap(`return typeof Function.prototype;`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: "function" });
  });

  it("typeof Object.getPrototypeOf(Function.prototype) → \"object\"（原型对象本身是对象）", () => {
    // 原生：Object.getPrototypeOf(Function.prototype) === Object.prototype
    // ⇒ typeof 是 "object"
    const r = call(wrap(`return typeof Object.getPrototypeOf(Function.prototype);`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: "object" });
  });

  it("Object.getPrototypeOf(Function) === Function.prototype → true（内建构造器自身的原型面）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Function) === Function.prototype;`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(Object) === Function.prototype → true（内建构造器自身的原型面）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Object) === Function.prototype;`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(function(){}) === Function.prototype → true（函数表达式）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(function(){}) === Function.prototype;`), "f");
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });

  it("Object.getPrototypeOf(Object.getPrototypeOf([])) === Object.prototype → true", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Object.getPrototypeOf([])) === Object.prototype;`),
      "f",
    );
    expect(litValue___nudojs_core_32(r.result)).toEqual({ ok: true, value: true });
  });
});
});

// ---------------------------------------------------------------------------
// 迭代器对象的 @@iterator 返回自身
// ---------------------------------------------------------------------------
describe("迭代器对象的 @@iterator 返回自身", () => {
/**
 * 回归：迭代器对象的 `@@iterator` 必须**返回自身**（迭代器协议）。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 * new Set([1,2])[Symbol.iterator]()[Symbol.iterator]() === it → true
 * new Map([[1,2]])[Symbol.iterator]()[Symbol.iterator]() === it → true
 * [1,2][Symbol.iterator]()[Symbol.iterator]() === it → true
 * "ab"[Symbol.iterator]()[Symbol.iterator]() === it → true
 * 两个**不同**迭代器对象互比 → false（不是「所有迭代器都相等」）
 *
 * 修前：引擎的迭代器对象**没有自协议**——
 * - Set / Map 迭代器：`it[Symbol.iterator]` 取不到 ⇒ 调用**确定抛
 * TypeError** ⇒ 返回值折 never（自信的错值）；
 * - 数组 / 字符串迭代器：给出**错的 "diff"**（原生是 same / true）。
 *
 * 口径说明（**别被报告的措辞带偏**）：报告里的 "same" / "diff" 是
 * 「同一性」的措辞，**原生值是布尔** true / false——本文件按**原生布尔**
 * 断言（引擎当前也给精确 true）。
 *
 * 取证（原生 oracle）：
 * node -e 'const s=new Set([1,2])[Symbol.iterator](),
 * m=new Map([[1,2]])[Symbol.iterator](),
 * a=[1,2][Symbol.iterator](), t="ab"[Symbol.iterator]();
 * console.log(s[Symbol.iterator]()===s, m[Symbol.iterator]()===m,
 * a[Symbol.iterator]()===a, t[Symbol.iterator]()===t)'
 */




const wrap = (body: string) => `export function f() { ${body} }`;

describe("迭代器对象的 @@iterator 返回自身", () => {
  it("Set 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）", () => {
    const r = call(
      wrap(`const it = new Set([1,2])[Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue___nudojs_core_33(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("Map 迭代器：it[Symbol.iterator]() === it → true（修前：确定抛 TypeError）", () => {
    const r = call(
      wrap(`const it = new Map([[1,2]])[Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue___nudojs_core_33(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("数组迭代器：it[Symbol.iterator]() === it → true（修前：错的 \"diff\"）", () => {
    const r = call(
      wrap(`const it = [1,2][Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue___nudojs_core_33(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("字符串迭代器：it[Symbol.iterator]() === it → true（修前：错的 \"diff\"）", () => {
    const r = call(
      wrap(`const it = "ab"[Symbol.iterator](); return it[Symbol.iterator]() === it;`),
      "f",
    );
    expect(litValue___nudojs_core_33(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});

describe("负控制（自协议 ≠ 「所有迭代器都相等」）", () => {
  it("两个不同集合迭代器互比 → false（原生同款）", () => {
    const r = call(
      wrap(
        `const a = new Set([1,2])[Symbol.iterator](); const b = new Set([1,2])[Symbol.iterator](); return a === b;`,
      ),
      "f",
    );
    expect(litValue___nudojs_core_33(r.result)).toEqual({ ok: true, value: false });
  });

  it("迭代器本身与源集合互比 → 不是精确 true（原生 false；引擎给保守 boolean 域）", () => {
    // 原生：`it === s` → false（迭代器与集合是不同对象）。引擎当前给**保守
    // boolean 域**（说不死）⇒ 只钉「不得说死 true」。
    const r = call(
      wrap(`const s = new Set([1,2]); const it = s[Symbol.iterator](); return it === s;`),
      "f",
    );
    const lit = litValue___nudojs_core_33(r.result);
    expect(lit.ok === true ? lit.value : undefined).not.toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// Error.prototype own data properties name / message
// ---------------------------------------------------------------------------
describe("Error.prototype own data properties name / message", () => {
/**
 * Error.prototype 的自有数据属性 name / message 缺席。
 *
 * 原生：Error 家族（Error / TypeError / RangeError / SyntaxError /
 * ReferenceError / EvalError / URIError / AggregateError）的 prototype 上
 * **各有**自有数据属性 `name`（值 = 家族名）与 `message`（值 = ""），
 * 描述符 {writable:true, enumerable:false, configurable:true}。
 * 其余内建原型**无**自有 name / message（原生 gOPN 逐个核对）。
 *
 * node v26.10.0 原生实测（oracle）：
 * hasOwnProperty.call(Error.prototype,"name") → true
 * hasOwnProperty.call(Error.prototype,"message") → true
 * Error.prototype.name → "Error"
 * Error.prototype.message → ""
 * "name" in Error.prototype → true
 * "message" in Error.prototype → true
 * Error.prototype.propertyIsEnumerable("name") → false（不可枚举）
 * for (const k in Error.prototype) 计数 → 0
 * TypeError.prototype.name → "TypeError"（其余七族同款）
 * hasOwnProperty.call(Array.prototype,"name") → false（原生无）
 * hasOwnProperty.call(Object.prototype,"name") → false（原生无）
 * hasOwnProperty.call(Map.prototype,"name") → false（原生无）
 * "name" in Array.prototype → false
 *
 * 修前：protoBrandAbs 的原型面只装 `constructor` 一个槽 ⇒
 * hasOwnProperty / "name" in 全部折 false（原生 true）。
 * 修复：ctor.ts 的 protoBrandAbs —— Error 家族原型额外装自有 name / message
 * 槽（不可枚举标记挂内层 obj）。
 */




/** 调用 f() 的字面量结果（非字面量 → undefined） */
function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

const HOP = "Object.prototype.hasOwnProperty.call";

/** Error 家族（原生 prototype 各自有自有 name / message） */
const ERROR_FAMILY = [
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
] as const;

describe("Error.prototype own data properties name / message", () => {
  it("Error.prototype 自有 name / message（hasOwnProperty true）", () => {
    expect(v(`export function f() { return ${HOP}(Error.prototype, "name"); }`)).toBe(true);
    expect(v(`export function f() { return ${HOP}(Error.prototype, "message"); }`)).toBe(true);
  });

  it("取值不变（name = 家族名、message = \"\"）", () => {
    expect(v(`export function f() { return Error.prototype.name; }`)).toBe("Error");
    expect(v(`export function f() { return Error.prototype.message; }`)).toBe("");
  });

  it("\"name\" / \"message\" in Error.prototype → true", () => {
    expect(v(`export function f() { return "name" in Error.prototype; }`)).toBe(true);
    expect(v(`export function f() { return "message" in Error.prototype; }`)).toBe(true);
  });

  it("自有但不可枚举（propertyIsEnumerable false、for-in 不发布）", () => {
    expect(v(`export function f() { return Error.prototype.propertyIsEnumerable("name"); }`)).toBe(false);
    expect(v(`export function f() { return Error.prototype.propertyIsEnumerable("message"); }`)).toBe(false);
    expect(v(`export function f() { let n=0; for (const k in Error.prototype) n++; return n; }`)).toBe(0);
  });

  it("Error 家族八个原型同款（各自 name = 家族名、message = \"\"）", () => {
    for (const name of ERROR_FAMILY) {
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "name"); }`), name).toBe(true);
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "message"); }`), name).toBe(true);
      expect(v(`export function f() { return ${name}.prototype.name; }`), name).toBe(name);
      expect(v(`export function f() { return ${name}.prototype.message; }`), name).toBe("");
    }
  });

  it("对照组：其余内建原型**无**自有 name / message（原生 gOPN 逐个核对）", () => {
    for (const name of ["Array", "Object", "Map", "Promise"]) {
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "name"); }`), name).toBe(false);
      expect(v(`export function f() { return ${HOP}(${name}.prototype, "message"); }`), name).toBe(false);
    }
    expect(v(`export function f() { return "name" in Array.prototype; }`)).toBe(false);
    expect(v(`export function f() { return "message" in Array.prototype; }`)).toBe(false);
    expect(v(`export function f() { return "name" in Object.prototype; }`)).toBe(false);
  });

  it("constructor 自有槽不受影响（仍是原型自有、非枚举）", () => {
    expect(v(`export function f() { return ${HOP}(Error.prototype, "constructor"); }`)).toBe(true);
    expect(v(`export function f() { return Error.prototype.propertyIsEnumerable("constructor"); }`)).toBe(false);
    expect(v(`export function f() { return Error.prototype.constructor.name; }`)).toBe("Error");
  });
});
});

// ---------------------------------------------------------------------------
// Object.create(o, undefined) 整步跳过
// ---------------------------------------------------------------------------
describe("Object.create(o, undefined) 整步跳过", () => {
/**
 * 回归：Object.create(o, **显式 undefined**) 的第二实参判定。
 *
 * 原生（node v26 实测）：规范 ES2024 20.1.2.2「If properties is not
 * undefined」⇒ 显式传 `undefined` 与**不传**同义（整步跳过：只建对象、
 * 不定义任何属性、**不抛**）⇒ `Object.create(o)` 与 `Object.create(o,
 * undefined)` 都返回对象；`Object.create(o, null)` 才抛 TypeError
 * （ToObject(null)）。
 *
 * 修复前：第二实参的**槽**在就当「有 properties」⇒ 显式 `undefined` 被判
 * **确定抛 TypeError** ⇒ L2 门禁假红 + 返回值错折 never，且与 1 参形态
 * （完全正常）自相矛盾。
 */




function v(src: string) {
  return litValue___nudojs_core_34(call(src, "f").result);
}

function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Object.create(o, undefined) 整步跳过", () => {
  it("显式 undefined 第二实参 ⇒ 返回对象、不抛（改前定抛 TypeError）", () => {
    expect(v(wrap(`const o = { a: 1 }; return typeof Object.create(o, undefined);`))).toEqual({
      ok: true,
      value: "object",
    });
    expect(thrown(wrap(`const o = { a: 1 }; Object.create(o, undefined);`))).toBeUndefined();
  });

  it("负控制：1 参形态同样返回对象（与显式 undefined 同口径）", () => {
    expect(v(wrap(`const o = { a: 1 }; return typeof Object.create(o);`))).toEqual({
      ok: true,
      value: "object",
    });
  });

  it("负控制：null 第二实参 ⇒ TypeError（ToObject(null)，原生同款）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.create(o, null);`))).toBe("TypeError");
  });

  it("负控制：数字第二实参 ⇒ 零自有属性的包装器、不抛（原生同款）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.create(o, 5);`))).toBeUndefined();
  });

  it("负控制：第二实参带描述符 ⇒ 仍安装自有属性", () => {
    expect(
      v(
        wrap(
          `const o = Object.create(null, { a: { value: 1, enumerable: true } }); return JSON.stringify(Object.keys(o));`,
        ),
      ),
    ).toEqual({ ok: true, value: '["a"]' });
  });
});
});

// ---------------------------------------------------------------------------
// Object.defineProperties(o, <原始值>) 走 ToObject
// ---------------------------------------------------------------------------
describe("Object.defineProperties(o, <原始值>) 走 ToObject", () => {
/**
 * 回归：Object.defineProperties(o, **原始值**) 的第二实参判定。
 *
 * 原生（node v26 实测）：第二实参走 **ToObject** ——
 * - `null` / `undefined` ⇒ TypeError；
 * - number / boolean / bigint / symbol ⇒ 装箱成**零自有可枚举属性**的
 * 包装器 ⇒ **不定义任何属性、不抛**；
 * - 非空字符串 ⇒ 装箱后有下标键（"0"/"1"…）⇒ 每个「描述符」是字符（非
 * 对象）⇒ ToPropertyDescriptor 定抛 TypeError；空串零键 ⇒ 不抛。
 *
 * 修复前：第二实参是 prim ⇒ 判**确定抛 TypeError** ⇒ L1 门禁假红 +
 * 返回值错折 never。
 */




function v(src: string) {
  return litValue___nudojs_core_35(call(src, "f").result);
}

function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Object.defineProperties(o, <原始值>) 走 ToObject", () => {
  it("数字第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, 5);`))).toBeUndefined();
    expect(v(wrap(`const o = { a: 1 }; Object.defineProperties(o, 5); return JSON.stringify(o);`))).toEqual({
      ok: true,
      value: '{"a":1}',
    });
  });

  it("布尔第二实参 ⇒ 不抛、不改属性（改前定抛 TypeError）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, true);`))).toBeUndefined();
  });

  it("空串第二实参 ⇒ 零键 ⇒ 不抛（改前定抛 TypeError）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, "");`))).toBeUndefined();
  });

  it("负控制：null / undefined 第二实参 ⇒ TypeError（原生同款）", () => {
    expect(thrown(wrap(`Object.defineProperties({}, null);`))).toBe("TypeError");
    expect(thrown(wrap(`Object.defineProperties({}, undefined);`))).toBe("TypeError");
  });

  it("负控制：非空字符串第二实参 ⇒ TypeError（描述符是字符，非对象）", () => {
    expect(thrown(wrap(`const o = { a: 1 }; Object.defineProperties(o, "ab");`))).toBe("TypeError");
  });

  it("负控制：对象第二实参仍照常安装描述符", () => {
    expect(
      v(
        wrap(
          `const o = {}; Object.defineProperties(o, { a: { value: 1, enumerable: true } }); return JSON.stringify(Object.keys(o));`,
        ),
      ),
    ).toEqual({ ok: true, value: '["a"]' });
  });
});
});

// ---------------------------------------------------------------------------
// 内建原型的 [[Prototype]] 链不再被压扁
// ---------------------------------------------------------------------------
describe("内建原型的 [[Prototype]] 链不再被压扁", () => {
/**
 * 回归：内建原型的 [[Prototype]] 链**不再被压扁**。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 * Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype
 * → **false**（Uint8Array.prototype 的原型是 %TypedArray%.prototype，
 * 它才是 Object.prototype 的子原型——原生是**两层**）
 * Object.getPrototypeOf(Object.getPrototypeOf(Uint8Array.prototype))
 * === Object.prototype → **true**（链条错一级的症状已修）
 * Object.getPrototypeOf(Array.prototype) === Object.prototype → **true**
 * （Array.prototype 的上一层**就是** Object.prototype——原生是**一层**）
 *
 * 修前：引擎把内建原型的 [[Prototype]] **一律**压成 Object.prototype
 * ⇒ 对 Uint8Array.prototype 这类「原型之上还有一层」的内建给出**自信的
 * 错值**（原生 false，引擎 true）。
 *
 * 引擎当前（保守域口径，**不是**自信的错值）：`getProto(Uint8Array.prototype)
 * === Object.prototype` 落 **保守 boolean 域**（formatShape = "boolean"，
 * litValue 不 ok）——即引擎**不再**说死 true，但也没说死 false。
 * 故本文件按「**不得是精确 true**」钉（原生是 false，引擎保守 ⇒ 方向一致，
 * 只是精度未到位）；**不得**断言精确 false（会假红），也**不得**断言精确
 * true（那是修前的错值）。
 *
 * 取证（原生 oracle）：
 * node -e 'console.log(Object.getPrototypeOf(Uint8Array.prototype)===Object.prototype,
 * Object.getPrototypeOf(Object.getPrototypeOf(Uint8Array.prototype))===Object.prototype,
 * Object.getPrototypeOf(Array.prototype)===Object.prototype)'
 */




const wrap = (body: string) => `export function f() { ${body} }`;

describe("内建原型的 [[Prototype]] 链不再被压扁", () => {
  it("getProto(getProto(Uint8Array.prototype)) === Object.prototype → true（链条错一级已修）", () => {
    const r = call(
      wrap(
        `return Object.getPrototypeOf(Object.getPrototypeOf(Uint8Array.prototype)) === Object.prototype;`,
      ),
      "f",
    );
    expect(litValue___nudojs_core_36(r.result)).toEqual({ ok: true, value: true });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("getProto(Array.prototype) === Object.prototype → true（对照组：一层链的原生同款）", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Array.prototype) === Object.prototype;`),
      "f",
    );
    expect(litValue___nudojs_core_36(r.result)).toEqual({ ok: true, value: true });
  });

  it("getProto(Uint8Array.prototype) === Object.prototype → **不是精确 true**（原生 false）", () => {
    // 原生是 false（%TypedArray%.prototype 夹在中间）。修前引擎恒 true
    // （自信的错值）；当前引擎给**保守 boolean 域**（不 ok 的 litValue）——
    // 断言只钉「不得说死 true」，精度债（未说死 false）另行记账。
    const r = call(
      wrap(`return Object.getPrototypeOf(Uint8Array.prototype) === Object.prototype;`),
      "f",
    );
    const lit = litValue___nudojs_core_36(r.result);
    expect(lit.ok === true ? lit.value : undefined).not.toBe(true);
    // 保守域的具体形状：boolean（既非 exact true 也非 exact false）
    expect(formatShape___nudojs_core(r.result)).toBe("boolean");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});

describe("负控制（内建原型链的相邻形态不回归）", () => {
  it("getProto(Object.prototype) === null → true（链顶恒 null）", () => {
    const r = call(wrap(`return Object.getPrototypeOf(Object.prototype) === null;`), "f");
    expect(litValue___nudojs_core_36(r.result)).toEqual({ ok: true, value: true });
  });

  it("getProto(getProto(Array.prototype)) === null → true（Array.prototype 上一层即顶）", () => {
    const r = call(
      wrap(`return Object.getPrototypeOf(Object.getPrototypeOf(Array.prototype)) === null;`),
      "f",
    );
    expect(litValue___nudojs_core_36(r.result)).toEqual({ ok: true, value: true });
  });

  it("typeof Array.prototype === \"object\"（内建原型对象的 typeof 面不回归）", () => {
    const r = call(wrap(`return typeof Array.prototype;`), "f");
    expect(litValue___nudojs_core_36(r.result)).toEqual({ ok: true, value: "object" });
  });
});
});

// ---------------------------------------------------------------------------
// Array.prototype 三键的 nullish 接收者记抛
// ---------------------------------------------------------------------------
describe("Array.prototype 三键的 nullish 接收者记抛", () => {
/**
 * 回归：`Array.prototype.join/toString/toLocaleString` 的
 * **nullish 接收者**必须记抛（ToObject）——不再让 L2 门禁假绿。
 *
 * ES 语义（node 实测）：`Array.prototype.join.call(null)` /
 * `.call(undefined)` / `Array.prototype.join()` ⇒ TypeError
 * "Cannot convert undefined or null to object"（ToObject 前置校验）。
 * 同一对象上的其它方法（slice / indexOf / map）本就正确报红。
 *
 * 修复前：`arrayMethodAbs` 的 apply 用 `a[0] ?? undefAbs()` 把 nullish
 * 接收者**静默替换**成 undefined 值 ⇒ brand 判定（ToObject）从未发生
 * ⇒ 全程不记抛 ⇒ 导出函数被引擎判成 total ⇒ L2 门禁 0 诊断（假绿）。
 *
 * 负控制钉住：非 nullish 接收者（数组 / array-like / 字符串 / 数字 /
 * 对象）仍**不抛**；`String(arr)` / 模板串 / `arr.join()` 等 ToString
 * 通道不受影响；同对象上其它方法的既有报红不变。
 */






/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue___nudojs_core_37(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : (t.shape.k as string);
}

/** 是否 definite throw（结果面是 never + throws 面是具名 brand） */
function isDefiniteThrow(src: string, name: string): boolean {
  const rec = call(src, "f");
  const t = rec.throws as { shape?: { k?: string; name?: string } } | undefined;
  return (
    rec.result.shape.k === "never" &&
    !!t?.shape &&
    t.shape.k === "brand" &&
    t.shape.name === name
  );
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Array.prototype 三键的 nullish 接收者记抛", () => {
  it("join.call(null) / join.call(undefined) ⇒ TypeError（改前不记抛）", () => {
    for (const body of [
      `return Array.prototype.join.call(null);`,
      `return Array.prototype.join.call(undefined);`,
      `return Array.prototype.join.call();`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
      expect(throwName(src), body).toBe("TypeError");
    }
  });

  it("toString.call(null) / toString.call(undefined) ⇒ TypeError", () => {
    for (const body of [
      `return Array.prototype.toString.call(null);`,
      `return Array.prototype.toString.call(undefined);`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
    }
  });

  it("toLocaleString.call(null) / toLocaleString.call(undefined) ⇒ TypeError", () => {
    for (const body of [
      `return Array.prototype.toLocaleString.call(null);`,
      `return Array.prototype.toLocaleString.call(undefined);`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
    }
  });

  it("摘下方法值后以 null 调用 ⇒ TypeError（原生同）", () => {
    const src = wrap(`const a = [1,2]; const j = a.join; return j.call(null);`);
    expect(isDefiniteThrow(src, "TypeError")).toBe(true);
  });
});

describe("负控制：非 nullish 接收者不抛", () => {
  it("数组接收者仍折出值（原生 \"1,2\"）", () => {
    expect(v(wrap(`return Array.prototype.join.call([1,2]);`))).toEqual({
      ok: true,
      value: "1,2",
    });
    expect(v(wrap(`return Array.prototype.toString.call([1,2]);`))).toEqual({
      ok: true,
      value: "1,2",
    });
  });

  it("array-like / 字符串 / 数字 / 对象接收者不抛", () => {
    for (const body of [
      `return Array.prototype.join.call({length:2,0:"a",1:"b"});`,
      `return Array.prototype.join.call("ab");`,
      `return Array.prototype.join.call(5);`,
      `return Array.prototype.join.call({});`,
      `return Array.prototype.toString.call({});`,
      `return Array.prototype.toLocaleString.call({});`,
    ]) {
      const src = wrap(body);
      expect(throwName(src), body).toBe("");
    }
  });

  it("实例方法调用不受影响（原生 \"1,2\"）", () => {
    expect(v(wrap(`const a = [1,2]; return a.join(",");`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`const a = [1,2]; return a.toString();`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`const a = [1,2]; return a.toLocaleString();`))).toEqual({
      ok: true,
      value: "1,2",
    });
  });

  it("ToString 通道不受影响（原生 \"1,2\"）", () => {
    // String([1,2]) 的读面是抽象 string（既有精度债）——只钉「不抛」
    const s1 = wrap(`return String([1,2]);`);
    expect(throwName(s1)).toBe("");
    expect(call(s1, "f").result.shape.k).toBe("prim");
    expect(v(wrap(`return \`\${[1,2]}\`;`))).toEqual({ ok: true, value: "1,2" });
    expect(v(wrap(`return [1,2] + "";`))).toEqual({ ok: true, value: "1,2" });
  });

  it("同对象上其它方法的既有报红不变（原生 TypeError）", () => {
    for (const body of [
      `return Array.prototype.slice.call(null);`,
      `return Array.prototype.indexOf.call(null);`,
      `return Array.prototype.map.call(null, x => x);`,
    ]) {
      const src = wrap(body);
      expect(isDefiniteThrow(src, "TypeError"), body).toBe(true);
    }
  });

  it("L2 门禁不再假绿：nullish 接收者的导出函数被判 may-throw", () => {
    // 改前：引擎不记抛 ⇒ 导出函数被判 total ⇒ 0 诊断（假绿）
    const r = checkSource(
      "/t/bug330-nullrecv.js",
      `export function joinCallNull() {
  return Array.prototype.join.call(null);
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(true);
  });

  it("L2 门禁负控制：非 nullish 接收者仍是 total（0 诊断）", () => {
    const r = checkSource(
      "/t/bug330-ok.js",
      `export function joinCallArray() {
  return Array.prototype.join.call([1, 2]);
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});
});

// ---------------------------------------------------------------------------
// 族 59 · 第 1 条 · const 绑定的函数上的成员写（/ 族 43 遗留 5）
// ---------------------------------------------------------------------------
describe("族 59 · 第 1 条 · const 绑定的函数上的成员写（/ 族 43 遗留 5）", () => {
  const bodyFn = (body: string, params: string[] = ["x"]) => {
    const file = parseSource(`function f(${params.join(", ")}) { ${body} }`);
    const decl = (file.program.body as Array<{ type: string; body: never }>).find((s) => s.type === "FunctionDeclaration") as { body: never };
    return absFunction(params, { body: decl.body });
  };
  it("const 函数成员写：值可读、不抛、不重绑；let/非函数/函数声明负控", () => {
    const src = `export function f() {
      const F = function(){};
      F.prototype = { x: 1 };
      return typeof F.prototype.x;
    }`;
    const rec = call(src);
    expect(val(src)).toEqual({ ok: true, value: "number" });
    expect(isNever(rec.throws)).toBe(true);
    const imm = `const F = function(){}; F.prototype = { x: 1 };`;
    const out = transpileSource_____exec_transpile_ts(imm, { source: imm });
    expect(out).toContain('$set(__nudoMpRoot, "prototype", __nudoMpVal)');
    expect(out).not.toContain("F = $set(");
    const letSrc = `let F = function(){}; F.prototype = { x: 1 };`;
    expect(transpileSource_____exec_transpile_ts(letSrc, { source: letSrc })).toContain('F = $rebindable("F", F) ? $set(__nudoMpRoot, "prototype", __nudoMpVal) : F');
    const objSrc = `const o = {}; o.x = 1;`;
    expect(transpileSource_____exec_transpile_ts(objSrc, { source: objSrc })).toContain('o = $rebindable("o", o) ? $set(__nudoMpRoot, "x", __nudoMpVal) : o');
    const fnSrc = `function F(){} F.prototype = { x: 1 };`;
    expect(transpileSource_____exec_transpile_ts(fnSrc, { source: fnSrc })).toContain('F = $rebindable("F", F) ? $set(__nudoMpRoot, "prototype", __nudoMpVal) : F');
  });
  it("body-fn 临时名避让：用户撞名仍求值；不撞名负控；避让集来自 AST", () => {
    expect(litValue($call(bodyFn(`const __nudoTm_0 = 7; try { return __nudoTm_0 + x; } catch (e) { return 0; }`), [numLit(5)]))).toEqual({ ok: true, value: 12 });
    expect(litValue($call(bodyFn(`const __nudoE_0 = 7; try { throw new Error("x"); } catch (e) { return __nudoE_0 + x; }`), [numLit(5)]))).toEqual({ ok: true, value: 12 });
    expect(litValue($call(bodyFn(`const __nudoTm_0x = 7; try { return __nudoTm_0x + x; } catch (e) { return 0; }`), [numLit(5)]))).toEqual({ ok: true, value: 12 });
    const file = parseSource(`function f(x) { const __nudoTm_0 = 1; return x; }`);
    const decl = (file.program.body as Array<{ type: string; body: never }>).find((s) => s.type === "FunctionDeclaration") as { body: never };
    const names = bodyIdentNames(decl.body, ["x"]);
    expect(names.has("__nudoTm_0")).toBe(true);
    expect(names.has("x")).toBe(true);
  });
  it("super.m() 删除后抛 TypeError、可 catch；未删/toString/动态原型负控", () => {
    expect(throwsError(call(`export function f() {
      class A { m(){ return 1; } }
      class B extends A { m(){ return super.m(); } }
      delete A.prototype.m;
      return new B().m();
    }`).throws, "TypeError")).toBe(true);
    expect(val(`export function f() {
      class A { m(){ return 1; } }
      class B extends A { n(){ return super.m(); } }
      delete A.prototype.m;
      try { return new B().n(); } catch (e) { return e.constructor.name; }
    }`)).toEqual({ ok: true, value: "TypeError" });
    expect(val(`export function f() {
      class A { m(){ return 1; } }
      class B extends A { m(){ return super.m(); } }
      return new B().m();
    }`)).toEqual({ ok: true, value: 1 });
    const toStr = call(`export function f() {
      class A {}
      class B extends A { n(){ return super.toString(); } }
      return new B().n();
    }`);
    expect(isNever(toStr.throws)).toBe(true);
    const dyn = call(`export function f() {
      class A {}
      A.prototype.m = function(){ return 5; };
      class B extends A { n(){ return super.m(); } }
      return new B().n();
    }`);
    expect(isNever(dyn.throws)).toBe(true);
  });
  it("复合赋值到不可重绑成员：直接/计算键折 3；可重绑与只求值一次负控", () => {
    expect(val(`export function f() {
      function mk(){ return { x: 1 }; }
      return mk().x += 2;
    }`)).toEqual({ ok: true, value: 3 });
    expect(val(`export function f() {
      function mk(){ return { x: 1 }; }
      const k = "x";
      return mk()[k] += 2;
    }`)).toEqual({ ok: true, value: 3 });
    expect(val(`export function f() {
      const o = { x: 1 };
      o.x += 2;
      return o.x;
    }`)).toEqual({ ok: true, value: 3 });
    expect(tupleEls(call(`export function f() {
      let n = 0;
      function mk(){ n++; return { x: 1 }; }
      const r = mk().x += 2;
      return [r, n];
    }`).result)).toEqual([3, 1]);
  });
  it("含内建父的派生 Map/Set 读回条目；缺席/同名/普通 Map 负控", () => {
    expect(val(`export function f() { class MyMap extends Map {} const m = new MyMap([["a", 1]]); return m.get("a"); }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { class MyMap extends Map {} const m = new MyMap([["a", 1]]); return m.has("a"); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { class MyMap extends Map {} const m = new MyMap([["a", 1]]); return m.size; }`)).toEqual({ ok: true, value: 1 });
    expect(val(`export function f() { class MySet extends Set {} const s = new MySet([1, 2]); return s.size; }`)).toEqual({ ok: true, value: 2 });
    expect(val(`export function f() { class MySet extends Set {} const s = new MySet([1, 2]); return s.has(1); }`)).toEqual({ ok: true, value: true });
    expect(val(`export function f() { class MyMap extends Map {} const m = new MyMap([["a", 1]]); return m.get("b"); }`)).toEqual({ ok: true, value: undefined });
    expect(val(`export function f() { class MyMap extends Map { get(k){ return "own"; } } const m = new MyMap([["a", 1]]); return m.get("a"); }`)).toEqual({ ok: true, value: "own" });
    expect(val(`export function f() { const m = new Map([["a", 1]]); return m.get("a"); }`)).toEqual({ ok: true, value: 1 });
  });
});
;

// ---------------------------------------------------------------------------
// CJS 对象字面量导出的 check 面成员桥接
// ---------------------------------------------------------------------------
describe("CJS 对象字面量导出的 check 面成员桥接", () => {
/**
 * `module.exports = { f: fn }`（CJS 对象字面量导出）的函数在
 * **core 的 check 面**不可见：导出表里只有 `module.exports` 本身（default
 * 槽），成员 `f` 查不到 ⇒ 签名退成 `unknown` + 指向错误的 nudo:opaque-result。
 *
 * 修法（core 侧）：`algebra/export-slot.ts` 的 CJS 对象字面量成员桥接
 * （`module.exports = { … }` 的成员登记成可按名查找的导出槽），
 * `algebra/generalize.ts` 消费它（成员调用走 $invoke 桥）。
 *
 * 本文件钉住：
 * - 正控制：CJS 对象字面量导出的成员在 check 面**可按名查到**，签名是实值，
 * 且不再产生 nudo:opaque-result；
 * - 负控制：普通 CJS 具名导出（`exports.f = fn`）行为不变；CJS 成员桥
 * 不得劫持无关的本地函数；
 * - 原生 oracle 对拍（node 另起进程，CJS）：成员挂在 exports 对象上，
 * 调用返回同样的值。
 */









beforeEach(() => {
  resetCheckSourceMemo_____check_check_ts();
  resetGeneralizeMemo();
});

/** CJS 对象字面量导出：成员 greet 挂在 module.exports 上 */
const CJS_OBJECT_SRC = `module.exports = {
  greet: function (name) {
    return "hi " + name;
  },
};
`;

describe("CJS 对象字面量导出的 check 面成员桥接", () => {
  it("成员在签名面可按名查到，返回类型是实值（string）", () => {
    const r = checkSource("/t/cjs.js", CJS_OBJECT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "greet");
    expect(sig, "CJS 对象字面量成员 greet 必须出现在签名面").toBeDefined();
    expect(sig!.display).toContain("string");
    expect(sig!.conf).not.toBe("opaque");
  });

  it("不再产生指向错误的 nudo:opaque-result", () => {
    const r = checkSource("/t/cjs.js", CJS_OBJECT_SRC, pTrue);
    const opaque = r.issues.filter((i) => i.code === "nudo:opaque-result");
    expect(opaque).toEqual([]);
  });

  it("负控制：普通 CJS 具名导出行为不变（exports.f = fn）", () => {
    const src = `exports.greet = function (name) {
  return "hi " + name;
};
`;
    const r = checkSource("/t/cjs2.js", src, pTrue);
    const sig = r.signatures.find((s) => s.name === "greet");
    expect(sig).toBeDefined();
    expect(sig!.display).toContain("string");
  });

  it("负控制：成员桥不得劫持无关的本地函数", () => {
    const src = `function other() {
  return 7;
}
module.exports = {
  greet: function () {
    return 1;
  },
};
`;
    const r = checkSource("/t/cjs3.js", src, pTrue);
    const other = r.signatures.find((s) => s.name === "other");
    expect(other).toBeDefined();
    expect(other!.display).toContain("7");
  });

  it("原生 oracle：CJS 成员挂在 exports 对象上（node 另起进程对拍）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug995-"));
    const mod = join(dir, "mod.cjs");
    writeFileSync(
      mod,
      `module.exports = {
  greet: function (name) {
    return "hi " + name;
  },
};
`,
      "utf8",
    );
    const runner = join(dir, "run.cjs");
    writeFileSync(
      runner,
      `const m = require("./mod.cjs");
console.log(JSON.stringify({ keys: Object.keys(m), value: m.greet("x") }));
`,
      "utf8",
    );
    const res = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    const native = JSON.parse(res.stdout.trim()) as { keys: string[]; value: string };
    expect(native.keys).toContain("greet");
    expect(native.value).toBe("hi x");

    // 引擎侧：成员名可按名查到，返回类型与原生值域一致（string）
    const r = checkSource("/t/cjs.js", CJS_OBJECT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "greet")!;
    expect(sig.display).toContain(typeof native.value);
  });
});
});

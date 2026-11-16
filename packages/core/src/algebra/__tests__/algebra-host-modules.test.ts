/**
 * 模块套件：host/module/import/export 面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, formatShape, serializeCheckJson, extractDeclaredThrows, findFnDirectiveScope, listFnDirectiveScopes, parseSource } from "../index.ts";
import { makeFiles, sidecarOpts, stdOpts, l2Count, sigOf, issuesOf } from "./nudo-constraints.ts";
import { litValue, type Abs as Abs___nudojs_core } from "@nudojs/core";
import { call, isNever, throwsError, resetEngineCaches, effects, val } from "./eval-helpers.ts";
import { tryRunTranspiledDetailed, runTranspiled, callTranspiledExportFull, type EvalFallback, setEvalFallbackCollector } from "../exec/run.ts";
import { renameAbs } from "../key/generalize-key.ts";
import { leqAbs } from "../leq.ts";
import { abs, num, numLit, type Abs } from "../abs.ts";
import { implies, and, gt, ge, lt, le } from "../pred.ts";
import { lit, v, app } from "../term.ts";
import { takeRefineDiags, extractRefinesFromSource, setRefineDiagCollector } from "../refine.ts";
import { takeContractDiags, contractTierOf, resetSidecarLoadFailureCache } from "../contract/contract.ts";
import { hostFnCtorFacet } from "../abs-fn.ts";
import { formatGithubAnnotations, formatGitlabCodeQuality, type CheckReport } from "../check/check-report.ts";
import { extractNudoImportRecords, scanMalformedNudoImports } from "../directive-scan.ts";
import { $lit } from "../exec/runtime/state.ts";
import { resolveExportSource } from "../scan/scan-call-graph.ts";
import { resetCheckSourceMemo } from "../check/check.ts";

// ---------------------------------------------------------------------------
// 导入绑定再绑定的六条调用形态
// ---------------------------------------------------------------------------
describe("导入绑定再绑定的六条调用形态", () => {
/**
 * 分册 03 · 导入函数经本地**别名 / 对象成员**再绑定后 L1 零执法。
 *
 * 根因：`bindExternal()` 把 `import { f }` 写进 `externalFn` /
 * `frame.externals`，而再绑定收集器只查**本地** `knownSet` ⇒
 * `const alias = f` 落进 `frame.names`（shadowed，fail-closed）、
 * `const o = { f }` 的成员根本不登记 ⇒ 调用点拿不到被调方。
 *
 * 修法：收集侧把「外部绑定的再绑定」登记成 `frame.externals` /
 * `frame.externalMembers`（+ 模块表），`normalizeCallee` 覆盖数组元素 /
 * 逗号 / 条件三种同源形态。
 */




const LIB = `export function f(x) { return x; }
`;
const LIB_SIDE = `import { number, fn } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`;

/** 跨模块 caller：lib.js 提供 f，lib.nudo.js 提供契约 */
function check(src: string, file = "/t/forms.js") {
  const { loadModule } = makeFiles({
    "/t/lib.js": LIB,
    "/t/lib.nudo.js": LIB_SIDE,
    [file]: src,
  });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

function violations(r: { issues: Array<{ code: string; actual?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

{
  it("六形态（-1…-6）各报一条 nudo:constraint-violated；负控制：导入函数收到合法实参 ⇒ 零违例（直接 / 别名 / 对象成员）", () => {
  {
    const r = check(`import { f } from "./lib.js";
const alias = f;
const o = { f };
export function direct() { return f(-1); }
export function viaAlias() { return alias(-2); }
export function viaObj() { return o.f(-3); }
export function viaArr() { return [f][0](-4); }
export function viaComma() { return (0, f)(-5); }
export function viaCond(c) { return (c ? f : f)(-6); }
`);
    const v = violations(r);
    expect(v).toHaveLength(6);
    expect(v.map((i) => i.actual).join(" | ")).toContain("-6");
  }
  {
    const r = check(`import { f } from "./lib.js";
const alias = f;
const o = { f };
export function ok() { return f(1); }
export function okAlias() { return alias(2); }
export function okObj() { return o.f(3); }
`);
    expect(violations(r)).toHaveLength(0);
  }
});

  it.each([
    ["alias", `const alias = f; export function use() { return alias(-2); }`],
    ["对象成员", `const o = { f }; export function use() { return o.f(-3); }`],
    ["数组元素", `export function use() { return [f][0](-4); }`],
    ["逗号表达式", `export function use() { return (0, f)(-5); }`],
    ["条件表达式", `export function use() { return (1 ? f : f)(-6); }`],
  ])("%s 单独出现也报一条（import 前缀自动补）", (_name, body) => {
    const r = check(`import { f } from "./lib.js";\n${body}`);
    expect(violations(r)).toHaveLength(1);
  });

}
});

// ---------------------------------------------------------------------------
// sloppy 源的写入语义
// ---------------------------------------------------------------------------
describe("sloppy 源的写入语义", () => {
/**
 * 回归：sloppy 源（`type: commonjs` / `.cjs`）的不可变写入与隐式
 * 全局赋值按 **sloppy** 语义（静默失败 / 建全局），不得按 strict 判确定
 * TypeError / ReferenceError。引擎既已按 sloppy 建模 Annex B 提升，写门
 * 必须同源（run.ts 算出的 sourceStrict 现在进入 Abs 层写门）。
 */




const CJS = [
  `function readonlyWrite() { const o = {}; Object.defineProperty(o, "x", { value: 1, writable: false }); o.x = 2; return o.x; }`,
  `function getterOnlyWrite() { const o = { get x() { return 7; } }; o.x = 9; return o.x; }`,
  `function nonExtensibleNewKey() { const o = Object.preventExtensions({ a: 1 }); o.b = 2; return Object.keys(o).length; }`,
  `function implicitGlobal() { leaked = 1; return 1; }`,
  `module.exports = { readonlyWrite, getterOnlyWrite, nonExtensibleNewKey, implicitGlobal };`,
].join("\n");

{
  for (const [fn, expected] of [
    ["readonlyWrite", 1],
    ["getterOnlyWrite", 7],
    ["nonExtensibleNewKey", 1],
    ["implicitGlobal", 1],
  ] as const) {
    it(`${fn} 恒 total 且值与原生一致（改前 never throws）`, () => {
      const r = call(CJS, fn);
      expect(litValue(r.result), fn).toEqual({ ok: true, value: expected });
      expect(isNever(r.result), fn).toBe(false);
    });
  }

  it("负控制：ESM（strict）下 frozen / readonly 写仍确定抛 TypeError；负控制：ESM 下隐式全局赋值仍确定抛 ReferenceError", () => {
  {
    for (const src of [
      `export function f() { const o = Object.freeze({a:1}); o.a = 2; return o.a; }`,
      `export function f() { const o = {}; Object.defineProperty(o,"x",{value:1,writable:false}); o.x=2; return o.x; }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result)).toBe(true);
      expect(throwsError(r.throws, "TypeError")).toBe(true);
    }
  }
  {
    const r = call(`export function f() { leaked2 = 1; return 1; }`);
    expect(isNever(r.result)).toBe(true);
  }
});

}
});

// ---------------------------------------------------------------------------
// 函数内 const 实参不再静默跳过
// ---------------------------------------------------------------------------
describe("函数内 const 实参不再静默跳过", () => {
/**
 * 分册 03 · 实参是**函数内 `const`** 的调用点整条跳过（假绿）。
 *
 * 根因：`varAbs` 只由模块级求值绑定表构造 ⇒ `const v = -1; f(v)` 的
 * `Identifier` 实参退化成 `absUnknown()` ⇒ `hasInfo === false` ⇒
 * `checkOneCall` 直接跳过；执行态实参回退（`bCalls`）只覆盖顶层语句。
 *
 * 修法：`scan-literal-calls.ts` 在 AST 走查时按作用域收集局部 const 的
 * 静态可判值，调用点解析 `Identifier` 实参时用「模块级 + 局部」合并绑定表
 * （求不出的保持无信息，fail-closed）。
 */




const SIDE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;
const IMP = `/// @nudo:import { positive } from "./std9.nudo.js"\n`;
const FILE = "/t/bug9.js";

function check(body: string) {
  return checkSource(FILE, IMP + body, pTrue, sidecarOpts("std9", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

const DECL = `/** @nudo:contract x positive */
export function f(x) { return x; }

const TOP = -1;
`;


  it("字面量 / 模块级 const / 函数内 const 三条调用点各报一条；函数内 const 单独出现也报（位置不决定判定）；负控制：函数内 const 是合法值 ⇒ 零违例；负控制：求不出值的局部绑定不发明义务", () => {
  {
    const r = check(`${DECL}export function literal() { return f(-1); }
export function topConst() { return f(TOP); }
export function localConst() { const v = -1; return f(v); }`);
    expect(violations(r)).toHaveLength(3);
  }
  {
    const r = check(`${DECL}export function localConst() { const v = -1; return f(v); }`);
    expect(violations(r)).toHaveLength(1);
    expect(r.issues.find((i) => i.code === "nudo:constraint-violated")?.expected).toBe("x > 0");
  }
  {
    const r = check(`${DECL}export function ok() { const v = 1; return f(v); }`);
    expect(violations(r)).toHaveLength(0);
  }
  {
    const r = check(`${DECL}export function unknown() { const v = f(TOP); return f(v); }`);
    // TOP 那条仍应报；v 的值不可静态判定 ⇒ 不额外造违例
    expect(violations(r)).toHaveLength(1);
  }
});




});

// ---------------------------------------------------------------------------
// native user-code exception is a program throw
// ---------------------------------------------------------------------------
describe("native user-code exception is a program throw", () => {
/**
 * 用户代码的宿主原生异常（ReferenceError）被归 `nudo:internal`
 * 「引擎内部缺陷」⇒ 误导排障。修复：`evalFallbackOf` 把非 NudoThrow 的
 * 原生异常归 `module-throw`（程序自身抛），门禁按确定性装载期抛出诊断。
 */




const SRC = `
export function fmt(v) {
  return __nudoMissingNative(v);
}
fmt(1);
`;


  it("fallback reason is module-throw, not internal；check reports nudo:module-throw ReferenceError (no nudo:internal)", () => {
  {
    const attempt = tryRunTranspiledDetailed(SRC, { mode: "analyze" });
    expect(attempt.run).toBeUndefined();
    expect(attempt.fallback?.reason).toBe("module-throw");
    expect(attempt.fallback?.reason).not.toBe("internal");
  }
  {
    const r = checkSource("/t/bug-073-r1.js", SRC, pTrue);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("nudo:module-throw");
    expect(codes).not.toContain("nudo:internal");
    const issue = r.issues.find((i) => i.code === "nudo:module-throw")!;
    expect(issue.message).toContain("ReferenceError");
    expect(issue.expected?.length ?? 0).toBeGreaterThan(0);
  }
});


});

// ---------------------------------------------------------------------------
// renameAbs preserves shape facets
// ---------------------------------------------------------------------------
describe("renameAbs preserves shape facets", () => {
/**
 * `renameAbs` 重建 shape 时丢 facet（fn.optionalParams /
 * tuple.holes）⇒ α-重命名后稀疏元组被误判可赋给稠密元组（假绿）。
 */





const fnAbs = (o: boolean[]): Abs =>
  abs(
    { k: "fn", params: ["a"], optionalParams: o, paramTypes: [num()] },
    undefined,
    undefined,
    "exact",
  );

const tupleAbs = (holes?: number[]): Abs =>
  abs(
    { k: "tuple", elements: [numLit(1), numLit(2)], ...(holes ? { holes } : {}) },
    undefined,
    undefined,
    "exact",
  );

const RENAME = new Map([["A1", "zzz"]]);


  it("keeps fn.optionalParams；keeps tuple.holes；renamed sparse tuple is still not assignable to dense tuple", () => {
  {
    const renamed = renameAbs(fnAbs([true]), RENAME);
    expect(renamed.shape).toMatchObject({ k: "fn", optionalParams: [true] });
  }
  {
    const renamed = renameAbs(tupleAbs([1]), RENAME);
    expect(renamed.shape).toMatchObject({ k: "tuple", holes: [1] });
  }
  {
    expect(leqAbs(tupleAbs([1]), tupleAbs()).ok).toBe(false);
    expect(leqAbs(renameAbs(tupleAbs([1]), RENAME), tupleAbs()).ok).toBe(false);
  }
});



});

// ---------------------------------------------------------------------------
// goal 侧 gt/lt 不得按实数环抵消常量
// ---------------------------------------------------------------------------
describe("goal 侧 gt/lt 不得按实数环抵消常量", () => {
/**
 * 目标侧 `gt` / `lt` 的**常量抵消**丢掉内层 IEEE 舍入
 *
 * 目标侧严格比较走 `normCmp` 的「`a − b op 0`」归一，常量被**精确抵消**
 * ⇒ `fl(x+1) − 1` 被当成 `x` ⇒ 内层的 `fl` 吸收被抹掉
 * ⇒ `x > 0 ⊨ x + 1 > 1`（反例 x = 2^-53：`fl(x+1) === 1`）⇒ 假事实
 * ⇒ 比较折成字面量 `true` ⇒ 签名面造假 + L1 契约门禁假绿 + 死臂消除。
 *
 * 同命题的 `>=` 变体走 `proveCmpDirect` 的**直接比较**（不抵消常量），
 * 本来就健全 ⇒ 必须仍成立（本文件同时钉住这一对口径）。
 *
 * 修法：线性形携带源表达式「原子 ⊕ 常量」的舍入次数与常量量级
 * （`Lin.rounds` / `Lin.addConstMag`），目标侧端点按
 * `rounds × ½ulp(量级)` 外扩——只放宽不出错。
 */




const x = v("x");
const plus = (t: ReturnType<typeof v>, k: number) => app("+", [t, lit(k)]);
const minus = (t: ReturnType<typeof v>, k: number) => app("-", [t, lit(k)]);


  it("宿主 IEEE 见证：2^-53 + 1 被吸收成 1；x > 0 ⊬ x + 1 > 1（反例 x = 2^-53）；x > 0 ⊨ x + 1 >= 1（同命题的 ge 变体：IEEE 恒真，直接比较路径）；x < 0 ⊬ x - 1 < -1（反例 x = -2^-53）；x < 0 ⊨ x - 1 <= -1（le 变体健全）；死臂消除级联：x > 0 时 `x + 1 <= 1` 仍可能真 ⇒ 不得证伪", () => {
  {
    expect(2 ** -53 + 1).toBe(1);
  }
  {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(1)))).toBe(false);
  }
  {
    expect(implies(gt(x, lit(0)), ge(plus(x, 1), lit(1)))).toBe(true);
  }
  {
    expect(-(2 ** -53) - 1).toBe(-1);
    expect(implies(lt(x, lit(0)), lt(minus(x, 1), lit(-1)))).toBe(false);
  }
  {
    expect(implies(lt(x, lit(0)), le(minus(x, 1), lit(-1)))).toBe(true);
  }
  {
    // 反例 x = 2^-53：x > 0 真、fl(x+1) = 1 ⇒ x + 1 <= 1 真
    expect(2 ** -53 > 0 && 2 ** -53 + 1 <= 1).toBe(true);
    expect(implies(gt(x, lit(0)), lt(plus(x, 1), lit(1)))).toBe(false);
    expect(implies(gt(x, lit(0)), le(plus(x, 1), lit(0)))).toBe(false);
  }
});







describe("不抵消常量的真事实仍可证（精度不回退）", () => {
  it("x > 0 ⊨ x + 1 > 0（常量未被抵消，端点保留 1 ULP 余量）；x > 1 ⊨ x + 1 > 1；x > 1 ⊨ x * 3 > 3（乘法严格端点在拐点处仍越过真值）；x ≥ 5 ∧ y ≤ 2 ⊨ x − y ≥ 3", () => {
  {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(0)))).toBe(true);
  }
  {
    expect(implies(gt(x, lit(1)), gt(plus(x, 1), lit(1)))).toBe(true);
  }
  {
    // fl(3 * nextUp(1)) = 3.0000000000000004 > 3（与 x+1 的吸收不同）
    expect(3 * (1 + 2 ** -52)).toBeGreaterThan(3);
    expect(implies(gt(x, lit(1)), gt(app("*", [x, lit(3)]), lit(3)))).toBe(true);
  }
  {
    expect(implies(and(ge(x, lit(5)), le(v("y"), lit(2))), ge(app("-", [x, v("y")]), lit(3)))).toBe(true);
  }
});



});
});

// ---------------------------------------------------------------------------
// lastIndexOf 的 fromIndex 第三态
// ---------------------------------------------------------------------------
describe("lastIndexOf 的 fromIndex 第三态", () => {
/**
 * `Array.prototype.lastIndexOf(x, undefined)`：**fromIndex 缺省**
 * 与 **fromIndex 显式 undefined** 被混为一谈（`toIOI` 对两者都返回
 * undefined）⇒ 起始下标取 `len-1`（扫全表）而原生取 0（只扫第 0 位）。
 *
 * 原生规则（ES2023 Array.prototype.lastIndexOf）：
 * - `lastIndexOf(x)`（fromIndex 缺省）⇒ pos = len - 1；
 * - `lastIndexOf(x, undefined)`（fromIndex **在场**）⇒
 * `ToIntegerOrInfinity(undefined) = 0` ⇒ pos = 0。
 *
 * 根修：fromIndex 取第三态（缺省 / 显式 undefined / 数值）——`toIOIArg`
 * （arr-methods.ts）在 `toIOI` 的数值判定之上只补「实参在不在」这一维。
 */



const val = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  return (r.result as { term?: { op?: string; value?: unknown } })?.term?.value;
};


  it("lastIndexOf(2, undefined)：起始下标 0 ⇒ 扫不到 ⇒ -1（原生）；对照：lastIndexOf(2)（fromIndex 缺省）⇒ 起始 len-1 ⇒ 1（原生）；对照：lastIndexOf(2, 0) ⇒ 起始 0 ⇒ -1（原生）；对照：indexOf(2, undefined) ⇒ 起始 0（缺省与显式 undefined 同为 0）", () => {
  {
    expect(val(`return [1,2,3].lastIndexOf(2, undefined);`)).toBe(-1);
  }
  {
    expect(val(`return [1,2,3].lastIndexOf(2);`)).toBe(1);
  }
  {
    expect(val(`return [1,2,3].lastIndexOf(2, 0);`)).toBe(-1);
  }
  {
    expect(val(`return [1,2,3].indexOf(2, undefined);`)).toBe(1);
    expect(val(`return [1,2,3].indexOf(2);`)).toBe(1);
  }
});




});

// ---------------------------------------------------------------------------
// @nudo:skip 的机器面必须与人类面一致
// ---------------------------------------------------------------------------
describe("@nudo:skip 的机器面必须与人类面一致", () => {
/**
 * `@nudo:skip` 签名分支仍输出**旧机器面** ⇒ 机器面与人类面不一致。
 *
 * 位置：packages/core/src/algebra/check.ts 的 `@nudo:skip` 分支——其它签名路径
 * 都用 `formatSigCached`（display = **人类面**渲染 `formatShape`，与终端签名行
 * 逐字同源；detail = 稳定 term id 版），唯独 skip 分支还在用 `formatAbs` /
 * `formatAbsMultiline`（带 `#conf` 段与引擎内部 term 文本）。
 *
 * 现象：`/** @nudo:skip => number() *\/ export function f(){return 1}` 的 JSON
 * `display` 是 `"number #exact"`，而终端显示 `"number"` ⇒ 同一函数两个面。
 *
 * 修法：skip 分支改用 `formatSigCached(retAbs, name)`（与其它路径同款）。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const numAbs: Abs = { shape: { k: "prim", type: "number" }, conf: "exact" };
/**
 * 带**引擎内部计数器 id** 的项（`len#3` 一族）——编号随进程漂移 ⇒ 不得进对外
 * 载荷（同款：稳定化后应是 `len`）。
 */
const lenAbs: Abs = {
  shape: { k: "prim", type: "number" },
  term: { op: "var", id: "len#3" },
  conf: "exact",
};

/** 终端签名行的返回位渲染（check-report.ts 用 formatShape(abs)） */
function terminalReturn(abs: Abs): string {
  return formatShape(abs);
}


  it("JSON display 与终端一致（无 #conf 段）；detail 走同一稳定化路径（无引擎内部 term 文本 / 计数器 id）；未声明返回类型（any）⇒ display 仍是人类面口径", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = `
/** @nudo:skip => number() */
export function f() {
  return 1;
}
`;
    const report = checkSource("/t/skip.js", src, pTrue, {
      skips: new Map([["f", numAbs]]),
      fromFile: "/t/skip.js",
    });
    const json = serializeCheckJson(report);
    const sig = json.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.display).toBe(terminalReturn(numAbs));
    expect(sig!.display).toBe("number");
    expect(sig!.display).not.toContain("#exact");
    expect(sig!.display).not.toContain("#");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = `
/** @nudo:skip => number() */
export function f() {
  return 1;
}
`;
    const report = checkSource("/t/skip2.js", src, pTrue, {
      skips: new Map([["f", lenAbs]]),
      fromFile: "/t/skip2.js",
    });
    const json = serializeCheckJson(report);
    const sig = json.signatures.find((s) => s.name === "f")!;
    // 不得带引擎内部计数器 id（`len#N` 一族 —— 编号随进程漂移 ⇒ 载荷不稳定）
    expect(sig.detail).not.toMatch(/len#\d+/);
    expect(sig.detail).toContain("len");
    // 与其它路径同款：首行函数名 + 形状行 + conf 行
    expect(sig.detail.split("\n")[0]).toBe("f");
    expect(sig.detail).toContain("conf: exact");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = `
/** @nudo:skip */
export function h() {
  return 1;
}
`;
    const report = checkSource("/t/skip4.js", src, pTrue, {
      skips: new Map([["h", null]]),
      fromFile: "/t/skip4.js",
    });
    const json = serializeCheckJson(report);
    const sig = json.signatures.find((s) => s.name === "h")!;
    expect(sig.display).toBe("any");
    expect(sig.display).not.toContain("#");
  }
});



});

// ---------------------------------------------------------------------------
// 装载期的转译拒绝归因给每个入口
// ---------------------------------------------------------------------------
describe("装载期的转译拒绝归因给每个入口", () => {
/**
 * 转译器拒绝的构造落在**模块装载期**（module-init）代码里 ⇒
 * L2 fail-closed 归因给**每个**入口。
 *
 * 根因：/ 的归因只认「入口自身跨度 ∪ 入口**可达**的顶层绑定」，
 * 而装载期代码（顶层语句体 / 顶层初始化表达式 / 类定义期的 `static {}`、
 * 静态字段初始化器、计算键、`extends` 表达式）不在任何入口的执行路径里 ⇒
 * 无人背账 ⇒ L2 静默转绿：
 * `export function f(a) { return a.b; }` → f 有 1 条真实 TypeError
 * `const g = () => ({x:1}); g().x++;` 加上面两行 → 零 error（假绿）
 * 但装载期代码先于**任何**入口调用执行 ⇒ 转译器拒绝装载期构造时，每个入口的
 * total 性都不可判定（同一条 fail-closed 证据形状，`@nudo:throws` /
 * `--ignore-throws` 照常放行）。
 *
 * 边界：函数体 / 参数默认值（调用时跑）、实例字段初始化器 / 构造器 / 方法体
 * （`new` / 调用时跑）**不**算装载期 ⇒ 仍按 的可达性归因（不可达
 * 的陪葬入口不背账）。
 *
 * **TS-only 声明语句例外（）**：`namespace` / `import x = require()` 这类
 * 类型层 / 声明层语法的转译拒绝**不**是「入口可能抛」的证据（`.ts` 源码必须
 * 保持零诊断；`namespace` 体里「程序自己的抛」属 module-throw 族，门禁面已
 * 静默）⇒ 不做装载期归因，`nudo check` 与干净模块同判 OK。
 */




const G = `const g = () => ({ x: 1 });`;
const ENTRIES = `export function f(a) { return a.b; }
export function safe() { return 1; }`;


  it("顶层裸语句里的不支持构造 ⇒ f / safe 各 1 条 L2（改前：零 error）；对照：干净孪生模块 ⇒ 只有 f 自己的 TypeError，safe 为 0；顶层 const 初始化表达式（装载期求值）⇒ 每个入口各 1；**未被引用**的类的 static 块 ⇒ 每个入口各 1（类定义期就执行）；**未被引用**的类的静态字段初始化器 ⇒ 每个入口各 1；类定义期的计算键 / extends 表达式 ⇒ 每个入口各 1；负控：不可达 helper / 顶层函数", () => {
  {
    const src = `${G}
g().x++;
${ENTRIES}`;
    const r = checkSource("b1155-1.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
    expect(l2Count(r)).toBe(2);
    expect(r.ok).toBe(false);
  }
  {
    const src = `${G}
${ENTRIES}`;
    const r = checkSource("b1155-2.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(0);
    expect(sigOf(r, "f")).toContain("TypeError");
  }
  {
    const src = `${G}
const z = g().y++;
${ENTRIES}`;
    const r = checkSource("b1155-3.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
    expect(r.ok).toBe(false);
  }
  {
    const src = `${G}
class U { static { g().x++; } }
${ENTRIES}`;
    const r = checkSource("b1155-4.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
  }
  {
    const src = `${G}
class U { static z = g().y++; }
${ENTRIES}`;
    const r = checkSource("b1155-5.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
  }
  {
    const key = checkSource(
      "b1155-6.js",
      `${G}
class U { [g().y++]() {} }
${ENTRIES}`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(key, "f")).toBe(1);
    expect(l2Count(key, "safe")).toBe(1);
    const ext = checkSource(
      "b1155-7.js",
      `${G}
class U extends (g().x++ ? Object : Object) {}
${ENTRIES}`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(ext, "f")).toBe(1);
    expect(l2Count(ext, "safe")).toBe(1);
  }
  {
    for (const src of [
      `${G}
function h() { return g().x++; }
${ENTRIES}`,
      `${G}
function h() { return delete (g() + 1); }
${ENTRIES}`,
    ]) {
      const r = checkSource("b1155-8.js", src, pTrue, stdOpts);
      expect(l2Count(r, "f")).toBe(0);
      expect(l2Count(r, "safe")).toBe(0);
      expect(r.ok).toBe(true);
    }
  }
  {
    for (const decl of [
      `class U { z = g().y++; }`,
      `class U { constructor() { g().y++; } m() { return g().y++; } }`,
      `class U { static z = () => g().y++; }`,
    ]) {
      const r = checkSource("b1155-9.js", `${G}
${decl}
${ENTRIES}`, pTrue, stdOpts);
      expect(l2Count(r, "f")).toBe(0);
      expect(l2Count(r, "safe")).toBe(0);
    }
  }
  {
    const src = `export enum Color { Red = 1, Green = 2 }
export namespace NS { export const v = 1; }
export abstract class B { abstract m(): void; }
export const c = Color.Red;
export const n = NS.v;
export function f() { return 1; }
export function safe() { return 2; }`;
    const r = checkSource("b1155-13.ts", src, pTrue, stdOpts);
    const clean = checkSource(
      "b1155-14.ts",
      `export function f() { return 1; }
export function safe() { return 2; }`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(r)).toBe(0);
    expect(l2Count(r, "B")).toBe(0);
    expect(r.ok).toBe(clean.ok);
    expect(r.ok).toBe(true);
  }
  {
    const r = checkSource(
      "b1155-15.ts",
      `import x = require("./nope.js");
export function f() { return 1; }
export function safe() { return 2; }`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.ok).toBe(true);
  }
  {
    const src = `${G}
g().x++;
export namespace NS { export const v = 1; }
export function f() { return 1; }
export function safe() { return 2; }`;
    const r = checkSource("b1155-16.ts", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(1);
    expect(r.ok).toBe(false);
  }
  {
    const src = `${G}
g().x++;
/**
 * @nudo:throws Error
 */
export function f(a) { return a.b; }
export function safe() { return 1; }`;
    const r = checkSource("b1155-10.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
    expect(l2Count(r, "safe")).toBe(1);
    // 门禁过滤 ≠ 藏事实
    expect(sigOf(r, "f")).toContain("throws");
  }
  {
    const src = `${G}
g().x++;
${ENTRIES}`;
    const r = checkSource("b1155-11.js", src, pTrue, { ...stdOpts, ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(0);
    expect(sigOf(r, "f")).toContain("throws");
    expect(sigOf(r, "safe")).toContain("throws");
  }
  {
    const r = checkSource(
      "b1155-12.js",
      `export function f() { return 1; }
export function safe() { return 2; }`,
      pTrue,
      stdOpts,
    );
    expect(l2Count(r)).toBe(0);
    expect(r.ok).toBe(true);
  }
});














});

// ---------------------------------------------------------------------------
// host global constructor probe
// ---------------------------------------------------------------------------
describe("host global constructor probe", () => {
/**
 * `new Storage()` 被引擎判成 brand `Storage`（自信的错值），
 * 与 `new globalThis.Storage()` 的诚实结论自相矛盾。修复：宿主全局构造器
 * 走宿主可构造性探针 ⇒ 不再把未建模宿主全局当确定类值。
 */




const SRC = `
export function s1() { return new Storage(); }
export function s2() { return new globalThis.Storage(); }
`;


  it("bare host ctor is not reported as a confident brand", () => {
    const r = checkSource("/t/bug-159.js", SRC, pTrue);
    expect(sigOf(r, "s1")).not.toBe("Storage");
    expect(sigOf(r, "s2")).not.toBe("Storage");
  });

});

// ---------------------------------------------------------------------------
// hostFnCtorFacet 的 IsConstructor 判据
// ---------------------------------------------------------------------------
describe("hostFnCtorFacet 的 IsConstructor 判据", () => {
/**
 * 回归：宿主函数可构造性 facet 必须用**规范 IsConstructor 探针**
 * （`Reflect.construct(noop, [], v)` + 恒抛内建表），不得用「有无 prototype
 * 属性」代理。
 *
 * 「有 prototype」既非充分条件（`Symbol` / `BigInt` 有 prototype 但
 * `new Symbol()` 恒抛 TypeError——规范明写「If NewTarget is not undefined,
 * throw」）也非必要条件（`Proxy` 无 prototype 但是合法构造器）。代理判据的
 * 后果：`Reflect.construct(Proxy, …)` 假红 / `Reflect.construct(Symbol, [])`
 * 假绿，且同一值在 `new` 面（走 $new 的宿主探针）与 `Reflect.construct` 面
 * 给出**相反**结论。
 */




const wrap = (body: string) => `export function f() { ${body} }`;


  it("Proxy：无 prototype 但可构造 ⇒ true（旧 prototype 启发式给 false）；Symbol / BigInt：有 prototype 但 [[Construct]] 恒抛 ⇒ false；其余方向保持：箭头/内建方法不可构造，普通函数/类可构造", () => {
  {
    expect(hostFnCtorFacet(Proxy)).toBe(true);
  }
  {
    expect(hostFnCtorFacet(Symbol)).toBe(false);
    expect(hostFnCtorFacet(BigInt)).toBe(false);
  }
  {
    expect(hostFnCtorFacet(() => 1)).toBe(false);
    expect(hostFnCtorFacet(parseInt)).toBe(false);
    expect(hostFnCtorFacet(Math.max)).toBe(false);
    expect(hostFnCtorFacet(function regular() {})).toBe(true);
    expect(hostFnCtorFacet(class K {})).toBe(true);
    expect(hostFnCtorFacet(Array)).toBe(true);
  }
});




describe("Reflect.construct 面的假红/假绿", () => {
  it("construct(Proxy, [target, handler]) 不抛（此前假红 never）；Proxy 作 newTarget 不抛（此前假红 never）；construct(Symbol, []) 定抛 TypeError（此前假绿 unknown）；new 面与 Reflect.construct 面对 Symbol 结论一致（同为定抛）；new Proxy / new Symbol 既有结论不变（Proxy 可构造、Symbol 定抛）", () => {
  {
    const src = wrap(`return Reflect.construct(Proxy, [{}, {}]);`);
    const r = call(src);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  }
  {
    const src = wrap(`return Reflect.construct(Array, [], Proxy);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(false);
    expect(effects(src)).not.toContain("TypeError");
  }
  {
    const src = wrap(`return Reflect.construct(Symbol, []);`);
    expect(throwsError(call(src).throws, "TypeError")).toBe(true);
    expect(isNever(call(src).result)).toBe(true);
  }
  {
    expect(throwsError(call(wrap(`return new Symbol();`)).throws, "TypeError")).toBe(true);
    expect(throwsError(call(wrap(`return Reflect.construct(Symbol, []);`)).throws, "TypeError"))
      .toBe(true);
  }
  {
    expect(throwsError(call(wrap(`return new Proxy({}, {});`)).throws, "TypeError")).toBe(false);
    expect(throwsError(call(wrap(`return new Symbol();`)).throws, "TypeError")).toBe(true);
  }
});




});
});

// ---------------------------------------------------------------------------
// in / delete 的宿主全局接收者不得炸引擎
// ---------------------------------------------------------------------------
describe("in / delete 的宿主全局接收者不得炸引擎", () => {
/**
 * `delete <宿主全局>.x` / `"x" in <宿主全局>` 把**宿主真对象**喂进
 * `$del` / `$delRes` / `$in` ⇒ 引擎**裸 TypeError 崩溃** ⇒ 回落 `internal`
 * ⇒ `nudo check` 对**合法代码**假红（exit 1，还把引擎内部报错原文吐给用户）。
 *
 * `globalThis` / `process` / `Math` … 是自由标识符 ⇒ 转译层原样当接收者发射，
 * 它们**不是 Abs**（没有 `.shape`）。`$get` / `$set` / `$len` / `$idx` /
 * `$idxSet` 都已有 DEC-006 非-Abs 守卫，唯独 `$in` / `$del` / `$delRes` 直接读
 * `o.shape.k` ⇒ `Cannot read properties of undefined (reading 'k')` ⇒ 一处崩
 * ⇒ **整模块**分析作废（导出退化 unknown）。同语义的读 / 写（`globalThis.x`、
 * `globalThis.x = 1`）却不崩——两条路结论互斥。
 *
 * 口径与 `$set` 同款：非 Abs 接收者 fail-closed——`$del` 返回原接收者
 * （写回通道的自赋值 no-op）、`$delRes` / `$in` 返回 `unknown`（键集不可判）。
 */





/** 采集一次 runTranspiled 的回落事件（含 internal） */
function withFallbacks<T>(body: () => T): { out: T; fallbacks: EvalFallback[] } {
  const fallbacks: EvalFallback[] = [];
  setEvalFallbackCollector((f) => fallbacks.push(f));
  try {
    return { out: body(), fallbacks };
  } finally {
    setEvalFallbackCollector(null);
  }
}


  it("\"FLAG\" in globalThis ⇒ 模块正常求值（改前：裸 TypeError / internal 回落）；delete globalThis.x ⇒ 模块正常求值，$del / $delRes 双通道都不崩；负控：普通对象的 in / delete 口径不变（精确判定不被守卫吃掉）", () => {
  {
    const src = `export function f(){ return "FLAG" in globalThis; }`;
    const { out, fallbacks } = withFallbacks(() => runTranspiled(src, { mode: "analyze" }));
    // 改前这里直接抛 `Cannot read properties of undefined (reading 'k')`
    expect(Object.keys(out)).toContain("f");
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    const r = callTranspiledExportFull(out, "f", []);
    // 键集不可判 ⇒ unknown（不得谎称 boolean，更不得谎称 throws TypeError）
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  }
  {
    const src = `export function f(){ return delete globalThis.__nudoProbe; }`;
    const { out, fallbacks } = withFallbacks(() => runTranspiled(src, { mode: "analyze" }));
    expect(Object.keys(out)).toContain("f");
    expect(fallbacks.filter((f) => f.reason === "internal")).toEqual([]);
    const r = callTranspiledExportFull(out, "f", []);
    expect(r.result.shape.k).toBe("unknown");
    expect(r.throws.shape.k).toBe("never");
  }
  {
    const { out } = withFallbacks(() =>
      runTranspiled(
        `export function f(){ const o = { a: 1 }; return "a" in o; }
export function g(){ const o = { a: 1 }; return delete o.a; }`,
        { mode: "analyze" },
      ),
    );
    expect(callTranspiledExportFull(out, "f", []).result.shape).toEqual({ k: "prim", type: "boolean" });
  }
});



});

// ---------------------------------------------------------------------------
// contract 档单一读取口不为导出别名伪造派生档
// ---------------------------------------------------------------------------
describe("contract 档单一读取口不为导出别名伪造派生档", () => {
/**
 * LSP `semanticTokens` 把「导出别名」（`export const alias = target;`）
 * 判成 **函数 + 契约档(derived)**，而 `documentSymbol` 判 Variable、
 * CodeLens / hover 判**不在契约档** ⇒ 同一绑定三面互斥。
 *
 * 根因在 core 的**单一读取口** `contractTierOf`（`contract.ts`，A7：CodeLens
 * / hover / inlay / semantic tokens 共用，保证「同源」）：`implicit` 回落只看
 * `localNamedExports` ⇒ 任何本地具名导出都拿到 implicit 档 ⇒ derived 修饰。
 *
 * 钉：无契约的**导出别名 / 变量导出**不进档（undefined）；真正的函数位才有
 * implicit 档；有契约的函数位仍是 handwritten。
 */





const SRC = `export function target() {
  return 1;
}

export const alias = target;
export const notAFn = 1;
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";

export const target = fn({}, number());
`;

function tier(name: string, source = SRC) {
  const { loadModule } = makeFiles({ "/t/a.nudo.js": SIDECAR });
  return contractTierOf(source, name, "/t/a.js", { loadModule, fromFile: "/t/a.js" });
}

{
  beforeEach(() => {
    resetSidecarLoadFailureCache();
    takeContractDiags();
    takeRefineDiags();
  });

  it("导出别名（无契约）⇒ 不进 contract 档（旧口径给 implicit ⇒ derived）；变量导出（无契约）⇒ 不进 contract 档；真正的函数位（无契约）⇒ implicit 档（既有行为不变）；有契约的函数位 ⇒ handwritten（与 CodeLens 同源）", () => {
  {
    resetSidecarLoadFailureCache();
    takeContractDiags();
    takeRefineDiags();


    expect(tier("alias")).toBeUndefined();
  }
  {
    resetSidecarLoadFailureCache();
    takeContractDiags();
    takeRefineDiags();


    expect(tier("notAFn")).toBeUndefined();
  }
  {
    resetSidecarLoadFailureCache();
    takeContractDiags();
    takeRefineDiags();


    const source = `export function bare() {\n  return 1;\n}\n`;
    const t = tier("bare", source);
    expect(t?.source).toBe("implicit");
  }
  {
    resetSidecarLoadFailureCache();
    takeContractDiags();
    takeRefineDiags();


    expect(tier("target")?.source).toBe("handwritten");
  }
});



}
});

// ---------------------------------------------------------------------------
// env 全局名是 strict-mode 保留字时不得打挂整个模块
// ---------------------------------------------------------------------------
describe("env 全局名是 strict-mode 保留字时不得打挂整个模块", () => {
/**
 * core 把 env 全局注入成裸 `let <名字>` 绑定 ⇒ 名字是
 * **strict-mode 保留字**（`default` / `static` / `implements` …）时
 * `new Function` 抛 `SyntaxError: Unexpected strict mode reserved word`
 * ⇒ **整个模块 fail-closed**（导出全退 unknown）⇒ `nudo:internal` + exit 1。
 *
 * 注入点是 `exec/run.ts` 的 env 注入：查表键 `JSON.stringify(k)` 加了引号，
 * **绑定名** `${k}` 没有。而 harvester 的 `emitEnvModule` 对**任何**带 default
 * 导出的包必产一个 `default` 全局（`@types/lodash` 的 `export = _` 即命中）
 * ⇒ 那份 env 模块让**引用它的每个工程**整模块求值失败。
 *
 * 修法（与 「模块级绑定优先」同族、同一个拼接点）：注入前校验
 * **绑定名合法性**（合法标识符 ∧ 非关键字 ∧ 非 strict-mode 保留字 ∧ 非
 * `eval`/`arguments`/`await`）；非法名**不注入**——该 env 全局当不存在，
 * 绝不让一个 env 文件里的名字把用户的整个文件打挂。
 */




/** 一个普通的 number Abs（env 全局值不重要——被检验的是**名字**） */
const NUM: Abs = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");

const MODULE = `export function use() { return 1; }`;


  it("globals { default } ⇒ 模块仍可求值（改前：new Function SyntaxError / 整模块失败）；globals { static, implements, package } ⇒ 模块仍可求值；非标识符名（`a-b` / 空串）⇒ 跳过注入，模块仍可求值；负控：**合法** env 名照旧注入并生效（守卫不得把 env 面整体关掉）", () => {
  {
    const out = runTranspiled(MODULE, { envGlobals: { default: NUM } });
    expect(Object.keys(out)).toContain("use");
    expect(callTranspiledExportFull(out, "use", []).result.shape.k).toBe("prim");
  }
  {
    const out = runTranspiled(MODULE, {
      envGlobals: { static: NUM, implements: NUM, package: NUM },
    });
    expect(Object.keys(out)).toContain("use");
  }
  {
    const out = runTranspiled(MODULE, { envGlobals: { "a-b": NUM, "": NUM } });
    expect(Object.keys(out)).toContain("use");
  }
  {
    const out = runTranspiled(`export function use() { return probeName; }`, {
      envGlobals: { probeName: NUM },
    });
    const r = callTranspiledExportFull(out, "use", []);
    expect(r.result.shape.k).toBe("prim");
    expect(r.throws.shape.k).toBe("never");
  }
});




});

// ---------------------------------------------------------------------------
// 同名 @nudo:import 绑定
// ---------------------------------------------------------------------------
describe("同名 @nudo:import 绑定", () => {
/**
 * 回归：两条 `@nudo:import` 绑**同一个本地名** ⇒ 静默取后者。
 *
 * 根因：`collectConstraints` 用 `map.set(name, v)`，后写覆盖先写，零冲突
 * 检测零诊断 ⇒ 契约裁决随**行序**翻转（native ESM 是 SyntaxError：模块
 * 根本不装载）。
 *
 * 修法：**拒绝绑定**该本地名（不猜哪条赢——猜错就是静默的假绿/假红）+
 * 报 error 级诊断（nudo:contract-name-clash）。
 */




beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

const SRC = `
/// @nudo:import { positive } from "./a.nudo.js"
/// @nudo:import { positive } from "./b.nudo.js"
/**
 * @nudo:contract x positive
 */
export function inc(x) {
  return x + 1;
}
`;


  it("报 nudo:contract-name-clash 并点名冲突的本地名与两个来源；拒绝绑定冲突的本地名（不静默取后者）→ 契约段拿不到约束；不冲突的 import 仍正常绑定", () => {
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const { loadModule } = makeFiles({
      "/t/a.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "/t/b.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(100);\n`,
    });
    extractRefinesFromSource(SRC, "inc", { loadModule, fromFile: "/t/dup.js" });
    const clash = diags.find((d) => d.code === "nudo:contract-name-clash");
    expect(clash).toBeDefined();
    expect(clash?.message).toContain("'positive'");
    expect(clash?.message).toContain("./a.nudo.js");
    expect(clash?.message).toContain("./b.nudo.js");
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const { loadModule } = makeFiles({
      "/t/a.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
      "/t/b.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(100);\n`,
    });
    const entries = extractRefinesFromSource(SRC, "inc", {
      loadModule,
      fromFile: "/t/dup.js",
    });
    expect(entries).toHaveLength(0);
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const ok = `
/// @nudo:import { positive } from "./a.nudo.js"
/**
 * @nudo:contract x positive
 */
export function inc(x) {
  return x + 1;
}
`;
    const { loadModule } = makeFiles({
      "/t/a.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(ok, "inc", {
      loadModule,
      fromFile: "/t/ok.js",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.param).toBe("x");
    expect(
      diags.some((d) => d.code === "nudo:contract-name-clash"),
    ).toBe(false);
  }
});



});

// ---------------------------------------------------------------------------
// 工作区根裁剪要过路径边界（兄弟目录不得被裁）
// ---------------------------------------------------------------------------
describe("工作区根裁剪要过路径边界（兄弟目录不得被裁）", () => {
/**
 * GHA / GitLab 注解读取用**裸 `startsWith` 前缀**裁工作区路径 ⇒
 * **兄弟目录**（`…/app` vs `…/app2`）被裁成 `2/src/x.js`（指向**不存在**的
 * 文件）⇒ 注解的 `file=` / Code Quality 的 `location.path` / `fingerprint`
 * **全错**。
 *
 * 修法（core/algebra/check-report.ts）：前缀命中后，余下部分必须是**空**或
 * 以**路径分隔符**开头 ⇒ 才是「同一棵树下的子路径」；否则（`app2` vs `app`）
 * 原样保留完整路径。
 */



const report = (file: string): CheckReport => ({
  file,
  ok: true,
  signatures: [],
  summary: { errors: 0, warnings: 0, infos: 1, functions: 0 },
  issues: [
    {
      severity: "info",
      code: "nudo:contract-entry-only",
      message: "export 'b' has no contract root and no call-site domain (entry-only)",
      line: 1,
      column: 7,
    },
  ],
});

const WS = "/ws/app";


  it("GHA 注解：兄弟目录 app2 不得被裁成 2/src/x.js；GHA 注解：真子路径仍按工作区相对路径裁（app/src/x.js → src/x.js）；GitLab Code Quality：location.path 不得被裁成 2/src/x.js；GitLab Code Quality：真子路径仍按工作区相对路径裁；无工作区根 ⇒ 原样保留完整路径", () => {
  {
    const out = formatGithubAnnotations(report("/ws/app2/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out).toContain("file=/ws/app2/src/x.js");
    expect(out).not.toContain("file=2/src/x.js");
  }
  {
    const out = formatGithubAnnotations(report("/ws/app/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out).toContain("file=src/x.js");
  }
  {
    const out = formatGitlabCodeQuality(report("/ws/app2/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out[0]?.location.path).toBe("/ws/app2/src/x.js");
    expect(out[0]?.fingerprint.startsWith("/ws/app2/src/x.js:")).toBe(true);
  }
  {
    const out = formatGitlabCodeQuality(report("/ws/app/src/x.js"), {
      workspaceRoot: WS,
    });
    expect(out[0]?.location.path).toBe("src/x.js");
    expect(out[0]?.fingerprint.startsWith("src/x.js:")).toBe(true);
  }
  {
    const out = formatGitlabCodeQuality(report("/ws/app2/src/x.js"));
    expect(out[0]?.location.path).toBe("/ws/app2/src/x.js");
  }
});





});

// ---------------------------------------------------------------------------
// 签名 detail 不得串号（共享 never Abs 的第 2/3 个函数）
// ---------------------------------------------------------------------------
describe("签名 detail 不得串号（共享 never Abs 的第 2/3 个函数）", () => {
/**
 * `nudo check --json` 的 `signatures[].detail` **串号**：共享同一
 * `never` Abs（模块级单例）的第 2、3 个函数显示的是**第一个函数的名字** ⇒
 * JSON 信封**字段间自相矛盾**（`name` 与 `detail` 对不上）。
 *
 * 根因：`sigFormatCache`（`WeakMap<Abs, {display, detail}>`）按 **Abs 对象
 * 身份**缓存，但缓存值 `detail` **内嵌函数名**（`formatAbsMultiline(abs,
 * name)`）⇒ 缓存键必须覆盖值的全部依赖。
 *
 * 修法（core/algebra/check-signatures.ts）：缓存键改为 **(Abs 身份, 函数名)**
 * （WeakMap<Abs, Map<name, entry>>）。
 */



const SRC = `
export function a() { throw new Error("x"); }
export function b() { throw new Error("y"); }
export function c() { throw new Error("z"); }
`;


  it("三个函数的 detail 各自带自己的名字；detail 的首行与 name 一致（JSON 信封字段间不矛盾）", () => {
  {
    const r = checkSource("/t/bug377.js", SRC, pTrue);
    const sigs = r.signatures.filter((s) => ["a", "b", "c"].includes(s.name));
    expect(sigs.length).toBe(3);
    for (const s of sigs) {
      expect(s.detail.split("\n")[0]).toBe(s.name);
    }
  }
  {
    const r = checkSource("/t/bug377.js", SRC, pTrue);
    const json = JSON.parse(
      JSON.stringify(r.signatures.map((s) => ({ name: s.name, detail: s.detail }))),
    ) as Array<{ name: string; detail: string }>;
    for (const s of json) {
      expect(s.detail.startsWith(`${s.name}\n`)).toBe(true);
    }
  }
});


});

// ---------------------------------------------------------------------------
// `+` 运算符面的用户转换钩子真调用
// ---------------------------------------------------------------------------
describe("`+` 运算符面的用户转换钩子真调用", () => {
/**
 * 用户转换钩子（`valueOf` / `toString` / `@@toPrimitive` / `toJSON`）
 * 从不被调用：确定 `no-throw` 假阴性 + 状态确折错值。
 *
 * 修前（HEAD）：隐式强转路径对 user obj 的钩子槽**只做存在性判定**（探到槽就
 * 不折默认标签）⇒ 钩子体**从不执行** ⇒
 * - 钩子副作用（计数器 / 捕获变量写）全丢：`valueOfCounter() => 0`
 * - 钩子体**确定抛错**的代码被折成**确定不抛**：`hookThrowerCall() => "no-throw"`
 * （native "threw"）——L2 `entry-may-throw` 对必然抛错的入口完全无感。
 *
 * 修后：钩子体**真调用**（`$invoke` 调用面：objects.ts 的
 * `coercionHookOf` / `invokeToPrimitiveHook` / `invokeCoercionHook`）——
 * 副作用发生、throw 域随之而来（钩子体抛错 → NudoThrow 传播 ⇒ 用户 try/catch
 * 可吸收 ⇒ 原生同款）。
 *
 * oracle：node v26 实测（`node -e` 逐条对照）。
 */




  it("`o + o`：valueOf 被调两次（native：每个操作数各一次）；`o + \"\"`：toString 被调一次（native：1）；`o + 1`：[Symbol.toPrimitive] 被调一次（native：1）；模板串面：`${o}` 走同一条 ToPrimitive 闸门（native：1）", () => {
  {
    expect(
      val(`export function f() { let n = 0; const o = { valueOf(){ n++; return 1; } }; o + o; return n; }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    expect(
      val(`export function f() { let n = 0; const o = { toString(){ n++; return "s"; } }; o + ""; return n; }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        `export function f() { let n = 0; const o = { [Symbol.toPrimitive](){ n++; return 1; } }; o + 1; return n; }`,
      ),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(`export function f() { let n = 0; const o = { toString(){ n++; return "s"; } }; const s = \`\${o}\`; return n; }`),
    ).toEqual({ ok: true, value: 1 });
  }
});





describe("钩子体抛错 ⇒ 抛错域不再被折成 no-throw", () => {
  it("`o + 1` 的 valueOf 抛错 ⇒ 用户 try/catch 捕到（native：\"threw\"）；`o + \"\"` 的 toString 抛错 ⇒ 用户 try/catch 捕到（native：\"threw\"）；入口 throws 面记下钩子体的错误类型（钩子体必然抛错 ⇒ 入口不再折 never）", () => {
  {
    expect(
      val(
        `export function f() { const o = { valueOf(){ throw new Error("v"); } }; try { o + 1; } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
  {
    expect(
      val(
        `export function f() { const o = { toString(){ throw new Error("s"); } }; try { o + ""; } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
  {
    const rec = call(
      `export function f() { const o = { valueOf(){ throw new Error("v"); } }; o + 1; return 1; }`,
    );
    // 原生：钩子体抛的 Error 直接传播 ⇒ 入口的 throws 面就是用户的 Error
    expect(throwsError(rec.throws, "Error")).toBe(true);
  }
});


});

describe("JSON.stringify 的 toJSON 步真调用", () => {
  it("toJSON 钩子被调一次（native：1）；toJSON 钩子抛错 ⇒ 用户 try/catch 捕到（native：\"threw\"）", () => {
  {
    expect(
      val(`export function f() { let n = 0; const o = { toJSON(){ n++; return 1; } }; JSON.stringify(o); return n; }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(
      val(
        `export function f() { const o = { toJSON(){ throw new Error("j"); } }; try { JSON.stringify(o); } catch { return "threw"; } return "no-throw"; }`,
      ),
    ).toEqual({ ok: true, value: "threw" });
  }
});

});

describe("new Error(对象实参) 走 ToString ⇒ 钩子真调用", () => {
  it("toString 钩子抛错 ⇒ 构造面抛（native：throw Error: boom）", () => {
    const rec = call(
      `export function f() { return new Error({ toString(){ throw new Error("boom"); } }).message; }`,
    );
    expect(throwsError(rec.throws, "Error")).toBe(true);
  });
});

describe("对照组（无钩子 / 直接调用）不得回归", () => {
  it("无钩子的对象不产生任何钩子副作用；直接调用 o.valueOf() 仍调一次（对照组）；`{a:1} + ''` 仍折 \"[object Object]\"（无钩子 → 缺省 toString）", () => {
  {
    expect(val(`export function f() { let n = 0; const o = {}; o + ""; return n; }`)).toEqual({
      ok: true,
      value: 0,
    });
  }
  {
    expect(
      val(`export function f() { let n = 0; const o = { valueOf(){ n++; return 1; } }; o.valueOf(); return n; }`),
    ).toEqual({ ok: true, value: 1 });
  }
  {
    expect(val(`export function f() { return {a:1} + ''; }`)).toEqual({
      ok: true,
      value: "[object Object]",
    });
  }
});


});
});

// ---------------------------------------------------------------------------
// block-comment @nudo:import is not a file-level import
// ---------------------------------------------------------------------------
describe("block-comment @nudo:import is not a file-level import", () => {
/**
 * `@nudo:import` 写在**块注释**里也是**生效的**文件级 import
 * （而 `@nudo:env` / `@nudo:mock-module` 在块注释里被忽略并告警）。
 *
 * 根因（core 文本扫描通道）：`directiveCommentLinesRaw` 把行注释与块注释
 * **拍平成同一个列表**且丢掉 `kind` ⇒ `nudoImportPayloads` 分不出两种注释
 * ⇒ 块注释里的 import **真的生效**（真的去装载那个侧车）。
 *
 * 本钉锁：两种注释形态**必须分档** —— 行注释生效 / 块注释忽略
 * （口径与 parser AST 通道一致：块注释形态被忽略并告警）。
 */



const BLOCK = `/* @nudo:import { positive } from "./c.nudo.js" */\nexport function inc(x) { return x + 1; }\n`;
const JSDOC = `/** @nudo:import { positive } from "./c.nudo.js" */\nexport function inc(x) { return x + 1; }\n`;
const LINE = `/// @nudo:import { positive } from "./c.nudo.js"\nexport function inc(x) { return x + 1; }\n`;
const LINE2 = `// @nudo:import { positive } from "./c.nudo.js"\nexport function inc(x) { return x + 1; }\n`;


  it("block comment form yields no import record (was effective)；JSDoc block form yields no import record (was effective)；line comment forms still work (control)；a block comment does not shadow the line comment beside it；block comment form is not", () => {
  {
    expect(extractNudoImportRecords(BLOCK)).toEqual([]);
  }
  {
    expect(extractNudoImportRecords(JSDOC)).toEqual([]);
  }
  {
    expect(extractNudoImportRecords(LINE)).toHaveLength(1);
    expect(extractNudoImportRecords(LINE2)).toHaveLength(1);
  }
  {
    expect(
      extractNudoImportRecords(
        `/* @nudo:import { positive } from "./c.nudo.js" */\n/// @nudo:import { negative } from "./d.nudo.js"\n`,
      ).map((r) => r.names[0]),
    ).toEqual(["negative"]);
  }
  {
    expect(scanMalformedNudoImports(BLOCK)).toEqual([]);
  }
});





});

// ---------------------------------------------------------------------------
// 同名遮蔽：按名查找取最浅的 scope
// ---------------------------------------------------------------------------
describe("同名遮蔽：按名查找取最浅的 scope", () => {
/**
 * 函数级指令 scope **按名字查找 + 文档序首个命中**
 * ⇒ **遮蔽函数**偷走导出函数的 `@nudo:throws` ⇒ **L2 门禁假绿**。
 *
 * 根因（`directive-scan.ts` 的 `findFnDirectiveScope`）：scope 名**不唯一**
 * （同名遮蔽函数 / 嵌套同名函数），而消费口只按名字 + 文档序首个命中查找
 * ⇒ 内层 `f` 的 `@nudo:throws *` 被套到导出的 `f` 上 ⇒ 导出 `f` 的
 * `throw` 不再报 `nudo:entry-may-throw`（**假绿**）。
 *
 * 修法：scope 记**词法嵌套深度**（`depth`：顶层函数 / 类成员 = 0，每进入
 * 一层函数体 +1）；按名查找取**最浅**（depth 最小）的那个 ⇒ 与分析面
 * （顶层函数先登记、嵌套同名者跳过）的口径一致。
 */




const SHADOW = `export function h() {
  /**
   * @nudo:throws *
   */
  function f() { return 1; }
  return f();
}

export function f() {
  throw new Error("boom");
}
`;

const CONTROL = `export function f() {
  throw new Error("boom");
}
`;

const SUPPRESSED = `/**
 * @nudo:throws *
 */
export function f() {
  throw new Error("boom");
}
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource(src));
}


  it("按名查找命中的是导出的 f（不是内层遮蔽的 f）；内层遮蔽函数自己的 throws 仍在（只是不再顶替导出函数）；导出 f 的 throws 声明为空（内层的不再顶替）；L2 门禁：导出 f 的 throw 重新被报出来（不再假绿）；对照：无遮蔽时行为不变（仍报 may-throw）；对照：导出 f 自己声明 @nudo:throws * 时不报（抑制仍生效）", () => {
  {
    const scope = findFnDirectiveScope(parseSource(SHADOW), "f");
    expect(scope?.commentLines ?? []).not.toContain("@nudo:throws *");
    // 导出的 f 在文件末尾（行号更大），内层遮蔽的 f 在前面
    const inner = scopesOf(SHADOW).filter((s) => s.name === "f");
    expect(inner.length).toBe(2);
    expect(inner[0].depth).toBe(1);
    expect(inner[1].depth).toBe(0);
    expect(scope?.startLine).toBe(inner[1].startLine);
  }
  {
    const inner = scopesOf(SHADOW).filter((s) => s.name === "f");
    expect(inner[0].commentLines).toContain("@nudo:throws *");
  }
  {
    expect(extractDeclaredThrows(SHADOW, "f")).toBeUndefined();
  }
  {
    expect(l2Count(issuesOf(SHADOW, "/t/b424/shadow.js"), "f")).toBe(1);
  }
  {
    expect(l2Count(issuesOf(CONTROL, "/t/b424/ctrl.js"), "f")).toBe(1);
  }
  {
    expect(l2Count(issuesOf(SUPPRESSED, "/t/b424/sup.js"), "f")).toBe(0);
  }
});






});

// ---------------------------------------------------------------------------
// export 包装形态的 @nudo:as 覆盖命中内层声明
// ---------------------------------------------------------------------------
describe("export 包装形态的 @nudo:as 覆盖命中内层声明", () => {
/**
 * 回归（core 转译层）：`@nudo:as` 写在 **export 包装**形态的声明
 * 前面时，覆盖必须命中**内层声明**。
 *
 * 病灶：指令的**载体节点**是 `ExportNamedDeclaration`（Babel 把前置注释挂
 * 在 export 语句上），而转译面拿到的声明节点是**内层** `VariableDeclaration`
 * ⇒ 两个字符区间不重合 ⇒ `matchAsOverride` 匹配不到 ⇒ 工具打印
 * 「Bindings applied」却类型不变（假成功）。
 *
 * 修法（packages/core/src/algebra/exec/transpile/helpers.ts）：补一条
 * 「export 前缀」匹配——**尾端相同**（export 语句与其内层声明同一处结尾）
 * + **前缀恰是 export 引导词**（`export ` / `export default `）⇒ 命中。
 *
 * 负控制：① 非 export 形态仍按精确区间命中；② **非** export 引导词的同尾
 * 区间不得误命中（fail-closed）。
 */





/** 结果字面量值（非字面量 → "not-lit"） */
function lit(a: Abs___nudojs_core): unknown {
  const r = litValue(a);
  return r.ok ? r.value : "not-lit";
}

/** 源文本中某个片段的字符区间（AST 节点身份） */
function rangeOf(src: string, needle: string): { start: number; end: number } {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`needle not found: ${needle}`);
  return { start, end: start + needle.length };
}


  it("export const：登记区间 = export 语句 ⇒ 内层声明被覆盖；export let / export var：登记区间 = export 语句 ⇒ 内层声明被覆盖；负控制：非 export 形态仍按精确区间命中（行为不退化）；负控制：同尾但**非** export 前缀的区间不得误命中（fail-closed）", () => {
  {
    const src = `export const raw = 1;\n`;
    const target = rangeOf(src, "export const raw = 1;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs___nudojs_core },
      asOverrideTargets: [{ varName: "__as0", stmtStart: target.start, stmtEnd: target.end }],
    });
    const rec = callTranspiledExportFull(exports, "raw", []);
    expect(lit(rec.result)).toBe("s");
  }
  {
    const src = `export let raw = 1;\n`;
    const target = rangeOf(src, "export let raw = 1;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs___nudojs_core },
      asOverrideTargets: [{ varName: "__as0", stmtStart: target.start, stmtEnd: target.end }],
    });
    const rec = callTranspiledExportFull(exports, "raw", []);
    expect(lit(rec.result)).toBe("s");
  }
  {
    const src = `const raw = 1;\nexport function useRaw() { return raw; }\n`;
    const target = rangeOf(src, "const raw = 1;");
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs___nudojs_core },
      asOverrideTargets: [{ varName: "__as0", stmtStart: target.start, stmtEnd: target.end }],
    });
    const rec = callTranspiledExportFull(exports, "useRaw", []);
    expect(lit(rec.result)).toBe("s");
  }
  {
    const src = `/*x*/ const raw = 1;\nexport function useRaw() { return raw; }\n`;
    const stmt = rangeOf(src, "const raw = 1;");
    // 登记区间从头开始（与内层声明同尾，但前缀是块注释，不是 export 引导词）
    const exports = runTranspiled(src, {
      mode: "analyze",
      asOverrides: { __as0: $lit("s") as Abs___nudojs_core },
      asOverrideTargets: [{ varName: "__as0", stmtStart: 0, stmtEnd: stmt.end }],
    });
    const rec = callTranspiledExportFull(exports, "useRaw", []);
    // 未被覆盖 ⇒ 仍是字面量 1（而不是 "s"）
    expect(lit(rec.result)).toBe(1);
  }
});




});

// ---------------------------------------------------------------------------
// 再导出链不被未导出的同名本地函数短路
// ---------------------------------------------------------------------------
describe("再导出链不被未导出的同名本地函数短路", () => {
/**
 * 跨文件**再导出链**被中间模块里一个**未导出的同名本地函数**
 * 短路 ⇒ 被再导出的函数的契约静默失效 ⇒ 真实违约不报（L1 门禁假绿）。
 *
 * 根因：`resolveExportSource` 的短路判据是「源码里出现过这个名字」
 * （listTopFunctions 含**未导出**的本地函数）⇒ 未导出的本地函数被误判成
 * 「该导出名由本模块定义」⇒ 再导出链从不再往下跳。
 * ESM 规则：未导出的本地绑定对模块导出表没有任何影响。
 *
 * 钉住：短路判据 = 「本模块**导出**了这个名字」（localNamedExports）：
 * - 星号再导出 + 同名未导出本地函数 ⇒ 继续往下跳（拿到 dd.js 的定义）
 * - 命名再导出 + 同名未导出本地函数 ⇒ 同上
 * - 端到端：调用点报 nudo:constraint-violated
 */






const DD = `/// @nudo:import { positive } from "./c.nudo.js"
/**
 * @nudo:contract x positive
 */
export function g(x) { return x; }
`;

const CC_STAR = `function g(x) { return x * 2; }\nexport * from "./dd.js";\n`;
const CC_NAMED = `function g(x) { return x * 2; }\nexport { g } from "./dd.js";\n`;

const CNUDO = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

const MAIN = `import { g } from "./cc.js";
g(0);
`;

{
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("resolveExportSource：星号再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js；resolveExportSource：命名再导出 + 同名未导出本地函数 ⇒ 跳到 dd.js；端到端：跨再导出链的调用点报 nudo:constraint-violated", () => {
  {
    resetCheckSourceMemo();


    const r = resolveExportSource(
      CC_STAR,
      "g",
      (spec: string) => (spec === "./dd.js" ? DD : undefined),
      0,
      "/t/cc.js",
      "/t/cc.js",
    );
    expect(r.source).toBe(DD);
    expect(r.fromFile).toBe("/t/dd.js");
  }
  {
    resetCheckSourceMemo();


    const r = resolveExportSource(
      CC_NAMED,
      "g",
      (spec: string) => (spec === "./dd.js" ? DD : undefined),
      0,
      "/t/cc.js",
      "/t/cc.js",
    );
    expect(r.source).toBe(DD);
    expect(r.fromFile).toBe("/t/dd.js");
  }
  {
    resetCheckSourceMemo();


    const { loadModule } = makeFiles({
      "/t/c.nudo.js": CNUDO,
      "/t/dd.js": DD,
      "/t/cc.js": CC_STAR,
    });
    const r = checkSource("/t/main.js", MAIN, pTrue, { loadModule, fromFile: "/t/main.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(r.ok).toBe(false);
  }
});


}
});

/**
 * 模块套件：数值/字面量/比较/算术端点面。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { val, call, resetEngineCaches, objSlots, throwsError, callLit } from "./eval-helpers.ts";
import { litValue, checkSource as checkSource___nudojs_core, pTrue as pTrue___nudojs_core, resetCheckSourceMemo as resetCheckSourceMemo___nudojs_core, resetGeneralizeMemo as resetGeneralizeMemo___nudojs_core, runTranspiled, callTranspiledExportApply, absFunction, litC as litC___nudojs_core, nullable, number as number___nudojs_core, union as union___nudojs_core } from "@nudojs/core";
import { checkSource, resetCheckSourceMemo } from "../check/check.ts";
import { pTrue, implies, and, eq, ge, le, gt, lt, assumeFinite, ne } from "../pred.ts";
import { checkSource as checkSource_____index_ts, pTrue as pTrue_____index_ts, generalizeFromAst, transpileSource, abs, gt as gt_____index_ts, v as v_____index_ts, array, boolean, constraintToEntryAbs, isIntFlag, lit as lit_____index_ts, number as number_____index_ts, string, literalMeetsConstraint, parseSource as parseSource_____index_ts, formatAbs, fn as fn_____index_ts, throwConstraintToKinds, union, checkArg, ge as ge_____index_ts, lenTerm, numLit, strLit, termToString, listFnDirectiveScopes, instantiateReturn, type Abs as Abs_____index_ts, formatShape as formatShape_____index_ts, num as num_____index_ts } from "../index.ts";
import { sidecarOpts, errorsOf, issuesOf, sigOf, makeFiles, stdOpts, l2Count, withStdImport } from "./nudo-constraints.ts";
import { app, lit, simplifyTerm, type Term, v } from "../term.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeContractDiags, formatConstraint, resetSidecarLoadFailureCache } from "../contract/contract.ts";
import { takeRefineDiags, extractRefineReturnFromSource, setRefineDiagCollector, resetNudoModuleExecCache } from "../refine.ts";
import type { CheckIssue } from "../check/check-report.ts";
import { fn, litC, shape, string as str, number, constraintToEntryAbs as constraintToEntryAbs_____constraint_ts, derefConstraint, union as union_____constraint_ts, type NudoConstraint } from "../constraint.ts";
import { evalThrowsOutcome, definiteModuleThrowOf } from "../check/check-may-throw.ts";
import { parseSource } from "../parse-source.ts";
import { throwAbsToKinds, errorTypeAbs } from "../diagnostics/may-throw.ts";
import { litValue as litValue_____abs_ts, type Abs, abs as abs_____abs_ts, type Shape, numLit as numLit_____abs_ts, num, str as str_____abs_ts, absLit, } from "../abs.ts";
import { checkReturnConstraint } from "../check/check-return.ts";
import { assumeConsumed, noteAssumeConsumed, resetAssumeConsumed } from "../assume-ledger.ts";
import { listClassEntryNames } from "../scan/scan-top-functions.ts";
import { $await } from "../exec/runtime/async.ts";
import { leqAbs } from "../leq.ts";
import { literalMeetsConstraint as literalMeetsConstraint_____domain_membership_ts, } from "../domain-membership.ts";
import { tryRunTranspiledDetailed, runTranspiled as runTranspiled_____exec_run_ts, callTranspiledExportFull, } from "../exec/run.ts";
import { formatShape, formatAbs as formatAbs_____format_format_ts, } from "../format/format.ts";
import { denoteGuard } from "../denote.ts";
import { getFnImpl, absFunction as absFunction_____abs_fn_ts, makeAbsApplyResult } from "../abs-fn.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanThrowsDecl, extractMockModuleRecords, parseMockModulePayload } from "../directive-scan.ts";
import { add } from "../arithmetic/addsub.ts";
import { div, mul } from "../arithmetic/muldiv.ts";
import { assertImplies } from "../postcondition.ts";
import { numericBounds, div as div_____arithmetic_ts } from "../arithmetic.ts";
import { evalMathMethod } from "../builtins/math.ts";
import { strictEqAbs } from "../surface.ts";
import { markDomainShared } from "../len-sharing.ts";
import { bindImports, namespaceAbsOf, type AbsModuleExports, collectAbsExports } from "../abs-modules.ts";
import { emptyEnv } from "../ast-env.ts";
import { structuralAssignIssues } from "../check/check-assign.ts";
import type { AbsAssignRecord } from "../ast-records.ts";
import { cmp } from "../arithmetic/cmp.ts";
import { generatedExportNames } from "../scan/scan-named-exports.ts";

// ---------------------------------------------------------------------------
// namespace 不污染同模块其它导出
// ---------------------------------------------------------------------------
describe("namespace 不污染同模块其它导出", () => {
/**
 * 回归：模块里一条非 `declare` 的 `namespace` 此前让转译器抛
 * NudoUnsupportedError ⇒ 整个模块求值失败 ⇒ 同模块无关导出全部退化成
 * unknown（返回契约违例从 error 降成 warning，exit 0 假绿）。
 * 修复：namespace 降级为局部 opaque 绑定，其它导出照常求值。
 */






const PLAIN = `export function bad() { return 1; }
export const top = 7;`;
const POISONED = `export namespace NS { export const x = 1; }
export function bad() { return 1; }
export const top = 7;`;


  it("存在 export namespace 时无关函数仍是精确值（改前 unknown）；顶层常量导出同样不退化；check 面的问题集合与无 namespace 的同一模块一致（不再假绿）", () => {
  {
    expect(val(POISONED.replace("bad", "f"))).toEqual({ ok: true, value: 1 });
  }
  {
    const exp = call(POISONED, "bad");
    expect(litValue(exp.result)).toEqual({ ok: true, value: 1 });
  }
  {
    const codes = (src: string, name: string) =>
      checkSource(`/t/bug47-${name}.ts`, src, pTrue, {})
        .issues.map((i) => i.code)
        .sort()
        .join(",");
    expect(codes(POISONED, "poisoned")).toBe(codes(PLAIN, "plain"));
  }
});



});

// ---------------------------------------------------------------------------
// lit(null) 契约对无信息实参不发明义务
// ---------------------------------------------------------------------------
describe("lit(null) 契约对无信息实参不发明义务", () => {
/**
 * 分册 03 · `lit(null)` 形参契约收到 `any #path` 实参（变量键查找
 * `map[k]`）时误报 `nudo:constraint-violated`（假红）。
 *
 * 根因：`scan/literal-shapes.ts` 的 nullish `eq` 通道把「实参不是 nullish
 * 字面量」直接当确定违例，缺 `any` 守卫；而同函数其它通道（typeof / eq
 * 字面量 / shape）都跳过无信息实参，`scan/literal-args.ts` 产出 `anyAbs`
 * 处也明写「any ≤ 任意目标；≠ unknown 不发明义务」。
 *
 * 既有钉 core-只覆盖字面量实参 ⇒ 本钉补 `any #path` / `any` 形参。
 */




const SIDE = `import { lit } from "@nudojs/core";
export const onlyNull = lit(null);
`;
const IMP = `/// @nudo:import { onlyNull } from "./std5.nudo.js"\n`;
const FILE = "/t/bug5.js";

function check(body: string) {
  return checkSource_____index_ts(FILE, IMP + body, pTrue_____index_ts, sidecarOpts("std5", SIDE, FILE));
}

const DECL = `/** @nudo:contract x onlyNull */
export function f(x) { return 1; }
`;

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}


  it("变量键查找 map[k]（any #path）⇒ 零违例（改前假红）；any 形参作实参 ⇒ 零违例（与 any #path 同口径）；null 字面量放行（434 不回归）；0 字面量仍判违例，expected 指向 x = null", () => {
  {
    const r = check(`${DECL}export function anyPath(map, k) { return f(map[k]); }`);
    expect(violations(r)).toHaveLength(0);
  }
  {
    const r = check(`${DECL}export function anyParam(x) { return f(x); }`);
    expect(violations(r)).toHaveLength(0);
  }
  {
    const r = check(`${DECL}export function use() { return f(null); }`);
    expect(violations(r)).toHaveLength(0);
  }
  {
    const r = check(`${DECL}export function use() { return f(0); }`);
    expect(violations(r)).toHaveLength(1);
    expect(r.issues.find((i) => i.code === "nudo:constraint-violated")?.expected).toBe("x = null");
  }
});




});

// ---------------------------------------------------------------------------
// 含长度界成员的 union 对确定违例必须执法
// ---------------------------------------------------------------------------
describe("含长度界成员的 union 对确定违例必须执法", () => {
/**
 * 分册 03 · `union()` 里只要有一个**长度界 / 结构**成员，整条析取
 * 契约在调用点零义务（假绿）。
 *
 * 根因：`string().min(1)` 实例化成 `ge(length(x), 1)`，根在 app 不在 var ⇒
 * `predOnVar` 判 false ⇒ `orMembersOnVar` 把 `judgeOrUnion` 的整段域兼容
 * 兜底关掉；`memberDomainKind` 也判不出长度界 ⇒ 全部成员落「未决」⇒ 不报。
 * `checkUnionMembers` 只接管形态命中的结构成员 ⇒ 标量实参落回静默通道。
 *
 * 修法：`predOnVar` 把长度界 / 字段界（非结构成员）也算「挂在参数自身」，
 * 并新增 `memberImpossible`（形态级确定假）⇒ 域兜底对这三类成员生效。
 */




const SIDE = `import { number, string, shape, union } from "@nudojs/core";
export const numOrStr = union(number().gt(0), string().min(1));
export const shapeOrNum = union(shape({ id: number().gt(0) }), number().gt(0));
export const numOrStrNoLen = union(number().gt(0), string());
`;
const IMP = `/// @nudo:import { numOrStr, shapeOrNum, numOrStrNoLen } from "./std7.nudo.js"\n`;
const FILE = "/t/bug7.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource_____index_ts(FILE, src, pTrue_____index_ts, sidecarOpts("std7", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

{
  it.each(["0", "true", "{}", "null", '""'])(
    "numOrStr（number().gt(0) | string().min(1)）收到 %s ⇒ 1 条违例",
    (arg) => {
      expect(violations(check("numOrStr", arg))).toHaveLength(1);
    },
  );

  it.each(['5', '"hi"'])(
    "负控制：numOrStr 收到满足某一支的 %s ⇒ 零违例",
    (arg) => {
      expect(violations(check("numOrStr", arg))).toHaveLength(0);
    },
  );
}

describe("含结构成员的 union 对域不兼容实参必须执法", () => {
  it.each(['"z"', "true", "null", "[1]"])(
    "shapeOrNum 收到 %s ⇒ 1 条违例",
    (arg) => {
      expect(violations(check("shapeOrNum", arg))).toHaveLength(1);
    },
  );

  it.each(["{ id: 1 }", "5"])(
    "负控制：shapeOrNum 收到满足某一支的 %s ⇒ 零违例",
    (arg) => {
      expect(violations(check("shapeOrNum", arg))).toHaveLength(0);
    },
  );
});

describe("对照组（无长度界的 union）不回归", () => {
  it.each(["0", "{}"])("numOrStrNoLen 收到 %s ⇒ 仍报 1 条", (arg) => {
    expect(violations(check("numOrStrNoLen", arg))).toHaveLength(1);
  });
});
});

// ---------------------------------------------------------------------------
// 同 prim 字面量 union 作返回契约不得假红
// ---------------------------------------------------------------------------
describe("同 prim 字面量 union 作返回契约不得假红", () => {
/**
 * 同 prim 字面量 union 的**返回契约**假阳性（误报违约）。
 *
 * `union(lit(0), lit(1))` 在 Abs 面上被**特化**成「单个 prim 臂 + 析取谓词」
 * （`samePrimLiteralUnionAbs`）⇒ 该 union 的语义落在**谓词**上，而不是
 * 「多个可判别臂」上。旧的 union 后置检查**逐成员**问「整条臂蕴含某一个
 * 成员」⇒ `x = 0 ∨ x = 1` 不蕴含 `x = 0`（x 可能是 1）⇒ 两个成员都不成立
 * ⇒ `disproved` ⇒ 已被证明满足契约的返回值被判违约（假红，直接卡 CI）。
 *
 * 修法：union 分支**先试整体蕴含**（臂的谓词 ⇒ union 的合并析取），
 * 证不出时才回落逐成员检查（只升级为 proved，不制造新的假绿）。
 *
 * 钉住的行为：
 * - 返回位：`return x`（x 契约 = `status`）对 `@nudo:contract return status`
 * 零 error（改前 1 条 `nudo:constraint-violated`）；
 * - 同 prim 字符串字面量 union 同款；
 * - **负控制**：返回值确定不在 union 内 / 值域宽于 union ⇒ 仍是 error
 * （整体蕴含只放宽「已被证明满足」的那条路）。
 */




/** 侧车：同 prim 字符串字面量 union（自定义约束用） */
const LIB = `
export const ab = union(lit("a"), lit("b"));
`;
const libOpts = () =>
  sidecarOpts("lib.nudo", LIB, "/t/bug001/app.js");


  it("返回位：x 的谓词已证明落在 union 内（status）⇒ 零 error；返回位：同 prim **字符串**字面量 union 同样不得假红；负控制：返回值确定不在 union 内 ⇒ 仍报 error（整体蕴含不放宽确定违约）；负控制：值域宽于 union（x 只是裸 number）⇒ 仍是 error", () => {
  {
    const r = issuesOf(
      `
/**
 * @nudo:contract x status
 * @nudo:contract return status
 */
function echoStatus(x) {
  return x;
}
`,
      "/t/bug001-status.js",
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
    const src = `/// @nudo:import { ab } from "./lib.nudo.js"

/**
 * @nudo:contract x ab
 * @nudo:contract return ab
 */
function echoAb(x) {
  return x;
}
`;
    const r = checkSource_____index_ts("/t/bug001/app.js", src, pTrue_____index_ts, libOpts());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
    const r = issuesOf(
      `
/**
 * @nudo:contract return status
 */
function bad() {
  return 2;
}
`,
      "/t/bug001-bad.js",
    );
    const err = r.issues.find(
      (i) => i.severity === "error" && i.message.includes("@nudo:contract return"),
    );
    expect(err).toBeDefined();
  }
  {
    const r = errorsOf(
      `
/**
 * @nudo:contract x num
 * @nudo:contract return status
 */
function echoNum(x) {
  return x;
}
`,
      "/t/bug001-num.js",
    );
    expect(r.length).toBeGreaterThan(0);
  }
});




});

// ---------------------------------------------------------------------------
// number().int() 的返回义务必须真的被检查
// ---------------------------------------------------------------------------
describe("number().int() 的返回义务必须真的被检查", () => {
/**
 * `number().int()` 的**返回**义务对非字面量返回值完全未检查（假绿）。
 *
 * `.int()` 是约束对象上的**数据标志**（`c.int === true`），不是 pred。
 * `constraintOnTermAbs` 把它编码成谓词（`eq(self % 1, 0)`），但后置通道的
 * `assertScalar` 走的是 `instantiateOnTerm`（**不**编码 int 标志）⇒
 * `number().int()` 的 `constraintPred` 只剩 `typeof(x) = "number"` ⇒
 * 「仅有 auto-typeof」的早退分支直接 `proved()` ⇒ 整性义务**从未被检查**。
 * 唯一生效的是字面量特判（`1.5` 报、`x + 0.5` 不报）。
 *
 * 修法：`assertScalar` 的约束谓词与 `constraintOnTermAbs` **同口径**合取整性
 * 编码；整性义务也算「带界义务」（`isBoundedEvidenceMissing`）⇒ 不可判定时
 * 落 `unprovable`（warning `nudo:unproven-return`），**不得伪装成功**。
 *
 * 钉住的行为：
 * - `return x + 0.5` 对 `intId` 返回契约：**不再假绿**（出 warning，无 error）；
 * - 整性可从前提传导：x 声明为 int ⇒ `return x` 零诊断；
 * - 整数字面量照旧放行；小数照旧 error；无整性证据的宽值域照旧 error。
 */



/** `@nudo:contract return …` 通道的诊断（与其它通道解耦） */
const returnIssues = (src: string, file: string) =>
  issuesOf(src, file).issues.filter((i) =>
    i.message.includes("@nudo:contract return"),
  );


  it("非字面量返回值（x + 0.5）不再假绿：出 unproven-return warning、无 error；整性可从前提传导：x 声明为 int ⇒ `return x` 证得、零诊断；整数字面量返回照旧放行；小数返回照旧是 error（字面量特判不回归）；值域只是裸 number（无整性证据）⇒ 出 unproven-return warning（改前静默 proved）；负控制：整数算术（x + 1，x 为 int）**不得**变成假红（整性不可判定 ⇒ warning", () => {
  {
    const ret = returnIssues(
      `
/**
 * @nudo:contract x intId
 * @nudo:contract return intId
 */
function halfOfId(x) {
  return x + 0.5;
}
`,
      "/t/bug002-half.js",
    );
    // 改前：零诊断（假绿）。改后：**不得**再静默通过。
    expect(ret).toHaveLength(1);
    expect(ret[0]!.severity).toBe("warning");
    expect(ret[0]!.code).toBe("nudo:unproven-return");
  }
  {
    const src = `
/**
 * @nudo:contract x intId
 * @nudo:contract return intOnly
 */
function idOf(x) {
  return x;
}
`;
    expect(returnIssues(src, "/t/bug002-id.js")).toEqual([]);
    expect(issuesOf(src, "/t/bug002-id2.js").issues.filter((i) => i.severity === "error")).toEqual(
      [],
    );
  }
  {
    const src = `
/**
 * @nudo:contract return intOnly
 */
function two() {
  return 2;
}
`;
    expect(returnIssues(src, "/t/bug002-two.js")).toEqual([]);
  }
  {
    const r = issuesOf(
      `
/**
 * @nudo:contract return intOnly
 */
function bad() {
  return 1.5;
}
`,
      "/t/bug002-1p5.js",
    );
    const err = r.issues.find((i) => i.severity === "error");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("int");
  }
  {
    const src = `
/**
 * @nudo:contract x num
 * @nudo:contract return intOnly
 */
function maybe(x) {
  return x;
}
`;
    const ret = returnIssues(src, "/t/bug002-maybe.js");
    expect(ret).toHaveLength(1);
    expect(ret[0]!.severity).toBe("warning");
    expect(ret[0]!.code).toBe("nudo:unproven-return");
    expect(
      issuesOf(src, "/t/bug002-maybe2.js").issues.filter((i) => i.severity === "error"),
    ).toEqual([]);
  }
  {
    const r = issuesOf(
      `
/**
 * @nudo:contract x intId
 * @nudo:contract return intOnly
 */
function next(x) {
  return x + 1;
}
`,
      "/t/bug002-next.js",
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
});






});

// ---------------------------------------------------------------------------
// class-method bridge static/instance split
// ---------------------------------------------------------------------------
describe("class-method bridge static/instance split", () => {
/**
 * 类方法桥把 `D.s1`（静态方法）当实例方法求值 ⇒ 静态方法签名
 * 拿不到返回值（`D.s1 => never`）。修复：按源码类声明分流静态/实例。
 */




const SRC = `
export class D {
  static s1() {
    return 42;
  }
  instance() {
    return 7;
  }
}
`;


  it("static method returns its value；instance method still returns its value；class value itself stays a class signature", () => {
  {
    const r = checkSource_____index_ts("/t/bug-004.js", SRC, pTrue_____index_ts);
    expect(sigOf(r, "D.s1")).toBe("42");
  }
  {
    const r = checkSource_____index_ts("/t/bug-004.js", SRC, pTrue_____index_ts);
    expect(sigOf(r, "D.instance")).toBe("7");
  }
  {
    const r = checkSource_____index_ts("/t/bug-004.js", SRC, pTrue_____index_ts);
    expect(sigOf(r, "D")).toBe("D");
  }
});



});

// ---------------------------------------------------------------------------
// x - 0 = x 只在 number 域成立
// ---------------------------------------------------------------------------
describe("x - 0 = x 只在 number 域成立", () => {
/**
 * 回归：`simplifyTerm` 的 `x - 0 = x` 重写缺 **number 域守卫**
 * （重写规则与自身文档矛盾：`arithmetic/shared.ts` 明写「不用 simplifyTerm：
 * `x*1=x` / `x-0=x` 只对 number 成立」）。
 *
 * 修复前：`simplifyTerm(app("-", [lit("abc"), lit(0)]))` ⇒ `lit("abc")`
 * （原生 `"abc" - 0` 是 **NaN**，且域从 number 变成 string）；
 * `true - 0` ⇒ `lit(true)`（原生是 1）。
 *
 * 修法：与同文件 `surviveMulOne`（`x * 1`）同口径的域守卫——非 number 字面量
 * 走 ToNumber 折值（`"5"→5`、`true→1`、`null→0`、`"abc"/undefined→NaN`），
 * bigint 混型保留原项（原生 TypeError，交算术核 `foldBigintBinOp`）。
 * 非字面量项（var/app）的 `x - 0 → x` 化简保持（number 路径依赖它）。
 */



const sub = (a: Term, b: Term) => app("-", [a, b]);

const isLit = (t: Term, value: unknown): boolean =>
  t.op === "lit" && Object.is(t.value, value);


  it("非 number 字面量不得被认成原字面量（此前 `\"abc\" - 0` ⇒ `\"abc\"`）；boolean / null / 数字字符串走 ToNumber；bigint 混型保留原项（原生 TypeError，不得折成字面量）；number 字面量仍可化简（`5 - 0` ⇒ 5）；非字面量项保持 number 路径化简（`x - 0` ⇒ x）；对照：`x * 1` 的既有域守卫不变（`\"abc\" * 1` ⇒ NaN，不得留 string）", () => {
  {
    const r = simplifyTerm(sub(lit("abc"), lit(0)));
    expect(isLit(r, "abc")).toBe(false);
    // ToNumber("abc") = NaN ⇒ number 域
    expect(r.op === "lit" && typeof r.value === "number" && Number.isNaN(r.value)).toBe(true);
  }
  {
    expect(isLit(simplifyTerm(sub(lit(true), lit(0))), 1)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit(false), lit(0))), 0)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit(null), lit(0))), 0)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit("5"), lit(0))), 5)).toBe(true);
    const undef = simplifyTerm(sub(lit(undefined), lit(0)));
    expect(undef.op === "lit" && typeof undef.value === "number" && Number.isNaN(undef.value)).toBe(
      true,
    );
  }
  {
    const r = simplifyTerm(sub(lit(5n), lit(0)));
    expect(r.op).toBe("app");
    expect(r.op === "app" && r.fn === "-").toBe(true);
  }
  {
    expect(isLit(simplifyTerm(sub(lit(5), lit(0))), 5)).toBe(true);
    expect(isLit(simplifyTerm(sub(lit(2.5), lit(1))), 1.5)).toBe(true);
  }
  {
    const x = v("x");
    const r = simplifyTerm(sub(x, lit(0)));
    expect(r).toEqual(x);
  }
  {
    const r = simplifyTerm(app("*", [lit("abc"), lit(1)]));
    expect(r.op === "lit" && typeof r.value === "number" && Number.isNaN(r.value)).toBe(true);
    expect(isLit(simplifyTerm(app("*", [lit("abc"), lit(1)])), "abc")).toBe(false);
  }
});






});

// ---------------------------------------------------------------------------
// 有限字面量集的矛盾 ⇒ error（可判定）
// ---------------------------------------------------------------------------
describe("有限字面量集的矛盾 ⇒ error（可判定）", () => {
/**
 * 可判定的契约矛盾被降级成「不可计算」warning ⇒ `nudo check` exit 0。
 *
 * 源码契约 `x = 42`（`lit(42)` 模板）∧ 侧车契约 `x ∈ {43,44}`
 * （`union(lit(43),lit(44))`）的合取**为空集**——完全可判定，必须报
 * `nudo:contract-conflict` **error**（docs/design/refine-derivation.md：
 * 「源码 + 侧车是合取 … 不可满足报冲突码」）。
 *
 * 旧口径 `crossBoundConflict` 只读各侧**顶层** preds（不下钻 `members`）⇒ 矛盾
 * 看不见 ⇒ 落进 `isNonScalarForm` 的 undecidable 通道 ⇒ warning + exit 0；
 * 而**同一个矛盾**写成平铺字面量（`lit(43)`）就是 error ⇒ 两种拼写两种结论。
 *
 * 钉：有限字面量集之间交集为空 ⇒ error（不是 warning / undecidable）；
 * 且可满足的有限集组合仍然不误报。
 */








const SRC = `
/// @nudo:import { fortyTwo } from "./tmpl.nudo.js"

/**
 * @nudo:contract x fortyTwo
 */
export function f(x) {
  return x;
}
f(42);
`;

function check(sidecar: string) {
  const { loadModule } = makeFiles({
    "/t/lib.nudo.js": sidecar,
    "/t/tmpl.nudo.js": `import { lit } from "@nudojs/core";\nexport const fortyTwo = lit(42);\n`,
  });
  return checkSource_____index_ts("/t/lib.js", SRC, pTrue_____index_ts, {
    loadModule,
    fromFile: "/t/lib.js",
  });
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();
  });

  it("x = 42 ∧ x ∈ {43,44} → nudo:contract-conflict error + exit≠0；平铺字面量同款矛盾 → error（两种拼写同结论）；有限集有交集（x = 42 ∧ x ∈ {42,43}）→ 不报矛盾", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(
      `import { fn, lit, union } from "@nudojs/core";\nexport const f = fn({ x: union(lit(43), lit(44)) });\n`,
    );
    const conflicts = r.issues.filter((i) => i.code === "nudo:contract-conflict");
    // 矛盾不是「不可计算」：只有一条 error，不得再印 undecidable warning
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.severity).toBe("error");
    expect(conflicts[0]!.message).toContain("unsatisfiable");
    expect(r.ok).toBe(false);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const flat = check(`import { fn, lit } from "@nudojs/core";\nexport const f = fn({ x: lit(43) });\n`);
    const withUnion = check(
      `import { fn, lit, union } from "@nudojs/core";\nexport const f = fn({ x: union(lit(43), lit(44)) });\n`,
    );
    expect(flat.issues.find((i) => i.code === "nudo:contract-conflict")?.severity).toBe("error");
    expect(withUnion.issues.find((i) => i.code === "nudo:contract-conflict")?.severity).toBe("error");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(
      `import { fn, lit, union } from "@nudojs/core";\nexport const f = fn({ x: union(lit(42), lit(43)) });\n`,
    );
    const conflicts = r.issues.filter((i) => i.code === "nudo:contract-conflict");
    // 有交集 ⇒ 不是「不可满足」：不得出现 unsatisfiable / error。
    // （合取能力边界仍可印一条 undecidable warning——那是既有的显式留痕。）
    expect(conflicts.filter((i) => i.severity === "error")).toEqual([]);
    expect(conflicts.some((i) => i.message.includes("unsatisfiable"))).toBe(false);
    expect(r.ok).toBe(true);
  }
});


}
});

// ---------------------------------------------------------------------------
// 同 prim 字面量 union 在签名面保留字面量集
// ---------------------------------------------------------------------------
describe("同 prim 字面量 union 在签名面保留字面量集", () => {
/**
 * `nudo check` 签名面把「同 prim 的字面量 union」渲染成**基类型**
 * ⇒ 签名行（`v: number`）与本面自己的门槛诊断（`expected: (v = 1 ∨ v = 2 ∨
 * v = 3)`）互相矛盾，且与 dts 产物面（`v: 1 | 2 | 3`）结论相反。
 *
 * 根因：`format.ts` 的字面量提取只认**单个** `eq(term, lit(v))` 合取项；
 * `samePrimLiteralUnionAbs` 构造的是 `or(eq 1, eq 2, eq 3)` ⇒ 返回 undefined
 * ⇒ 退化成基类型。
 *
 * 本钉：签名面的参数类型必须与 dts 面同源（字面量集）。
 */




/** 同名侧车：源文件 file.js ⇒ 侧车 file.nudo.js */
function optsWithSidecar(sidecar: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec === "./file.nudo.js" ? sidecar : stdOpts.loadModule(spec),
    fromFile: "/test/file.js",
  };
}

const SRC = `export function pick(v) {
  return v;
}
`;

const UNION_SIDE = `
import { fn, lit, union } from "@nudojs/core";
export const pick = fn({ v: union(lit(1), lit(2), lit(3)) });
`;

const NUM_SIDE = `
import { fn, number } from "@nudojs/core";
export const pick = fn({ v: number() });
`;


  it("union(lit(1), lit(2), lit(3)) ⇒ `1 | 2 | 3`（不是 `number`）；负控制：裸 number 契约仍是 `number`", () => {
  {
    const r = checkSource_____index_ts("/test/file.js", SRC, pTrue_____index_ts, optsWithSidecar(UNION_SIDE));
    const sig = r.signatures.find((s) => s.name === "pick");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("1 | 2 | 3");
    expect(sig!.paramTypes?.[0]).not.toBe("number");
  }
  {
    const r = checkSource_____index_ts("/test/file.js", SRC, pTrue_____index_ts, optsWithSidecar(NUM_SIDE));
    const sig = r.signatures.find((s) => s.name === "pick");
    expect(sig!.paramTypes?.[0]).toBe("number");
  }
});


});

// ---------------------------------------------------------------------------
// module-eval instance identity is round-scoped
// ---------------------------------------------------------------------------
describe("module-eval instance identity is round-scoped", () => {
/**
 * 同文件/同源被**二次求值**——evaluator 的模块执行缓存（
 * generalize.ts / check-may-throw.ts 的 `evalRunMemo`）存的是**活的 run
 * 表**，表里住着模块级 `let` 状态。跨轮复用 ⇒ 上一轮（analyzer 的一次
 * generalize）已经 ++ 过的实例漏给下一轮（check 闸门）⇒ 同一份源码在不同
 * 路径下读出 1 / 2 / 3；且两个**字节相同**的不同文件共用同一个活实例。
 *
 * 修复：求值轮次（epoch）——`runWithCollectorScope` 开新作用域时 +1，两张
 * run 表按轮作废（嵌套入口共享外层轮次，不重复涨轮）；check-may-throw 的
 * 键另带调用点路径（字节相同的不同文件即便同轮也不共用）。
 *
 * 复现口径：`let n = 0; export function bump(){ return ++n; }`——原生恒 1。
 */




const SRC = `let n = 0;
export function bump() { return ++n; }
`;

/** check 闸门面：bump() 的签名显示串（原生恒 "1"）。 */
function bumpSig(file: string): string {
  return sigOf(checkSource_____index_ts(file, SRC, pTrue_____index_ts), "bump");
}


  it("analyzer round 之后 check 闸门仍读到 1（不接续上一轮的活状态）；字节相同的第二个文件不共用实例（各自 1，不是 2/3）；同一文件重复分析也是新一轮（每次 1）", () => {
  {
    // analyzer 面（service 的 analyzer-abs-eval 同款调用：无 opts）
    generalizeFromAst("bump", SRC);
    expect(bumpSig("/t/bug-056-a.js")).toBe("1");
  }
  {
    generalizeFromAst("bump", SRC);
    expect(bumpSig("/t/bug-056-b.js")).toBe("1");
    expect(bumpSig("/t/bug-056-c.js")).toBe("1");
  }
  {
    expect(bumpSig("/t/bug-056-d.js")).toBe("1");
    expect(bumpSig("/t/bug-056-d.js")).toBe("1");
  }
});



});

// ---------------------------------------------------------------------------
// module initializer definitely throws ⇒ nudo:module-throw
// ---------------------------------------------------------------------------
describe("module initializer definitely throws ⇒ nudo:module-throw", () => {
/**
 * 模块顶层「建模内抛」/ 原生必抛被吸收 ⇒ `nudo check` 绿灯。
 * 修复：`definiteModuleThrowOf` 对确定性装载期抛（IIFE throw / 顶层调用必抛
 * 函数 / nullish 成员访问 / 非法 JSON.parse / 类静态块 throw）出证据。
 */



function moduleThrows(src: string, file: string) {
  const r = checkSource_____index_ts(file, src, pTrue_____index_ts);
  return r.issues.filter((i) => i.code === "nudo:module-throw");
}


  it("IIFE with unconditional throw；top-level call to a function that always throws；top-level member access on a nullish const；top-level JSON.parse of an invalid literal；class static block with unconditional throw；typeof missing identifier is saf", () => {
  {
    const issues = moduleThrows(
      `export const a = 1;\n(function () { throw new Error("x"); })();\n`,
      "/t/bug-072-t2.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("Error");
  }
  {
    const issues = moduleThrows(
      `export function boom() { throw new Error("x"); }\nboom();\n`,
      "/t/bug-072-t3.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Error");
  }
  {
    const issues = moduleThrows(
      `export const a = 1;\nconst x = null;\nx.foo();\n`,
      "/t/bug-072-t4.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("TypeError");
  }
  {
    const issues = moduleThrows(
      `export const a = 1;\nJSON.parse("{");\n`,
      "/t/bug-072-t5.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("SyntaxError");
  }
  {
    const issues = moduleThrows(
      `export function m() { return 1; }\nclass K { static { throw new Error("x"); } }\n`,
      "/t/bug-072-t7.js",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Error");
  }
  {
    const issues = moduleThrows(
      `export const v = typeof __nudoMissingNative;\nexport function f(){ return 1; }\n`,
      "/t/bug-072-neg-typeof.js",
    );
    expect(issues).toHaveLength(0);
  }
  {
    const issues = moduleThrows(
      `export function m() { return 1; }\nif (globalThis.cond) throw new Error("x");\nconst x = null;\nconst y = x?.foo;\n`,
      "/t/bug-072-neg.js",
    );
    expect(issues).toHaveLength(0);
  }
});







});

// ---------------------------------------------------------------------------
// 等式反解必须给出舍入前像，而不是点
// ---------------------------------------------------------------------------
describe("等式反解必须给出舍入前像，而不是点", () => {
/**
 * 谓词代数把 IEEE **舍入**运算当可逆恒等式做「精确消去」
 *
 * 事实侧 `applyCmp` 的单原子分支曾把 `fl(atom ⊕ k) op c` 直接反解成点
 * `atom === c-k`。IEEE 下 `fl` **非单射**——`fl(x + 1) === 1` 的解含
 * `x = -5e-324`（`Number.MIN_VALUE`），`fl(x + 1e6) === 1e6` 的解含
 * `|x| ≤ ½ulp(1e6)`，`fl(3*x) === 1` 的解含 `0.33333333333333337`。
 *
 * 点反解 ⇒ 假事实 ⇒ 签名面造出字面量 `true` + L1 契约门禁**假绿**：
 * `if (x + 1 !== 1) throw; return x >= 0;` 对 `lit(true)` 契约曾报 OK / exit 0
 * （原生 `x = MIN_VALUE` 时返回 `false`）。
 *
 * 修法（section 方案 B）：解集按**舍入前像区间**提取——
 * `atom ∈ [c-k-½ulp(量级), c-k+½ulp(量级)]`，量级 = max(|比较常量|, 加性常量)。
 * 精确构造（rounds === 0：纯 var/lit、2 的幂缩放）仍是点反解。
 */




const x = v("x");
const plus = (t: ReturnType<typeof v>, k: number) => app("+", [t, lit(k)]);
const minus = (t: ReturnType<typeof v>, k: number) => app("-", [t, lit(k)]);
const times = (t: ReturnType<typeof v>, k: number) => app("*", [t, lit(k)]);


  it("宿主 IEEE 见证：fl(MIN_VALUE + 1) === 1 但 x ≠ 0；x + 1 === 1 ⊬ x === 0（吸收型加法；反例 x = MIN_VALUE）；x + 1 === 1 ⊬ x >= 0（同一前像区间不得收成单点）；x - 1 === -1 ⊬ x === 0（减法同源；反例 x = -5e-324）；x + 1e6 === 1e6 ⊬ x === 0（量级吸收：解集 |x| ≤ ½ulp(1e6)）；3 * x === 1 ⊬ x === 1", () => {
  {
    expect(1 + Number.MIN_VALUE).toBe(1);
    expect(Number.MIN_VALUE).not.toBe(0);
  }
  {
    expect(implies(eq(plus(x, 1), lit(1)), eq(x, lit(0)))).toBe(false);
  }
  {
    expect(implies(eq(plus(x, 1), lit(1)), ge(x, lit(0)))).toBe(false);
  }
  {
    expect(-Number.MIN_VALUE - 1).toBe(-1);
    expect(implies(eq(minus(x, 1), lit(-1)), eq(x, lit(0)))).toBe(false);
  }
  {
    expect(2.9e-11 + 1e6).toBe(1e6);
    expect(implies(eq(plus(x, 1e6), lit(1e6)), eq(x, lit(0)))).toBe(false);
  }
  {
    expect(3 * 0.33333333333333337).toBe(1);
    expect(0.33333333333333337).not.toBe(1 / 3);
    expect(implies(eq(times(x, 3), lit(1)), eq(x, lit(1 / 3)))).toBe(false);
  }
  {
    expect(-Number.MIN_VALUE + 1 >= 1).toBe(true);
    expect(implies(ge(plus(x, 1), lit(1)), ge(x, lit(0)))).toBe(false);
  }
  {
    expect(3 * 0.33333333333333337 <= 1).toBe(true);
    expect(implies(le(times(x, 3), lit(1)), le(x, lit(1 / 3)))).toBe(false);
  }
});









describe("精确构造的反解不受影响（精度不回退）", () => {
  it("2 * x === 4 ⊨ x === 2（2 的幂缩放无舍入）；x === 5 ⊨ x === 5 / x >= 5（纯原子事实仍是点）；x + 1 === 0 仍可取到 x = -1 的下界（前像不含正区间）", () => {
  {
    expect(implies(eq(times(x, 2), lit(4)), eq(x, lit(2)))).toBe(true);
  }
  {
    expect(implies(eq(x, lit(5)), eq(x, lit(5)))).toBe(true);
    expect(implies(eq(x, lit(5)), ge(x, lit(5)))).toBe(true);
  }
  {
    // fl(-1 + δ) = 0 只可能在 δ 被吸收到 0 之外；但 fl(x+1)=0 的解集仍以
    // -1 为中心且 |x+1| ≤ ½ulp(0) = 0 ⇒ 单点。这里钉「界仍单调收紧」。
    const ok = implies(eq(plus(x, 1), lit(0)), and(ge(x, lit(-1.0000000000000002)), le(x, lit(-0.9999999999999998))));
    expect(ok).toBe(true);
  }
});


});
});

// ---------------------------------------------------------------------------
// 被调方 L1 面：默认值与参数契约冲突不再假绿
// ---------------------------------------------------------------------------
describe("被调方 L1 面：默认值与参数契约冲突不再假绿", () => {
/**
 * 默认参数值与参数契约不符：调用点面**已执法**，被调方 L1 面**假绿**。
 *
 * 根因：契约路径把形参域**整体替换**成契约 Abs（`constraintToEntryAbs`）⇒
 * 默认值初始化式从未参与被调方的门禁路径。`pick(s = "abc")` 配侧车
 * `fn({ s: number() }, number())` 因此在被调方文件上判绿（`OK`, exit 0），
 * 而同一份契约在零参调用点面正确报红。
 *
 * 修后：契约绑定时把默认值类型并入形参定义域（**契约域 ∪ 默认值类型**；
 * 默认值落在契约域内时保持契约域原样）⇒ 形参域变宽 ⇒ 返回面随之变宽 ⇒
 * 既有的 L1 返回契约对账通道报红。
 *
 * oracle：node 原生 `pick()` 返回 `"abc"`（字符串）⇒ 同时违反参数域 `number`
 * 与返回 `number` 两条契约。
 */




/** 侧车：`pick(s: number) => number` */
const PICK_SIDECAR = `import { fn, number } from "@nudojs/core";
export const pick = fn({ s: number() }, number());
`;

const SRC = `export function pick(s = "abc") { return s; }\n`;

/** 冻结的契约路径：源码 + 侧车（`e.js` ↔ `e.nudo.js`） */
function frozenCheck(src: string) {
  const files = { "/t/e.js": src, "/t/e.nudo.js": PICK_SIDECAR };
  const { loadModule } = makeFiles(files);
  return checkSource_____index_ts("/t/e.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/e.js" });
}


  it("契约 + 冲突默认值 ⇒ 报错（修复前：OK / exit 0）；签名如实反映默认值参与定义域（`number | \"abc\"`）；合法形态保持绿：默认值落在契约域内（`s = 1` + `number()`）；无契约路径行为不变（默认值不参与，零报错）；.d.ts 可省性的事实来源保留：契约路径下 formals 仍是 default/optional；`_` / rest 之外的默认形参也走同一口径（`a`, `b = 2`）；通用侧车 opts 口径（marker）与 ", () => {
  {
    const r = frozenCheck(SRC);
    expect(r.ok).toBe(false);
    const errors = r.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    // 冲突经既有的返回契约对账通道落点：`pick` 自身的 L1 面
    expect(errors.some((i) => i.fn === "pick")).toBe(true);
    expect(errors.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  }
  {
    // 修复前签名是自信的单值 `pick(s: number) => number`（默认值蒸发）
    expect(sigOf(frozenCheck(SRC), "pick")).toContain('"abc"');
  }
  {
    const r = frozenCheck(`export function pick(s = 1) { return s; }\n`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
    const src = `export function pick(s = "abc") { return s; }\n`;
    const { loadModule } = makeFiles({ "/t/e.js": src });
    const r = checkSource_____index_ts("/t/e.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/e.js" });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
    // dts 面的 optional 判据 = `decl.hasDefault`（形参 kind === "default"）；
    // 契约绑定不得把它抹掉（否则 `s` 被渲染成必选）
    const { loadModule } = makeFiles({ "/t/e.js": SRC, "/t/e.nudo.js": PICK_SIDECAR });
    const g = generalizeFromAst("pick", SRC, {
      refine: { loadModule, fromFile: "/t/e.js" },
    });
    expect(g?.formals?.[0]).toMatchObject({ kind: "default", optional: true });
    expect(g?.params).toEqual(["s"]);
  }
  {
    const src = `export function pick(a = 0, b = 2) { return a + b; }\n`;
    const sidecar = `import { fn, number } from "@nudojs/core";
export const pick = fn({ a: number(), b: number() }, number());
`;
    const { loadModule } = makeFiles({ "/t/e.js": src, "/t/e.nudo.js": sidecar });
    const r = checkSource_____index_ts("/t/e.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/e.js" });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
    const opts = sidecarOpts("e.nudo", PICK_SIDECAR, "/t/e.js");
    const r = checkSource_____index_ts("/t/e.js", SRC, pTrue_____index_ts, opts);
    expect(r.issues.some((i) => i.severity === "error" && i.fn === "pick")).toBe(true);
  }
});







});

// ---------------------------------------------------------------------------
// nudo:invariant-relied 只在真正消费时归因
// ---------------------------------------------------------------------------
describe("nudo:invariant-relied 只在真正消费时归因", () => {
/**
 * `@nudo:invariant` 只要「声明了 + 返回契约证明成功」就**无条件**报
 * `nudo:invariant-relied`（无循环、零贡献也报）⇒ 审计归因说谎。
 *
 * 文档口径（docs/concepts/directives.md「When a proof relies on it」）要求
 * 只在**证明依赖**时上屏。修法 = 与 `@nudo:assume` 同款的**消费账本**：
 * `exec/runtime/invariant-apply.ts` 在循环 join/宽化位命中自己的绑定时记账，
 * `check-return.ts` 按账本过滤。
 *
 * 钉：
 * - 无循环（不变式从未实施）⇒ **零** `nudo:invariant-relied`；
 * - 循环里真的实施了 ⇒ 仍有 `nudo:invariant-relied`（不是把特性关掉）；
 * - 声明了不存在的绑定名 ⇒ 该 spec 不参与，也不得被归因。
 */








/** 返回契约 `number().ge(1)`：`return 7` 平凡满足 */
const SIDECAR_GE1 = `import { fn, number } from "@nudojs/core";
export const f = fn({ n: number() }, number().ge(1));
`;
/** 返回契约 `number().ge(0)`：循环累加面只有靠不变式才能证成 */
const SIDECAR_GE0 = `import { fn, number } from "@nudojs/core";
export const f = fn({ n: number() }, number().ge(0));
`;

function check(src: string, sidecar = SIDECAR_GE1) {
  const { loadModule } = makeFiles({ "/t/f.nudo.js": sidecar });
  return checkSource_____index_ts("/t/f.js", src, pTrue_____index_ts, {
    loadModule,
    fromFile: "/t/f.js",
  });
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();
  });

  it("没有循环的函数上声明不变式 ⇒ 零 invariant-relied（旧口径无条件报）；循环里真正实施了不变式 ⇒ 仍有 invariant-relied；不变式指向的绑定在循环里不存在 ⇒ 不归因", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(`
/**
 * @nudo:invariant last >= 1
 */
export function f(n) {
  let last = 0;
  return 7;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-invalid")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-relied")).toEqual([]);
    // 返回契约仍被证明（零贡献的不变式既不该被归因，也不该影响判定）
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return")).toEqual([]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(`
/**
 * @nudo:invariant dp[*] >= 0
 */
export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`, SIDECAR_GE0);
    const relied = r.issues.find((i) => i.code === "nudo:invariant-relied");
    expect(relied).toBeDefined();
    expect(relied!.message).toContain("dp[*] >= 0");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(`
/**
 * @nudo:invariant other >= 1
 */
export function f(n) {
  let other = 3;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc = acc + i;
  }
  return 7;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:invariant-relied")).toEqual([]);
  }
});


}
});

// ---------------------------------------------------------------------------
// 字面量约束在类型展示面渲染成类型（不是契约 DSL）
// ---------------------------------------------------------------------------
describe("字面量约束在类型展示面渲染成类型（不是契约 DSL）", () => {
/**
 * 字面量约束在**类型展示面**被渲染成侧车契约文法的 `lit(v)`（不是
 * 任何语言的类型），而同一工具的 `.d.ts` 产物面渲染成类型 `v` ⇒ 同一个参数
 * 在两个产品面上是两套「类型」，且 `check --json` 的 `paramTypes`（机器面）被
 * 污染。
 *
 * 根因：`format.ts` 的 `showLits` 分支直接输出 `lit(${formatLitValue(v)})`
 * ——契约 DSL 文本泄漏进类型展示面。
 *
 * 本钉：展示面必须输出**类型**（`3` / `"a"`），与 dts 面同源。
 */




function optsWithSidecar(sidecar: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec === "./file.nudo.js" ? sidecar : stdOpts.loadModule(spec),
    fromFile: "/test/file.js",
  };
}

const SRC = `export function g(a, b, c, d, e) {
  return a;
}
`;

const SIDE = `
import { fn, number, string, shape, lit } from "@nudojs/core";
export const g = fn({ a: lit(3), b: number(), c: number().gt(0), d: string(), e: shape({ p: number() }) }, number());
`;

const SLOT_SRC = `export function h(a) {
  return a;
}
`;

const SLOT_SIDE = `
import { fn, number, shape, lit } from "@nudojs/core";
export const h = fn({ a: shape({ kind: lit("a"), n: number() }) }, number());
`;


  it("顶层形参：`lit(3)` ⇒ `3`（不是 `lit(3)`）；对象判别槽：`kind: lit(\"a\")` ⇒ `{ kind: \"a\", n: number }`；负控制：无数值界契约的渲染不变（`number` 仍是 `number`）", () => {
  {
    const r = checkSource_____index_ts("/test/file.js", SRC, pTrue_____index_ts, optsWithSidecar(SIDE));
    const sig = r.signatures.find((s) => s.name === "g");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("3");
    expect(sig!.paramTypes?.join(", ")).not.toContain("lit(");
  }
  {
    const r = checkSource_____index_ts("/test/file.js", SLOT_SRC, pTrue_____index_ts, optsWithSidecar(SLOT_SIDE));
    const sig = r.signatures.find((s) => s.name === "h");
    expect(sig!.paramTypes?.[0]).toBe('{ kind: "a", n: number }');
  }
  {
    const r = checkSource_____index_ts("/test/file.js", SRC, pTrue_____index_ts, optsWithSidecar(SIDE));
    const sig = r.signatures.find((s) => s.name === "g");
    expect(sig!.paramTypes?.[1]).toBe("number");
    expect(sig!.paramTypes?.[3]).toBe("string");
  }
});



});

// ---------------------------------------------------------------------------
// strict 端点的 1 ULP 离散性放松只做一次（同项格点步进）
// ---------------------------------------------------------------------------
describe("strict 端点的 1 ULP 离散性放松只做一次（同项格点步进）", () => {
/**
 * 回归：strict 端点的 **1 ULP 离散性放松只做一次**。
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






const x = v("x");
const y = v("y");
/** 被求和的项（`x + 1`） */
const sum = app("+", [x, lit(1)]);


  it("同项事实 `x+1 > nextDown(1)` ⇒ 义务 `x+1 >= 1`（IEEE 下恒真）；同项事实 ⇒ 更弱的义务同样成立（ge / gt nextDown(1)）；反向不成立：`x+1 > nextDown(1)` ⇏ `x+1 > 1`（严格差一格不够）；严格事实才步进一格：非严格事实 `x+1 >= nextDown(1)` ⇏ `x+1 >= 1`；保真控制：吸收型累加仍证不出 `x+y > 1`（fl(MIN + 1) === 1）；保真控制：同项格点步", () => {
  {
    expect(implies(gt(sum, lit(0.9999999999999999)), ge(sum, lit(1)))).toBe(true);
  }
  {
    expect(implies(gt(sum, lit(0.9999999999999999)), ge(sum, lit(0.9999999999999999)))).toBe(
      true,
    );
    expect(implies(gt(sum, lit(0.9999999999999999)), gt(sum, lit(0.9999999999999999)))).toBe(
      true,
    );
  }
  {
    expect(implies(gt(sum, lit(0.9999999999999999)), gt(sum, lit(1)))).toBe(false);
  }
  {
    // `x + 1 >= 0.9999999999999999` 允许 x + 1 恰好 = 0.9999999999999999 ⇒ 不蕴含 >= 1
    expect(implies(ge(sum, lit(0.9999999999999999)), ge(sum, lit(1)))).toBe(false);
  }
  {
    const phi = and(gt(x, lit(0)), ge(y, lit(1)));
    expect(implies(phi, gt(app("+", [x, y]), lit(1)))).toBe(false);
  }
  {
    expect(implies(ge(x, lit(5)), gt(x, lit(5)))).toBe(false);
    expect(implies(ge(x, lit(5)), lt(x, lit(5)))).toBe(false);
  }
  {
    const impl = `export function f(x) { return x + 1; }`;
    const sidecar = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number().ge(1));
`;
    const files = { "/t/bug-1004.nudo.js": sidecar };
    const r = checkSource_____index_ts("/t/bug-1004.js", impl, pTrue, {
      ...makeFiles(files),
      fromFile: "/t/bug-1004.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  }
  {
    const impl = `export function f(x) { return x + 1; }`;
    const sidecar = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().ge(0) }, number().ge(2));
`;
    const files = { "/t/bug-1004-ctl.nudo.js": sidecar };
    const r = checkSource_____index_ts("/t/bug-1004-ctl.js", impl, pTrue, {
      ...makeFiles(files),
      fromFile: "/t/bug-1004-ctl.js",
    });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(1);
  }
});








});

// ---------------------------------------------------------------------------
// [merged] bigint-lit-contract-tautology
// ---------------------------------------------------------------------------
describe("bigint-lit-contract-tautology", () => {
// MERGED (topic-related bug pins): bigint-lit-contract-tautology + bigint-literal-arg-fastpath
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>





{
/**
 * `lit(1n)`（bigint 字面量契约）在**实参位是恒真契约**：
 * 契约实例化成单条 `eq(x, 1n)` 原子，而 `scan/literal-preds.ts` 的
 * `predEqLiteral` 此前只取 number / string / boolean 三域 ⇒ bigint 字面量端
 * **取不到值** ⇒ 该 eq 原子永远不可判定 ⇒ **零义务**（`k(2)` 假绿）。
 *
 * 症状（族 11 / S1 修前实测，闸① oracle）：
 * - `lit(1n)` 契约收到 `2` ⇒ 0 违例（**假绿**）
 * - `union(lit(1n), lit(2n))` 收到 `2` ⇒ 0 违例（**假绿**）
 *
 * 修法（S1，`scan/literal-preds.ts`）：
 * - `predEqLiteral` 的返回类型**放宽**到含 `bigint`（不收窄、不重排）；
 * - `judgeLiteralPred` 的标量字面量域同步放行 `bigint`，eq 比较用
 * 字面量同一性口径（`===` + NaN 特例）。
 *
 * ── 口径收窄说明（族 11 裁决）──────────────────────────────────────────
 * - **渲染面已修**：`format.ts` 保留 `n` 后缀 ⇒ `expected: x = 1n`（本钉钉住）。
 * - 「bigint 实参零诊断」只在契约是 `lit(1n)` 时成立；契约是 `lit(1)` 时
 * bigint 实参由 `typeof` 通道兜住（报 `typeof x = "number"`）。
 * ⇒ 真正的残留缺口就是本钉钉的这条：`lit(1n)` 在实参位恒真。
 *
 * ⚠ **不在本钉范围内（消费侧 `scan/literal-shapes.ts`，S2 在途）**：
 * 实参**本身是 bigint** 时，`lv` 值类型门（number / string / boolean）仍把
 * eq / or 分支挡在门外 ⇒ `k(1n)` / `k(2n)` 这类实参仍零义务（假绿）；
 * 另外 bigint **实参**的快路径取参也不在本片（`scan/literal-args.ts` 是冻结层）。
 */





const SIDE = `import { lit, union } from "@nudojs/core";
export const bigOne = lit(1n);
export const bigUnion = union(lit(1n), lit(2n));
export const numOne = lit(1);
`;

const IMP = `/// @nudo:import { bigOne, bigUnion, numOne } from "./std1020.nudo.js"\n`;

const FILE = "/t/std1020.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo___nudojs_core();
  resetGeneralizeMemo___nudojs_core();
  return checkSource___nudojs_core(FILE, IMP + src, pTrue___nudojs_core, sidecarOpts("std1020", SIDE, FILE));
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

describe("lit(1n) 字面量契约不再是恒真契约（bigint 字面量端可判定）", () => {
  it("lit(1n) 契约收到 2 ⇒ 判违例（改前 0 违例 = 假绿）；lit(1n) 契约收到 1 ⇒ 判违例（1 ≠ 1n：number 与 bigint 是两个域）；union(lit(1n), lit(2n)) 收到 2 ⇒ 判违例（改前 0 违例 = 假绿）；负控制：lit(1)（number 字面量）收到 2 ⇒ 判违例（既有行为不回退）；负控制：没有契约的形参收到任何实参 ⇒ 零违例（违例来自契约，不是引擎噪声）", () => {
  {
    const r = check(call("bigOne", "2"));
    const vs = violated(r);
    // 族 48（主 agent 追认，2026-10-23）：bigint 字面量契约**补齐了缺失的
    // `typeof` 类型义务** ⇒ 与 number/string/boolean 兄弟 prim **同款**
    // （`constraint-builders.test.ts` 钉的 `typeof x = "number" ∧ x = 42` 即该口径）
    // ⇒ 类型不符时**多报一条**「类型义务」诊断。
    // ⇒ 本用例的**核心主张**（`lit(1n)` 在实参位不再是恒真契约 ⇒ 必判违例）**不变**，
    // 变的只是**条数**与**首条消息**。两条都成立（`2` 既不是 bigint，也不等于 `1n`）。
    expect(vs.length).toBe(2);
    expect(vs[0]?.expected).toBe('typeof x = "bigint"');
    expect(vs[0]?.actual).toContain("2");
  }
  {
    const r = check(call("bigOne", "1"));
    const vs = violated(r);
    // 同上（族 48 · 主 agent 追认）：bigint 补齐 `typeof` 义务 ⇒ 条数 1 → 2。
    expect(vs.length).toBe(2);
    expect(vs[0]?.expected).toBe('typeof x = "bigint"');
  }
  {
    const r = check(call("bigUnion", "2"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1n ∨ x = 2n)");
  }
  {
    const r = check(call("numOne", "2"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 1");
  }
  {
    const r = check(`export function f(x) { return x; }
export function use() { return f(2); }`);
    expect(violated(r).length).toBe(0);
  }
});




});
}

describe("bigint-literal-arg-fastpath", () => {
/**
 * **bigint 实参的取参快路径**：`f(1n)` 的实参取不到 ⇒ 调用点
 * **没有可执法信息** ⇒ 整条调用点被静默跳过（假绿；与 430 的 boolean 形态
 * 同款：「顶层靠执行态回退才报错、函数体内静默」）。
 *
 * 症状（族 11 / S6 修前实测，闸① oracle）：
 * - `lit(1n)` 收到 `2n` ⇒ 0 违例（**假绿**）
 * - `lit(2n)` 收到 `1n` ⇒ 0 违例（**假绿**）
 * - `union(lit(1n), lit(2n))` 收到 `3n` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-args.ts` 的 `parseCallArgs` **快路径分派表**里没有
 * `BigIntLiteral` 分支 ⇒ bigint 字面量落兜底 `absUnknown()` ⇒ `hasInfo=false`
 * ⇒ 该调用点整条跳过执法（静态路径）。
 *
 * 修法（S6，`scan/literal-args.ts`）：补 `BigIntLiteral` 分支（prim + lit
 * term + `conf: "exact"`，与 430 的 `BooleanLiteral` 分支同款）。
 *
 * ⚠ **Babel 节点形态实测**（`parse-source.ts` 的 `@babel/parser`，typescript
 * + jsx 插件）：
 * - `1n` 的节点类型 = **`BigIntLiteral`**；
 * - `node.value` 是**真 bigint**（`typeof node.value === "bigint"`），
 * **不是字符串**；原始文本在 `node.extra.raw`（如 `"0x10n"` / `"1_000n"`）
 * ⇒ 取值直接用 `node.value`（已归一化的十进制 bigint），**不要**去解析
 * `extra.raw`；
 * - **负 bigint 不是 `BigIntLiteral` 节点**，而是 `UnaryExpression(-)` 包
 * `BigIntLiteral` ⇒ 与既有的 `Unary(-)` 分支同款处理。
 */





const SIDE = `import { lit, union } from "@nudojs/core";
export const litOneN = lit(1n);
export const litTwoN = lit(2n);
export const litNegN = lit(-1n);
export const litUnionN = union(lit(1n), lit(2n));
`;

const IMP = `/// @nudo:import { litOneN, litTwoN, litNegN, litUnionN } from "./std1020.nudo.js"\n`;

const FILE = "/t/std1020.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo___nudojs_core();
  resetGeneralizeMemo___nudojs_core();
  return checkSource___nudojs_core(FILE, IMP + src, pTrue___nudojs_core, sidecarOpts("std1020", SIDE, FILE));
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

describe("bigint 实参可取参（快路径补 BigIntLiteral 分支）", () => {
  it("lit(1n) 收到 2n ⇒ 判违例（改前 0 违例 = 假绿：实参取不到）；lit(2n) 收到 1n ⇒ 判违例（改前 0 违例 = 假绿）；union(lit(1n), lit(2n)) 收到 3n ⇒ 判违例（改前 0 违例 = 假绿）；负控制：lit(1n) 收到 1n ⇒ 放行（取到实参且满足契约）；负控制：union(lit(1n), lit(2n)) 收到 1n ⇒ 放行；负控制：union(lit(1n), lit(2n)) 收到 2n ⇒ 放行（2n 落", () => {
  {
    const r = check(call("litOneN", "2n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 1n");
    // 实参确实被取到了（actual 里能看到 bigint 值）
    expect(String(vs[0]?.actual)).toContain("2n");
  }
  {
    const r = check(call("litTwoN", "1n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = 2n");
  }
  {
    const r = check(call("litUnionN", "3n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("(x = 1n ∨ x = 2n)");
  }
  {
    const r = check(call("litOneN", "1n"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("litUnionN", "1n"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("litUnionN", "2n"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("litNegN", "-1n"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("litNegN", "1n"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe("x = -1n");
  }
  {
    const r = check(`export function f(x) { return x; }
export function use() { return f(1n); }`);
    expect(violated(r).length).toBe(0);
  }
});








});
});
});

// ---------------------------------------------------------------------------
// 跨模块：契约形参名对不上 ⇒ 报 param-mismatch
// ---------------------------------------------------------------------------
describe("跨模块：契约形参名对不上 ⇒ 报 param-mismatch", () => {
/**
 * 跨模块桥接路径与同文件路径**同口径**：契约形参名对不上形参表
 * ⇒ 报 nudo:contract-param-mismatch，不再静默丢参数面。
 *
 * 旧行为：跨模块时契约形参名对不上（`fn({ k: … })` vs `function scale(factor)`）
 * ⇒ 该形参的**义务在调用方蒸发**（调用点假绿：负参调用不报违例）。
 * 同文件路径本就报 mismatch（check.ts 的 C4.5 口径）⇒ 两套口径分叉。
 *
 * 新行为：跨模块路径复用同一段计算（unmatchedContractParams）+ 同一文案
 * （paramMismatchIssue）⇒ 两边都报。
 */



const LIB = `export function scale(factor) { return factor * 2; }`;

/** 契约形参名 k ≠ 形参表 factor ⇒ mismatch */
const SIDE_MISMATCH = `import { fn, number } from "@nudojs/core";
export const scale = fn({ k: number().gt(0) }, number());
`;

/** 契约形参名 factor = 形参表 ✔ 对照组 */
const SIDE_OK = `import { fn, number } from "@nudojs/core";
export const scale = fn({ factor: number().gt(0) }, number());
`;

const CALLER = `import { scale } from "./scale.js";
export const r = scale(-1);
`;

function run(side: string) {
  const run_ = runTranspiled(LIB, { mode: "analyze" });
  const named: Record<string, unknown> = {
    scale: absFunction(["factor"], {
      apply: callTranspiledExportApply(run_, "scale"),
      kind: "eval-export",
      fingerprint: "eval:b1023#scale",
    }),
  };
  return checkSource___nudojs_core("/t/b1023.js", CALLER, pTrue___nudojs_core, {
    loadModule: (spec: string): string | undefined => {
      if (spec.includes("scale.nudo.js")) return side;
      if (spec.includes("scale.js")) return LIB;
      return undefined;
    },
    fromFile: "/t/b1023.js",
    modules: { "./scale.js": { named, evaluated: true } } as never,
  });
}

{
  const r = run(SIDE_MISMATCH);
  it("调用方看到 nudo:contract-param-mismatch（旧行为：零诊断）", () => {
    const m = r.issues.filter((i) => i.code === "nudo:contract-param-mismatch");
    expect(m).toHaveLength(1);
    expect(m[0]!.fn).toBe("scale");
    expect(m[0]!.severity).toBe("error");
    expect(m[0]!.actual).toBe("k");
    expect(r.ok).toBe(false);
  });
}

describe("跨模块对照组：契约形参名对得上 ⇒ 不报 mismatch", () => {
  const r = run(SIDE_OK);
  it("无 param-mismatch；调用点的负参违例照旧执法（跨模块 L1 扫描）", () => {
  {
    expect(
      r.issues.some((i) => i.code === "nudo:contract-param-mismatch"),
    ).toBe(false);
  }
  {
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated"),
    ).toBe(true);
  }
});
});

describe("跨模块负控：解构点路径契约名（card.grade）不是 mismatch", () => {
  const LIB_DOT = `export function grade({ card: { grade } }) { return grade; }`;
  const SIDE_DOT = `import { fn, number } from "@nudojs/core";
export const grade = fn({ "card.grade": number().gt(0) }, number());
`;
  const caller = `import { grade } from "./grade.js";
export const r = grade({ card: { grade: -1 } });
`;
  const run_ = runTranspiled(LIB_DOT, { mode: "analyze" });
  const named: Record<string, unknown> = {
    grade: absFunction(["card"], {
      apply: callTranspiledExportApply(run_, "grade"),
      kind: "eval-export",
      fingerprint: "eval:b1023#grade",
    }),
  };
  const r = checkSource___nudojs_core("/t/b1023-dot.js", caller, pTrue___nudojs_core, {
    loadModule: (spec: string): string | undefined => {
      if (spec.includes("grade.nudo.js")) return SIDE_DOT;
      if (spec.includes("grade.js")) return LIB_DOT;
      return undefined;
    },
    fromFile: "/t/b1023-dot.js",
    modules: { "./grade.js": { named, evaluated: true } } as never,
  });
  it("不报 param-mismatch（点路径名在契约面内）；点路径实参义务照旧执法", () => {
  {
    expect(
      r.issues.some((i) => i.code === "nudo:contract-param-mismatch"),
    ).toBe(false);
  }
  {
    expect(
      r.issues.some((i) => i.code === "nudo:constraint-violated"),
    ).toBe(true);
  }
});
});
});

// ---------------------------------------------------------------------------
// 系数表相同 ≠ 值相同（乘法 vs 折叠）
// ---------------------------------------------------------------------------
describe("系数表相同 ≠ 值相同（乘法 vs 折叠）", () => {
/**
 * 代数把 IEEE 加法当**结合律 / 分配律**（系数表相同 ⇒ 值相同）
 *
 * `proveCmpDirect` 曾用 `linFormsEqual`（只比系数表）判「两侧同值」：
 * `x*6` 与 `x+x+x+x+x+x` 都是 `{x:6}`，`(x+y)+z` 与 `x+(y+z)` 系数全同。
 * 但 IEEE 下 `x*6` 是**一次**舍入、六项折叠是**五次**舍入：
 * `fl(0.1*6) = 0.6000000000000001 ≠ fl(0.1+…+0.1) = 0.6`；加法不结合：
 * `(1+1)+1/3 = 2.3333333333333335 > 1+(1+1/3) = 2.333333333333333`。
 *
 * ⇒ `if (x*6 <= x+x+x+x+x+x) return 1; throw` 的抛臂被当死臂消除
 * ⇒ L2 `nudo:entry-may-throw` **假绿**；`check` 面与 `test` 面给出互斥结论。
 *
 * 修法：`linFormsEqual` 只在两形都是**精确**构造（`Lin.rounds === 0`）时成立；
 * 有限证据（assumeFinite / 自动导出）下按仓库既有环语义口径放行。
 */




const x = v("x");
const a = v("a");
const b = v("b");
const c = v("c");
const add = (p: ReturnType<typeof v>, q: ReturnType<typeof v>) => app("+", [p, q]);
const mul = (p: ReturnType<typeof v>, k: number) => app("*", [p, lit(k)]);
/** x + x + … + x（n 项左结合折叠） */
const fold = (p: ReturnType<typeof v>, n: number) => {
  let t = p;
  for (let i = 1; i < n; i++) t = add(t, p);
  return t;
};


  it("宿主 IEEE 见证：[0.1]*6 ≠ 0.1+0.1+0.1+0.1+0.1+0.1；x >= 0 ⊬ x * 6 <= x+x+x+x+x+x（抛臂可达）；x >= 0 ⊬ x * 6 >= x+x+x+x+x+x（对称方向同样不得证出）；x >= 0 ⊬ x * 6 === x+x+x+x+x+x", () => {
  {
    expect(0.1 * 6).toBe(0.6000000000000001);
    expect(0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1).toBe(0.6);
    expect(0.1 * 6 <= 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1).toBe(false);
  }
  {
    expect(implies(ge(x, lit(0)), le(mul(x, 6), fold(x, 6)))).toBe(false);
  }
  {
    expect(implies(ge(x, lit(0)), ge(mul(x, 6), fold(x, 6)))).toBe(false);
  }
  {
    expect(implies(ge(x, lit(0)), eq(mul(x, 6), fold(x, 6)))).toBe(false);
  }
});





describe("结合律形态（check 面 / test 面互斥的根源）", () => {
  it("宿主 IEEE 见证：(1+1)+1/3 > 1+(1+1/3)；a,b,c > 0 ⊬ (a+b)+c <= a+(b+c)；a,b,c > 0 ⊬ (a+b)+c >= a+(b+c)（反向亦然）", () => {
  {
    expect((1 + 1) + 1 / 3).toBeGreaterThan(1 + (1 + 1 / 3));
  }
  {
    const phi = and(gt(a, lit(0)), gt(b, lit(0)), gt(c, lit(0)));
    expect(implies(phi, le(add(add(a, b), c), add(a, add(b, c))))).toBe(false);
  }
  {
    const phi = and(gt(a, lit(0)), gt(b, lit(0)), gt(c, lit(0)));
    expect(implies(phi, ge(add(add(a, b), c), add(a, add(b, c))))).toBe(false);
  }
});


});

describe("精确构造的同形判定不回退", () => {
  it("2 * x 与 x + x 都是精确加倍 ⇒ x > 0 ⊨ 2x <= x+x；x > 1 ∧ assumeFinite(x) 下 2 * x 与 x + x 仍同形", () => {
  {
    expect(2 * (1 + 2 ** -52)).toBe((1 + 2 ** -52) + (1 + 2 ** -52));
    expect(implies(gt(x, lit(0)), le(mul(x, 2), add(x, x)))).toBe(true);
  }
  {
    const phi = and(gt(x, lit(1)), assumeFinite(x));
    expect(implies(phi, le(mul(x, 2), add(x, x)))).toBe(true);
  }
});

});
});

// ---------------------------------------------------------------------------
// `-0` 保真（侧车约束的组合式渲染不得抹掉负号）
// ---------------------------------------------------------------------------
describe("`-0` 保真（侧车约束的组合式渲染不得抹掉负号）", () => {
/**
 * 侧车约束的**组合式渲染**把 `lit(-0)` 渲成 `lit(0)`。
 *
 * 改前：`litToString`（`packages/core/src/algebra/contract.ts`）用
 * `String(v)` 序列化 number ⇒ `String(-0) === "0"` ⇒ 负号被抹掉：
 *
 * - `nudo contract` 回显：`f [handwritten] (o: shape({ v: lit(0) })) → lit(0)`
 * （侧车写的是 `lit(-0)` ⇒ 产品陈述的契约 ≠ 用户写的契约）；
 * - `nudo check` 诊断：`expected: o.v ∈ lit(0)`（同一条诊断里「陈述的契约」
 * 与侧车里的契约不是同一个）；
 * - 侧车 DSL 回写（`nudo contract --emit`）同样写 `lit(0)`。
 *
 * `-0` 与 `0` 身份不同（`Object.is` / `1/x` 可观察）——仓库自己已写明这一点
 * （`term.ts` 的 `litKeyString`、`format.ts` 的 `formatLitValue`）⇒ 本面是
 * 同一份「`-0` 保真」约定的**第三个漏点**。
 *
 * 改后：`litToString` 的 number 分支复用仓库既有的保真口径 `litKeyString`
 * （`./term.ts`：`Object.is(v, -0) ⇒ "-0"`）；`lengthBound` 的常数界渲染
 * （`.length(n)`）同款口径一并改。
 *
 * ⚠ 范围：只改 `contract.ts` 的 `litToString` + `lengthBound` 渲染点；
 * `term.ts` / `format.ts` 是**只读**参考（口径来源），未改动。
 */





  it("lit(-0) 渲染成 lit(-0)，不是 lit(0)；字段位（shape）保真：侧车回显与字段契约同源；函数契约整体保真（参数位 + 返回位）；lengthBound 的常数界渲染同款口径（.length(-0)）；负控制：正零仍是 0（不得把 0 渲成 -0）；负控制：其它字面量形态不受牵连（bigint 的 n 后缀 / 字符串 / 布尔）；原生事实：-0 与 0 确实可观察不同（Object.is / 1/x）", () => {
  {
    expect(formatConstraint(litC(-0))).toBe("lit(-0)");
    expect(formatConstraint(litC(-0))).not.toBe("lit(0)");
  }
  {
    expect(formatConstraint(shape({ v: litC(-0) }))).toBe("shape({ v: lit(-0) })");
  }
  {
    expect(formatConstraint(fn({ o: shape({ v: litC(-0) }) }, litC(-0)))).toBe(
      "fn({ o: shape({ v: lit(-0) }) }, lit(-0))",
    );
  }
  {
    expect(formatConstraint(str().length(-0))).toBe("string().length(-0)");
  }
  {
    expect(formatConstraint(litC(0))).toBe("lit(0)");
    expect(formatConstraint(shape({ v: litC(0) }))).toBe("shape({ v: lit(0) })");
    expect(formatConstraint(str().length(0))).toBe("string().length(0)");
  }
  {
    expect(formatConstraint(litC(10n))).toBe("lit(10n)");
    expect(formatConstraint(litC("x"))).toBe('lit("x")');
    expect(formatConstraint(litC(true))).toBe("lit(true)");
  }
  {
    expect(Object.is(-0, 0)).toBe(false);
    expect(Object.is(-0, -0)).toBe(true);
    expect(1 / -0).toBe(-Infinity);
    // String() 抹掉符号 —— 这正是改前的漏点
    expect(String(-0)).toBe("0");
  }
});







});

// ---------------------------------------------------------------------------
// 实例方法桥不得把构造器的 throws 归因到方法
// ---------------------------------------------------------------------------
describe("实例方法桥不得把构造器的 throws 归因到方法", () => {
/**
 * L2 实例方法桥把**构造器**的 throws 归因到方法体 ⇒ 普通类即触发
 * error 级 `nudo:entry-may-throw`（CI 闸门假红）。
 *
 * 根因：check-may-throw.ts 的实例方法桥执行
 * `$new(clsAbs, ctorAnyArgs(file, clsName))` ⇒ 构造器实参**一律补 `any`**
 * ⇒ 构造器体内的任何强制转换（`x + 1` / `x > 0` / `"a" + x` / `x.toFixed()`）
 * 都产 TypeError ⇒ 那被算进**方法**的 throws 域。
 *
 * 三个错：
 * ① 归因错——TypeError 来自构造器，`Account.describe` 本身不抛；
 * ② 该 TypeError 是 `any` 实参的**假象**（真实调用点传 number 时构造器 total）；
 * ③ 该诊断是 error 级（AGENT.md：L2 entry may-throw 默认 error）⇒ 卡死用户 CI。
 *
 * 修法：构造器改在**独立 may-throw 会话**里跑（软效果与硬抛都不归因给方法），
 * 方法体自身的证据照常收集（闸门不整体关掉）。
 */







const acctSrc = `export class Account {
  constructor(balance) { this.balance = balance + 1; }
  describe() { return "acct"; }
}
`;


  it("构造器做算术 ⇒ 方法入口不再报 nudo:entry-may-throw（改前：error 级 1 条）；构造器做比较 / 字符串拼接 / 成员调用 ⇒ 同上（都只算构造器的账）；构造器显式 throw ⇒ 也不归因给方法（那是 `new C()` 入口的事）；方法体**自己**会抛 ⇒ 仍要报（闸门不整体关掉）；方法体读构造器写入的字段（any）⇒ 成员调用仍报（构造器仍要跑）；静态方法口径不变（静态桥不跑构造器 ⇒ 它自己的算术照报）；单元层：实例方法的 throws ", () => {
  {
    const r = checkSource_____index_ts("acct.js", acctSrc, pTrue_____index_ts, stdOpts);
    // 归因面：构造器的算术**不**归因给方法入口（本用例的正面口径）
    expect(l2Count(r, "Account.describe")).toBe(0);
    expect(sigOf(r, "Account.describe")).not.toContain("throws");
    // BUG-107：但它**是** `new Account(...)` 这个类入口的事实（同文件
    // `export function f(x){return x+1}` 本来就被报）⇒ 全文件不再零 error，
    // 且唯一那条的归因落点是类名而不是方法名。
    const errs = r.issues.filter((i) => i.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.fn).toBe("Account");
  }
  {
    const variants = [
      `export class A { constructor(x) { this.v = x > 0; } describe() { return "a"; } }`,
      `export class A { constructor(x) { this.v = "a" + x; } describe() { return "a"; } }`,
      `export class A { constructor(x) { this.v = x.toFixed(); } describe() { return "a"; } }`,
    ];
    for (const src of variants) {
      const r = checkSource_____index_ts("acct.js", src, pTrue_____index_ts, stdOpts);
      expect(l2Count(r, "A.describe")).toBe(0);
    }
  }
  {
    const src = `export class A {
  constructor(x) { throw new TypeError("ctor"); }
  describe() { return "a"; }
}`;
    const r = checkSource_____index_ts("acct.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "A.describe")).toBe(0);
  }
  {
    const src = `export class A {
  constructor(x) { this.v = x; }
  describe() { throw new TypeError("m"); }
}`;
    const r = checkSource_____index_ts("acct.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "A.describe")).toBe(1);
    const issue = r.issues.find(
      (i) => i.code === "nudo:entry-may-throw" && i.fn === "A.describe",
    );
    expect(issue?.severity).toBe("error");
    expect(sigOf(r, "A.describe")).toContain("throws TypeError");
  }
  {
    const src = `export class A {
  constructor(x) { this.v = x; }
  describe() { return this.v.toFixed(); }
}`;
    const r = checkSource_____index_ts("acct.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "A.describe")).toBe(1);
  }
  {
    const src = `export class A {
  constructor(x) { this.v = x + 1; }
  static make(y) { return y + 1; }
}`;
    const r = checkSource_____index_ts("acct.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "A.make")).toBe(1);
  }
__scenario_1: {
    const file = parseSource(acctSrc);
    const out = evalThrowsOutcome(acctSrc, "Account.describe", [], {}, pTrue_____index_ts, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") break __scenario_1;
    expect(throwAbsToKinds(out.result.throws)).toEqual([]);
  }
__scenario_2: {
    const src = `export class A {
  constructor(x) { this.v = x + 1; }
  describe() { throw new TypeError("m"); }
}`;
    const file = parseSource(src);
    const out = evalThrowsOutcome(src, "A.describe", [], {}, pTrue_____index_ts, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") break __scenario_2;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  }
});








});

// ---------------------------------------------------------------------------
// async generator 声明体的 await 不发射裸 yield
// ---------------------------------------------------------------------------
describe("async generator 声明体的 await 不发射裸 yield", () => {
/**
 * 回归：async generator **声明**体里的 `await` 不得发射成裸 `yield`。
 *
 * 背景：`async function*` 声明（`export async function* f(){}` /
 * `export default async function*(){}` / 嵌套声明）的体被编译成
 * `$gen(() => {…}, true)`——体是**普通箭头**，不是宿主生成器 ⇒ 体里的
 * `await` 若按 async **函数**口径发射成裸 `yield`（`(yield …)`），产物
 * **不是合法 JS** ⇒ `new Function` 编译期 SyntaxError（Unexpected strict
 * mode reserved word）⇒ **整模块**求值失败（fail-closed）⇒ 全部导出退化
 * unknown/opaque ⇒ **L2 门禁（`nudo:entry-may-throw`）不再触发 ⇒ 门禁假绿**。
 *
 * 三条兄弟路径（函数**表达式** / 对象**方法** / class **方法**）都有
 * `generator !== true` 守卫（async generator 的体不是宿主生成器 ⇒ await
 * 走 `$await(…)` 兜底），**只有声明路径漏了**。
 *
 * 修法：`transpile/stmt/statement.ts` 的声明面 async 挂起判定与兄弟路径
 * 对齐——`stmt.async === true && stmt.generator !== true` 才做 async 挂起
 * 计划 ⇒ async generator 体走 `$await(…)`（不再是裸 `yield`）。
 *
 * 断言口径：
 * - 门禁面：同文件的**其它**导出（`risky()`）仍报 `nudo:entry-may-throw`
 * （error 级）⇒ 修前整模块 fail-closed ⇒ 该诊断消失（假绿）。
 * - 产物面：转译产物里 async generator 体内**不得有裸 `yield`**（`$yield(…)`
 * 是显式 `yield` 表达式的正常发射，与 await 无关）。
 * - 产出面：async generator 自身的元素仍正确（for-await 累加精确）。
 */







/** 剥外层 promise（async 函数面：返回值恒 promise<内层>） */
function unwrapPromise(a: Abs): Abs {
  return a.shape.k === "eff" && a.shape.eff === "promise" ? a.shape.inner : a;
}

/** async 函数体的求值结果（剥 promise 后的字面量值） */
function v(src: string, fnName = "f") {
  return litValue_____abs_ts(unwrapPromise(call(src, fnName).result));
}

/** check 门禁的整文件报告 */
function report(src: string) {
  return checkSource_____index_ts("/t/async-gen-decl.js", src, pTrue_____index_ts, {});
}

/** 诊断码集 */
function codes(src: string): string[] {
  return report(src).issues.map((i) => i.code);
}

/** 触发源：async generator 声明 + 另一个必抛导出（L2 门禁探针） */
const SRC = `export function risky(){ throw new Error("boom"); }
export async function* f(){ await Promise.resolve(1); yield 1; }`;


  it("转译产物里 async generator 体内没有裸 yield（修前：`(yield …)` ⇒ 非法 JS）；整模块不再 fail-closed：其它导出的 L2 门禁仍触发（修前：诊断消失 ⇒ 假绿）；其它导出的签名不退化 unknown（修前：risky 退成 `risky() => unknown`）；无假 nudo:opaque-result（修前：整模块 unknown ⇒ 假 opaque 诊断）；async generator 自身的产出仍正确（for-a", () => {
  {
    const js = transpileSource(SRC, { source: SRC });
    expect(js).not.toContain("(yield ");
    // 显式 `yield` 表达式仍走 $yield（与 await 无关）
    expect(js).toContain("$yield(");
    // await 走 $await 兜底（async generator 体不是宿主生成器）
    expect(js).toContain("$await(");
  }
  {
    const r = report(SRC);
    expect(l2Count(r, "risky")).toBe(1);
    expect(r.issues.find((i) => i.code === "nudo:entry-may-throw")?.severity).toBe("error");
  }
  {
    expect(sigOf(report(SRC), "risky")).not.toBe("unknown");
    expect(sigOf(report(SRC), "risky")).toBe(sigOf(report(`export function risky(){ throw new Error("boom"); }`), "risky"));
  }
  {
    expect(codes(SRC)).not.toContain("nudo:opaque-result");
  }
  {
    const src = `export async function* f(){ await Promise.resolve(1); yield 7; }
export async function g(){ let t = 0; for await (const v of f()) t += v; return t; }`;
    expect(v(src, "g")).toEqual({ ok: true, value: 7 });
  }
  {
    const src = `export async function* f(){ await Promise.resolve(1); yield 1; }
export function g(){ return typeof f().next().then; }`;
    expect(v(src, "g")).toEqual({ ok: true, value: "function" });
  }
  {
    const src = `export function risky(){ throw new Error("boom"); }
export default async function* g(){ await Promise.resolve(1); yield 1; }`;
    const js = transpileSource(src, { source: src });
    expect(js).not.toContain("(yield ");
    expect(l2Count(report(src), "risky")).toBe(1);
  }
  {
    const src = `export function risky(){ throw new Error("boom"); }
export function h(){ async function* g(){ await Promise.resolve(1); yield 1; } return typeof g().next().then; }`;
    const js = transpileSource(src, { source: src });
    expect(js).not.toContain("(yield ");
    expect(l2Count(report(src), "risky")).toBe(1);
    expect(v(src, "h")).toEqual({ ok: true, value: "function" });
  }
});









describe("负控制：兄弟路径与同步/async 声明不得回归", () => {
  it("同步 generator 声明：体里的 yield 仍走 $yield（不是 $await）；async **函数**（非 generator）声明：await 仍发射裸 yield（真挂起点）；async generator **表达式**面（兄弟路径）不受影响：await 走 $await", () => {
  {
    const src = `export function* g(){ yield 1; }`;
    const js = transpileSource(src, { source: src });
    expect(js).toContain("$yield(");
    expect(js).not.toContain("(yield ");
  }
  {
    const src = `export async function h(){ await Promise.resolve(1); return 2; }`;
    const js = transpileSource(src, { source: src });
    expect(js).toContain("(yield ");
  }
  {
    const src = `export function f(){ const g = async function*(){ await Promise.resolve(1); yield 1; }; return typeof g().next().then; }`;
    const js = transpileSource(src, { source: src });
    expect(js).not.toContain("(yield ");
  }
});


});
});

// ---------------------------------------------------------------------------
// Uint8ClampedArray 取值是「就近偶数」（不向零截断）
// ---------------------------------------------------------------------------
describe("Uint8ClampedArray 取值是「就近偶数」（不向零截断）", () => {
/**
 * 回归：`Uint8ClampedArray` 元素取值**先截断再钳位** ⇒ 自信错值。
 *
 * 修前（探针实测）：
 * - `new Uint8ClampedArray([1.5])[0]` ⇒ **1**（原生 2）；
 * - `new Uint8ClampedArray([3.5])[0]` ⇒ **3**（原生 4）。
 *
 * 根因：`builtins/error/binary.ts` 的 `taStoreNumber` 先做
 * `Math.trunc`（整数 TA 的 ToIntegerOrInfinity 口径），再调
 * `taClampUint8`（ToUint8Clamp——**就近偶数**取整，**不**向零截断）。
 * 钳位函数本身是对的，被上游的截断污染 ⇒ 折出自信的错值。
 *
 * 修后：`Uint8ClampedArray` 分支改吃**未截断**的值（`taClampUint8` 自带
 * NaN / ±Infinity / 0 / 255 边界处理）；其余整数 TA（Int8Array 等）的
 * 向零截断口径**不变**（负控制）。
 *
 * oracle：node v26.10.0 实测（ES2024 7.1.7 ToUint8Clamp）。
 */



const wrap = (body: string) => `export function f() { ${body} }`;


  it("new Uint8ClampedArray([1.5])[0] ⇒ 2（native：2；修前：1）；new Uint8ClampedArray([3.5])[0] ⇒ 4（native：4；修前：3）；就近偶数（tie → 偶数）：2.5 ⇒ 2、4.5 ⇒ 4、0.5 ⇒ 0（native 同款）；非 tie 值照旧四舍五入：1.4 ⇒ 1、1.6 ⇒ 2（native 同款）", () => {
  {
    expect(val(wrap(`return new Uint8ClampedArray([1.5])[0];`))).toEqual({ ok: true, value: 2 });
  }
  {
    expect(val(wrap(`return new Uint8ClampedArray([3.5])[0];`))).toEqual({ ok: true, value: 4 });
  }
  {
    expect(val(wrap(`return new Uint8ClampedArray([2.5])[0];`))).toEqual({ ok: true, value: 2 });
    expect(val(wrap(`return new Uint8ClampedArray([4.5])[0];`))).toEqual({ ok: true, value: 4 });
    expect(val(wrap(`return new Uint8ClampedArray([0.5])[0];`))).toEqual({ ok: true, value: 0 });
  }
  {
    expect(val(wrap(`return new Uint8ClampedArray([1.4])[0];`))).toEqual({ ok: true, value: 1 });
    expect(val(wrap(`return new Uint8ClampedArray([1.6])[0];`))).toEqual({ ok: true, value: 2 });
  }
});





describe("负控制（边界与整数 TA 口径不变）", () => {
  it("边界：300 ⇒ 255、-1 ⇒ 0（native 同款）；整数 TA 仍是向零截断：new Int8Array([1.5])[0] ⇒ 1（native：1）；浮点 TA 不钳位：new Float64Array([1.5])[0] ⇒ 1.5（native：1.5）", () => {
  {
    expect(val(wrap(`return new Uint8ClampedArray([300])[0];`))).toEqual({ ok: true, value: 255 });
    expect(val(wrap(`return new Uint8ClampedArray([-1])[0];`))).toEqual({ ok: true, value: 0 });
  }
  {
    expect(val(wrap(`return new Int8Array([1.5])[0];`))).toEqual({ ok: true, value: 1 });
  }
  {
    expect(val(wrap(`return new Float64Array([1.5])[0];`))).toEqual({ ok: true, value: 1.5 });
  }
});


});
});

// ---------------------------------------------------------------------------
// 类方法桥：构造器抛不得拖垮方法体的推断
// ---------------------------------------------------------------------------
describe("类方法桥：构造器抛不得拖垮方法体的推断", () => {
/**
 * 回归：类方法桥的**值域**通道（`generalize.ts`）——构造器**抛**时
 * 方法体的推断被一起拖垮 ⇒ 签名退 unknown + 误导的 info 级
 * `nudo:opaque-result`（把「构造器必抛」谎报成「推断失败」）。
 *
 * 与 （`check-may-throw.ts` 的**证据域**通道：构造器 throws 被归因给
 * 方法 ⇒ error 级 `nudo:entry-may-throw` 假红）是同一根因的两条通道：
 * 构造器的行为**不该**污染方法体的推断。
 *
 * 修前：`$new` 抛 ⇒ 异常逃出 `runCore` ⇒ `Account.describe` 退 unknown。
 * 修后：构造器抛 ⇒ 退到**裸实例**（跳过构造器）继续求值方法体 ⇒ 方法体
 * 自身的推断照常产出（`"acct"`）。
 *
 * oracle：语义断言（构造器抛 ≠ 方法抛）。
 */



/** 构造器必抛、方法体 total */
const CTOR_THROWS = `export class Account {
  constructor(balance) { throw new Error("boom"); }
  describe() { return "acct"; }
}`;


  it("构造器抛 + 方法体 total ⇒ 方法签名仍是 \"acct\"（不是 unknown）；构造器抛 ⇒ 不产生误导的 nudo:opaque-result；构造器**不**抛时行为不变（方法签名照常）", () => {
  {
    const r = issuesOf(CTOR_THROWS);
    expect(sigOf(r, "Account.describe")).toBe(String.raw`"acct"`);
  }
  {
    const r = issuesOf(CTOR_THROWS);
    expect(r.issues.filter((i) => i.code === "nudo:opaque-result")).toHaveLength(0);
  }
  {
    const r = issuesOf(`export class Account {
      constructor(balance) { this.balance = balance; }
      describe() { return "acct"; }
    }`);
    expect(sigOf(r, "Account.describe")).toBe(String.raw`"acct"`);
  }
});



});

// ---------------------------------------------------------------------------
// 引理账本 = 消费事实源（归因取数在记账之后）
// ---------------------------------------------------------------------------
describe("引理账本 = 消费事实源（归因取数在记账之后）", () => {
/**
 * **引理账本**（`assume-ledger.ts`）是「本次证明消费过哪些公理」的
 * 唯一事实源；归因面（`nudo:assume-relied`）必须在**记账之后**读它。
 *
 * 背景（并发 review 收口发现的死写）：Φ 侧的消费在 `check-return.ts` 的证明段
 * 里记进账本（`noteAssumeConsumed`），而调用方（`check.ts`）传入的
 * `consumedAssume` 快照取自**调用之前** ⇒ Φ 侧的写入永远读不到 ⇒ 账本写入
 * 成了死写；changeset 宣称的「经 `noteAssumeConsumed` 记进引理账本 ⇒
 * `nudo:assume-relied` 归因可见」这条链路实际断在取数时序上。
 *
 * 修法：归因集就地取账本（读在写之后）⇒ 账本是唯一事实源；调用方快照退化为
 * 兜底（保留兼容）。
 *
 * 本文件覆盖：
 * - 账本是**活写**：Φ 被消费 ⇒ 记账 + 归因可见（不依赖调用方传快照）。
 * - 只靠账本消费（调用方未传快照）⇒ 仍须归因（改前此处归因丢失）。
 * - 未被消费的公理**不得**归因（不得把没消费过的公理报成 relied）。
 * - 账本按**对象身份**匹配（别的前提不得按位置误配）。
 */






/** 返回项：number，term = y（无 pred ⇒ 无值域证据） */
const retY = abs({ k: "prim", type: "number" }, v_____index_ts("y"), undefined, "exact");
/** 返回项：number，term = y，值域证据 `y > 20`（自身即可蕴含契约 `y > 10`） */
const retYProved = abs(
  { k: "prim", type: "number" },
  v_____index_ts("y"),
  gt_____index_ts(v_____index_ts("y"), { op: "lit", value: 20 }),
  "exact",
);


  it("Φ 被消费 ⇒ 记账 + 归因可见（账本是活写，不依赖调用方传快照）；只靠账本消费（调用方未传快照）⇒ 仍须归因（改前此处归因丢失）；既未记账、也非 Φ 命中 ⇒ 不归因（不得把没消费过的公理报成 relied）；账本里是**别的**前提（对象身份不同）⇒ 不归因（防按位置误配）；证明不成立（unprovable / disproved）⇒ 不报 relied（归因只对已证义务）", () => {
  {
    resetAssumeConsumed();
    // Φ = `y > 20`（同项且蕴含 `y > 10`）⇒ 去掉 Φ 证不出 ⇒ 本次证明依赖
    // 这条公理 ⇒ 记账 + 归因。**不传** `consumedAssume`（调用方快照缺位）。
    const premise = gt_____index_ts(v_____index_ts("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint("f", "positive", number().gt(10), retY, {
      phi: premise,
      phiPremises: [premise],
      assumeDisplay: ["y >= 20"],
    });
    expect(assumeConsumed()).toContain(premise);
    const relied = issues.filter((i) => i.code === "nudo:assume-relied");
    expect(relied).toHaveLength(1);
    expect(relied[0]!.message).toContain("y >= 20");
  }
  {
    // 模拟代数核在**引理消费点**（div/sub 折叠）记账：调用方没有把快照传进来
    // ⇒ 归因只能靠就地读账本。改前（只认调用方快照）⇒ 这里归因丢失。
    resetAssumeConsumed();
    const premise = gt_____index_ts(v_____index_ts("y"), { op: "lit", value: 20 });
    noteAssumeConsumed(premise);
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retYProved,
      {
        assumeDisplay: ["y >= 20"],
        phiPremises: [premise],
      },
    );
    const relied = issues.filter((i) => i.code === "nudo:assume-relied");
    expect(relied).toHaveLength(1);
    expect(relied[0]!.message).toContain("y >= 20");
  }
  {
    resetAssumeConsumed();
    const premise = gt_____index_ts(v_____index_ts("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retYProved,
      {
        assumeDisplay: ["y >= 20"],
        phiPremises: [premise],
      },
    );
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(0);
  }
  {
    resetAssumeConsumed();
    // 账本记的是 `x > 5`，而归因面要认的是 `y >= 20` ⇒ 两者不是同一条引理
    // （账本口径 = **对象身份**，不是位置）⇒ 不得归因。
    noteAssumeConsumed(gt_____index_ts(v_____index_ts("x"), { op: "lit", value: 5 }));
    const premise = gt_____index_ts(v_____index_ts("y"), { op: "lit", value: 20 });
    const issues = checkReturnConstraint(
      "f",
      "positive",
      number().gt(10),
      retYProved,
      {
        assumeDisplay: ["y >= 20"],
        phiPremises: [premise],
      },
    );
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(0);
  }
  {
    resetAssumeConsumed();
    const premise = gt_____index_ts(v_____index_ts("y"), { op: "lit", value: 20 });
    noteAssumeConsumed(premise);
    // ret 无值域证据、无 Φ ⇒ 证不出 ⇒ 不是「证成了 ⇒ 依赖公理」
    const issues = checkReturnConstraint("f", "positive", number().gt(10), retY, {
      assumeDisplay: ["y >= 20"],
      phiPremises: [premise],
    });
    expect(issues.filter((i) => i.code === "nudo:assume-relied")).toHaveLength(0);
    expect(issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  }
});





});

// ---------------------------------------------------------------------------
// 显式 undefined 走默认值
// ---------------------------------------------------------------------------
describe("显式 undefined 走默认值", () => {
/**
 * 显式 `undefined` 传给**带默认值**的形参被当成「值就是 undefined」
 * ⇒ 契约面报假红（P1）。
 *
 * 复现：`/** @nudo:contract x positive *\/ function d1(x = 5)`，`d1(undefined)`
 * ⇒ 报「实参 undefined」+「x > 0」两条约束错 + 虚假元数警告。
 *
 * 根因（`scan/literal-args.ts` 的 `parseCallArgs` 的 Identifier `undefined`
 * 分支）：它把 `undefined` 当成**实参值**抽成 `absLit(undefined)`；但 JS 语义是
 * 「带默认值的形参收到显式 `undefined` ⇒ **走默认值**」（`d1(undefined)` ≡ `d1()`）
 * ⇒ 运行时 x = 5（满足 `x > 0`）⇒ 报违例是假红。
 *
 * 修法：复用 `defaultArgAbss` —— 显式 `undefined` 的实参位**改用默认值**再执法。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDE = `import { number } from "@nudojs/core";
export const positive = number().gt(0);
`;

function check(src: string, file = "/t/undef.js") {
  const imp = `/// @nudo:import { positive } from "./std.nudo.js"\n`;
  return checkSource_____index_ts(file, imp + src, pTrue_____index_ts, sidecarOpts("std.nudo", SIDE, file));
}

function violations(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}


  it("d1(undefined)（x = 5，契约 x > 0）⇒ 零诊断（默认值 5 满足契约）；默认值本身违约时仍要报（d2(undefined)，x = -5，契约 x > 0）；负控制：没有默认值的形参收 undefined ⇒ 仍按 undefined 执法（报 typeof 违例）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x positive */
function d1(x = 5) { return x; }
export function use() { return d1(undefined); }
`);
    expect(violations(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x positive */
function d2(x = -5) { return x; }
export function use() { return d2(undefined); }
`);
    expect(violations(r)).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract x positive */
function d3(x) { return x; }
export function use() { return d3(undefined); }
`);
    expect(violations(r)).toBeGreaterThan(0);
  }
});



});

// ---------------------------------------------------------------------------
// .int() 只在数值链上成立（域面 / Abs 面口径一致）
// ---------------------------------------------------------------------------
describe(".int() 只在数值链上成立（域面 / Abs 面口径一致）", () => {
/**
 * `.int()` 对**非 number builder** 暴露 ⇒ 域面 / Abs 面**两个裁决**。
 *
 * 缺陷（口径分裂）：
 * - 域面（`domain-membership.ts` 的 `literalMeetsConstraint`）：int 只在
 * `prim === "number"` 时执法 ⇒ `literalMeetsConstraint("abc", string().int())`
 * **接受** "abc"。
 * - Abs / 投影面（`constraint.ts` 的 `constraintOnTermAbs`）：此前对**任何**带
 * int 位的约束都生成 `eq(self % 1, 0)` ⇒
 * `constraintToEntryAbs(string().int(), "s").pred` 带整数谓词 ⇒ 同一约束在
 * 产物面（zod / standard / guard）上会要求 `"abc" % 1 === 0` ⇒ 假红。
 *
 * 修法（**拒绝**路线）：`.int()` 只在数值链上成立 —— 与 `shift()` 同口径，
 * 非数值链 / 结构链上直接报错（构造期即失败，不再产出互相矛盾的契约）；
 * `constraintOnTermAbs` 的整性 pred 也只在 `prim === "number"` 时生成 ⇒
 * 域面与 Abs 面口径一致。
 */






beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** pred 树里有没有 `eq(x % 1, 0)` 这条整性编码 */
function hasIntEncoding(pred: unknown): boolean {
  if (!pred || typeof pred !== "object") return false;
  const p = pred as {
    op?: string;
    fn?: string;
    value?: unknown;
    a?: { op?: string; fn?: string; args?: unknown[] };
    b?: { op?: string; value?: unknown };
    args?: unknown[];
  };
  if (p.op === "eq") {
    const isModOne = (t: { op?: string; fn?: string; args?: unknown[] } | undefined): boolean =>
      t?.op === "app" && t.fn === "%" && Array.isArray(t.args) && t.args.length === 2;
    const isZero = (t: { op?: string; value?: unknown } | undefined): boolean =>
      t?.op === "lit" && t.value === 0;
    if ((isModOne(p.a as never) && isZero(p.b as never)) || (isModOne(p.b as never) && isZero(p.a as never)))
      return true;
  }
  if (p.op === "and" && Array.isArray(p.args)) return p.args.some((x) => hasIntEncoding(x));
  return false;
}


  it("string().int() 抛错（不再暴露到非数值 builder）；boolean().int() 抛错；lit('a') 根本不带 int 方法（非数值字面量链无法产出分裂约束）；number().int() 仍然可用（负控制）；域面 / Abs 面口径一致：非数值链上不存在 int 约束；数值链的 Abs 面仍带整性编码（Bug 342 语义不回归）；纯数据约束（非 number prim）不再产出整性 pred（两面一致）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (string() as unknown as { int: () => unknown }).int()).toThrow(/int\(\)/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (boolean() as unknown as { int: () => unknown }).int()).toThrow(/int\(\)/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect((lit_____index_ts("a") as unknown as { int?: () => unknown }).int).toBeUndefined();
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const c = number_____index_ts().int();
    expect(isIntFlag(c)).toBe(true);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    // 构造期即拒绝 ⇒ 不存在「域面接受、Abs 面带整数谓词」的分裂约束
    expect(() => (string() as unknown as { int: () => unknown }).int()).toThrow();
    // 数值链上两面一致：3.5 不满足 number().int()
    const c = number_____index_ts().int();
    expect(literalMeetsConstraint(3.5, c)).toBe(false);
    expect(literalMeetsConstraint(3, c)).toBe(true);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(hasIntEncoding(constraintToEntryAbs(number_____index_ts().int(), "n").pred)).toBe(true);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const raw = { __nudoConstraint: true, prim: "string", preds: [], int: true } as never;
    expect(hasIntEncoding(constraintToEntryAbs(raw, "s").pred)).toBe(false);
  }
});








/**
 * 同一约束面（构造器实参 / 界护栏）的其余**静默无效输入**（报告 §附带项，
 * 逐条确认后处理）：
 *
 * - `boolean().gt(1)` / `string().gt(1)` ⇒ 此前静默产出 `gt(self, 1)`
 * ⇒ ① 域面 / Abs 面两个裁决；② 该约束**恒假** ⇒ 每个合法实参都被判违例
 * = **假红** ⇒ **已修**（非数值链上直接报错，与 `shift()` 同口径）。
 * - `string().length(-3)` ⇒ 产出 `len(self) === -3` ⇒ **恒假** ⇒ 假红
 * ⇒ **已修**（长度界必须非负；`length` 还必须是非负整数）。
 * - `array(1, 2)` ⇒ 第二个实参被**静默丢弃** ⇒ 用户的元素约束从未生效
 * （契约被悄悄削弱 = 假绿）⇒ **已修**（多余实参直接报错）。
 * - `pick(shape({a}), ["b"])` ⇒ 不存在的 key **被忽略**（文档化的既有语义：
 * 「shape 子形状（不存在的 key 忽略）」）⇒ **保持现状**（改成报错会破坏
 * 已文档化的语义与既有侧车）。
 * - `omit(c, ["zzz"])` ⇒ 去掉一个不存在的 key 本就是 no-op ⇒ **保持现状**。
 * - `lit()` ⇒ 与 `lit(undefined)` **语法不可区分**（而 `lit(undefined)` 是合法
 * 契约）⇒ **保持现状**。
 */
describe("附带 —— 约束构造器的无效输入不再被静默接受", () => {
  it("boolean().gt(1) 抛错（恒假契约 ⇒ 假红）；string().gt(1) 抛错（恒假契约 ⇒ 假红）；string().length(-3) 抛错（恒假契约 ⇒ 假红）；负控制：既有的有限界护栏口径不变（length(2.5) 仍合法，Bug 336 钉住）；array(1, 2) 抛错（多余实参不再被静默丢弃）；负控制：合法用法仍然可用（number().gt(0) / string().min(1) / array(number())）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (boolean() as unknown as { gt: (n: number) => unknown }).gt(1)).toThrow(/gt\(\)/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (string() as unknown as { gt: (n: number) => unknown }).gt(1)).toThrow(/gt\(\)/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (string() as unknown as { length: (n: number) => unknown }).length(-3)).toThrow(
      /length\(\)/,
    );
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (string() as unknown as { length: (n: number) => unknown }).length(2.5)).not.toThrow();
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => (array as unknown as (...a: unknown[]) => unknown)(1, 2)).toThrow(/array\(\)/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => number_____index_ts().gt(0)).not.toThrow();
    expect(() => string().min(1)).not.toThrow();
    expect(() => string().max(20)).not.toThrow();
    expect(() => array(number_____index_ts())).not.toThrow();
  }
});





});
});

// ---------------------------------------------------------------------------
// 早返回的关系补集不再默认「x 不是 NaN」（不得假绿）
// ---------------------------------------------------------------------------
describe("早返回的关系补集不再默认「x 不是 NaN」（不得假绿）", () => {
/**
 * 早返回形态的**关系补集**窄化默认「x 不是 NaN」⇒ 门禁**假绿**。
 *
 * 根因（core/algebra/exec/transpile/stmt/fn-body.ts + stmt/statement.ts）：
 * 「事实臂以 return/throw 提前退出 ⇒ else 臂 = **后续路径**（测试为假）」这条
 * 实现路径在后续路径上断言**否定关系界**（的
 * `narrowRelComplementArmThunk` / `REL_COMPLEMENT_OP`：`x <= k` 为假 ⇒ `x > k`）。
 * 但 JS 里 `¬(x <= k)` 还含 `x` 为 **NaN** 的情形（NaN 与任何比较皆假）⇒
 * 后续路径只能断定 `x > k ∨ x is NaN` ⇒ 断言 `x > k` **排除了 NaN**（不健全）。
 *
 * 后果（假绿）：
 * `if (x < 0) return 0; return x;` + `@nudo:contract return nonNeg`
 * ⇒ 后续路径断言 `x >= 0` ⇒ 契约被「证成」⇒ **0 诊断**（CI 绿灯）。
 * 而原生 x=NaN 时：`NaN < 0` 为**假** ⇒ 走到 `return x` ⇒ 返回 NaN ⇒
 * 违反 `nonNeg`（NaN 不满足 `>= 0`）⇒ **真违规**被放过。
 *
 * 同族形态（报告点名）：`if (x <= 0) return 1; return x;` + `positive`；
 * `if (x > 100) return 100; return x;` + `max100`；if/else 写法同理。
 *
 * 修法：后续路径**不断言否定界**（事实臂 `narrowRelArmThunk` 保留——那一侧
 * 「测试为真」⇒ NaN 不可达，断言健全）⇒ 后续路径与**三元写法**
 * （`return x < 0 ? 0 : x;`，else 臂本就无否定界窄化）**同口径**。
 *
 * 严重级由「返回义务」通道决定（声明域参数的值域已知 ⇒ 不蕴含
 * 契约 = 契约不成立 ⇒ error）；本文件只钉「**不得静默**」与「两种等价写法
 * 结论一致」两条不变式。
 */







/** 返回义务诊断（违约 error + 证不出 warning）的 "severity:code" 列表 */
function retDiags(body: string, cname: string, file = "/t/bug1115.js"): string[] {
  const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return ${cname}
 */
export function f(x) {${body}}
`);
  const r = checkSource_____index_ts(file, src, pTrue_____index_ts, stdOpts);
  return r.issues
    .filter(
      (i) => i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return",
    )
    .map((i) => `${i.severity}:${i.code}`);
}

/** 原生 oracle：跑真 JS，回报返回值（NaN 用 "NaN" 标记） */
function native(body: string, arg: unknown): string {
  const fn = new Function("x", body) as (x: unknown) => unknown;
  const v = fn(arg);
  return typeof v === "number" && Number.isNaN(v) ? "NaN" : String(v);
}

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("原生 oracle：早返回形态在 x=NaN 时返回 NaN（违反 nonNeg）；早返回形态不得静默（0 诊断 = 假绿）；早返回形态与三元写法结论一致（同一契约 ⇒ 同一诊断）；同族形态：`positive` 家族（x <= 0 ⇒ 返回 1）不得静默；同族形态：`max100` 家族（x > 100 ⇒ 返回 100）不得静默；同族形态：if/else 写法（else 臂 = 后续路径）不得静默；负控制：事实臂的关系窄化**保留**（x >= 0 ⇒ return x ", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 原生：`NaN < 0` 为假 ⇒ 走到 `return x` ⇒ 返回 NaN。
    expect(native("if (x < 0) return 0; return x;", Number.NaN)).toBe("NaN");
    // 对照：x=5 ⇒ 返回 5（满足 nonNeg）⇒ 该函数不是「恒违约」，而是
    // 「存在违约输入」⇒ 契约未被证明 ⇒ 必须被报告。
    expect(native("if (x < 0) return 0; return x;", 5)).toBe("5");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 修前：后续路径断言 `x >= 0` ⇒ 契约被证成 ⇒ 0 诊断。
    expect(retDiags("  if (x < 0) return 0;\n  return x;", "nonNeg")).not.toHaveLength(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const early = retDiags("  if (x < 0) return 0;\n  return x;", "nonNeg");
    const ternary = retDiags("  return x < 0 ? 0 : x;", "nonNeg");
    expect(early).toEqual(ternary);
    expect(early).not.toHaveLength(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 原生：x=NaN ⇒ `NaN <= 0` 为假 ⇒ 返回 NaN ⇒ 违反 positive。
    expect(native("if (x <= 0) return 1; return x;", Number.NaN)).toBe("NaN");
    expect(retDiags("  if (x <= 0) return 1;\n  return x;", "positive")).not.toHaveLength(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(native("if (x > 100) return 100; return x;", Number.NaN)).toBe("NaN");
    expect(retDiags("  if (x > 100) return 100;\n  return x;", "max100")).not.toHaveLength(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      retDiags("  if (x < 0) { return 0; } else { return x; }", "nonNeg"),
    ).not.toHaveLength(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 事实臂（测试为真 ⇒ NaN 不可达）⇒ 断言 `x >= 0` 健全 ⇒ 契约可证。
    expect(retDiags("  if (x >= 0) return x;\n  return 0;", "nonNeg")).toHaveLength(0);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(retDiags("  return x < 0 ? 0 : x;", "nonNeg")).not.toHaveLength(0);
  }
});







}
});

// ---------------------------------------------------------------------------
// 声明域参数 / 字面量分支的返回义务判 error（不得降级成 warning）
// ---------------------------------------------------------------------------
describe("声明域参数 / 字面量分支的返回义务判 error（不得降级成 warning）", () => {
/**
 * 把**确定违规**降为 warning ⇒ `nudo check` 门禁**假绿**。
 *
 * 根因（core/algebra/postcondition.ts 的 `isBoundedEvidenceMissing`）：
 * 把「证据面」的判据从「`ret.pred` 存在」换成「证据面（Φ ∧ ret.pred）
 * 含**界原子**（gt/ge/lt/le）」⇒ `typeof` 级证据（`@nudo:contract x num` 的
 * **声明域参数**）被当成「无证据」⇒ 返回义务降级成 `nudo:unproven-return`
 * （**warning**）。
 *
 * 后果（假绿）：
 * `if (x === -1 || x === -2) return x; return 1;` + `return positive`
 * ⇒ 该分支**只会返回 -1 或 -2**（确定违规）⇒ 却只报 1 条 warning、**无
 * error** ⇒ `nudo check` 的 `ok` 判据是 `errors === 0`
 * （packages/nudojs/src/commands/check-report.ts:408-412）⇒ **exit 0** ⇒
 * CI 门禁空转。
 *
 * 修法：判据回到「**值域已知**」——
 * - 返回项是**声明域参数**（term = var）：其值域 = 该绑定的声明域 ⇒ 返回
 * 义务**可判定**：「不蕴含契约」= 「契约不成立」（返回契约是对**所有**输入
 * 成立的后置 ⇒ 值域 ⊄ 契约域 ⇒ 存在违约输入）⇒ 判 `disproved`（**error**）。
 * - `unprovable` 收窄到「**无 term / 派生项**」（`return x + 1` /
 * `return Math.abs(x)`：值域未被跟踪 ⇒ 证不出也反证不了）。
 *
 * 口径依据：docs/design/cli-semantics.md §5.5 —— 「`any` / unknown（推断
 * 失败）返回对有界契约报 `nudo:unproven-return` warning」⇒ warning 只针对
 * any/unknown；声明域参数**不是** any/unknown ⇒ 不得降级成 warning。
 */







/** 返回义务诊断（违约 error + 证不出 warning）的 "severity:code" 列表 */
function retDiags(body: string, cname: string, file = "/t/bug1116.js"): string[] {
  const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return ${cname}
 */
export function f(x) {${body}}
`);
  const r = checkSource_____index_ts(file, src, pTrue_____index_ts, stdOpts);
  return r.issues
    .filter(
      (i) => i.code === "nudo:constraint-violated" || i.code === "nudo:unproven-return",
    )
    .map((i) => `${i.severity}:${i.code}`);
}

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("字面量分支（eq/or 路径事实把值钉在违规字面量上）⇒ error；声明域参数的裸返回（x: num vs positive）⇒ error；补集臂 NaN 面（三元写法，else 臂含 NaN ⊭ nonNeg）⇒ error；负控制：派生项（值域未被跟踪）⇒ 证不出（warning），不得当违约；负控制：无 term 的派生项 ⇒ 证不出（warning）；负控制：有界证据（守卫 x >= 0 vs positive）⇒ 仍是 error；负控制：字面量返回按域隶属判违", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 该分支**只会返回 -1 或 -2** ⇒ 对 `positive` 是**确定违规**。
    expect(retDiags("  if (x === -1 || x === -2) return x;\n  return 1;", "positive")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // `x` 的声明域是 `number()`（含 NaN）⇒ 存在违约输入（x=0）⇒ 契约不成立。
    expect(retDiags("  return x;", "positive")).toEqual(["error:nudo:constraint-violated"]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // `x < 0 ? 0 : x`：x=NaN ⇒ else 臂 ⇒ 返回 NaN ⇒ 违反 nonNeg。
    expect(retDiags("  return x < 0 ? 0 : x;", "nonNeg")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(retDiags("  return x + 1;", "positive")).toEqual([
      "warning:nudo:unproven-return",
    ]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(retDiags("  return Math.abs(x);", "positive")).toEqual([
      "warning:nudo:unproven-return",
    ]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(retDiags("  if (x >= 0) return x;\n  return 1;", "positive")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(retDiags("  if (x > 0) { return x; }\n  return 0;", "positive")).toEqual([
      "error:nudo:constraint-violated",
    ]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(retDiags("  if (x >= 0) return x;\n  return 0;", "nonNeg")).toHaveLength(0);
  }
});







}
});

// ---------------------------------------------------------------------------
// `export default C` 的类入口不再漏
// ---------------------------------------------------------------------------
describe("`export default C` 的类入口不再漏", () => {
/**
 * 回归 —— `export default C`（**标识符**形态）的类**入口**被漏
 * ⇒ 构造器必抛在 L2 `nudo:entry-may-throw` 闸门**看不见** ⇒ **假绿**。
 *
 * 根因（scan-top-functions.ts，`listClassEntryNames`）：
 * `d.type === "Identifier"` 分支读 `d.id?.name` —— Babel 的 `Identifier`
 * 节点字段是 **`name`**（`id` 是 `Identifier` **上的** `id` 字段，不存在）
 * ⇒ `localName` 恒为 undefined ⇒ `export default C` 的类**不在入口表**。
 *
 * 对照：`export class C` / `export default class C` / `export { C }` 三种形态
 * 走**别的分支** ⇒ 一直是对的 ⇒ 只有「本地类 + `export default <标识符>`」
 * 这一形态漏掉（形态覆盖不全 ⇒ 闸门假绿）。
 *
 * 修法：读 `d.name`（并把 `name?: string` 补进节点类型）。
 */








/** 缓存重置（仓库惯例） */
beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 本地类 + `export default <标识符>`；构造器**无条件抛** */
const DEFAULT_CTOR_THROW = `class C {
  constructor(x) { throw new Error("boom"); }
  describe() { return "a"; }
}
export default C;
`;

/** 同形但构造器**不抛** ⇒ 不得凭空造出 L2（不假红） */
const DEFAULT_CTOR_OK = `class D {
  constructor(x) { this.v = x; }
  describe() { return this.v; }
}
export default D;
`;


  it("类入口清单含 `export default C`（修前：空清单）；导出形态覆盖齐全（回归护栏：其余三种形态不变）；端到端：构造器必抛必须报在类入口上（修前：零诊断 ⇒ 假绿）；端到端：构造器不抛 ⇒ 零 L2（不凭空造诊断）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(listClassEntryNames(DEFAULT_CTOR_THROW)).toEqual(["C"]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(listClassEntryNames("export class E { m() { return 1; } }")).toEqual(["E"]);
    expect(listClassEntryNames("export default class F { m() { return 1; } }")).toEqual(["F"]);
    expect(listClassEntryNames("class G { m() { return 1; } }\nexport { G };")).toEqual(["G"]);
    // 非导出类**不是**入口（`new C()` 不是该模块的公开面）
    expect(listClassEntryNames("class H { m() { return 1; } }")).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = checkSource("/t/bug-1119-ctor.js", DEFAULT_CTOR_THROW, pTrue, {});
    const l2 = r.issues.filter((i) => i.code === "nudo:entry-may-throw" && i.fn === "C");
    expect(l2).toHaveLength(1);
    expect(l2[0]!.severity).toBe("error");
    expect(l2[0]!.message).toContain("may throw Error");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = checkSource("/t/bug-1119-ok.js", DEFAULT_CTOR_OK, pTrue, {});
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
  }
});




});

// ---------------------------------------------------------------------------
// lit(NaN) 契约不得判自相矛盾（假红）
// ---------------------------------------------------------------------------
describe("lit(NaN) 契约不得判自相矛盾（假红）", () => {
/**
 * `lit(NaN)` 契约被判**自相矛盾**（nudo:contract-conflict）⇒
 * 门禁**假红**（对 main 的回归：fix-13 引入单份契约自检后暴露）。
 *
 * 根因（packages/core/src/algebra/contract.ts）：
 * `selfBoundConflict(c)` → `crossBoundConflict(c, c)` → eq 字面量冲突判定用
 * `x.value !== y.value` 比较字面量值。`NaN !== NaN` 恒真 ⇒ **同一个**
 * `lit(NaN)` 约束自比被判成「两个不同字面量」⇒ 单份契约自相矛盾。
 *
 * 口径：字面量同一性用 **SameValue 的 NaN 口径**（`===` + NaN 特例）——
 * 与仓库既有 `termEquals`（term.ts）/ `literalSame`（domain-membership.ts）
 * 同款：NaN 与自身同项，-0 与 0 仍同项（与 `===` 一致）。
 *
 * 本文件钉住：
 * - `lit(NaN)` 参数位 / 返回位 ⇒ **不得**报 nudo:contract-conflict；
 * - 真矛盾（`and(lit(1), lit(2))`）⇒ 仍必须报（不得把闸门修成假绿）。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** ambient 侧车绑定路径：侧车在 /t/<base>.nudo.js，源码在 /t/<base>.js */
function checkWithSidecar(sidecar: string, src: string, base = "nan") {
  const file = `/t/${base}.js`;
  const { loadModule } = makeFiles({ [`/t/${base}.nudo.js`]: sidecar });
  return checkSource_____index_ts(file, src, pTrue_____index_ts, { loadModule, fromFile: file });
}


  it("侧车参数位 + 返回位 lit(NaN) ⇒ 不报 nudo:contract-conflict；源码指令位 lit(NaN) ⇒ 不报 nudo:contract-conflict；真矛盾（and(lit(1), lit(2))）⇒ 仍报 nudo:contract-conflict（闸门不得变假绿）；不同字面量（lit(1) ∧ lit(2)）跨约束 ⇒ 仍报 conflict（不得放宽真矛盾）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = checkWithSidecar(
      `import { fn, lit } from "@nudojs/core";\nexport const f = fn({ x: lit(NaN) }, lit(NaN));`,
      `export function f(x) { return x; }`,
    );
    expect(r.issues.filter((i) => i.code === "nudo:contract-conflict")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { lit } from "@nudojs/core";\nexport const nanLit = lit(NaN);`,
    });
    const src = `/// @nudo:import { nanLit } from "./std.nudo.js"
/**
 * @nudo:contract x nanLit
 */
export function f(x) { return x; }`;
    const r = checkSource_____index_ts("/t/src.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/src.js" });
    expect(r.issues.filter((i) => i.code === "nudo:contract-conflict")).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = checkWithSidecar(
      `import { fn, lit, and } from "@nudojs/core";\nexport const f = fn({ x: and(lit(1), lit(2)) }, lit(0));`,
      `export function f(x) { return x; }`,
    );
    const conflicts = r.issues.filter((i) => i.code === "nudo:contract-conflict");
    expect(conflicts.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/std.nudo.js": `import { lit } from "@nudojs/core";\nexport const one = lit(1);\nexport const two = lit(2);`,
    });
    const src = `/// @nudo:import { one, two } from "./std.nudo.js"
/**
 * @nudo:contract x one
 * @nudo:contract x two
 */
export function f(x) { return x; }`;
    const r = checkSource_____index_ts("/t/src2.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/src2.js" });
    expect(r.issues.filter((i) => i.code === "nudo:contract-conflict").length).toBeGreaterThan(0);
  }
});




});

// ---------------------------------------------------------------------------
// 不可读的 ambient 侧车不得被报成 error（假红）
// ---------------------------------------------------------------------------
describe("不可读的 ambient 侧车不得被报成 error（假红）", () => {
/**
 * `autoBind:false` 下**不可读的 ambient 侧车**仍被报成 error
 * ⇒ 门禁**假红**（没有任何依赖 / 启用的契约需要这次读取）。
 *
 * 根因：
 * - `packages/core/src/algebra/load-deps-fp.ts`：指纹计算**无条件**探测入口的
 * ambient 侧车（`absorbSidecarClosure(fromFile)`），且该探测走 check.ts 的
 * **记录型** loader ⇒ 读失败被记进 `loadReadFailures` ⇒ 收口成 error 诊断
 * （`nudo:module-unreadable`）。
 * - `packages/core/src/algebra/check.ts`：把探测的 EACCES 升级成分析错误。
 *
 * 修法：
 * (a) 仅为**指纹**做的推测性读取**不升级成分析错误**（读失败只标 readError
 * ⇒ 指纹键不可信、禁 memo；不产生 error 诊断）；
 * (b) 遵循 ambient 绑定资格：`autoBind:false` 时 ambient 侧车根本不会被绑定
 * ⇒ 连探测都不必做（不读盘）。
 *
 * 本文件钉住：
 * - autoBind:false + 不可读 ambient 侧车 ⇒ 零 error 诊断、门禁绿；
 * - autoBind:false ⇒ 不探测 ambient 侧车（loader 未被调用）；
 * - 真·依赖不可读 ⇒ 仍报 nudo:module-unreadable（不得放宽真故障）；
 * - autoBind 开启且 ambient 侧车**确实需要** ⇒ 仍报 nudo:contract-load
 * （真故障不被吞）。
 */






beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 恒抛 EACCES 的 loader（记录探测到的 spec） */
function denyingLoader(probes: string[] = []) {
  return (spec: string, _from: string): string | undefined => {
    probes.push(spec);
    throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  };
}


  it("autoBind:false + 不可读 ambient 侧车 ⇒ 零 error 诊断、门禁绿；autoBind:false ⇒ 不探测 ambient 侧车（ambient 绑定无资格 ⇒ 不读盘）；真·依赖不可读 ⇒ 仍报 nudo:module-unreadable（不得放宽真故障）；autoBind 开启且 ambient 侧车确实被绑定 ⇒ 仍报 nudo:contract-load（真故障不被吞）；autoBind 开启但 ambient 侧车**没被用到** ", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = checkSource_____index_ts("/t/a.js", "export function f(){return 1}", pTrue_____index_ts, {
      fromFile: "/t/a.js",
      autoBind: false,
      loadModule: denyingLoader(),
    });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const probes: string[] = [];
    checkSource_____index_ts("/t/b.js", "export function f(){return 1}", pTrue_____index_ts, {
      fromFile: "/t/b.js",
      autoBind: false,
      loadModule: denyingLoader(probes),
    });
    expect(probes.filter((p) => p.includes(".nudo."))).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = `import { d } from './dep.js';\nexport function run() { return d(); }\n`;
    const r = checkSource_____index_ts("/t/main.js", src, pTrue_____index_ts, {
      fromFile: "/t/main.js",
      loadModule: (spec, from) => {
        throw Object.assign(new Error(`EACCES: permission denied, open '${from}/${spec}'`), {
          code: "EACCES",
          path: "/t/dep.js",
        });
      },
    });
    const unreadable = r.issues.filter((i) => i.code === "nudo:module-unreadable");
    expect(unreadable.length).toBe(1);
    expect(unreadable[0]!.severity).toBe("error");
    expect(r.ok).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const src = `export function alpha(x) { return x; }\n`;
    const r = checkSource_____index_ts("/t/alpha.js", src, pTrue_____index_ts, {
      fromFile: "/t/alpha.js",
      loadModule: denyingLoader(),
    });
    const loadErrs = r.issues.filter((i) => i.code === "nudo:contract-load");
    expect(loadErrs.length).toBeGreaterThan(0);
    expect(loadErrs[0]!.severity).toBe("error");
    expect(r.ok).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    // 源码没有任何导出 ⇒ 没有同名绑定需要那份侧车 ⇒ 侧车**没被读**过
    const src = `function helper(x) { return x; }\n`;
    const r = checkSource_____index_ts("/t/helper.js", src, pTrue_____index_ts, {
      fromFile: "/t/helper.js",
      loadModule: denyingLoader(),
    });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
    expect(r.ok).toBe(true);
  }
});





});

// ---------------------------------------------------------------------------
// async 体的多 await（≥2 个挂起点）
// ---------------------------------------------------------------------------
describe("async 体的多 await（≥2 个挂起点）", () => {
/**
 * 回归钉：async 体的**多 await**（≥2 个挂起点）——callee 未 settle
 * 前 caller 提前恢复，读到占位符 `unknown`。
 *
 * 原生（node v26.10.0 实测）：`await g()` 的恢复点排在 **g 的 promise settle
 * 之后**——callee 有几个 await 都不影响：caller 永远读到 callee 的终值；
 * callee 拒绝时，caller 的恢复点同样在 settle 之后（拒绝臂不丢）。
 *
 * 引擎（的生成器路径）：`await <promise>` 把恢复点**无条件**排进
 * 宿主微任务队列；callee 的续体也排进同一队列 ⇒ 队列 = [callee-resume,
 * caller-resume]。callee 有 **1 个** await 时，callee-resume 跑完即 settle
 * （caller-resume 在其后）⇒ 碰巧正确；callee 有 **≥2 个** await 时，
 * callee 的**第二次**续体排在 caller-resume **之后** ⇒ caller 恢复时 callee
 * 的 live promise 仍是占位符 `inner = unknown` ⇒ caller 读到 `unknown`
 * （拒绝臂同样被跳过 ⇒ 假绿：callee 明明拒绝，caller 却当 fulfilled 继续跑）。
 *
 * 修法（`exec/runtime/async.ts`）：live `$asyncGen` promise 标 **pending**
 * （WeakMap 侧表：pending 态 + waiter 列表）——operand 为 pending 时，恢复点
 * **排到 settle 之后**再跑；体 `return <未 settle 的 promise>` 时，本 promise
 * 同样保持 pending（原生：async 体 return promise ⇒ 递归采纳其兑现值 ⇒ 本
 * promise 的 settle 时刻 = 被采纳 promise 的 settle 时刻）。
 *
 * 口径边界（**已登记，未修**——需改 `builtins/promise.ts`，不在本条归属内）：
 * `await Promise.all([a(), b()])`——组合子对元素 promise 取的是**调用期快照**
 * （`elementSettle` 读 `shape.inner`）⇒ 元素尚未 settle 时取到占位符 ⇒ 组合子
 * 提前兑现（原生：Promise.all 等所有元素 settle 才兑现）。
 */









/** 调用导出的 f，返回同步段观测到的字面量值 */
function syncVal(src: string): unknown {
  const r = call(src, "f");
  const lv = litValue_____abs_ts(r.result);
  return lv.ok ? lv.value : lv;
}

/** 调用导出的 f，返回其 promise 兑现值的字面量（await 之后的结果） */
function awaitedVal(src: string, fnName = "f"): unknown {
  const r = call(src, fnName);
  const lv = litValue_____abs_ts($await(r.result as never));
  return lv.ok ? lv.value : lv;
}

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("callee 2 个 await：caller 恢复后读到 callee 的终值（原生 \"1,2,3\"）；callee 3 个 await：caller 恢复后读到 callee 的终值（原生 \"1,2,3,4\"）；callee 2 个 await 后写 flag：caller 读到 flag=1（原生 1）；return await <2-await callee>：值域是 callee 终值（原生 7）；嵌套 return await <2-await callee>：值", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); await null; log.push(3); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2,3");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); await null; log.push(3); await null; log.push(4); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2,3,4");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`let flag = 0;
        async function h() { await null; await null; flag = 1; }
        export async function f() { await h(); return flag; }`),
    ).toBe(1);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function h() { await null; await null; return 7; }
        export async function f() { return await h(); }`),
    ).toBe(7);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function g() { await null; await null; return 3; }
        async function h() { return await g(); }
        export async function f() { return await h(); }`),
    ).toBe(3);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function g() { await null; await null; return 7; }
        export async function f() { await null; return g(); }`),
    ).toBe(7);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function g() { await null; await null; throw new Error("boom"); }
        export async function f() { try { await g(); return "no"; } catch (e) { return "caught"; } }`),
    ).toBe("caught");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 原生：await 一个拒绝的 promise ⇒ 调用方的 promise 拒绝（fulfilled 臂不可能）
    const r = call(
      `async function g() { await null; await null; throw new Error("boom"); }
       export async function f() { await g(); return "no"; }`,
      "f",
    );
    const sh = (r.result as { shape: { inner: { shape: { k: string } }; rejected?: unknown } }).shape;
    expect(sh.inner.shape.k).toBe("never");
    expect(sh.rejected).toBeDefined();
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`const log = [];
        async function g() { log.push(1); log.push(2); }
        export async function f() { await g(); return log.join(","); }`),
    ).toBe("1,2");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      awaitedVal(`async function g() { await null; return 3; }
        export async function f() { const a = await g(); const b = await g(); return a + b; }`),
    ).toBe(6);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(
      syncVal(`const log = [];
        async function g() { log.push(1); await null; log.push(2); await null; log.push(3); }
        export function f() { g(); return log.join(","); }`),
    ).toBe("1");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    // 原报告 F15 的 fixture：修前求值面给 "cold"（caller 抢跑读到占位符）
    expect(
      awaitedVal(
        `let cache = "cold";
        async function warm(){ await null; await null; cache = "warm" }
        export async function readCache(){ await warm(); return cache }`,
        "readCache",
      ),
    ).toBe("warm");
  }
});












}

describe("check 面（签名）不受多 await 影响", () => {
  beforeEach(() => {
    takeRefineDiags();
    takeContractDiags();
  });

  it("readCache：await 2-await callee 后的 cache 仍是 \"warm\"；callee 2 个 await 后拒绝：caller 的 promise 面是 never（与 1-await 同口径）", () => {
  {
    takeRefineDiags();
    takeContractDiags();


    const src = `let cache = "cold";
      async function warm(){ await null; await null; cache = "warm" }
      export async function readCache(){ await warm(); return cache }`;
    const r = checkSource_____index_ts("/t/src.js", src, pTrue_____index_ts, {});
    expect(sigOf(r, "readCache")).toBe('promise<"warm">');
  }
  {
    takeRefineDiags();
    takeContractDiags();


    const src = `async function g(){ await null; await null; throw new Error("boom"); }
      export async function f(){ await g(); return 1 }`;
    const r = checkSource_____index_ts("/t/src.js", src, pTrue_____index_ts, {});
    expect(sigOf(r, "f")).toBe("promise<never>");
  }
});

});
});

// ---------------------------------------------------------------------------
// fn arity 按「最后一个必选参数的位置」比较
// ---------------------------------------------------------------------------
describe("fn arity 按「最后一个必选参数的位置」比较", () => {
/**
 * （并发 review F23 / P2）—— `leq` 的函数 arity 只比较**必选参数个数**，
 * 漏掉「**可选参数之后的必选参数**」。
 *
 * 现象：`(a = 1, b) => b.toFixed()`（`optionalParams = [true, false]` ⇒ 必选
 * 参数个数 = 1）被接受为**单参**目标（`fnAbs(["x"])`）；而原生
 * `g = (x) => f(x); g(1)` **抛 TypeError**（`b` 是 `undefined` ⇒
 * `b.toFixed()` 炸）⇒ `leq` 的判定比原生**松** ⇒ 假绿。
 *
 * 根因：`packages/core/src/algebra/leq.ts` 的 `fnRequiredArity` 数的是
 * 「**有几个**必选参数」，而 arity 义务要的是「**最后一个必选参数在第几位**」
 * —— 前者把 `(a = 1, b)` 记成 1（后者是 2）。
 *
 * 修法：按**最后一个必选参数的位置**比较（= 最小实参元数，TS 语义：
 * 可选参数之后的参数仍必选）。`optionalParams` 缺省时回退名字后缀判据
 * （`...rest` / `x?`），`requiredFnArity` 的**公开行为一字不改**。
 */









/** fn shape（可选带 `optionalParams` 标记——写侧口径，同 钉） */
function fnAbs(params: string[], optionalParams?: boolean[]): Abs {
  const shape = {
    k: "fn" as const,
    params,
    ...(optionalParams ? { optionalParams } : {}),
  };
  return abs_____abs_ts(shape as Shape, undefined, undefined, "exact");
}

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("原生 oracle：可选参数之后的必选参数 ⇒ 少传就炸；(a = 1, b) ⊭ 单参目标（最小实参元数 = 2）；(a = 1, b) ⩽ 双参目标（目标给够两个 ⇒ 可赋值）；既有口径不变：(a, b = 1) ⩽ 单参目标（必选只有 a）；可选参数之后的必选参数算进最小元数：(a, b = 1, c) ⇒ 最小 3；rest 吸收多余实参：(a, ...rest) ⇒ 最小 1；缺省标记时回退名字后缀判据：可选位在**前**也算必选位之后 ⇒ 最小 2；端到端：把 (", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const f = (a = 1, b: number): string => b.toFixed();
    // TS 侧也拒绝少传（`b` 是必选位）⇒ 用 @ts-expect-error 记下这条**类型级**事实；
    // 运行时（JS 语义）同样炸：`b` 为 undefined ⇒ `b.toFixed()` TypeError。
    // @ts-expect-error TS2554: 必选位 `b` 不可省
    const g = (x: number): string => f(x);
    expect(() => g(1)).toThrow(TypeError);
    // 传够两个就不炸
    expect(f(1, 2)).toBe("2");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = fnAbs(["a", "b"], [true, false]);
    const r = leqAbs(src, fnAbs(["x"]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 2");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = fnAbs(["a", "b"], [true, false]);
    expect(leqAbs(src, fnAbs(["x", "y"])).ok).toBe(true);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = fnAbs(["a", "b"], [false, true]);
    expect(leqAbs(src, fnAbs(["x"])).ok).toBe(true);
    expect(leqAbs(src, fnAbs([])).ok).toBe(false);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = fnAbs(["a", "b", "c"], [false, true, false]);
    expect(leqAbs(src, fnAbs(["x", "y"])).ok).toBe(false);
    expect(leqAbs(src, fnAbs(["x", "y", "z"])).ok).toBe(true);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = fnAbs(["a", "...rest"], [false, true]);
    expect(leqAbs(src, fnAbs(["x"])).ok).toBe(true);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    expect(leqAbs(fnAbs(["a?", "b"]), fnAbs(["x"])).ok).toBe(false);
    expect(leqAbs(fnAbs(["a?", "b"]), fnAbs(["x", "y"])).ok).toBe(true);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = checkSource(
      "/t/bug1129.js",
      `export function outer() {
  let f = (x) => x;
  f = (a = 1, b) => b;
  return f;
}
`,
      pTrue,
      { fromFile: "/t/bug1129.js" },
    );
    expect(r.issues.map((i) => i.code)).toContain("nudo:assign-mismatch");
  }
});







}
});

// ---------------------------------------------------------------------------
// 契约面的大字面量比较：bigint 必须参与比较
// ---------------------------------------------------------------------------
describe("契约面的大字面量比较：bigint 必须参与比较", () => {
/**
 * 调用边界契约面（`contract-face.ts`）的 **bigint 过滤**必须
 * 发生在**比较之后**，不能发生在比较之前。
 *
 * 旧行为：`litMeetsReturnConstraint` / `violatesDeclaredReturn` 在调用
 * `literalMeetsConstraint` **之前**就把 `typeof v === "bigint"` 的值排除掉
 * ⇒ bigint 值**从不参与**域判定：
 * - `lit(1n)` 契约 + 推断面 `2n` ⇒ 「不满足声明约束」判不出来
 * ⇒ `violatesDeclaredReturn` 说「没违反」⇒ **声明面替换**真实推断面
 * ⇒ `2n` 被当成满足 `lit(1n)` ⇒ **假绿**（违约被放过）。
 * - `lit(1n)` 契约 + 推断面 `1n` ⇒ 同样判不出「满足」⇒ 也走面替换
 * （本例恰好无害，但口径与 number / string / boolean 三域不一致）。
 *
 * 新行为：bigint 与其余标量同口径 —— 参与 `literalMeetsConstraint` 比较
 * （口径同 `domain-membership.ts` 的 `literalSame`：`===` + NaN 特例 ⇒
 * `1n !== 1`，bigint 与 number 不混同）：
 * - `lit(1n)` + `2n` ⇒ **确定违反** ⇒ 不许用声明面替换 ⇒ 调用方也红；
 * - `lit(1n)` + `1n` ⇒ 满足 ⇒ 保留推断精度（调用方零诊断）。
 *
 * 覆盖面：同文件路径（`$callNamed` 消费按名解析的契约面）。
 */







const SIDECAR = `import { lit } from "@nudojs/core";
export const litN = lit(1n);
`;

/**
 * 同文件：callee `inner` 声明 `lit(1n)` 返回契约、实际返回 ret；
 * caller `outer` 同样声明 `lit(1n)` 返回契约（返回位面由 inner 的
 * 声明面决定 ⇒ 声明面替换会把违约洗白）。
 */
function src(ret: string): string {
  return `/// @nudo:import { litN } from "./t.nudo.js"
/**
 * @nudo:contract return litN
 */
export function inner() {
  return ${ret};
}
/**
 * @nudo:contract return litN
 */
export function outer() {
  return inner();
}
`;
}

function run(ret: string) {
  const { loadModule } = makeFiles({ "/t/t.nudo.js": SIDECAR });
  return checkSource_____index_ts("/t/lib.js", src(ret), pTrue_____index_ts, {
    loadModule,
    fromFile: "/t/lib.js",
  });
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("域隶属口径：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 与 number 不混同）；callee 违约（返回 2n）⇒ 调用方不得被声明面「证得」（假绿回归）；callee 违约（返回 2n）⇒ 调用方的返回面是真实值 2n，不是声明面；callee 守约（返回 1n）⇒ 调用方零诊断（不得新增诊断）；callee 守约（返回 1n）⇒ 调用方的返回面保留推断精度 1n", () => {
  {
    resetCheckSourceMemo();


    expect(literalMeetsConstraint_____domain_membership_ts(1n, litC(1n))).toBe(true);
    expect(literalMeetsConstraint_____domain_membership_ts(2n, litC(1n))).toBe(false);
    expect(literalMeetsConstraint_____domain_membership_ts(1, litC(1n))).toBe(false);
  }
  {
    resetCheckSourceMemo();


    const r = run("2n");
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.map((i) => i.fn)).toContain("outer");
    expect(r.ok).toBe(false);
  }
  {
    resetCheckSourceMemo();


    const r = run("2n");
    expect(sigOf(r, "outer")).toMatch(/^2n\b/);
  }
  {
    resetCheckSourceMemo();


    const r = run("1n");
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
    resetCheckSourceMemo();


    const r = run("1n");
    expect(sigOf(r, "outer")).toMatch(/^1n\b/);
  }
});




}
});

// ---------------------------------------------------------------------------
// 种子（assume）求值不得命中 L0
// ---------------------------------------------------------------------------
describe("种子（assume）求值不得命中 L0", () => {
/**
 * generalize 的 L0（进程内 PolyFn memo）键**不含种子动态域**
 * （`@nudo:assume` 引理 / `@nudo:invariant` 循环界）⇒ 有种子求值命中无种子
 * 缓存（或反之）造成双向错误：
 *
 * - **正向漏报**：check 对带引理的函数求值时以 `withAssumePremises` 种子；
 * 若 L0 命中（第二次 check / 只改了无关兄弟函数 / 先跑过一次无种子
 * generalize）⇒ body 不再重新求值 ⇒ 引理消费账本（`assume-ledger.ts`）
 * 没被填 ⇒ `nudo:assume-relied` 丢失（用户以为引理被用上，审计面蒸发）。
 * - **反向泄漏**：种子求值把「折了界的 PolyFn」写进 L0 ⇒ 之后无种子
 * `generalizeFromAst`（LSP/CLI 签名面）读到它 ⇒ 签名里出现只有引理才能
 * 证出的界（`proved via @nudo:assume` 的精度泄漏到无公理上下文）。
 *
 * 修法：种子的非平凡窗口内**绕过 L0**（既不读也不写；键仍只装静态身份）。
 * 本套件钉住：(a) 冷跑 relied=1；(b) 清 check memo 后仍 1；(c) 只改兄弟
 * 函数后仍 1；(d) 无种子 generalize 先行后 check 仍 1 且不误报 unproven；
 * (e) check 之后无种子 generalize 与冷跑逐字一致（无泄漏）；(f) 负控制：
 * 无引理 ⇒ 无 relied、返回义务诚实未证；(g) `@nudo:invariant` 同型
 * （种子后无种子不得泄漏、无种子先行的 check 不得丢 relied）。
 *
 * ⚠ 形参契约（nonNeg / atLeast1）与返回契约（unit）缺一不可：没有形参
 * 契约时连冷跑都是 unproven-return；没有返回契约则引理不参与证明。
 * 函数必须**非导出**：导出入口在 L2 面重新求值会顺手回填账本，掩盖 L0 缺陷。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDE = `import { number } from "@nudojs/core";
export const unit = number().ge(0).le(1);
export const nonNeg = number().ge(0);
export const atLeast1 = number().ge(1);
`;

/** 引理折叠 `1 - d/max` 的相关性下界（div 消费点），证得 unit 契约 */
const srcWithLemma = (K: number) => `/// @nudo:import { unit, nonNeg, atLeast1 } from "./std.nudo.js"
/**
 * @nudo:assume d <= max
 * @nudo:contract d nonNeg
 * @nudo:contract max atLeast1
 * @nudo:contract return unit
 */
function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
export function other(x) { return x + ${K}; }
`;

/** 同源去掉引理行（负控制：善意的 unproven-return 必须留下） */
const srcNoLemma = (K: number) => srcWithLemma(K).replace(" * @nudo:assume d <= max\n", "");

/** 无种子 generalize（LSP/签名面）——与 check 同一 loader 身份才能命中同一 L0 */
const unseeded = (fn: string, src: string, o: ReturnType<typeof sidecarOpts>) =>
  generalizeFromAst(fn, src, { file: parseSource_____index_ts(src), refine: o });

const reliedCount = (r: { issues: { code: string }[] }) =>
  r.issues.filter((i) => i.code === "nudo:assume-relied").length;
const issueSet = (r: { issues: { code: string; fn?: string }[] }) =>
  r.issues.map((i) => `${i.code}:${i.fn ?? ""}`).sort();


  it("(a) 冷跑：引理被消费 ⇒ nudo:assume-relied = 1，返回契约证得；(b) 清 check memo（L0 仍在）后重跑 ⇒ relied 仍为 1（不得跳过账本回填）；(c) 只改无关兄弟函数（per-fn 指纹不变 ⇒ 仅 L0 可能命中）⇒ relied 仍为 1；(d) 无种子 generalize 先行（L0 里是无引理 PolyFn）⇒ 随后 check 仍 relied=1，且不误报 unproven；(e) check 之后无种子 gen", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-a.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const r = checkSource_____index_ts(f, srcWithLemma(1), pTrue_____index_ts, { ...o, entryThrows: "off" as const });
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied")!;
    expect(relied.fn).toBe("sim");
    expect(relied.message).toContain("proved via @nudo:assume d <= max");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-b.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o, entryThrows: "off" as const };
    expect(reliedCount(checkSource_____index_ts(f, srcWithLemma(1), pTrue_____index_ts, c))).toBe(1);
    const r = checkSource_____index_ts(f, srcWithLemma(1), pTrue_____index_ts, c);
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-c.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o, entryThrows: "off" as const };
    expect(reliedCount(checkSource_____index_ts(f, srcWithLemma(1), pTrue_____index_ts, c))).toBe(1);
    const r = checkSource_____index_ts(f, srcWithLemma(2), pTrue_____index_ts, c);
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-d.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const src = srcWithLemma(1);
    const pre = unseeded("sim", src, o);
    expect(pre).toBeDefined();
    const r = checkSource_____index_ts(f, src, pTrue_____index_ts, { ...o, entryThrows: "off" as const });
    expect(reliedCount(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-e.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const src = srcWithLemma(1);
    const coldFmt = formatAbs(unseeded("sim", src, o)!.symbolic);
    // 冷跑（无种子）不含引理折出的界
    expect(coldFmt).not.toContain("≥ 0");
    const o2 = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o2, entryThrows: "off" as const };
    expect(reliedCount(checkSource_____index_ts(f, src, pTrue_____index_ts, c))).toBe(1);
    const afterFmt = formatAbs(unseeded("sim", src, o2)!.symbolic);
    expect(afterFmt).toBe(coldFmt);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-f.js";
    const o = sidecarOpts("std.nudo", SIDE, f);
    const c = { ...o, entryThrows: "off" as const };
    const cold = checkSource_____index_ts(f, srcNoLemma(1), pTrue_____index_ts, c);
    expect(reliedCount(cold)).toBe(0);
    expect(cold.issues.some((i) => i.code === "nudo:unproven-return" && i.fn === "sim")).toBe(true);
    const again = checkSource_____index_ts(f, srcNoLemma(1), pTrue_____index_ts, c);
    expect(issueSet(again)).toEqual(issueSet(cold));
  }
});







// ---------------------------------------------------------------------------
// (g) @nudo:invariant 同型：种子 / 无种子双向都不得借道 L0
// ---------------------------------------------------------------------------

const scalarSrc = `
/**
 * @nudo:invariant last >= 1
 */
export function lastLoop(n) {
  let last = 0;
  for (let j = 1; j <= n; j++) last = j;
  return last;
}
`;
const SCALAR_SIDE = `export const lastLoop = fn({ n: number() }, number().ge(1));`;

const invariantRelied = (r: { issues: { code: string }[] }) =>
  r.issues.filter((i) => i.code === "nudo:invariant-relied").length;

describe("种子（invariant）求值不得命中 L0", () => {
  it("(g1) 无种子 generalize 先行 ⇒ 随后 check 仍 invariant-relied=1 且未证不误报；(g2) check 之后无种子 generalize 与冷跑逐字一致（invariant 折后界不得泄漏）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-g1.js";
    const o = sidecarOpts("nudo", SCALAR_SIDE, f);
    expect(unseeded("lastLoop", scalarSrc, o)).toBeDefined();
    const r = checkSource_____index_ts(f, scalarSrc, pTrue_____index_ts, { ...o, entryThrows: "off" as const });
    expect(invariantRelied(r)).toBe(1);
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const f = "/t/bug1152-g2.js";
    const o = sidecarOpts("nudo", SCALAR_SIDE, f);
    const coldFmt = formatAbs(unseeded("lastLoop", scalarSrc, o)!.symbolic);
    expect(coldFmt).not.toContain("inv#");
    const o2 = sidecarOpts("nudo", SCALAR_SIDE, f);
    expect(invariantRelied(checkSource_____index_ts(f, scalarSrc, pTrue_____index_ts, { ...o2, entryThrows: "off" as const }))).toBe(1);
    const afterFmt = formatAbs(unseeded("lastLoop", scalarSrc, o2)!.symbolic);
    expect(afterFmt).toBe(coldFmt);
  }
});

});
});

// ---------------------------------------------------------------------------
// fail-closed 归因按可达性（helper / 类 / CJS 形态）
// ---------------------------------------------------------------------------
describe("fail-closed 归因按可达性（helper / 类 / CJS 形态）", () => {
/**
 * L2 fail-closed **归因按可达性**（不是只按入口自身的源码跨度）。
 *
 * 根因：的 fail-closed 只对「不支持构造落在**入口自己的**跨度内」
 * 的入口发证据 ⇒ 同一段代码内联在入口里是红的，拆到顶层 helper 里就绿：
 * `export function f(g) { return g().x++; }` → L2（）
 * `export function f(g) { return h(g); } function h(g) { return g().x++; }`
 * → 零 error（假绿）
 *
 * 修法：归因 = 入口自身跨度 ∪ 入口**可达**的顶层绑定（`reachableTopBindings`
 * 的传递闭包：辅助函数 / 类；互递归靠 `seen` 收敛）。不可达的陪葬入口仍
 * **不**背账（不做过度断言）。
 */




const CLEAN = `export function f() { return 1; }
export function safe() { return 2; }`;


  it("helper 里的不支持构造 ⇒ 调用它的入口 f 拿 L2；兄弟入口 safe 仍是 0；两级 helper 链 ⇒ 传递闭包把构造归因到入口 f；互递归 helper：闭包收敛（不挂死）且仍把环后的构造归因到入口 f；类入口 C：构造器里的不支持构造 ⇒ 整个类入口 C 拿 L2；类方法入口 C.m：构造器里的不支持构造也归因（实例桥要跑构造器）；类方法入口 C.m：**其它**方法的构造不归因（不是它的执行路径）；CJS exports.f = function …：入", () => {
  {
    const src = `export function f(g) { return h(g); }
export function safe() { return 1; }
function h(g) { return g().x++; }`;
    const r = checkSource_____index_ts("b1153-1.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
    expect(l2Count(r, "safe")).toBe(0);
    // 证据上屏（门禁过滤 ≠ 藏事实）
    expect(sigOf(r, "f")).toContain("throws");
    expect(r.ok).toBe(false);
  }
  {
    const src = `export function f(g) { return h(g); }
function h(g) { return k(g); }
function k(g) { return g().x++; }`;
    const r = checkSource_____index_ts("b1153-2.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  }
  {
    const src = `export function f(g) { return a(g); }
function a(g) { return b(g); }
function b(g) { return a(g) || k(g); }
function k(g) { return g().x++; }`;
    const r = checkSource_____index_ts("b1153-3.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  }
  {
    const src = `export class C { constructor(g) { g().x++; } }`;
    const r = checkSource_____index_ts("b1153-4.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "C")).toBe(1);
    expect(r.ok).toBe(false);
  }
  {
    const src = `export class C { constructor(g) { g().x++; } m() { return 1; } }`;
    const r = checkSource_____index_ts("b1153-5.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "C.m")).toBe(1);
  }
  {
    const src = `export class C { m() { return 1; } n(g) { return g().x++; } }`;
    const r = checkSource_____index_ts("b1153-6.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "C.m")).toBe(0);
    expect(l2Count(r, "C.n")).toBe(1);
  }
  {
    const src = `exports.f = function (g) { return g().x++; };`;
    const r = checkSource_____index_ts("b1153-7.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  }
  {
    const arrow = checkSource_____index_ts(
      "b1153-8.js",
      `module.exports.f = (g) => g().x++;`,
      pTrue_____index_ts,
      stdOpts,
    );
    expect(l2Count(arrow, "f")).toBe(1);
    const obj = checkSource_____index_ts(
      "b1153-9.js",
      `module.exports = { f: function (g) { return g().x++; } };`,
      pTrue_____index_ts,
      stdOpts,
    );
    expect(l2Count(obj, "f")).toBe(1);
  }
  {
    const src = `function h(g) { return g().x++; }
export function f() { return 1; }`;
    const r = checkSource_____index_ts("b1153-10.js", src, pTrue_____index_ts, stdOpts);
    const clean = checkSource_____index_ts("b1153-clean.js", CLEAN, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
    expect(r.ok).toBe(clean.ok);
  }
  {
    const src = `export function f() { return 1; }
class D { constructor(g) { g().x++; } }`;
    const r = checkSource_____index_ts("b1153-11.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
  }
  {
    const src = `export function f() { return h(); }
function h() { return new K(); }
class K { constructor(g) { g().x++; } }`;
    const r = checkSource_____index_ts("b1153-12.js", src, pTrue_____index_ts, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  }
  {
    const r = checkSource_____index_ts("b1153-13.js", CLEAN, pTrue_____index_ts, stdOpts);
    expect(l2Count(r)).toBe(0);
    expect(r.ok).toBe(true);
  }
});












});

// ---------------------------------------------------------------------------
// 非标量字面量实参不再静默通过数值/字符串契约
// ---------------------------------------------------------------------------
describe("非标量字面量实参不再静默通过数值/字符串契约", () => {
/**
 * 调用点的**非标量字面量实参**（函数/箭头/类表达式、`new Date(0)`、
 * 正则、`Symbol('s')`、`NaN` / `Infinity`、模板字面量、`new Map()/Set()`、
 * `void 0`）对 `number()` / `string()` / union 契约**零义务**（假绿）。
 *
 * 复现（函数体内调用，静态扫描路径）：
 * `@nudo:contract x positive` 标在 `function u(x){return x}`
 * `export function use(){ return u(() => 1) }` ⇒ 0 条
 * `export function use(){ return u(new Date(0)) }` ⇒ 0 条
 * `export function use(){ return u(NaN) }` ⇒ 0 条
 * 同一实参在**顶层**调用（执行态实参回退）已报违例 ⇒ 同一个实参两种裁决。
 *
 * 根因两层：
 * 1. `scan/literal-args.ts` 的 `parseCallArgs` 只对「标量 / 对象 / 数组」字面量
 * 抽 Abs，其余形态（函数 / 箭头 / 类 / new / 正则 / 模板 / Symbol / NaN /
 * Infinity / void）落兜底 `absUnknown()` ⇒ `hasInfo=false` ⇒
 * `scan-literal-calls.ts` 把**整条调用点**跳过 ⇒ 契约面零义务。
 * 2. `scan/literal-shapes.ts` 的 `typeof` 通道不拆 `brand` 包装 ⇒ 即使 Abs 到了
 * 分类器（顶层执行态回退），`new Date(0)` / `/re/` / `new Map()`（brand obj）
 * 仍落 `actualPrim === undefined` ⇒ 裸 prim 契约（`positive` / `number()` /
 * `string()`）零义务；而同一条 typeof 判据在 union 面（`literal-preds.ts` 的
 * `typeofNameOf`）**会**拆 brand ⇒ 引擎内两套 typeof 口径。
 *
 * 修法（只在**确定**时报，宁漏勿错）：
 * - 抽取层：函数/箭头/类表达式（恒为 function）、正则（恒为对象）、模板
 * （恒为 string）、`void`（恒为 undefined）、已知全局构造器的 `new`
 * （恒为对象）、`Symbol(...)`（恒为 symbol）、未遮蔽的 `NaN` / `Infinity`
 * （恒为 number 字面量）走字面量快路径；其余仍 unknown（fail-closed）。
 * - 分类器：`typeof` 通道拆 brand；`shape` 通道拆 brand（brand 的内层是对象
 * ⇒ `shape({})` 不再把 `new Date(0)` 误报成「object shape」）。
 *
 * 本文件的行是**表驱动**的，每行只钉「确定违例 / 确定放行」两类原生事实：
 * 函数/对象/symbol/bigint 绝不是 number/string/null；`NaN` 是 number（裸
 * `number()` 放行）但 `NaN > 0` 为 false；`Infinity > 0` 为 true 而
 * `Infinity < 10` 为 false；`-Infinity` 相反。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDE = `import { number, string, lit, union, nullable, shape, array, any } from "@nudojs/core";
export const positive = number().gt(0);
export const num = number();
export const nonEmpty = string();
export const small = number().lt(10);
export const posOrNull = union(number().gt(0), lit(null));
export const numOrStr = union(number(), string());
export const maybePositive = nullable(number().gt(0));
export const emptyShape = shape({});
export const idShape = shape({ id: number().gt(0) });
export const arrayEmpty = array(shape({}));
export const anything = any();
`;

const IMPORTED =
  "positive, num, nonEmpty, small, posOrNull, numOrStr, maybePositive, emptyShape, idShape, arrayEmpty, anything";

function check(src: string, file = "/t/nonscalar.js") {
  const imp = `/// @nudo:import { ${IMPORTED} } from "./std.nudo.js"\n`;
  return checkSource_____index_ts(file, imp + src, pTrue_____index_ts, sidecarOpts("std.nudo", SIDE, file));
}

/** 函数体内调用（静态扫描路径 —— 的缺口所在） */
function callInBody(contract: string, literal: string): string {
  return `/** @nudo:contract x ${contract} */
function u(x) { return x; }
export function use() { return u(${literal}); }
`;
}

function violations(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

/**
 * (契约, 实参字面量, 期望的 `nudo:constraint-violated` 条数)。
 * 原生事实写在行尾注释里；负控制（兼容契约 ⇒ 0）与既有已执法形态（`{}` /
 * `[]` / `1n` / 标量）一起放，防止修法把「本来就对」的路径带偏。
 */
const TABLE: Array<[string, string, number, string]> = [
  // ── 函数 / 箭头 / 类表达式：`typeof` 恒为 "function" ⇒ 不是 number/string/null
  ["positive", "(() => 1)", 1, "typeof (() => 1) === 'function'"],
  ["nonEmpty", "(() => 1)", 1, "同上：不是 string"],
  ["numOrStr", "(() => 1)", 1, "function 不是 number 也不是 string"],
  ["positive", "function(){}", 1, "typeof function(){} === 'function'"],
  ["positive", "(class {})", 1, "typeof (class {}) === 'function'"],
  ["nonEmpty", "(class {})", 1, "同上"],
  // ── `new 内建构造器`：对象（brand 包装）⇒ 不是 number/string/null
  ["positive", "new Date(0)", 1, "typeof new Date(0) === 'object'"],
  ["nonEmpty", "new Date(0)", 1, "Date 不是 string"],
  ["posOrNull", "new Date(0)", 1, "对象既不是 number>0 也不是 null"],
  ["numOrStr", "new Date(0)", 1, "Date 不是 number 也不是 string"],
  ["positive", "new Map()", 1, "typeof new Map() === 'object'"],
  ["nonEmpty", "new Set()", 1, "Set 不是 string"],
  // ── 正则字面量：对象（brand RegExp）
  ["positive", "/re/", 1, "typeof /re/ === 'object'"],
  ["num", "/re/", 1, "RegExp 不是 number"],
  // ── Symbol(...)：prim symbol ⇒ 不是 number/string
  ["positive", "Symbol('s')", 1, "typeof Symbol('s') === 'symbol'"],
  ["numOrStr", "Symbol('s')", 1, "symbol 不是 number 也不是 string"],
  // ── NaN：是 number（裸 number() 放行），但所有数值界都失败
  ["positive", "NaN", 1, "NaN > 0 === false"],
  ["small", "NaN", 1, "NaN < 10 === false"],
  ["posOrNull", "NaN", 1, "NaN 既不是 >0 也不是 null"],
  // ── Infinity / -Infinity：number 字面量，界判定与有限数同口径
  ["small", "Infinity", 1, "Infinity < 10 === false"],
  ["nonEmpty", "Infinity", 1, "Infinity 不是 string"],
  ["positive", "-Infinity", 1, "-Infinity > 0 === false"],
  ["nonEmpty", "-Infinity", 1, "-Infinity 不是 string"],
  // ── 模板字面量：恒为 string
  ["positive", "`tpl`", 1, "typeof `tpl` === 'string'"],
  ["num", "`t${1}`", 1, "模板求值 't1'，不是 number"],
  // ── void：恒为 undefined
  ["positive", "void 0", 1, "void 0 === undefined"],
  ["nonEmpty", "void 0", 1, "同上"],
  // ── 既有已执法形态（回归钉：修法不得放松）
  ["positive", "undefined", 1, "undefined ⊭ number"],
  ["posOrNull", "undefined", 1, "undefined 既不是 >0 也不是 null"],
  ["numOrStr", "undefined", 1, "undefined 不是 number/string"],
  ["positive", "1n", 1, "typeof 1n === 'bigint'"],
  ["positive", "{}", 1, "对象不是 number"],
  ["nonEmpty", "[]", 1, "数组不是 string"],
  // ── 负控制：契约的域**接受**该实参 ⇒ 0（防假红）
  ["anything", "(() => 1)", 0, "any() 接受一切"],
  ["anything", "new Date(0)", 0, "any() 接受一切"],
  ["anything", "Symbol('s')", 0, "any() 接受一切"],
  ["emptyShape", "new Date(0)", 0, "空 shape = 任意对象；Date 是对象"],
  ["emptyShape", "new Map()", 0, "同上"],
  ["arrayEmpty", "[new Date(0)]", 0, "array(shape({}))：每个元素都是无必填字段的对象"],
  ["numOrStr", "NaN", 0, "typeof NaN === 'number'"],
  ["num", "NaN", 0, "裸 number() 接受 NaN"],
  ["positive", "Infinity", 0, "Infinity > 0 === true"],
  ["small", "-Infinity", 0, "-Infinity < 10 === true"],
  ["numOrStr", "`tpl`", 0, "模板是 string"],
  ["nonEmpty", "'s'", 0, "非空 string"],
  ["positive", "1", 0, "1 > 0"],
  ["posOrNull", "null", 0, "lit(null) 成员"],
  ["maybePositive", "undefined", 0, "nullable 含 undefined"],
  ["maybePositive", "null", 0, "nullable 含 null"],
];

{
  it.each(TABLE)(
    "%s 收到 %s ⇒ %i 条违例（%s）",
    (contract, literal, want) => {
      const r = check(callInBody(contract, literal));
      expect(violations(r)).toBe(want);
    },
  );
}

describe("报告文案与 brand 拆壳（shape 通道不再误报 object shape）", () => {
  it("new Date(0) 撞 number().gt(0) ⇒ 文案是 typeof 义务；箭头字面量撞 string() ⇒ 文案是 typeof x = \"string\"；new Date(0) 撞 shape({ id }) ⇒ 报 missing field（不是 object shape 假红）；负控制：顶层调用与函数体内调用同口径（同一实参、同一契约同条数）；负控制：没有契约的形参收到非标量字面量 ⇒ 零诊断（噪声来自契约，不是引擎）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(callInBody("positive", "new Date(0)"));
    const v = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toBe('typeof x = "number"');
    expect(r.ok).toBe(false);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(callInBody("nonEmpty", "(() => 1)"));
    const v = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toBe('typeof x = "string"');
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(callInBody("idShape", "new Date(0)"));
    const v = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toBe("missing field x.id");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    for (const [contract, literal, want] of TABLE) {
      const top = check(`/** @nudo:contract x ${contract} */
function u(x) { return x; }
export const r = u(${literal});
`);
      expect(violations(top), `${contract}(${literal}) @top`).toBe(want);
    }
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`function u(x) { return x; }
function v(x) { return x; }
export function use() { return [u(() => 1), v(new Date(0)), u(NaN), v(new Map())]; }
`);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  }
});




});
});

// ---------------------------------------------------------------------------
// 模块装载期必抛 ⇒ nudo:module-throw（fail-closed）
// ---------------------------------------------------------------------------
describe("模块装载期必抛 ⇒ nudo:module-throw（fail-closed）", () => {
/**
 * （附录 A#1）：模块顶层**必然抛** ⇒ 求值回落 `module-throw` ⇒ 导出
 * 全丢。旧口径：**零诊断 + exit 0**（签名退化成 `f() => unknown`，L2 无证据）
 * ⇒ 引擎**完全没能分析**的模块被判绿 = fail-open。
 *
 * 修法：发一条**模块级** error 级 `nudo:module-throw`，定位 = 顶层 `throw`。
 *
 * **判据只认句法证据**（`check-may-throw.ts` 的 `definiteModuleThrowOf`）：
 * 顶层语句序列里**无条件**执行的 `throw`。为什么不用引擎的「抽象上必抛」结论：
 * 真实包实测（node_modules 的 6 个文件：`typescript/lib/_tsserver.js`、
 * `react-dom/cjs/*`、`vitest/dist/chunks/*`）顶层**没有** `throw` 语句却回落
 * `module-throw` —— 那是宿主 API 近似（缺失依赖 → 闭合对象 → 方法不可调用）
 * 的产物，不是程序自己的抛（react-dom 的两个 cjs bundle 原生 `require()` 实测
 * 成功）⇒ 拿引擎结论做门禁 = **假红**。本文件同时钉住两侧：显式顶层 `throw`
 * ⇒ 报；引擎近似抛 / 条件抛 / try 内抛 ⇒ 不报（现状不变）。
 *
 * 抑制口径与 L2 同源：`entryThrows: "off"` 关闸（零 FP 语料库同款）、
 * `"warning"` 降档、`ignoreThrows` 按抛出类型名放行（`Error` 盖整族）。
 */







/** `nudo:module-throw` 诊断全集（模块级：无 `fn`） */
function moduleThrowIssues(r: { issues: { code: string; severity: string; message: string; fn?: string; line?: number; column?: number }[] }) {
  return r.issues.filter((i) => i.code === "nudo:module-throw");
}


  it("顶层无条件 throw ⇒ 1 条 error（改前：零诊断 + ok=true）；裸块 { throw } 无条件下钻 ⇒ 报（loc 指向 throw 而非块首）；多个入口 / 入口前后的 throw ⇒ **一条**模块级诊断（不按入口重复）；CJS 入口形态同样覆盖（exports.f 后顶层 throw）；负控：条件抛（未知宿主守卫）⇒ 不报，行为逐字不变；负控：try/catch 吸收的 throw ⇒ 模块可正常装载，不报；负控：函数体内的 throw 不是装载", () => {
  {
    const src = `throw new TypeError("boom");
export function f(){ return 1; }`;
    const r = checkSource_____index_ts("b1158-1.js", src, pTrue_____index_ts);
    const hits = moduleThrowIssues(r);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
    // 抛出类型名进文案（jump 到 throw 的 loc，无 fn——模块级）
    expect(hits[0]!.message).toContain("TypeError");
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.column).toBe(0);
    expect(hits[0]!.fn).toBeUndefined();
    // 门禁面：error ⇒ 报告不 ok（改前这里 ok=true / exit 0 = 假绿）
    expect(r.ok).toBe(false);
    // 旧口径的退化面仍在（诊断解释它，不是把签名「修好」）
    expect(sigOf(r, "f")).toBe("unknown");
  }
  {
    const r = checkSource_____index_ts(
      "b1158-2.js",
      `{ throw new RangeError("r"); }
export function f(){ return 1; }`,
      pTrue_____index_ts,
    );
    const hits = moduleThrowIssues(r);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("RangeError");
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.column).toBe(2);
    expect(r.ok).toBe(false);
  }
  {
    const before = checkSource_____index_ts(
      "b1158-3a.js",
      `throw new Error("boom");
export function a(){ return 1; }
export function b(x){ return x; }`,
      pTrue_____index_ts,
    );
    expect(moduleThrowIssues(before)).toHaveLength(1);
    expect(l2Count(before)).toBe(0);
    expect(before.ok).toBe(false);

    const after = checkSource_____index_ts(
      "b1158-3b.js",
      `export function a(){ return 1; }
export function b(x){ return x; }
throw new Error("late");`,
      pTrue_____index_ts,
    );
    expect(moduleThrowIssues(after)).toHaveLength(1);
    expect(moduleThrowIssues(after)[0]!.line).toBe(3);
  }
  {
    const r = checkSource_____index_ts(
      "b1158-4.cjs",
      `exports.f = function(){ return 1; };
throw new Error("cjs boom");`,
      pTrue_____index_ts,
    );
    expect(moduleThrowIssues(r)).toHaveLength(1);
    expect(r.ok).toBe(false);
  }
  {
    const src = `if (typeof window === "undefined") throw new Error("no window");
export function f(){ return 1; }`;
    const r = checkSource_____index_ts("b1158-5.js", src, pTrue_____index_ts);
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(sigOf(r, "f")).toBe("1");
  }
  {
    const r = checkSource_____index_ts(
      "b1158-6.js",
      `try { throw new Error("x"); } catch { }
export function f(){ return 1; }`,
      pTrue_____index_ts,
    );
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
    const r = checkSource_____index_ts(
      "b1158-7.js",
      `export function f(){ throw new Error("x"); }`,
      pTrue_____index_ts,
    );
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(l2Count(r, "f")).toBe(1);
  }
  {
    const r = checkSource_____index_ts("b1158-8.js", `export function f(){ return 1; }`, pTrue_____index_ts);
    expect(moduleThrowIssues(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(sigOf(r, "f")).toBe("1");
  }
  {
    // `typescript/lib/_tsserver.js` 的最小机制复现：缺失依赖经 `__toESM`
    // 变成**闭合对象** ⇒ 引擎认为 `dep.setStackTraceLimit` 一定不可调用 ⇒
    // hard throw。原生（依赖存在时）完全正常 ⇒ 不得算程序的账。
    const src = `var __defProp = Object.defineProperty;
var __copyProps = (to, from) => {
  if (from && typeof from === "object") {
    for (let key of Object.getOwnPropertyNames(from))
      if (!Object.prototype.hasOwnProperty.call(to, key))
        __defProp(to, key, { get: () => from[key], enumerable: true });
  }
  return to;
};
var __toESM = (mod) => __copyProps(mod != null ? Object.create(Object.getPrototypeOf(mod)) : {}, mod);
const dep = __toESM(require("./typescript.js"));
dep.setStackTraceLimit();
export function f(){ return 1; }`;
    // 前提：引擎**确实**回落 `module-throw`（否则本负控失去意义）
    expect(tryRunTranspiledDetailed(src, { mode: "analyze" }).fallback?.reason).toBe(
      "module-throw",
    );
    const r = checkSource_____index_ts("b1158-9.js", src, pTrue_____index_ts);
    expect(moduleThrowIssues(r)).toEqual([]);
  }
  {
    const json = `export const v = JSON.parse("{");
export function f(){ return 1; }`;
    expect(tryRunTranspiledDetailed(json, { mode: "analyze" }).fallback?.reason).toBe(
      "module-throw",
    );
    const rj = checkSource_____index_ts("b1158-10a.js", json, pTrue_____index_ts);
    expect(moduleThrowIssues(rj)).toHaveLength(1);
    expect(moduleThrowIssues(rj)[0]!.message).toContain("SyntaxError");

    const nullish = `const o = null;
export const v = o.x;
export function f(){ return 1; }`;
    expect(
      tryRunTranspiledDetailed(nullish, { mode: "analyze" }).fallback?.reason,
    ).toBe("module-throw");
    const rn = checkSource_____index_ts("b1158-10b.js", nullish, pTrue_____index_ts);
    expect(moduleThrowIssues(rn)).toHaveLength(1);
    expect(moduleThrowIssues(rn)[0]!.message).toContain("TypeError");
  }
  {
    // react-dom/client.react-server.js 原文（同一语义的缩形）：无任何入口，
    // 装载即抛 ⇒ 模块不可导入。这是**程序自己的** fail-fast，不是引擎近似。
    const r = checkSource_____index_ts(
      "b1158-11.js",
      `'use strict';

throw new Error(
  'react-dom/client is not supported in React Server Components.'
);`,
      pTrue_____index_ts,
    );
    const hits = moduleThrowIssues(r);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("Error");
    expect(hits[0]!.line).toBe(3);
    expect(r.ok).toBe(false);
  }
  {
    const src = `throw new TypeError("boom");
export function f(){ return 1; }`;

    const off = checkSource_____index_ts("b1158-12a.js", src, pTrue_____index_ts, { entryThrows: "off" });
    expect(moduleThrowIssues(off)).toEqual([]);
    expect(off.ok).toBe(true);

    const warn = checkSource_____index_ts("b1158-12b.js", src, pTrue_____index_ts, { entryThrows: "warning" });
    expect(moduleThrowIssues(warn).map((i) => i.severity)).toEqual(["warning"]);
    expect(warn.ok).toBe(true);

    const ignored = checkSource_____index_ts("b1158-12c.js", src, pTrue_____index_ts, {
      ignoreThrows: ["TypeError"],
    });
    expect(moduleThrowIssues(ignored)).toEqual([]);

    // `Error` 盖整族（TypeError ⊂ Error 族）
    const family = checkSource_____index_ts("b1158-12d.js", src, pTrue_____index_ts, {
      ignoreThrows: ["Error"],
    });
    expect(moduleThrowIssues(family)).toEqual([]);

    // 负控：不相干的 ignore 名不得放行
    const other = checkSource_____index_ts("b1158-12e.js", src, pTrue_____index_ts, {
      ignoreThrows: ["RangeError"],
    });
    expect(moduleThrowIssues(other)).toHaveLength(1);
  }
});









  // 口径变更（本测试原为负控）：`JSON.parse("<非法字面量>")` 与
  // 字面量 null 的成员访问是**源码层面的确定性抛**（不是引擎对宿主 API 的
  // 近似产物），与 react-dom / typescript 那类「引擎近似抛但原生可装载」
  // 不同 ⇒ 必须进 `nudo:module-throw`。引擎近似的负控见上一条。




describe("判据边界：对象字面量的成员集不是 own 键集", () => {
  it("原型链上的成员（toString / hasOwnProperty）不得当「确定缺席」；对照：own 键缺席仍判（`({}).m()`）；`__proto__: null` 的字面量是封闭成员集 ⇒ 缺席仍判；行号归因：真实抛点优先于 `({}).hasOwnProperty`（此前误指第 1 行）", () => {
  {
    expect(definiteModuleThrowOf(parseSource(`const a = ({}).toString();`))).toBeUndefined();
    expect(
      definiteModuleThrowOf(parseSource(`const a = ({}).hasOwnProperty("x");`)),
    ).toBeUndefined();
    expect(definiteModuleThrowOf(parseSource(`const a = ({}).toLocaleString();`))).toBeUndefined();
  }
  {
    expect(definiteModuleThrowOf(parseSource(`const a = ({}).m();`))).not.toBeUndefined();
  }
  {
    expect(
      definiteModuleThrowOf(parseSource(`const a = ({ __proto__: null }).toString();`)),
    ).not.toBeUndefined();
  }
  {
    const r = checkSource_____index_ts(
      "b1158-proto.js",
      `const ok = ({}).hasOwnProperty("a");\nconst n = null;\nn.foo();`,
      pTrue_____index_ts,
    );
    const hits = moduleThrowIssues(r);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(3);
  }
});



});
});

// ---------------------------------------------------------------------------
// may-throw 建议必须与门禁判定同源
// ---------------------------------------------------------------------------
describe("may-throw 建议必须与门禁判定同源", () => {
/**
 * `nudo:entry-may-throw` 的建议只点名剩余效果里的**第一条** kind
 * ⇒ 照建议声明（`@nudo:throws TypeError`）诊断原样保留（建议不可执行），
 * LSP `[silence]` 一键 quickfix 插入的正是这条无效声明（假修复按钮）。
 *
 * 门禁按**并集**判定（`gateDisplay` = `Error`），建议却只给 `TypeError`
 * ⇒ 同一诊断块内两行互相矛盾。
 *
 * 钉：建议里的 `@nudo:throws X` 必须**声明后诊断消失**（多 kind 场景给
 * `Error`——与门禁展示同口径）；单 kind 场景仍给具体 kind。
 */







function check(src: string) {
  return checkSource_____index_ts("/t/risky.js", src, pTrue_____index_ts, {});
}

const BODY = `
export function risky(x) {
  if (x > 0) throw new Error("boom");
  return x;
}
`;

/** 建议行里给出的声明 kind（`@nudo:throws X`） */
function suggestedKind(suggestion: string | undefined): string | undefined {
  return suggestion?.match(/@nudo:throws\s+([A-Za-z][A-Za-z ,]*?)(?:\s{2,}|\s*\|)/)?.[1]?.trim();
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();
  });

  it("剩余效果 kind 不唯一 ⇒ 建议给门禁要求的族（Error），不是第一条 TypeError；照建议声明 ⇒ 诊断消失（建议可执行）；单 kind 场景仍给具体 kind（不无脑折成 Error）", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(BODY);
    const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("may throw Error");
    const kind = suggestedKind(issue!.suggestion);
    expect(kind).toBe("Error");
    // 与 actual: 行同口径（同一个 kind 集合）
    expect(issue!.actual).toContain("throws Error");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(`
/**
 * @nudo:throws Error
 */
export function risky(x) {
  if (x > 0) throw new Error("boom");
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(`
export function risky(x) {
  if (x > 0) throw new TypeError("boom");
  return x;
}
`);
    const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
    expect(issue).toBeDefined();
    expect(suggestedKind(issue!.suggestion)).toBe("TypeError");
  }
});


}
});

// ---------------------------------------------------------------------------
// 对象方法 / 方法型函数表达式补齐 effectFree·closed facet
// ---------------------------------------------------------------------------
describe("对象方法 / 方法型函数表达式补齐 effectFree·closed facet", () => {
/**
 * 同一函数体写成**对象方法简写**与写成**函数字面量**，在「有无副作用 /
 * 是否闭合」上必须给出同一结论。此前 `exec/transpile/expr/object.ts` 的
 * ObjectMethod / 方法型 FunctionExpression 两条 `$fnVal` 构造点**不发**
 * `effectFree` / `closed` facet（`expr/function.ts` 的函数表达式路径发），
 * 于是 sort 比较器闸门、promise then 回调、访问器纯度判定对同一段代码
 * 在两种写法下结论相反。
 *
 * 第二面（读域不可判）：`Object.defineProperty(o, "b", { get })` 装的访问器
 * 占位槽是 `unknown`（无 term）——投影面（`formatShape` / `denoteGuard` /
 * dts）此前仍去**执行** getter 取读域，把分析期的某次读值冻结成「确定值」⇒
 * 签名面自信错值 + guard 写成 `data.b === <literal>` 恒假。现在占位槽无 term
 * 时按 presence 判定，不执行用户 getter（不制造分析期副作用）。
 *
 * 负控制（/ ）：对象字面量访问器的占位槽仍是 `$lit(void 0)`，
 * 读域照旧投影、调用点求值序不变。
 */







/** 取对象槽上的函数 Abs（对象方法简写 / 方法型函数表达式） */
function fnSlotAbs(src: string, key: string): Abs {
  const r = call(src, "f").result;
  if (r.shape.k !== "obj") throw new Error(`期望 obj 形状，实际 ${r.shape.k}`);
  const slot = r.shape.slots[key];
  if (!slot) throw new Error(`槽 ${key} 缺席`);
  return slot.value;
}

/** `Object.defineProperty` 装的有副作用 getter（占位槽为 unknown） */
const DEFINE_PROP_SRC = `
let calls = 0;
export function f() {
  const o = { a: 1 };
  Object.defineProperty(o, "b", { get() { calls++; return calls; }, enumerable: true });
  return o;
}`;


  it("纯方法：两个 facet 都在场（此前完全缺席）；有副作用的方法：effectFree 不为 true（与函数字面量同结论）；读外层可变态的方法：closed 不为 true（与函数字面量同结论）；方法体只读 this：effectFree 仍为 true（读不是副作用）", () => {
  {
    const impl = getFnImpl(fnSlotAbs(`export function f() { return { m(a) { return a; } }; }`, "m"));
    expect(impl).toBeDefined();
    expect(impl?.effectFree).toBe(true);
    expect(impl?.closed).toBe(true);
  }
  {
    const methodImpl = getFnImpl(
      fnSlotAbs(`export function f() { let n = 0; return { m() { n++; } }; }`, "m"),
    );
    const fnImpl = getFnImpl(
      fnSlotAbs(`export function f() { let n = 0; return { m: function () { n++; } }; }`, "m"),
    );
    expect(methodImpl?.effectFree ?? false).toBe(false);
    expect(fnImpl?.effectFree ?? false).toBe(false);
  }
  {
    const src = (body: string) => `export function f(x) { return { ${body} }; }`;
    const methodImpl = getFnImpl(fnSlotAbs(src(`m() { return x; }`), "m"));
    const fnImpl = getFnImpl(fnSlotAbs(src(`m: function () { return x; }`), "m"));
    expect(methodImpl?.closed ?? false).toBe(false);
    expect(fnImpl?.closed ?? false).toBe(false);
  }
  {
    const impl = getFnImpl(fnSlotAbs(`export function f() { return { n: 1, m() { return this.n; } }; }`, "m"));
    expect(impl?.effectFree).toBe(true);
  }
});





describe("读域不可判的访问器不得被投影执行 / 冻结", () => {
  it("签名面打印 unknown（不是冻结的末次读值）；formatAbs（无损面）同口径；guard 只判 presence（不写必等式 ⇒ 不再恒假）；guard 放行自己的真实返回值（每次读都不同）；负控制：字面量访问器的读域照旧投影（Bug 191 口径不变）", () => {
  {
    expect(formatShape(call(DEFINE_PROP_SRC, "f").result)).toBe("{ a: 1, b: unknown }");
  }
  {
    expect(formatAbs_____format_format_ts(call(DEFINE_PROP_SRC, "f").result)).toContain("{ a: 1, b: unknown }");
  }
  {
    const guard = denoteGuard(call(DEFINE_PROP_SRC, "f").result, "data");
    expect(guard).not.toMatch(/data\.b\s*===/);
    expect(guard).toContain('Object.hasOwn(data, "b")');
  }
  {
    const guard = denoteGuard(call(DEFINE_PROP_SRC, "f").result, "data");
    // denotation 是**表达式**（与 export --format guard 的产物同源）
    const check = new Function("data", `return (${guard});`) as (d: unknown) => boolean;

    let calls = 0;
    const real: Record<string, unknown> = { a: 1 };
    Object.defineProperty(real, "b", {
      enumerable: true,
      get() {
        calls += 1;
        return calls;
      },
    });
    expect(check(real)).toBe(true);
    expect(check(real)).toBe(true);
  }
  {
    expect(
      formatShape(call(`export function f() { return { a: 1, get b() { return 2; } }; }`, "f").result),
    ).toBe("{ a: 1, b: 2 }");
    // 以 this 为接收者的读同样可证纯
    expect(
      formatShape(call(`export function f() { return { n: 41, get q() { return this.n; } }; }`, "f").result),
    ).toBe("{ n: 41, q: 41 }");
    // 仅 setter：读值恒 undefined（占位槽）
    expect(formatShape(call(`export function f() { return { set ab(v) {} }; }`, "f").result)).toBe(
      "{ ab: undefined }",
    );
  }
});




});
});

// ---------------------------------------------------------------------------
// strict 目标侧常量抵消不得证成
// ---------------------------------------------------------------------------
describe("strict 目标侧常量抵消不得证成", () => {
/**
 * 线性区间层把 `+` 当实数环运算 + 比较归一**精确抵消常量**
 *
 * 与 同源（目标侧常量抵消），本条补的是**适用面**：
 * - 多常量形态（`x+2` / `x+0.5` / 量级吸收 `x+1e6`）；
 * - **同语义两种写法结论互斥**：`x+y` 与 `y+x` 在 JS 里是同一个值
 * （浮点加法可交换），旧实现因 `linInterval` 按 Map 插入序累加端点，
 * 一个判 false、一个判 true ⇒ 门禁结论不可复现；
 * - 产物面：`nudo check` 渲染 `=> true`、`nudo export --format dts` 产出
 * `: true`（消费端误拒合法输入）。
 *
 * 修法：`linOf` 记录舍入次数/加性常量量级，`linInterval` 端点按
 * `rounds × ½ulp(量级)` 外扩，并按 atom key **稳定排序**累加（消除书写序）。
 */




const x = v("x");
const y = v("y");
const plus = (t: ReturnType<typeof v>, k: number) => app("+", [t, lit(k)]);


  it("宿主 IEEE 见证：x = MIN_VALUE 时 x > 0 真而 x + 1 > 1 假；x > 0 ⊬ x + 1 > 1；x > 0 ⊬ x + 2 > 2；x > 0 ⊬ x + 0.5 > 0.5；x ≥ 0 ⊬ x + 1 > 1（非 strict 下界同样不足）；x > 0 ⊨ x + 1 >= 1（IEEE 恒真，section 明确要求仍成立）；x > 0 ⊬ x + 1 > 2（既非可证也不该被常量抵消造出来）；量级吸收：x > 1e-12 ⊬ x +", () => {
  {
    expect(Number.MIN_VALUE > 0).toBe(true);
    expect(Number.MIN_VALUE + 1 > 1).toBe(false);
  }
  {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(1)))).toBe(false);
  }
  {
    expect(implies(gt(x, lit(0)), gt(plus(x, 2), lit(2)))).toBe(false);
  }
  {
    expect(implies(gt(x, lit(0)), gt(plus(x, 0.5), lit(0.5)))).toBe(false);
  }
  {
    expect(implies(ge(x, lit(0)), gt(plus(x, 1), lit(1)))).toBe(false);
  }
  {
    expect(implies(gt(x, lit(0)), ge(plus(x, 1), lit(1)))).toBe(true);
  }
  {
    expect(implies(gt(x, lit(0)), gt(plus(x, 1), lit(2)))).toBe(false);
  }
  {
    expect(1e-12 + 1e6).toBe(1e6);
    expect(implies(gt(x, lit(1e-12)), gt(plus(x, 1e6), lit(1e6)))).toBe(false);
  }
  {
    expect((1 + 2 ** -52) + 1).toBe(2);
    expect(implies(gt(x, lit(1)), gt(plus(x, 1), lit(2)))).toBe(false);
  }
});










describe("同一加法换操作数顺序必须同结论", () => {
  it("x > 0 ∧ y >= 1：x + y > 1 与 y + x > 1 都不可证；x > 0 ∧ y >= 1：x + y >= 1 与 y + x >= 1 都成立（对称性双向钉）", () => {
  {
    const phi = and(gt(x, lit(0)), ge(y, lit(1)));
    expect(implies(phi, gt(app("+", [x, y]), lit(1)))).toBe(false);
    expect(implies(phi, gt(app("+", [y, x]), lit(1)))).toBe(false);
  }
  {
    const phi = and(gt(x, lit(0)), ge(y, lit(1)));
    expect(implies(phi, ge(app("+", [x, y]), lit(1)))).toBe(true);
    expect(implies(phi, ge(app("+", [y, x]), lit(1)))).toBe(true);
  }
});

});

describe("无常量抵消的真事实不回退", () => {
  it("x > 1 ∧ y > 1 ⊨ x + y > 2（拐点处和精确可表示）；x > 0 ∧ y > 0 ⊨ x + y > 0；x ≥ 1 ∧ y ≥ 1 ⊨ x + y ≥ 2（非严格线性判定不变）；x > 2 ⊨ 2 * x > 4（2 的幂缩放精确）", () => {
  {
    expect((1 + 2 ** -52) + (1 + 2 ** -52)).toBeGreaterThan(2);
    expect(implies(and(gt(x, lit(1)), gt(y, lit(1))), gt(app("+", [x, y]), lit(2)))).toBe(true);
  }
  {
    expect(implies(and(gt(x, lit(0)), gt(y, lit(0))), gt(app("+", [x, y]), lit(0)))).toBe(true);
  }
  {
    expect(implies(and(ge(x, lit(1)), ge(y, lit(1))), ge(app("+", [x, y]), lit(2)))).toBe(true);
  }
  {
    expect(implies(gt(x, lit(2)), gt(app("*", [lit(2), x]), lit(4)))).toBe(true);
  }
});



});
});

// ---------------------------------------------------------------------------
// 侧车 fn() 的 throws 槽必须按分隔符拆分
// ---------------------------------------------------------------------------
describe("侧车 fn() 的 throws 槽必须按分隔符拆分", () => {
/**
 * 侧车 `fn()` 的 `throws` 槽**不按分隔符拆分**字符串字面量。
 *
 * `fn(..., { throws: "TypeError, RangeError" })` 把整串当成**一个** kind 名
 * （`throwConstraintToKinds` 的 `walk` 直接 `note(side.value)`）⇒ 申报集合里
 * 没有 `TypeError` ⇒ **声明静默失效零诊断** ⇒ L2 门禁把「已申报」的代码判成
 * 「未申报」⇒ `nudo:entry-may-throw` **假红**。
 *
 * 而**完全等价**的 `@nudo:throws TypeError, RangeError`（指令面按
 * `/[,\s|]+/` 切分）与 `fn(..., { throws: union("TypeError","RangeError") })`
 * 都是绿的 ⇒ 同一语义两种写法结论不同。
 *
 * 修法：`throwConstraintToKinds` 对字符串字面量 kind 名按**同一分隔符集**
 * 拆分（与 `scanThrowsDecl` 同口径）。
 */







/** 侧车 fn() 的 throws 槽 → 申报的 kind 名 */
const kindsOf = (throws: string | ReturnType<typeof union>) =>
  throwConstraintToKinds(fn_____index_ts({ x: number_____index_ts() }, number_____index_ts(), { throws }).fn!.throws);


  it("逗号串 ⇒ 两个 kind 名（改前整串当**一个**名）；竖线 / 空白分隔同样拆分（与指令面同口径）；单个 kind / `*` / union 形态不受影响；与指令面 `@nudo:throws` 的切分口径一致（同一 spec 同一 kind 集）；端到端：侧车 `throws: \"TypeError, RangeError\"` 放行已申报的 TypeError（改前 L2 假红）", () => {
  {
    expect(kindsOf("TypeError, RangeError")).toEqual(["TypeError", "RangeError"]);
  }
  {
    expect(kindsOf("TypeError | RangeError")).toEqual(["TypeError", "RangeError"]);
    expect(kindsOf("TypeError RangeError")).toEqual(["TypeError", "RangeError"]);
  }
  {
    expect(kindsOf("TypeError")).toEqual(["TypeError"]);
    expect(kindsOf("*")).toBe("*");
    expect(kindsOf(union("TypeError", "RangeError"))).toEqual([
      "TypeError",
      "RangeError",
    ]);
  }
  {
    const spec = "TypeError, RangeError";
    const fromDirective = scanThrowsDecl([`@nudo:throws ${spec}`]);
    expect(fromDirective).toBe("TypeError,RangeError");
    expect(kindsOf(spec)).toEqual(fromDirective!.split(","));
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug208-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "bug208", version: "1.0.0", nudo: {} }),
      );
      const srcPath = join(dir, "use.js");
      const src = `export function use(x) {
  if (x < 0) throw new TypeError("bad");
  return x;
}
`;
      writeFileSync(srcPath, src);
      const side = `import { fn, number } from "@nudojs/core";
export const use = fn({ x: number() }, number(), { throws: "TypeError, RangeError" });
`;
      writeFileSync(join(dir, "use.nudo.js"), side);
      const r = checkSource_____index_ts(srcPath, src, pTrue_____index_ts, {
        fromFile: srcPath,
        loadModule: (spec) => (spec.endsWith("use.nudo.js") ? side : undefined),
        autoBind: true,
        projectDir: dir,
      });
      // 改前：`may throw TypeError`（nudo:entry-may-throw，error）
      const mayThrow = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
      expect(mayThrow.map((i) => i.message)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});





});

// ---------------------------------------------------------------------------
// 长度界链的构造期 prim 门禁
// ---------------------------------------------------------------------------
describe("长度界链的构造期 prim 门禁", () => {
/**
 * 长度界链用在**数值 prim** 上（`number().min(1)`）时：
 * ① 构造期**不被拒** ⇒ 产出恒假约束（guard 产物 `data.length >= 1` 对数字恒
 * 假 ⇒ 拒绝全部合法输出）；
 * ② 参数通道把 `ge(length(x), 1)` 当**普通数值比较**（`3 >= 1` ⇒ 满足）⇒
 * 假绿；返回通道按**长度语义**读同一谓词 ⇒ 假红 ⇒ 同一约束两通道结论相反。
 *
 * 修法：
 * - `constraint.ts` 的 `min` / `max` / `length` 补**构造期 prim 门禁**（与
 * `gt/ge/lt/le`、`.int()` 同口径）：只有 `string()`、`array(...)` 与无 prim
 * 的开放链允许；数值 / 布尔的 prim 上直接报错；
 * - `diagnostics.ts` 的 `decideLitCmp` 按**比较式左项**分派：纯 `var` 才是数值
 * 比较；`length(t)` 走**长度语义**（字符串字面量）；其余形态（含数字字面量上
 * 的 `length`）判「不可判定」⇒ 不再当中普通数值比较。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDE = `import { number, string, array } from "@nudojs/core";
export const cLen3 = string().length(3);
export const cArr3 = array(number()).min(3);
`;

function check(src: string, file = "/t/minmax.js") {
  const imp = `/// @nudo:import { cLen3, cArr3 } from "./std.nudo.js"\n`;
  return checkSource_____index_ts(file, imp + src, pTrue_____index_ts, sidecarOpts("std.nudo", SIDE, file));
}

/** 参数通道（谓词执法）的违例 */
function paramViolations(r: {
  issues: { code: string; message: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && !i.message.includes("return value ⊭"),
  );
}

/** 返回通道的违例 */
function returnViolations(r: {
  issues: { code: string; message: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && i.message.includes("return value ⊭"),
  );
}


  it("number().min(1) / .max(1) / .length(1) 构造期抛错；boolean() / 结构型链上同样抛错（与 gt/ge/lt/le 同口径）；负控制：string() / array(...) 的长度链仍然可用", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => number_____index_ts().min(1)).toThrow(/only string \/ array length chains/);
    expect(() => number_____index_ts().min(1)).toThrow(/prim=number/);
    expect(() => number_____index_ts().max(1)).toThrow(/only string \/ array length chains/);
    expect(() => number_____index_ts().length(1)).toThrow(/only string \/ array length chains/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => boolean().min(1)).toThrow(/prim=boolean/);
    expect(() => boolean().max(1)).toThrow(/prim=boolean/);
    expect(() => boolean().length(1)).toThrow(/prim=boolean/);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(() => string().min(1)).not.toThrow();
    expect(() => string().max(20)).not.toThrow();
    expect(() => string().length(3)).not.toThrow();
    expect(() => array(number_____index_ts()).min(3)).not.toThrow();
    expect(() => array(number_____index_ts()).max(2)).not.toThrow();
  }
});




describe("参数通道与返回通道同结论（长度语义）", () => {
  it("string().length(3)：两通道都判违例（'ab'）；string().length(3)：两通道都放行（'abc'）；array(...).min(3)：两通道都判违例（[1,2]）；array(...).min(3)：两通道都放行（[1,2,3]）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const param = check(`/** @nudo:contract s cLen3 */
export function fStr(s) { return s; }
fStr("ab");
`);
    const ret = check(`/** @nudo:contract return cLen3 */
export function gStr() { return "ab"; }
`);
    expect(paramViolations(param)).toHaveLength(1);
    expect(returnViolations(ret)).toHaveLength(1);
    // 同结论（不是「一绿一红」）
    expect(paramViolations(param).length > 0).toBe(returnViolations(ret).length > 0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const param = check(`/** @nudo:contract s cLen3 */
export function fStr(s) { return s; }
fStr("abc");
`);
    const ret = check(`/** @nudo:contract return cLen3 */
export function gStr() { return "abc"; }
`);
    expect(paramViolations(param)).toEqual([]);
    expect(returnViolations(ret)).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const param = check(`/** @nudo:contract xs cArr3 */
export function fArr(xs) { return xs; }
fArr([1, 2]);
`);
    const ret = check(`/** @nudo:contract return cArr3 */
export function gArr() { return [1, 2]; }
`);
    expect(paramViolations(param)).toHaveLength(1);
    expect(returnViolations(ret)).toHaveLength(1);
    expect(paramViolations(param).length > 0).toBe(returnViolations(ret).length > 0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const param = check(`/** @nudo:contract xs cArr3 */
export function fArr(xs) { return xs; }
fArr([1, 2, 3]);
`);
    const ret = check(`/** @nudo:contract return cArr3 */
export function gArr() { return [1, 2, 3]; }
`);
    expect(paramViolations(param)).toEqual([]);
    expect(returnViolations(ret)).toEqual([]);
  }
});



});

describe("decideLitCmp 不得把 length(...) 当普通数值比较", () => {
  const lengthAtLeast1 = ge_____index_ts(lenTerm(v_____index_ts("s")), lit_____index_ts(1));

  it("数字字面量 × length(s) ≥ 1 ⇒ 不可判定（不是「满足」）；数字字面量 0 × length(s) ≥ 1 同样是「不可判定」（不是「违例」）；字符串字面量 × length(s) ≥ 1 ⇒ 按长度语义裁决；纯 var 左项的数值比较语义不变", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const d = checkArg(numLit(3), lengthAtLeast1);
    // 修复前：decideLitCmp 按 3 >= 1 判满足 ⇒ 返回 undefined（假绿）
    expect(d?.code).toBe("nudo:constraint-unproven");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    // 修复前：0 >= 1 判**不满足** ⇒ 假红（长度语义不可判 ⇒ 不得给结论）
    expect(checkArg(numLit(0), lengthAtLeast1)?.code).toBe(
      "nudo:constraint-unproven",
    );
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(checkArg(strLit("ab"), lengthAtLeast1)).toBeUndefined();
    expect(checkArg(strLit(""), lengthAtLeast1)?.code).toBe(
      "nudo:constraint-violated",
    );
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(checkArg(numLit(3), ge_____index_ts(v_____index_ts("s"), lit_____index_ts(1)))).toBeUndefined();
    expect(checkArg(numLit(0), ge_____index_ts(v_____index_ts("s"), lit_____index_ts(1)))?.code).toBe(
      "nudo:constraint-violated",
    );
  }
});



});

/**
 * **手写纯数据约束**直接塞 `app(length, …)`（`__nudoConstraint` 纯数据形态，
 * 不经构建器 ⇒ 构造期门禁管不到）。产品路径的**参数通道**（`checkReqs` 的
 * 数值界分支）此前会在 `argLen` 不可判时把 `length(x) ≥ n` 当普通数值比较
 * ⇒ 数字 3 判「满足」（假绿）、数字 0 判「违例」（假红）。
 */
describe("手写数据约束的 length 谓词：参数通道不得当数值比较", () => {
  const RAW = (prim: string): string =>
    `{ __nudoConstraint: true, prim: "${prim}", preds: [{ op: "ge", a: { op: "app", fn: "length", args: [{ op: "var", id: "__nudo_self__" }] }, b: { op: "lit", value: 1 } }] }`;
  const SIDE_RAW = `export const cStrLen = ${RAW("string")};
export const cNumLen = ${RAW("number")};
`;
  function checkRaw(src: string) {
    const imp = `/// @nudo:import { cStrLen, cNumLen } from "./std.nudo.js"\n`;
    return checkSource_____index_ts("/t/raw.js", imp + src, pTrue_____index_ts, sidecarOpts("std.nudo", SIDE_RAW));
  }

  it("数字实参：3 与 0 都不落进数值比较（0 不再假红）；字符串实参：参数位按长度语义裁决（'ab' 放行 / '' 违例）；与返回位同结论（字符串长度链：'ab' 两通道放行 / '' 两通道违例）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    for (const argLit of ["3", "0"]) {
      const r = checkRaw(`/** @nudo:contract x cNumLen */
export function fNum(x) { return x; }
fNum(${argLit});
`);
      expect(paramViolations(r), `fNum(${argLit})`).toEqual([]);
    }
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const ok = checkRaw(`/** @nudo:contract s cStrLen */
export function fStr(s) { return s; }
fStr("ab");
`);
    const bad = checkRaw(`/** @nudo:contract s cStrLen */
export function fStr(s) { return s; }
fStr("");
`);
    expect(paramViolations(ok)).toEqual([]);
    expect(paramViolations(bad)).toHaveLength(1);
    expect(paramViolations(bad)[0]!.expected).toContain("length(s) ≥ 1");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const ok = checkRaw(`/** @nudo:contract return cStrLen */
export function gStr() { return "ab"; }
`);
    const bad = checkRaw(`/** @nudo:contract return cStrLen */
export function gStr() { return ""; }
`);
    expect(returnViolations(ok)).toEqual([]);
    expect(returnViolations(bad)).toHaveLength(1);
    // 与参数位同结论（长度可判时两通道一致）
    expect(returnViolations(bad).length > 0).toBe(
      paramViolations(
        checkRaw(`/** @nudo:contract s cStrLen */
export function fStr(s) { return s; }
fStr("");
`),
      ).length > 0,
    );
  }
});


});
});

// ---------------------------------------------------------------------------
// 先放大再折半不得被放松成假红
// ---------------------------------------------------------------------------
describe("先放大再折半不得被放松成假红", () => {
/**
 * 回归：算术端点合成丢失「最紧可达值」⇒ `(x + x) / 2` / `x * 2 / 2`
 * 这类**恒 > 0** 的表达式被 L1 返回契约判成违约（error / exit 1），而同一语义
 * 的 `x` 判 GREEN ⇒ 假红 + 同一值的两种写法结论互斥。
 *
 * 根因：strict 端点的见证一律取 `nextUp(bound)`——`x + x` 的界是 `> 0`（正确），
 * 但它的**最紧可达值**是 `fl(5e-324 + 5e-324) = 1e-323`，不是 `nextUp(0)`。
 * 用不可达见证做下一步除法 ⇒ `fl(5e-324 / 2) = 0` 下溢回端点 ⇒
 * `ieeeStrictEndpoint` 退到 `nextDown(0)` ⇒ 界被放松整整一个 binade（`> -5e-324`）
 * ⇒ 不蕴含 `> 0` ⇒ 假红。
 *
 * 修法：端点模型携带 `attain`（`attainEndpoint`）——只对**可精确反解**的缩放
 * 形态（`t + t`、`t × 2^k`）填「可达下界」，`synthEndpoint` 见证优先用它。
 * 对照：`x / 2` 在 x = 5e-324 时**确实**为 0 ⇒ 仍必须判红（不得被本条放松）。
 */











/** x: number, x > 0（与夹具 `std.nudo.js` 的 `positive` 同形） */
function positiveX() {
  const x = v("x");
  return abs_____abs_ts({ k: "prim", type: "number" }, x, gt(x, lit(0)), "path");
}

const violations = (r: ReturnType<typeof issuesOf>) =>
  r.issues.filter((i) => i.code === "nudo:constraint-violated" && i.fn === "f");

function checkReturn(body: string) {
  return issuesOf(
    `/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function f(x) {
  return ${body};
}
`,
    "/t/bug224.js",
  );
}

{
  it.each([["x"], ["x + x"], ["x * 2"], ["(x + x) / 2"], ["x * 2 / 2"], ["(x + x) * 0.5"]])(
    "契约 x>0 ⇒ return>0 对 `%s` 成立 ⇒ 不得报违约",
    (body) => {
      expect(violations(checkReturn(body))).toEqual([]);
    },
  );

  it("对照（真红必须保留）：`x / 2` 在 x = 5e-324 处为 0 ⇒ 仍判违约；单元面：(x + x) / 2 的界是 > 0（不是被放松的 > -5e-324）；单元面：x * 2 / 2 与 (x + x) * 0.5 同结论（乘法路径同样补 attain）；单元面：x / 2 与 x * 0.5 保持 disproved（真界 ≥ 0，不可放松）", () => {
  {
    const v = violations(checkReturn("x / 2"));
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
  }
  {
    const x = positiveX();
    const halved = div(add(x, x), numLit_____abs_ts(2));
    expect(assertImplies(halved, number().gt(0)).status).toBe("proved");
    const printed = formatAbs_____format_format_ts(halved);
    expect(printed).toContain("> 0");
    expect(printed).not.toContain("-5e-324");
  }
  {
    const x = positiveX();
    expect(assertImplies(div(mul(x, numLit_____abs_ts(2)), numLit_____abs_ts(2)), number().gt(0)).status).toBe("proved");
    expect(assertImplies(mul(add(x, x), numLit_____abs_ts(0.5)), number().gt(0)).status).toBe("proved");
  }
  {
    const x = positiveX();
    expect(assertImplies(div(x, numLit_____abs_ts(2)), number().gt(0)).status).toBe("disproved");
    expect(assertImplies(mul(x, numLit_____abs_ts(0.5)), number().gt(0)).status).toBe("disproved");
  }
});



}
});

// ---------------------------------------------------------------------------
// 取整内建的 strict 端点须做见证步进
// ---------------------------------------------------------------------------
describe("取整内建的 strict 端点须做见证步进", () => {
/**
 * 回归：内建取整通道（`roundingAbs`）丢掉 strict 端点的**见证步进**
 * ⇒ `Math.ceil(x)`（契约 `x > 0` ⇒ 恒 `≥ 1`）被 L1 返回契约判成违约
 * （error / exit 1），而同语义的 `Math.floor(x) + 1` 判 GREEN ⇒ 假红 +
 * 同一语义两种写法结论相反。
 *
 * 根因：`packages/core/src/algebra/builtins/math.ts` 的 `roundingAbs` 对端点
 * 直接取 `impl(b.lo.value)`：输入 `x > 0` ⇒ `Math.ceil(0) = 0` ⇒ 下界比真界
 * （`ceil(5e-324) = 1`）松整整一级；且 `strict` 被硬编码 false。
 *
 * 修法：strict 端点做见证步进（与 `synthEndpoint` 同口径）——
 * `impl(nextUp(lo))` / `impl(nextDown(hi))`，结果按「可达」记（非 strict）。
 * 对照组：`floor` / `trunc` / `round` 的真下界本就是 `≥ 0`（`floor(0.5)=0`）
 * ⇒ 对 `x > 0` 判红是**正确的**，不得被本条放松。
 */











function numBound(n: number) {
  const t = v("x");
  return abs_____abs_ts({ k: "prim", type: "number" }, t, gt(t, lit(n)), "path");
}

const violations = (r: ReturnType<typeof issuesOf>) =>
  r.issues.filter((i) => i.code === "nudo:constraint-violated" && i.fn === "f");

function checkReturn(body: string) {
  return issuesOf(
    `/**
 * @nudo:contract x positive
 * @nudo:contract return positive
 */
function f(x) {
  return ${body};
}
`,
    "/t/bug225.js",
  );
}

{
  it.each([["Math.ceil(x)"], ["Math.ceil(Math.ceil(x))"], ["Math.floor(x) + 1"], ["Math.trunc(x) + 1"]])(
    "契约 x>0 ⇒ return>0 对 `%s` 成立 ⇒ 不得报违约",
    (body) => {
      expect(violations(checkReturn(body))).toEqual([]);
    },
  );

  it("对照（真红必须保留）：`Math.floor(x)` 在 x = 5e-324 处为 0 ⇒ 仍判违约；单元面：Math.ceil(x>0) 的下界是 1（此前是 0）；单元面：整数界触发（x > 5 ⇒ Math.ceil(x) ≥ 6），不依赖 denormal 推理；单元面：upper 侧同样做见证步进（x < 0 ⇒ Math.floor(x) ≤ -1）", () => {
  {
    const v = violations(checkReturn("Math.floor(x)"));
    expect(v).toHaveLength(1);
    expect(v[0]!.severity).toBe("error");
  }
  {
    const ceilAbs = evalMathMethod("ceil", [numBound(0)])!;
    const b = numericBounds(ceilAbs);
    expect(b?.lo).toEqual({ value: 1, strict: false });
    expect(formatAbs_____format_format_ts(ceilAbs)).toContain("≥ 1");
    expect(assertImplies(ceilAbs, number().gt(0)).status).toBe("proved");
  }
  {
    const ceilAbs = evalMathMethod("ceil", [numBound(5)])!;
    expect(numericBounds(ceilAbs)?.lo).toEqual({ value: 6, strict: false });
    expect(assertImplies(ceilAbs, number().gt(5)).status).toBe("proved");
    // 对照：floor(x>5) 的真下界仍是 5（x=5.000000000000001 ⇒ 5）⇒ 判红是对的
    const floorAbs = evalMathMethod("floor", [numBound(5)])!;
    expect(numericBounds(floorAbs)?.lo).toEqual({ value: 5, strict: false });
    expect(assertImplies(floorAbs, number().gt(5)).status).toBe("disproved");
  }
  {
    const t = v("x");
    const xLt0 = abs_____abs_ts({ k: "prim", type: "number" }, t, { op: "lt", a: t, b: lit(0) } as never, "path");
    const floorAbs = evalMathMethod("floor", [xLt0])!;
    expect(numericBounds(floorAbs)?.hi).toEqual({ value: -1, strict: false });
    // 常量折叠路径不受影响
    expect(evalMathMethod("ceil", [numLit_____abs_ts(0)])).toEqual(
      expect.objectContaining({ shape: { k: "prim", type: "number" } }),
    );
  }
});



}
});

// ---------------------------------------------------------------------------
// indexOf / lastIndexOf fromIndex clamping
// ---------------------------------------------------------------------------
describe("indexOf / lastIndexOf fromIndex clamping", () => {
/**
 * `indexOf(x, fromIndex)` 越界（fromIndex >= length）时应返回 -1
 * （`lastIndexOf` 则按规范从末尾夹取）。修复：fromIndex 夹取。
 */



const INDEX_OF = `
export function f() {
  const a = [1, 2, 3];
  return a.indexOf(3, 5);
}
`;

const LAST_INDEX_OF = `
export function f() {
  const a = [1, 2, 3];
  return a.lastIndexOf(3, 5);
}
`;


  it("indexOf past the end returns -1；lastIndexOf past the end searches from the end", () => {
  {
    expect(val(INDEX_OF)).toEqual({ ok: true, value: -1 });
  }
  {
    expect(val(LAST_INDEX_OF)).toEqual({ ok: true, value: 2 });
  }
});


});

// ---------------------------------------------------------------------------
// 并集源不再重复跑聚合 leqPred
// ---------------------------------------------------------------------------
describe("并集源不再重复跑聚合 leqPred", () => {
/**
 * 并集（sum）作为**源**时，结构判定通过后不得再跑聚合层 `leqPred`。
 *
 * `leqShape` 的 sum 源分支已逐成员跑过 `leqWithPred(m, tgt, …)`（含每个成员的
 * `leqPred`）⇒ `leqWithPred` 尾部再跑一次聚合 `leqPred` 是重复的。而 sum 聚合体
 * **不携带**顶层 pred（`makeSum` / parser `constraintToCaseArgAbs` 都不写 pred）
 * ⇒ 聚合判定走「源无 pred」分支（`implies(phi, tp)`）⇒ 目标只要带谓词就恒假
 * ⇒ `union(number().gt(0), number().gt(5)) ⊭ number().gt(0)` 假红，且两侧渲染串
 * 完全相同（诊断不可读）。
 *
 * TS 的并集源规则正是「每个成员可赋给目标即可」⇒ 聚合层不得再加一条独立判据。
 * 这里按 parser `constraintToCaseArgAbs` 的同口径构造 case 实参 Abs（union →
 * sum，无顶层 pred），逐条钉住正例 / 反例，防止把「跳过聚合判定」放宽成
 * 「并集全绿」。
 */







/** 约束（builder 或已解引用）→ 入口 Abs（锚在 `__arg` 上的 var 项）。 */
function entry(c: NudoConstraint): Abs {
  return constraintToEntryAbs_____constraint_ts(c, "__arg");
}

/**
 * 与 parser `constraintToCaseArgAbs` 同口径：union 成员递归再拼 sum，
 * **不带顶层 pred**（`{ shape: { k: "sum", members }, conf: "path" }`）。
 */
function caseArg(c: NudoConstraint): Abs {
  if (c.members && c.members.length > 0) {
    const parts = c.members.map(caseArg);
    if (parts.length === 1) return parts[0]!;
    return { shape: { k: "sum", members: parts }, conf: "path" };
  }
  return entry(c);
}

const C = (b: unknown): NudoConstraint => derefConstraint(b as never);


  it("union(number().gt(0), number().gt(5)) ≤ number().gt(0)；三成员并集同样按成员判定（不因成员数而回退）；单个成员的 sum 与裸成员同判；反例：并集里含类型不符成员仍判红；反例：并集里含谓词不符成员仍判红（x<0 ⊄ x>0）；聚合体确实带顶层 pred 时仍参与判定（信息不丢）；目标侧并集语义不变：单成员 ≤ 并集", () => {
  {
    // 复现：`@nudo:case "B" (union(number().gt(0), number().gt(5))) => number().gt(0)`
    const actual = caseArg(C(union_____constraint_ts(number().gt(0), number().gt(5))));
    const expected = caseArg(C(number().gt(0)));
    expect(leqAbs(actual, expected).ok).toBe(true);
  }
  {
    const actual = caseArg(
      C(union_____constraint_ts(number().gt(0), number().gt(5), number().gt(9))),
    );
    const expected = caseArg(C(number().gt(0)));
    expect(leqAbs(actual, expected).ok).toBe(true);
  }
  {
    const single = caseArg(C(union_____constraint_ts(number().gt(0))));
    expect(leqAbs(single, caseArg(C(number().gt(0)))).ok).toBe(true);
  }
  {
    const actual = caseArg(C(union_____constraint_ts(number().gt(0), str())));
    const r = leqAbs(actual, caseArg(C(number().gt(0))));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sum member/);
  }
  {
    const actual = caseArg(C(union_____constraint_ts(number().gt(0), number().lt(0))));
    const r = leqAbs(actual, caseArg(C(number().gt(0))));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sum member: pred/);
  }
  {
    // `narrow.ts` 的 `{ ...a, shape: sum }` 会保留 a.pred ⇒ 此时不得跳过聚合判定。
    const members = [entry(C(number().gt(0))), entry(C(number().gt(5)))];
    const withTopPred = abs_____abs_ts(
      { k: "sum", members },
      v("__arg"),
      lt(v("__arg"), lit(0)),
      "path",
    );
    expect(leqAbs(withTopPred, caseArg(C(number().gt(0)))).ok).toBe(false);
    // 对照：同成员、无顶层 pred ⇒ 放行（本 BUG 的修复点）
    expect(
      leqAbs(abs_____abs_ts({ k: "sum", members }, undefined, undefined, "path"), caseArg(C(number().gt(0))))
        .ok,
    ).toBe(true);
  }
  {
    expect(
      leqAbs(
        caseArg(C(number().gt(0))),
        caseArg(C(union_____constraint_ts(number().gt(0), number().gt(5)))),
      ).ok,
    ).toBe(true);
  }
});







});

// ---------------------------------------------------------------------------
// 域共享元素 Abs 不得折「同值」
// ---------------------------------------------------------------------------
describe("域共享元素 Abs 不得折「同值」", () => {
/**
 * `strictEqAbs` 的「同一 Abs 引用 ⇒ 同值」折叠缺**域共享门**。
 *
 * 根因：`arr` shape 只有一个元素域 Abs，`$idx` 等**分发位**把同一对象交给
 * 两个下标位（`xs[0]` / `xs[1]` 共享 `shape.element`，`arr-index.ts` 用
 * `markDomainShared` 标记）。`strictEqAbs` 的 `a === b` 分支只看对象身份
 * ⇒ 折 `true` ⇒ `if (xs[0] === xs[1])` 恒真 ⇒ **另一臂被当死代码删掉**
 * ⇒ 引擎自信返回 `"same"`（`conf: exact`），而宿主真值是 `"diff"` ⇒
 * guard / schema 产物只接受 `"same"`（拒绝真实返回值）。
 *
 * 修复：`a === b` 与「同 var 恒等」两支都补 `isDomainShared` 门（与
 * `arithmetic/addsub.ts` 的 sub 自反折叠门同一不变量）⇒ 不可判定
 * （`undefined`），不是 `true`。
 */






/** 契约元素域的代表形状（obj：非字面量、无 var 项 ⇒ 只走「同 Abs」支） */
const item = (): Abs =>
  abs_____abs_ts({ k: "obj", slots: { id: { value: numLit_____abs_ts(1) } } }, undefined, undefined, "exact");


  it("同一 Abs 引用：非域共享仍折 true，域共享折 undefined；契约类型数组的 xs[0] === xs[1] 不得删掉 false 臂；字面量数组（元素各自铸造、非域共享）仍精确判 diff", () => {
  {
    const el = item();
    // 同一绑定重复出现（真同值）——既有精度：保持 true
    expect(strictEqAbs(el, el)).toBe(true);
    // 元素域分发产物（xs[0] / xs[1] 的同一个对象）——不保证同值
    expect(strictEqAbs(markDomainShared(el), el)).toBeUndefined();
  }
  {
    const xs = abs_____abs_ts({ k: "arr", element: item() }, undefined, undefined, "exact");
    const src = `export function f(xs) {
  if (xs[0] === xs[1]) { return "same"; }
  return "diff";
}`;
    const r = call(src, "f", [xs]);
    const v = litValue_____abs_ts(r.result);
    // 修复前：exact "same"（宿主不可能产出的错值）⇒ 此断言必挂
    expect(v.ok ? v.value : undefined).not.toBe("same");
  }
  {
    const src = `export function f() {
  const xs = [{ id: 1 }, { id: 2 }];
  if (xs[0] === xs[1]) { return "same"; }
  return "diff";
}`;
    const r = call(src, "f", []);
    expect(litValue_____abs_ts(r.result)).toEqual({ ok: true, value: "diff" });
  }
});



});

// ---------------------------------------------------------------------------
// 落盘 @generated 段永远受漂移监督
// ---------------------------------------------------------------------------
describe("落盘 @generated 段永远受漂移监督", () => {
/**
 * 源码级 `@nudo:contract` 让侧车里已落盘的 `@generated` 段变成
 * 「**完全死件**」⇒ `nudo check` 对陈旧生成段零告警（假绿），而**同一文件**
 * `contract --emit --exit-on-diff` 判「会变 / exit 1」⇒ 两面结论相反；
 * 只加三行源码注释就让 drift 警告整条消失（非单调）。
 *
 * 根因：漂移闸门搭在「有效契约」上（`eff.source === "generated"`）而不是
 * 「落盘生成段」上。修法 = `effectiveContract` 交出与层级解耦的
 * `generated` 视图，漂移闸门**永远**监督落盘生成段。
 *
 * 钉：源码契约在场时陈旧生成段仍报 drift；对照组（无源码契约）行为不变；
 * 生成段与今日域一致时零 drift（不把监督做成误报）。
 */








const STALE_SIDECAR = `import { fn, lit } from "@nudojs/core";
// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: a.js:f
export const f = fn({ x: lit(9) }, lit(10));
`;

const FRESH_SIDECAR = `import { fn, lit } from "@nudojs/core";
// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: a.js:f
export const f = fn({ x: lit(5) }, lit(6));
`;

const WITH_CONTRACT = `
/// @nudo:import { positive } from "./std.nudo.js"

/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x + 1;
}
f(5);
`;

const CONTROL_NO_CONTRACT = `
export function f(x) {
  return x + 1;
}
f(5);
`;

function check(src: string, sidecar: string) {
  const { loadModule } = makeFiles({
    "/t/a.nudo.js": sidecar,
    "/t/std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().ge(0);\n`,
  });
  return checkSource_____index_ts("/t/a.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/a.js" });
}

function drifts(r: ReturnType<typeof check>) {
  return r.issues.filter((i) => i.code === "nudo:contract-drift");
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();
  });

  it("源码 @nudo:contract 在场 + 陈旧生成段 ⇒ 报 drift（旧口径零告警）；对照组（无源码契约）同样报 ⇒ 两面同结论（不再非单调）；生成段与今日域一致 ⇒ 零 drift（有源码契约时不误报）", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const r = check(WITH_CONTRACT, STALE_SIDECAR);
    const d = drifts(r);
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((i) => i.message.includes("f[x]"))).toBe(true);
    expect(d.every((i) => i.severity === "warning")).toBe(true);
    // 有效契约仍是手写的（漂移监督不改执法层级）
    expect(r.signatures.find((s) => s.name === "f")?.paramTypes).toEqual(["number"]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    const withC = drifts(check(WITH_CONTRACT, STALE_SIDECAR));
    const withoutC = drifts(check(CONTROL_NO_CONTRACT, STALE_SIDECAR));
    expect(withoutC.length).toBeGreaterThan(0);
    expect(withC.length).toBe(withoutC.length);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeContractDiags();
    takeRefineDiags();


    expect(drifts(check(WITH_CONTRACT, FRESH_SIDECAR))).toEqual([]);
  }
});


}
});

// ---------------------------------------------------------------------------
// mock 宿主内建名不再被 env skip 表吞掉
// ---------------------------------------------------------------------------
describe("mock 宿主内建名不再被 env skip 表吞掉", () => {
/**
 * `@nudo:mock Math|Date|JSON|Promise|…` 被**静默忽略**。
 *
 * 改前：mock 与 env **合进同一张注入表**，而过滤用的是 **env 专用**的
 * 「不遮蔽宿主内建」env-skip 名单（getEnvShadowSkipGlobals）⇒ 名单内的 mock 名
 * 在注入前就被丢弃（no-op）——用户以为 mock 生效，实际跑的是宿主内建。
 *
 * 改后：跳过名单**只作用于 env 全局**；mock 键集不过滤（mock 的值本身
 * 就是一个 Abs，没有宿主对象身份需要保全——遮蔽宿主全局正是 mock 的意图）。
 */






const num = (v: number) =>
  abs_____abs_ts({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue, "exact");
const str = (v: string) =>
  abs_____abs_ts({ k: "prim", type: "string" }, { op: "lit", value: v }, pTrue, "exact");

const mockFn = (v: number | string) =>
  absFunction_____abs_fn_ts(["x"], {
    apply: () => (typeof v === "number" ? num(v) : str(v)),
  });


  it("@nudo:mock Math 生效（宿主 Math.floor 不再应答）；@nudo:mock JSON 生效（宿主 JSON.stringify 不再应答）；env 全局仍受 skip 表约束（宿主内建名不被 env 遮蔽）；非 skip 名单上的 mock 名行为不变（fetch 对照组）", () => {
  {
    const src = `export function run() { return Math.floor(1.5); }`;
    const withMock = runTranspiled_____exec_run_ts(src, { mode: "exec", mocks: { Math: mockFn(42) } });
    const without = runTranspiled_____exec_run_ts(src, { mode: "exec" });
    const mocked = callTranspiledExportFull(withMock, "run", []);
    const host = callTranspiledExportFull(without, "run", []);
    // 对照组：宿主 Math.floor(1.5) = 1
    expect(litValue_____abs_ts(host.result)).toEqual({ ok: true, value: 1 });
    // mock 生效 ⇒ 结果不再是宿主值
    expect(litValue_____abs_ts(mocked.result)).not.toEqual(litValue_____abs_ts(host.result));
  }
  {
    const src = `export function run() { return JSON.stringify({ a: 1 }); }`;
    const withMock = runTranspiled_____exec_run_ts(src, { mode: "exec", mocks: { JSON: mockFn("MOCKED") } });
    const without = runTranspiled_____exec_run_ts(src, { mode: "exec" });
    const mocked = callTranspiledExportFull(withMock, "run", []);
    const host = callTranspiledExportFull(without, "run", []);
    expect(litValue_____abs_ts(host.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(litValue_____abs_ts(mocked.result)).not.toEqual(litValue_____abs_ts(host.result));
  }
  {
    const src = `export function run() { return Math.floor(1.5); }`;
    const exports = runTranspiled_____exec_run_ts(src, { mode: "exec", envGlobals: { Math: num(42) } });
    const full = callTranspiledExportFull(exports, "run", []);
    // env 的 Math 被跳过 ⇒ 仍是宿主 Math.floor(1.5) = 1
    expect(litValue_____abs_ts(full.result)).toEqual({ ok: true, value: 1 });
  }
  {
    const src = `export function run() { return fetch("x"); }`;
    const exports = runTranspiled_____exec_run_ts(src, { mode: "exec", mocks: { fetch: mockFn("MOCKED") } });
    const full = callTranspiledExportFull(exports, "run", []);
    expect(litValue_____abs_ts(full.result)).toEqual({ ok: true, value: "MOCKED" });
  }
});




});

// ---------------------------------------------------------------------------
// 可选 require 走 cjsMain 分支（返回 module.exports 本身）
// ---------------------------------------------------------------------------
describe("可选 require 走 cjsMain 分支（返回 module.exports 本身）", () => {
/**
 * 可选 `require`（try/catch 双侧）**返回命名空间**而不是
 * `module.exports`。
 *
 * 改前：`requireOptionalFromModules` **漏了 `cjsMain` 分支**——普通
 * `requireFromModules` 有（`module.exports = X` ⇒ 返回 X 本身），可选
 * require 没有 ⇒ 同一个模块经两条路径拿到**不同形状**（命名空间 vs X）。
 *
 * 改后：两条路径共用 `requireValueOf`（cjsMain ⇒ default 本体）。
 */






const num = (v: number) =>
  abs_____abs_ts({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue, "exact");
const obj = (slots: Record<string, unknown>) =>
  abs_____abs_ts(
    {
      k: "obj",
      slots: Object.fromEntries(
        Object.entries(slots).map(([k, v]) => [k, { value: v as never }]),
      ),
      open: false,
    },
    undefined,
    undefined,
    "exact",
  );


  it("try/catch 双侧 require：拿到 module.exports 本身（非命名空间）；普通 require 与可选 require 同口径（cjsMain ⇒ default 本体）；ESM 模块经可选 require 仍是命名空间（口径不变）", () => {
  {
    const src = `export function f() {
  let d;
  try { d = require("./b.js"); } catch (e) { d = require("./c.js"); }
  return d;
}`;
    const exports = runTranspiled_____exec_run_ts(src, {
      mode: "exec",
      modules: { "./b.js": { named: {}, default: obj({ v: num(2) }), cjsMain: true } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    // module.exports 本身 ⇒ 槽面是 { v: 2 }（改前是命名空间 { default: { v: 2 } }）
    expect(objSlots(full.result)).toEqual({ v: 2 });
  }
  {
    const src = `export function f() { return require("./b.js"); }`;
    const exports = runTranspiled_____exec_run_ts(src, {
      mode: "exec",
      modules: { "./b.js": { named: {}, default: obj({ v: num(2) }), cjsMain: true } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(objSlots(full.result)).toEqual({ v: 2 });
  }
  {
    const src = `export function f() {
  let d;
  try { d = require("./b.js"); } catch (e) { d = require("./c.js"); }
  return d;
}`;
    const exports = runTranspiled_____exec_run_ts(src, {
      mode: "exec",
      modules: { "./b.js": { named: { v: num(2) } } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(objSlots(full.result)).toEqual({ v: 2 });
  }
});



});

// ---------------------------------------------------------------------------
// require 缺失模块按原生抛（catch 臂是活代码）
// ---------------------------------------------------------------------------
describe("require 缺失模块按原生抛（catch 臂是活代码）", () => {
/**
 * `require()` 一个**不存在的模块不抛**（假 no-throw）→ L2 门禁少报。
 *
 * 改前：`requireFromModules` 对解析不到的 spec 返回 `unknown`（**普通值**）
 * ⇒ 用户 try/catch 的 **catch 臂成死代码** ⇒ 引擎宣称「不抛」⇒
 * `nudo:entry-may-throw` 门禁少报（诊断面说「模块缺失」、运行期说「不抛」，
 * 两者自相矛盾）。
 *
 * 改后：**调用期**的缺失 require 抛 NudoThrow（Error brand，与原生
 * MODULE_NOT_FOUND 同类）⇒ catch 臂是活代码；未被吸收 ⇒ 如实计入
 * throws 面。**装载期**（模块体求值中）的缺失 require 保持既有降级
 * （折 unknown）——原生语义是「模块装载失败」，若也抛则整文件退化 unknown
 * ⇒ 门禁假绿（且顶层绑定未记录 ⇒ 跨文件契约检查失效）；缺模块由诊断面
 * `nudo:module-missing`（error）报。
 */






  it("try/catch 包裹的缺失 require：进 catch 臂；未被 catch 吸收的缺失 require：throws 面如实非 never（L2 不再少报）；存在模块的 require：不抛（对照组）", () => {
  {
    const src = `export function f() {
  try { require("./nope.js"); return "no-throw"; } catch (e) { return "threw"; }
}`;
    const exports = runTranspiled_____exec_run_ts(src, { mode: "exec" });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(litValue_____abs_ts(full.result)).toEqual({ ok: true, value: "threw" });
  }
  {
    const src = `export function f() { return require("./nope.js"); }`;
    const exports = runTranspiled_____exec_run_ts(src, { mode: "exec" });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(throwsError(full.throws, "Error")).toBe(true);
  }
  {
    const src = `export function f() {
  try { require("./ok.js"); return "no-throw"; } catch (e) { return "threw"; }
}`;
    const exports = runTranspiled_____exec_run_ts(src, {
      mode: "exec",
      modules: { "./ok.js": { named: { v: 1 } } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(litValue_____abs_ts(full.result)).toEqual({ ok: true, value: "no-throw" });
    expect(full.throws?.shape?.k ?? "never").toBe("never");
  }
});



});

// ---------------------------------------------------------------------------
// 内建 brand 上用户新增的自有属性必须进枚举视图
// ---------------------------------------------------------------------------
describe("内建 brand 上用户新增的自有属性必须进枚举视图", () => {
/**
 * 内建 brand（Error 家族 / Map / Date / …）上**用户新增的自有可枚
 * 举属性**对 `Object.keys` / `values` / `entries` 与 `JSON.stringify` **完全
 * 隐形**（引擎折「自信的确切空键集」`[]`），而同一引擎的 gOPN / gOPD /
 * `hasOwnProperty` 三个面又说它存在且可枚举 ⇒ **同一引擎多面互斥**。
 *
 * 根因：`BUILTIN_BRAND_NO_ENUM_KEYS` 是**族级常量**，`builtinBrandNoEnumKeys`
 * 判定完全不看接收者的真实槽表 ⇒ 一旦用户在实例上新增属性（`e.code = 42`
 * / `m.foo = 1` / `d.bar = 2`）就被短路面成 exact 空元组。
 *
 * 修法：判定与投影都**先查接收者的内层槽表**——有用户新增的自有可枚举键时
 * 按真实键集投影（`builtinBrandUserEnumEntries` / `builtinBrandUserOwnKeys`），
 * 零键短路只在实例确实没有可枚举自有键时成立；`JSON.stringify` 同步展开。
 * 内层槽表装**内部数据**的家族（RegExp 的 source/flags、URL 的 href、
 * ArrayBuffer 的 byteLength…——原生它们是原型访问器、非自有键）不参与该
 * 投影，保持「零可枚举自有键」口径。
 */




const PRELUDE = `
function mkErr() { const e = new TypeError("boom"); e.code = 42; return e; }
function mkMap() { const m = new Map(); m.foo = 1; return m; }
function mkDate() { const d = new Date(0); d.bar = 2; return d; }
`;

function absOf(body: string): Abs {
  return call(`${PRELUDE}\nexport function f() { ${body} }`, "f").result;
}

function tupleLits(a: Abs): unknown[] | undefined {
  if (a.shape.k !== "tuple") return undefined;
  const out = a.shape.elements.map((e) => {
    const v = litValue_____abs_ts(e);
    return v.ok ? v.value : undefined;
  });
  return out.some((v) => v === undefined) ? undefined : out;
}


  it("Object.keys(TypeError + e.code) 折真实键集（改前 []）；Object.values / entries 同键集；JSON.stringify(TypeError + e.code) 折 {\"code\":42}（改前 \"{}\"）；Error 家族四面一致：keys / gOPN / gOPD / hasOwn 同键集同标志；Map 实例：keys 与 gOPN 都投影用户新增键（改前两面都折 []）；Date 实例：keys 与 gOPN 同样", () => {
  {
    expect(tupleLits(absOf("return Object.keys(mkErr());"))).toEqual(["code"]);
  }
  {
    expect(tupleLits(absOf("return Object.values(mkErr());"))).toEqual([42]);
    const a = absOf("return Object.entries(mkErr());");
    const els = (a.shape as { k: string; elements: Abs[] }).elements;
    expect(a.shape.k).toBe("tuple");
    expect(els.length).toBe(1);
    expect(tupleLits(els[0]!)).toEqual(["code", 42]);
  }
  {
    expect(litValue_____abs_ts(absOf("return JSON.stringify(mkErr());"))).toEqual({
      ok: true,
      value: '{"code":42}',
    });
  }
  {
    expect(tupleLits(absOf("return Object.keys(mkErr());"))).toEqual(["code"]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mkErr());"))).toEqual([
      "stack",
      "message",
      "code",
    ]);
    expect(
      tupleLits(
        absOf(`
  const e = mkErr();
  const d = Object.getOwnPropertyDescriptor(e, "code");
  return [d.value, d.enumerable, e.hasOwnProperty("code")];
`),
      ),
    ).toEqual([42, true, true]);
  }
  {
    expect(tupleLits(absOf("return Object.keys(mkMap());"))).toEqual(["foo"]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mkMap());"))).toEqual(["foo"]);
    expect(tupleLits(absOf("return Object.values(mkMap());"))).toEqual([1]);
  }
  {
    expect(tupleLits(absOf("return Object.keys(mkDate());"))).toEqual(["bar"]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mkDate());"))).toEqual(["bar"]);
  }
  {
    expect(tupleLits(absOf("return Object.keys(new Map());"))).toEqual([]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(new Map());"))).toEqual([]);
    expect(tupleLits(absOf("return Object.keys(new Date(0));"))).toEqual([]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(new Date(0));"))).toEqual([]);
    expect(tupleLits(absOf('return Object.keys(new TypeError("x"));'))).toEqual([]);
  }
  {
    expect(tupleLits(absOf('return Object.getOwnPropertyNames(new TypeError("x"));'))).toEqual([
      "stack",
      "message",
    ]);
    expect(litValue_____abs_ts(absOf('return JSON.stringify(new TypeError("x"));'))).toEqual({
      ok: true,
      value: "{}",
    });
  }
  {
    expect(tupleLits(absOf("return Object.keys(/x/);"))).toEqual([]);
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(/x/);"))).toEqual(["lastIndex"]);
    expect(litValue_____abs_ts(absOf("return JSON.stringify(/x/);"))).toEqual({ ok: true, value: "{}" });
  }
  {
    const a = call(
      `
class A { constructor() { this.p = 1; } }
export function f() {
  return [Object.keys(new A()), Object.getOwnPropertyNames(new A())];
}
`,
      "f",
    ).result;
    const els = (a.shape as { k: string; elements: Abs[] }).elements;
    expect(a.shape.k).toBe("tuple");
    expect(tupleLits(els[0]!)).toEqual(["p"]);
    expect(tupleLits(els[1]!)).toEqual(["p"]);
  }
});










});

// ---------------------------------------------------------------------------
// 多声明符导出的第 2+ 个声明符也是导出
// ---------------------------------------------------------------------------
describe("多声明符导出的第 2+ 个声明符也是导出", () => {
/**
 * `export const a = …, b = …`（多声明符）**只有首个声明符进
 * 导出表** → `b` 不是导出 → 签名 `unknown` / 跨模块 import `unknown`。
 *
 * 改前：转译产物对多声明符导出只给**首个**声明符加 `export ` 前缀
 * （`export let a = …; $recordBinding("a", a); let b = …; …`）⇒ 正则只
 * 收到 `a`。**注意**：`export const a=1,b=2` 与 `export const a=1;
 * const b=2` 的转译产物**逐字相同** ⇒ 文本口径**不可区分** ⇒ 只能回
 * **源 AST** 回收第 2+ 个声明符的名字。
 */





  it("export const a = 1, b = 2 ⇒ a 与 b 都是导出；多声明符的值正确（b = 2）；三个声明符全收；对照：独立声明 + 独立 export 只有 a 是导出（b 不是）；export function / export class 口径不变", () => {
  {
    const exports = runTranspiled_____exec_run_ts(`export const a = 1, b = 2;`, { mode: "exec" });
    expect(Object.keys(exports).sort()).toEqual(["a", "b"]);
  }
  {
    const exports = runTranspiled_____exec_run_ts(`export const a = 1, b = 2;`, { mode: "exec" });
    expect(litValue_____abs_ts(exports["b"] as never)).toEqual({ ok: true, value: 2 });
  }
  {
    const exports = runTranspiled_____exec_run_ts(`export const a = 1, b = 2, c = 3;`, {
      mode: "exec",
    });
    expect(Object.keys(exports).sort()).toEqual(["a", "b", "c"]);
  }
  {
    // 与多声明符的转译产物逐字相同 ⇒ 只有源 AST 能区分二者
    const exports = runTranspiled_____exec_run_ts(`export const a = 1;\nconst b = 2;`, {
      mode: "exec",
    });
    expect(Object.keys(exports)).toEqual(["a"]);
  }
  {
    const exports = runTranspiled_____exec_run_ts(
      `export function f() { return 1; }\nexport class K {}`,
      { mode: "exec" },
    );
    expect(Object.keys(exports).sort()).toEqual(["K", "f"]);
  }
});





});

// ---------------------------------------------------------------------------
// env 模块（CJS 互操作）的 ESM 默认导入
// ---------------------------------------------------------------------------
describe("env 模块（CJS 互操作）的 ESM 默认导入", () => {
/**
 * env 模块（CJS 互操作模块）的 ESM **默认导入**
 * （`import fs from "node:fs"`）此前折 `unknown` ⇒ 导出函数全量降级
 * unknown + **假** `nudo:unknown-inference`（真实原因是绑定没接上，不是
 * 推断失败）+ 门禁**假绿**（exit 0）；而**同一模块**的命名空间导入
 * （`import * as fs`）却正常执法 ⇒ 同一种导入语义两种门禁结论。
 *
 * 根因（core 侧）：`bindImport` 的 `name === "default"` 分支只看
 * `mod.default` 槽；env 表此前**只有具名导出、没有 default 槽** ⇒ 取不到
 * 值 ⇒ 直接折 unknown。
 *
 * core 侧口径（单一事实源 `defaultImportBindingOf`）：
 * - 有 default 槽 ⇒ 用它；
 * - 无 default 槽但表标记了 `interopDefault`（CJS 互操作模块：env 内建
 * 模块的默认导出就是**模块对象本身**，具名导出挂在它上面）⇒ 回退到
 * **命名空间**；
 * - 否则 ⇒ unknown（普通用户模块缺 default ⇒ 就是没有 default，
 * 口径，**不得**回退到命名空间）。
 *
 * 钉：
 * - 互操作表（interopDefault 标记、无 default 槽）的默认导入 ⇒ 绑到命名
 * 空间 ⇒ 成员可调、返回类型可推、throws 面可见（与命名空间导入**同结论**）；
 * - AST env 绑定面（`bindImports`）同口径；
 * - **负控制**：普通用户模块表（无 default 槽、无互操作标记）的默认导入
 * ⇒ 仍是 unknown（修前修后一致）；
 * - **对照**：普通用户模块表**有** default 槽 ⇒ 绑到 default 槽。
 */










/** 假 env 导出：`fs.readFileSync` 形态（返回字符串 + 可能抛 Error） */
const readFileSyncAbs = absFunction_____abs_fn_ts(["p"], {
  apply: () => makeAbsApplyResult(str_____abs_ts(), errorTypeAbs("Error")),
});

/** 互操作模块表：CJS 互操作（default = 模块对象本身），**无**物化 default 槽 */
const INTEROP_MOD: AbsModuleExports = {
  named: { readFileSync: readFileSyncAbs },
  interopDefault: true,
};

/** 普通用户模块表：没有 default 导出，也没有互操作标记（负控制） */
const USER_MOD_NO_DEFAULT: AbsModuleExports = { named: { a: num() } };
/** 普通用户模块表：有 default 导出（对照） */
const USER_MOD_WITH_DEFAULT: AbsModuleExports = { named: { a: num() }, default: str_____abs_ts() };

const SRC_DEFAULT = `import fs from "./m.js";
export function f() { return fs.readFileSync("/x").length; }
`;
const SRC_NAMESPACE = `import * as fs from "./m.js";
export function f() { return fs.readFileSync("/x").length; }
`;

/** 跑一次导出函数，返回「结果形态 / throws 形态」 */
function callSummary(src: string, mod: AbsModuleExports): string {
  const run = runTranspiled_____exec_run_ts(src, { mode: "analyze", modules: { "./m.js": mod } });
  const r = callTranspiledExportFull(run, "f", []);
  return `${formatShape(r.result)} / throws=${formatShape(r.throws)}`;
}

/** AST env 绑定面：import 说明符 → 绑定值（缺绑定 ⇒ undefined） */
function boundValue(src: string, mod: AbsModuleExports): Abs | undefined {
  const file = parseSource(src);
  const env = emptyEnv();
  const stmt = file.program.body[0];
  expect(stmt?.type).toBe("ImportDeclaration");
  bindImports(stmt as never, env, { "./m.js": mod });
  return env.vars.get("fs") as Abs | undefined;
}


  it("互操作表：默认导入绑到命名空间 ⇒ 返回类型可推（不再是 unknown）；互操作表：默认导入与命名空间导入**同结论**（含 throws 面）；互操作表：AST env 绑定面（bindImports）同口径 ⇒ 绑到命名空间；负控制：普通用户模块表缺 default ⇒ 默认导入仍是 unknown；对照：普通用户模块表有 default ⇒ 默认导入绑到 default 槽；对照：互操作表即使带了物化 default 槽，也绑到 default 槽本身；物化 defa", () => {
  {
    // 修复前：unknown / throws=never（env 表没有 default 槽 ⇒ 直接折 unknown）
    expect(callSummary(SRC_DEFAULT, INTEROP_MOD)).toBe("number / throws=Error");
  }
  {
    expect(callSummary(SRC_DEFAULT, INTEROP_MOD)).toBe(
      callSummary(SRC_NAMESPACE, INTEROP_MOD),
    );
  }
  {
    // 修复前：unknown
    const v = boundValue(`import fs from "./m.js";`, INTEROP_MOD);
    expect(v).toBeDefined();
    expect(v!.shape.k).toBe("obj");
    expect(Object.keys(v!.shape.k === "obj" ? (v!.shape.slots ?? {}) : {})).toEqual([
      "readFileSync",
    ]);
  }
  {
    // 修前修后一致（口径：模块表有该 mod 但没有 default ⇒ 没有 default）
    expect(callSummary(SRC_DEFAULT, USER_MOD_NO_DEFAULT)).toBe("unknown / throws=never");
    expect(boundValue(`import fs from "./m.js";`, USER_MOD_NO_DEFAULT)?.shape.k).toBe(
      "unknown",
    );
  }
  {
    const src = `import x from "./m.js"; export function f() { return x; }`;
    expect(callSummary(src, USER_MOD_WITH_DEFAULT)).toBe("string / throws=never");
  }
  {
    const withDefault: AbsModuleExports = {
      named: { a: num() },
      default: str_____abs_ts(),
      interopDefault: true,
    };
    const src = `import x from "./m.js"; export function f() { return x; }`;
    expect(callSummary(src, withDefault)).toBe("string / throws=never");
  }
  {
    const named = { a: num() };
    const materialized: AbsModuleExports = {
      named,
      default: namespaceAbsOf({ named }),
      interopDefault: true,
    };
    const interopOnly: AbsModuleExports = { named, interopDefault: true };
    const src = `import x from "./m.js"; export function f() { return x.a; }`;
    expect(callSummary(src, materialized)).toBe(callSummary(src, interopOnly));
  }
  {
    const emptyInterop: AbsModuleExports = { named: {}, interopDefault: true };
    const src = `import x from "./m.js"; export function f() { return x; }`;
    expect(callSummary(src, emptyInterop)).toBe("unknown / throws=never");
  }
});








});

// ---------------------------------------------------------------------------
// length 有限数值界护栏
// ---------------------------------------------------------------------------
describe("length 有限数值界护栏", () => {
/**
 * `length(...)` 没走 issue-#152 的**有限数值界护栏**：
 * `string().length(NaN)` 造出恒假契约（`length(x) ≥ NaN ∧ ≤ NaN`）
 * ⇒ 每个**合法**字符串实参都被判违反（假红），且零诊断说明契约无效。
 *
 * 修法：`length` 与 gt/ge/lt/le/min/max 同源走 `finiteBoundArg`。
 */








{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  });

  it("length(NaN) / length(±Infinity) 在构造期抛错（不再造恒假契约）；错误文案点名 length() 与实际入参（Nudo 原生，非宿主原文）；合法界仍然通过（3 / 2.5 / 0）；产品面：契约里的 length(NaN) 变成侧车装载失败，不再对合法字符串报假红", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => string().length(NaN)).toThrow(/finite numeric bound expected/);
    expect(() => string().length(Infinity)).toThrow(/finite numeric bound expected/);
    expect(() => string().length(-Infinity)).toThrow(/finite numeric bound expected/);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => string().length(NaN)).toThrow(/nudo length\(\)/);
    expect(() => string().length(NaN)).toThrow(/got NaN/);
    expect(() => string().length(Infinity)).toThrow(/got Infinity/);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => string().length(3)).not.toThrow();
    expect(() => string().length(2.5)).not.toThrow();
    expect(() => string().length(0)).not.toThrow();
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, string } from "@nudojs/core";
export const f = fn({ s: string().length(NaN) }, string());`,
    });
    const src = `
export function f(s) {
  return s;
}
export function g() {
  return f("abc");
}
`;
    const r = checkSource_____index_ts("/t/f.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("finite numeric bound expected");
    // 改前：2 条 nudo:constraint-violated（合法实参 "abc" 判违规 = 假红）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  }
});



}
});

// ---------------------------------------------------------------------------
// length 界的类型校验（非数值界不得静默废掉契约）
// ---------------------------------------------------------------------------
describe("length 界的类型校验（非数值界不得静默废掉契约）", () => {
/**
 * `length(...)` 不校验界的**类型**：`string().length("3")` 这类笔误
 * 把右端写成字符串字面量 ⇒ 执法层「右端非数值 ⇒ 整条分支跳过」⇒ 契约
 * **完全失效**（门禁零诊断 = 假绿）：明显违规的实参一个都不报。
 *
 * 修法：与 gt/ge/lt/le/min/max 同源走 `finiteBoundArg`（构造期拒绝）。
 */








{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();
  });

  it("length(\"3\") / length(null) / length(true) 在构造期抛错；错误文案带引号地展示字符串界（got \"3\"），并点名 length()；产品面：length(\"3\") 的契约不再静默失效（改前 0 error = 假绿）；对照组：合法数值界仍然产出真正的长度约束（length(3) 仍报违例）", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => string().length("3" as unknown as number)).toThrow(
      /finite numeric bound expected/,
    );
    expect(() => string().length(null as unknown as number)).toThrow(
      /finite numeric bound expected/,
    );
    expect(() => string().length(true as unknown as number)).toThrow(
      /finite numeric bound expected/,
    );
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    expect(() => string().length("3" as unknown as number)).toThrow(/nudo length\(\)/);
    expect(() => string().length("3" as unknown as number)).toThrow(/got "3"/);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, string } from "@nudojs/core";
export const f = fn({ s: string().length("3") }, string());`,
    });
    const src = `
export function f(s) {
  return s;
}
export function g() {
  return f("abcd");
}
`;
    const r = checkSource_____index_ts("/t/f.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/f.js" });
    const load = r.issues.find((i) => i.code === "nudo:contract-load");
    expect(load).toBeDefined();
    expect(load!.message).toContain("finite numeric bound expected");
    // 改前：契约完全失效 ⇒ 门禁 0 error（"abcd" 长度 4 > 3 也不报）
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toHaveLength(0);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeContractDiags();


    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, string } from "@nudojs/core";
export const f = fn({ s: string().length(3) }, string());`,
    });
    const src = `
export function f(s) {
  return s;
}
export function g() {
  return f("abcd");
}
`;
    const r = checkSource_____index_ts("/t/f.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/f.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBeGreaterThan(0);
  }
});



}
});

// ---------------------------------------------------------------------------
// lit() 的字面量在签名面保形
// ---------------------------------------------------------------------------
describe("lit() 的字面量在签名面保形", () => {
/**
 * `lit()` 的字面量只活在 **pred** 里（shape 无字面量位）⇒
 * 只看 term / shape 的 widen 路径**永远看不见它** ⇒ 同一份契约**四个面四种答案**：
 *
 * | 面 | 改前 | 改后 |
 * |---|---|---|
 * | 契约面 `nudo contract` | `x: lit(1)` | `x: lit(1)` ✔ |
 * | zod 产物面 | `z.literal(1)` | `z.literal(1)` ✔ |
 * | **dts 产物面** | `f(x: number)` | `f(x: 1)` ✔ |
 * | **check 签名面** | `f(x: number)` | `f(x: 1)` ✔（签名面渲染类型而非契约 DSL）|
 *
 * 改前 dts 面把「x 必须是字面量 1」印成 `number` ⇒ 消费方 tsc 放行违反契约的
 * 调用，而同一份代码 `nudo check` 判红 ⇒ **双门禁对撞**。
 *
 * 修法（**不加 shape 变体** —— 那会动公开 `Shape`）：
 * - core：签名面按 pred 里的字面量域保形（`formatEntryParamShape` 走
 * `formatShape(t, { showLits: true })`）；
 * - service：dts 的**参数位**与返回位同口径（复用已有的 `predLiteralSet`）。
 */




/** 同名侧车：源文件 file.js ⇒ 侧车 file.nudo.js */
function optsWithSidecar(sidecar: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec === "./file.nudo.js" ? sidecar : stdOpts.loadModule(spec),
    fromFile: "/test/file.js",
  };
}

const LIT_SIDE = `
import { fn, lit, number } from "@nudojs/core";
export const f = fn({ x: lit(1) }, number());
`;

const NUM_SIDE = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number() }, number());
`;

const SRC = `export function f(x) { return x; }`;


  it("check 签名面的参数类型保留字面量（改前拓宽成 number）；负控制：裸 number 契约不被改成 lit(...)", () => {
  {
    const r = checkSource_____index_ts("/test/file.js", SRC, pTrue_____index_ts, optsWithSidecar(LIT_SIDE));
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("1");
    expect(sig!.paramTypes?.[0]).not.toBe("number");
  }
  {
    const r = checkSource_____index_ts("/test/file.js", SRC, pTrue_____index_ts, optsWithSidecar(NUM_SIDE));
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig!.paramTypes?.[0]).toBe("number");
  }
});


});

// ---------------------------------------------------------------------------
// 多条 return 契约
// ---------------------------------------------------------------------------
describe("多条 return 契约", () => {
/**
 * 回归：多条 `@nudo:contract return` 段只执法**第一条** ⇒ 违反第 2 条
 * 时 0 error / exit 0（**加一条契约反而让门禁变绿**）。
 *
 * 修法（不改公开返回型，仍是**单条**返回槽）：在 `refine.ts` 的 return 段
 * 提取里把多条 return 段**合成单条合取**——语义 = 合取，与形参位「同形参多
 * 段取合取」的既有语义一致（`contract.ts` 的 `conjoinOrConflict` → `andC`）。
 */






beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

const STD = `
import { number } from "@nudojs/core";
export const positive = number().gt(0);
export const small = number().lt(10);
`;

const MULTI = `
/// @nudo:import { positive, small } from "./std.nudo.js"
/**
 * @nudo:contract return positive
 * @nudo:contract return small
 */
export function f(x) {
  return 100;
}
`;

const SINGLE = `
/// @nudo:import { small } from "./std.nudo.js"
/**
 * @nudo:contract return small
 */
export function f(x) {
  return 100;
}
`;


  it("合成**单条**合取（返回槽仍是单条）；违反**第 2 条**段也被执法（旧口径只执法第一条）；满足全部段时不报错；单条 return 段语义不变（名字不变、约束不变）", () => {
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(MULTI, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    expect(ret!.name).toBe("positive ∧ small");
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(MULTI, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    const proof = assertImplies(absLit(100), ret!.constraint);
    expect(proof.status).toBe("disproved");
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(MULTI, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    const proof = assertImplies(absLit(5), ret!.constraint);
    expect(proof.status).toBe("proved");
  }
  {
  setRefineDiagCollector(null);
  takeRefineDiags();


    const { loadModule } = makeFiles({ "/t/std.nudo.js": STD });
    const ret = extractRefineReturnFromSource(SINGLE, "f", {
      loadModule,
      fromFile: "/t/f.js",
    });
    expect(ret).toBeDefined();
    expect(ret!.name).toBe("small");
    const proof = assertImplies(absLit(100), ret!.constraint);
    expect(proof.status).toBe("disproved");
  }
});




});

// ---------------------------------------------------------------------------
// bigint 字面量保 n 后缀
// ---------------------------------------------------------------------------
describe("bigint 字面量保 n 后缀", () => {
/**
 * bigint 字面量丢 n 后缀 ⇒ 诊断文本里 10n 与 10 不可区分。
 *
 * `String(10n) === "10"` ⇒ `lit(10n)` 渲染成 `lit(10)`（读起来是 number
 * 字面量 10 —— 另一条契约）。修法：展示面（`termToString` /
 * `contract.ts` 的 `litToString`）保 n 后缀，与 `format.ts` 的 prim bigint
 * 渲染同口径；**键通道**（`litKeyString`）不动——那里 bigint 靠 typeof
 * 前缀分开。
 */








{
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("termToString：bigint 保 n 后缀，number 不受影响；诊断文本：lit(10n) 与 lit(10) 可区分", () => {
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();


    expect(termToString(lit_____index_ts(10n))).toBe("10n");
    expect(termToString(lit_____index_ts(10))).toBe("10");
    expect(termToString(lit_____index_ts(0n))).toBe("0n");
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();


    const { loadModule } = makeFiles({
      "/t/big.nudo.js": `import { fn, lit } from "@nudojs/core";\nexport const g = fn({ n: lit(10n) }, lit(10n));`,
    });
    const src = `export function g(n) { return 10; }`;
    const r = checkSource_____index_ts("/t/big.js", src, pTrue_____index_ts, {
      loadModule,
      fromFile: "/t/big.js",
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated).toHaveLength(1);
    expect(violated[0]!.message).toContain("lit(10n)");
    expect(violated[0]!.message).not.toContain("lit(10)");
  }
});

}
});

// ---------------------------------------------------------------------------
// 赋值记录 prev 是裸宿主值 ⇒ 判定层不得抛（整轮门禁不得腰斩）
// ---------------------------------------------------------------------------
describe("赋值记录 prev 是裸宿主值 ⇒ 判定层不得抛（整轮门禁不得腰斩）", () => {
/**
 * 回归：赋值记录通道的 `prev` 可能是**裸宿主值**（不是 Abs）。
 *
 * 机制：env 全局以 `let k = __nudoEnv[k]` 注入，其中**构造器 / 函数型全局**
 * （parseInt / String / Promise / setTimeout …）在 env 里是**裸宿主函数**
 * （不是 Abs）。顶层 `let g = parseInt;` 于是把裸宿主函数存进 g；转译层
 * 插桩把绑定变量的**原始运行时值**当 `prev` 传给 `$assignRecord`
 * ⇒ `structuralAssignIssues` 的 `if (!r.prev) continue` 只挡 undefined/null，
 * 挡不住「真值但不是 Abs」⇒ `r.prev.shape.k` 抛 TypeError
 * ⇒ **整轮 `nudo check` 被腰斩**（排在崩溃文件之后的源文件根本不被检查）。
 *
 * 修法（check-assign.ts / structuralAssignIssues）：读 `.shape` 前先过
 * `isAbsLike` 闸；非 Abs 载荷**无信息可比** ⇒ fail-closed 跳过（不判、不崩）。
 */







/** 顶层绑定先取 env 全局（裸宿主函数）再被重赋值 —— 的触发形态 */
const ENV_GLOBAL_REASSIGN = [
  "let g = parseInt;",
  "g = 1;",
  "export function f() {",
  "  return g;",
  "}",
].join("\n");

/** 排在崩溃文件之后的文件：必须仍然被检查（整轮不被腰斩的证据） */
const AFTER_CRASH = [
  "let n = 1;",
  'n = "str";',
  "export function useN() {",
  "  return n;",
  "}",
].join("\n");

/** 判定层单测用的记录：prev 槽塞裸宿主值（无 shape / conf） */
function recordWithHostPrev(): AbsAssignRecord {
  return {
    name: "g",
    prev: parseInt as unknown as Abs,
    next: abs_____abs_ts({ k: "prim", type: "number" }, undefined, undefined, "exact"),
    line: 2,
  } as AbsAssignRecord;
}


  it("产品面：顶层 env 全局重赋值 ⇒ checkSource 不抛；产品面：其它 env 全局（构造器 / Promise）同样不抛；整轮门禁不被腰斩：排在崩溃文件之后的文件仍被检查并出诊断；判定层：prev 是裸宿主值 ⇒ 不抛、不报（fail-closed）；原生语义未变：重赋值后 g 就是 1；控制组：Abs↔Abs 的标量改型仍报 nudo:assign-mismatch（守卫未吃掉通道信号）", () => {
  {
    let report: ReturnType<typeof checkSource_____index_ts> | undefined;
    expect(() => {
      report = checkSource_____index_ts("bug-368-env.js", ENV_GLOBAL_REASSIGN, pTrue_____index_ts, {
        entryThrows: "off",
      });
    }).not.toThrow();
    expect(report).toBeDefined();
    // fail-closed：宿主值无信息可比 ⇒ 不产生 assign-mismatch（但不崩）
    expect(
      (report?.issues ?? []).filter((i) => i.code === "nudo:assign-mismatch"),
    ).toEqual([]);
  }
  {
    for (const g of ["String", "Number", "Promise", "setTimeout", "isNaN"]) {
      const src = `let g = ${g};\ng = 1;`;
      expect(() => {
        checkSource_____index_ts(`bug-368-${g}.js`, src, pTrue_____index_ts, { entryThrows: "off" });
      }).not.toThrow();
    }
  }
  {
    const seen: string[] = [];
    let aborted = false;
    for (const [name, src] of [
      ["a-crash.js", ENV_GLOBAL_REASSIGN],
      ["b-after.js", AFTER_CRASH],
    ] as const) {
      if (aborted) {
        seen.push(`${name}:NOT-CHECKED`);
        continue;
      }
      try {
        const r = checkSource_____index_ts(name, src, pTrue_____index_ts, { entryThrows: "off" });
        seen.push(`${name}:CHECKED:${r.issues.map((i) => i.code).join(",")}`);
      } catch {
        aborted = true;
        seen.push(`${name}:THREW`);
      }
    }
    expect(seen[0]).toMatch(/^a-crash\.js:CHECKED:/);
    expect(seen[1]).toBe("b-after.js:CHECKED:nudo:assign-mismatch");
  }
  {
    let out: ReturnType<typeof structuralAssignIssues> = [];
    expect(() => {
      out = structuralAssignIssues([recordWithHostPrev()]);
    }).not.toThrow();
    expect(out).toEqual([]);
  }
  {
    const v = val(ENV_GLOBAL_REASSIGN);
    expect(v.ok).toBe(true);
    expect(v.ok ? v.value : undefined).toBe(1);
  }
  {
    const r = checkSource_____index_ts("bug-368-control.js", AFTER_CRASH, pTrue_____index_ts, {
      entryThrows: "off",
    });
    const mismatch = r.issues.filter((i) => i.code === "nudo:assign-mismatch");
    expect(mismatch.length).toBe(1);
    expect(mismatch[0].severity).toBe("error");
    expect(mismatch[0].message).toBe("n: assignment ⊭ existing shape");
  }
});






});

// ---------------------------------------------------------------------------
// eq ⇒ 序关系 / 对称（implies 读侧）
// ---------------------------------------------------------------------------
describe("eq ⇒ 序关系 / 对称（implies 读侧）", () => {
/**
 * 回归：`implies` 缺「**等式 ⇒ 序关系 / 对称**」规则。
 *
 * 根因（实测）：`packages/core/src/algebra/pred.ts` 的 `implies` 只有序关系之间
 * 的传递/代数恒等式与 `predEquals` 逐原子比对，**没有**这条规则：
 * `x === y` ⇒ `x <= y` ∧ `x >= y`（`===` 排除 NaN ⇒ 等值必然不小于也不大于），
 * `x === x` ⇒ `x <= x`（x 非 NaN）。⇒ `a === b` 前提**消解不掉** `a <= b`
 * 的分支可达性 ⇒ 恒假分支被算成可达 ⇒ 签名多出一个可能值。
 *
 * 症状（产品面）：`nudo check` 的签名 `f(a: any, b: any) => 1 | 2 | 3`
 * （应为 `1 | 3`）——`if (a === b) { if (a <= b) return 1; return 2; }` 的
 * `return 2` 是死分支。
 *
 * 口径：等式事实与目标**同一对项**（无序匹配——`x === y` 同时给出
 * `x <= y` 与 `y <= x`）。**不含** `lt` / `gt`：等值不蕴含严格序
 * （`x === y` 时 `x < y` 为假——这条由「蕴含否定」侧折叠成 false）。
 */








const x = v("x");
const y = v("y");
const z = v("z");

/** 签名里的可能值集合（排序后比较——join 顺序不稳定） */
function sigValues(display: string): string[] {
  // ⚠ `display` 自此是人类面口径的 shape 渲染（不再带 `#conf` 段）
  // ⇒ throws 后缀改用空格切（此前靠 ` #` 切掉）
  return display
    .split(/\s+throws\s+/)[0]!
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
}


  it("eq(x,y) ⇒ le(x,y) ∧ ge(x,y)；eq(x,y) ⇒ eq(y,x)（对称）；eq(x,x) ⇒ le(x,x) ∧ ge(x,x)（重言式：x === x ⇒ x 非 NaN）；反向不成立：eq(x,y) ⇏ lt(x,y) ∧ gt(x,y)（等值不含严格序）；无关项不成立：eq(x,x) ⇏ le(x,y)；比较折叠：a === b 前提下 `a <= b` 折 true、`a < b` 折 false；产品面：a === b 分支内的 `a <=", () => {
  {
    expect(implies(eq(x, y), le(x, y))).toBe(true);
    expect(implies(eq(x, y), ge(x, y))).toBe(true);
  }
  {
    expect(implies(eq(x, y), eq(y, x))).toBe(true);
  }
  {
    expect(implies(eq(x, x), le(x, x))).toBe(true);
    expect(implies(eq(x, x), ge(x, x))).toBe(true);
  }
  {
    expect(implies(eq(x, y), lt(x, y))).toBe(false);
    expect(implies(eq(x, y), gt(x, y))).toBe(false);
  }
  {
    expect(implies(eq(x, x), le(x, y))).toBe(false);
    expect(implies(eq(x, y), le(x, z))).toBe(false);
  }
  {
    const a = abs_____abs_ts({ k: "any" }, x, undefined, "exact");
    const b = abs_____abs_ts({ k: "any" }, y, undefined, "exact");
    expect(formatAbs_____format_format_ts(cmp("le", a, b, eq(x, y)))).toMatch(/^true\b/);
    expect(formatAbs_____format_format_ts(cmp("ge", a, b, eq(x, y)))).toMatch(/^true\b/);
    // a === b ⇒ ¬(a < b)
    expect(formatAbs_____format_format_ts(cmp("lt", a, b, eq(x, y)))).toMatch(/^false\b/);
  }
  {
    const r = issuesOf(
      `
export function f(a, b) {
  if (a === b) {
    if (a <= b) return 1;
    return 2;
  }
  return 3;
}
`,
      "/t/bug-387.js",
    );
    expect(sigValues(sigOf(r, "f"))).toEqual(["1", "3"]);
  }
  {
    const r = issuesOf(
      `
export function control(a, b) {
  if (a === b) {
    if (a === b) return 1;
    return 2;
  }
  return 3;
}
`,
      "/t/bug-387.js",
    );
    expect(sigValues(sigOf(r, "control"))).toEqual(["1", "3"]);
  }
});








});

// ---------------------------------------------------------------------------
// env 门禁不得吞掉 unknown-inference
// ---------------------------------------------------------------------------
describe("env 门禁不得吞掉 unknown-inference", () => {
/**
 * 一个**没生效**的 `@nudo:env` 指令会把唯一能提示「推断失败」的
 * `nudo:unknown-inference` **警告降级成 `nudo:opaque-result` 信息**。
 *
 * 根因：env 门禁（`generalize.ts` 的 `envGatedSource`）按**源码文本**判定
 * ⇒ env 名拼错时函数体 fail-closed ⇒ 符号面 `conf = opaque` ⇒ `check.ts` 的
 * `budgetExplained` 因 `conf === "opaque"` 成立 ⇒ **「推断失败」的警告被吞**，
 * 取而代之的是一条把它引向 `@nudo:case` 的 info（指错方向）。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：门禁的事实（`envGated`）要让诊断层
 * 看得见 ⇒ `budgetExplained` 不得把「因 env 门禁而 opaque」当作「已解释」，
 * 且那条 opaque-result info 对 env 门禁的函数不再发（正确信号是
 * `nudo:unknown-inference` warning）。
 *
 * 反向钉：HEAD（未修）上 env 门禁的函数只发 `nudo:opaque-result` ⇒ 本文件在
 * HEAD 上**必失败**。
 */





const PLAIN = `export function toBuf(s){ return Buffer.from(s); }\n`;
const ENV_BOGUS = `/// @nudo:env bogus\nexport function toBuf(s){ return Buffer.from(s); }\n`;

function codesOf(src: string): string[] {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  // CLI 同口径：文件声明的 env 名 → envGlobals 注入；bogus 解析不出全局 ⇒ 空
  const r = checkSource("/t/toBuf.js", src, pTrue, { inject: { envGlobals: {} } });
  return r.issues.map((i) => i.code);
}


  it("env 名拼错（没解析出全局）⇒ 发 nudo:unknown-inference 警告；env 名拼错 ⇒ 不再发指错方向的 nudo:opaque-result 信息；对照组：没有 env 指令 ⇒ 仍然是 unknown-inference 警告（口径不变）", () => {
  {
    const codes = codesOf(ENV_BOGUS);
    expect(codes).toContain("nudo:unknown-inference");
  }
  {
    const codes = codesOf(ENV_BOGUS);
    expect(codes).not.toContain("nudo:opaque-result");
  }
  {
    const codes = codesOf(PLAIN);
    expect(codes).toContain("nudo:unknown-inference");
    expect(codes).not.toContain("nudo:opaque-result");
  }
});



});

// ---------------------------------------------------------------------------
// leqAbs 的字面量同一性按 SameValue（Object.is）判定
// ---------------------------------------------------------------------------
describe("leqAbs 的字面量同一性按 SameValue（Object.is）判定", () => {
/**
 * 回归：`leqAbs` 的**字面量同一性**必须按 **SameValue**（`Object.is`）
 * 判定，而不是 `===`。
 *
 * 根因（实测）：`packages/core/src/algebra/leq.ts` 的注释写明「SameValue」，
 * 实现却是 `sv === tv || (NaN 特例)` ⇒ JS 的 `===` 认为 `0 === -0` 为 **true**
 * ⇒ `lit(-0)` 与 `lit(0)` 互相「满足」⇒ **精确期望被静默放宽**
 * （native `Object.is(0, -0) === false`）。
 *
 * 症状（产品面）：`@nudo:case "nz" () => -0` 期望 -0、实现给 0 ⇒ 断言**假绿**
 * （`nudo test` 报 `[ok]`）；service 层的 case 对账走的正是这个 `leqAbs`
 * 判定 ⇒ 期望值与实际值都被判「满足」。
 *
 * 口径：SameValue 同时覆盖 NaN ≡ NaN（`===` 对 NaN 为 false ⇒ 赋值同一性
 * 不可用 `===`），并把 `0` 与 `-0` 判为**不同**。
 */







/** 数字字面量 Abs（term 保留 -0 的符号） */
function numLit(value: number) {
  return abs_____abs_ts({ k: "prim", type: "number" }, lit(value), undefined, "exact");
}


  it("lit(-0) ⊭ lit(0)（Object.is(0, -0) === false）；lit(0) ⊭ lit(-0)（反向同样不满足）；NaN ≡ NaN（SameValue：=== 对 NaN 为 false，赋值同一性不可用 ===）；同值字面量仍可赋值（0 ≡ 0、1 ≡ 1、-1 ≡ -1）；不同字面量仍不可赋值（1 ⊭ 2）；case 期望面：实现给 +0、期望 -0 ⇒ 不是同一个值（service 层对账用的就是这个判定）", () => {
  {
    const r = leqAbs(numLit(-0), numLit(0));
    expect(r.ok).toBe(false);
    // 失败原因里 -0 与 0 必须可区分（String(-0) 是 "0" ⇒ 用 litText 渲染）
    expect(r.reason).toContain("-0");
  }
  {
    const r = leqAbs(numLit(0), numLit(-0));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("-0");
  }
  {
    expect(leqAbs(numLit(NaN), numLit(NaN)).ok).toBe(true);
  }
  {
    expect(leqAbs(numLit(0), numLit(0)).ok).toBe(true);
    expect(leqAbs(numLit(1), numLit(1)).ok).toBe(true);
    expect(leqAbs(numLit(-1), numLit(-1)).ok).toBe(true);
  }
  {
    expect(leqAbs(numLit(1), numLit(2)).ok).toBe(false);
  }
  {
    const r = call("export function f() { return 0; }", "f", []);
    const actual = litValue_____abs_ts(r.result);
    expect(actual.ok).toBe(true);
    const actualValue = actual.ok ? actual.value : undefined;
    expect(Object.is(actualValue, -0)).toBe(false);
    expect(Object.is(actualValue, 0)).toBe(true);
    // 期望（-0）对实际（+0）：SameValue 下不满足
    expect(leqAbs(numLit(actualValue as number), numLit(-0)).ok).toBe(false);
  }
});






});

// ---------------------------------------------------------------------------
// @nudo:mock-module payload accepts single quotes
// ---------------------------------------------------------------------------
describe("@nudo:mock-module payload accepts single quotes", () => {
/**
 * 文件级 `@nudo:mock-module 'x' from './y.js'`（**单引号**）被
 * **静默丢弃**：无 mock、无诊断、门禁绿灯。
 *
 * 根因（core 载荷文法）：`parseMockModulePayload` 的两条正则**硬编码双引号**
 * ⇒ 单引号载荷两条都不匹配 ⇒ 返回 `undefined` ⇒ 上游（parser
 * `collectFileDirectives`）**既不落诊断也不落记录** ⇒ 指令静默蒸发
 * （mock 不生效、门禁照常绿）。
 *
 * 本钉锁：单引号 / 混合引号都必须被认（与函数级 `@nudo:mock x from 'path'`
 * 同口径）；真正畸形的载荷仍被拒（零假阳性）。
 */




  it("single-quoted full form is parsed；single-quoted named form is parsed；mixed quote kinds are parsed (source and path may differ)；double-quoted form keeps working (control)；file-level extraction keeps the single-quoted record (was silently dro", () => {
  {
    expect(parseMockModulePayload("'axios' from './mocks/v-axios.js'")).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
  }
  {
    expect(parseMockModulePayload("'axios' { a, b } from './mocks/v-axios.js'")).toEqual({
      source: "axios",
      names: ["a", "b"],
      fromPath: "./mocks/v-axios.js",
    });
  }
  {
    expect(parseMockModulePayload(`"axios" from './mocks/v-axios.js'`)).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
    expect(parseMockModulePayload(`'axios' from "./mocks/v-axios.js"`)).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
  }
  {
    expect(parseMockModulePayload(`"axios" from "./mocks/v-axios.js"`)).toEqual({
      source: "axios",
      fromPath: "./mocks/v-axios.js",
    });
  }
  {
    expect(
      extractMockModuleRecords(
        `/// @nudo:mock-module 'axios' from './415-mock.js'\nimport axios from "axios";\n`,
      ),
    ).toEqual([{ source: "axios", fromPath: "./415-mock.js" }]);
  }
  {
    expect(
      extractMockModuleRecords(
        `/// @nudo:mock-module 'axios' from './m.js'\n/// @nudo:mock-module "vue" from "./m.js"\n`,
      ).map((r) => r.source),
    ).toEqual(["axios", "vue"]);
  }
  {
    expect(parseMockModulePayload("axios from ./m.js")).toBeUndefined();
    expect(parseMockModulePayload(`"axios"`)).toBeUndefined();
    expect(parseMockModulePayload(`"axios" from`)).toBeUndefined();
  }
});







});

// ---------------------------------------------------------------------------
// 多声明符 const：语句级 JSDoc 只绑首个 declarator
// ---------------------------------------------------------------------------
describe("多声明符 const：语句级 JSDoc 只绑首个 declarator", () => {
/**
 * 一个 JSDoc 被绑到多声明符 `const` 的**每一个** declarator 上
 * （TS 地真：只绑**首个**）→ 一条见证被重放 N 次。
 *
 * 根因（`directive-scan.ts` 的 `VariableDeclaration` 分支）：语句级
 * `leadingComments` 被**逐个** declarator 复制给各自建出的 scope ⇒
 * `const a = () => 1, b = () => 2` 上的 `@nudo:case "shared"` 同时落在 `a`
 * 与 `b` 上 ⇒ `nudo test` 打出**重复的 case 名**（见证重放）。
 *
 * 修法：语句级 JSDoc **只绑首个 declarator**（TS 口径）；其余 declarator
 * 只认自己的**内联**注释。
 */



const MULTI = `/**
 * @nudo:case "shared" (1)
 */
const a = () => 1, b = () => 2;
export { a, b };
`;

const MULTI_INLINE_SECOND = `const a = () => 1, b = /** @nudo:case "own" (2) */ () => 2;
export { a, b };
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource_____index_ts(src));
}

function scopeNamed(src: string, name: string) {
  return scopesOf(src).find((s) => s.name === name);
}


  it("见证只落在首个 declarator 上（不再重放到 b）；每个 declarator 只建一个 scope（不再多出 <anonymous> 影子）；第二个 declarator 的内联注释仍归它自己；单声明符形态不受影响（见证仍可见）", () => {
  {
    const a = scopeNamed(MULTI, "a");
    const b = scopeNamed(MULTI, "b");
    expect(a?.commentLines).toContain('@nudo:case "shared" (1)');
    expect(b?.commentLines ?? []).toEqual([]);
  }
  {
    const names = scopesOf(MULTI).map((s) => s.name);
    expect(names).toEqual(["a", "b"]);
    expect(names.filter((n) => n === "<anonymous>")).toEqual([]);
  }
  {
    const b = scopeNamed(MULTI_INLINE_SECOND, "b");
    expect(b?.commentLines).toContain('@nudo:case "own" (2)');
    const a = scopeNamed(MULTI_INLINE_SECOND, "a");
    expect(a?.commentLines ?? []).toEqual([]);
  }
  {
    const only = `/**
 * @nudo:case "solo" (1)
 */
const a = () => 1;
export { a };
`;
    expect(scopeNamed(only, "a")?.commentLines).toContain('@nudo:case "solo" (1)');
  }
});




});

// ---------------------------------------------------------------------------
// 生成段归属：用户自己的 const 不并入段内链
// ---------------------------------------------------------------------------
describe("生成段归属：用户自己的 const 不并入段内链", () => {
/**
 * `@generated` 段的**归属判定**用「向上回溯到上一条非 import/非 const
 * 语句」的启发式：**手写**侧车段被误判为**生成段** → 「手写优先」保护被静默绕过。
 *
 * 旧判据把**任何**紧邻的 `const` 都算段内 ⇒ 用户自己的 `const` 夹在上一段的
 * `@generated` 头与本段 export 之间时，上一段的头落进本段的 region ⇒ 手写段被
 * 判成生成段（连带触发 的数据丢失：emit 侧整段覆盖手写契约）。
 *
 * 修法（`scan-named-exports.ts` 的 `sectionChainIndices`）：段内链里的 const 只有
 * **被该 export 引用**时才属段内（组合式 §5.3 的 prelude const / 多步 prelude
 * 的中间量 / DESIGN-003 的别名绑定 const）—— 引用集合按链**传递闭包**扩展。
 *
 * ⇒ 合法生成段（别名段 / 组合式 / 多步 prelude / 头紧贴 export）**一个都不许
 * 误伤**（本文件后半段钉住）。
 */




  it("真 @generated 标记 + 中间夹无关 const ⇒ 手写 export 不是生成段；夹的 const 若**被 export 引用** ⇒ 仍属段内（判据是引用，不是位置）；无标记 ⇒ 不是生成段（对照）；合法：别名段（DESIGN-003，段内夹 const）仍认得出；合法：组合式下行段（§5.3，段内夹 prelude const）仍认得出；合法：多步 prelude（中间量只被后一步引用）仍认得出；合法：头紧贴 export 仍认得出；合法：头 + impo", () => {
  {
    const sidecar = `import { fn, number } from "@nudojs/core";
// @generated by nudo — do not edit
const helper = 1;
export const area = fn({ x: number().gt(0) }, number());
`;
    expect([...generatedExportNames(sidecar)]).toEqual([]);
  }
  {
    const sidecar = `import { fn, number } from "@nudojs/core";
// @generated by nudo — do not edit
const helper = 1;
export const area = fn({ x: number().gt(0) }, helper);
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["area"]);
  }
  {
    const sidecar = `import { fn, number } from "@nudojs/core";
const helper = 1;
export const area = fn({ x: number().gt(0) }, number());
`;
    expect([...generatedExportNames(sidecar)]).toEqual([]);
  }
  {
    const sidecar = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:class
const _nudo_1 = fn({ x: number() }, number());
export { _nudo_1 as class };
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["class"]);
  }
  {
    const sidecar = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: add.js:add2
import { positive } from "./std.nudo.js";

const x = positive.shift(1);
export const add2 = fn({ x }, x.shift(2));
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["add2"]);
  }
  {
    const sidecar = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
import { positive } from "./std.nudo.js";

const x_0 = positive.shift(1);
const x_1 = x_0.shift(2);
export const add2 = fn({ x: x_1 }, x_1.shift(2));
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["add2"]);
  }
  {
    const sidecar = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:f
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["f"]);
  }
  {
    const sidecar = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["f"]);
  }
});



  // ---- 合法生成段：一个都不许误伤 ----






});

// ---------------------------------------------------------------------------
// 裸 lit(null) / lit(undefined) 契约：唯一允许值放行、其余值判违例
// ---------------------------------------------------------------------------
describe("裸 lit(null) / lit(undefined) 契约：唯一允许值放行、其余值判违例", () => {
/**
 * 形参契约写成 `lit(null)` / `lit(undefined)` ⇒ 引擎把**自己的字面量**
 * 判成违例，诊断文本**自相矛盾**（`actual: null` / `expected: x = null` 却报 ⊭）
 * ⇒ L1 门禁**假红**。
 *
 * 现状：**假阳性** —— 症状已被族 06（，commit `e2880fd6`）修掉：
 * `scan/literal-preds.ts` 的 `predEqNullish` / `nullishKindOf` + `scan/literal-shapes.ts`
 * 的 **nullish eq 分支**（排在「确定 undefined」臂**之前**）⇒
 * **唯一允许值放行、其余值判违例**。本钉把这条行为钉死（**不改实现**）。
 *
 * ── 形态分清（本钉只钉「裸字面量形态」）──────────────────────────────
 *
 * | 形态 | 契约长什么样 | 执法通道 | 归属 |
 * |---|---|---|---|
 * | **裸字面量** | 契约**自身**就是 `lit(null)` / `lit(undefined)` | 单条 **eq 原子** | **本钉（434）** |
 * | union / nullable | 契约**含** nullish **成员**（`members[]`） | **or 析取**分支 | （族 11 · S1 在修） |
 *
 * ⇒ 两条形态走**不同通道**、症状相反（434 假红 vs 429 双向反了）⇒ 本钉
 * **只**断言裸字面量形态的执法结果；union / nullable 形态的执法结果**故意不钉**
 * （在途修复会改它，钉了就是耦合中间形态），只断言两种形态的**契约结构**可分
 * （第二个 describe）。
 */





const SIDE = `import { lit } from "@nudojs/core";
export const onlyNull = lit(null);
export const onlyUndef = lit(undefined);
`;

const IMP = `/// @nudo:import { onlyNull, onlyUndef } from "./std434.nudo.js"\n`;

const FILE = "/t/std434.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  return checkSource___nudojs_core(FILE, IMP + src, pTrue___nudojs_core, sidecarOpts("std434", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated）条数 */
function violated(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: "onlyNull" | "onlyUndef", arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return 1; }
export function use() { return f(${arg}); }`;
}


  it("lit(null) 契约收到 null ⇒ 放行（零诊断；改前是假红）；lit(undefined) 契约收到 undefined ⇒ 放行（零诊断；改前是假红）；lit(null) 契约收到 0 ⇒ 判违例，expected 指向 x = null；lit(null) 契约收到 'a' ⇒ 判违例；lit(undefined) 契约收到 0 ⇒ 判违例，expected 指向 x = undefined；null 与 undefined 是**两个域**：lit(null)", () => {
  {
    const r = check(call("onlyNull", "null"));
    expect(violated(r)).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
    const r = check(call("onlyUndef", "undefined"));
    expect(violated(r)).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  }
  {
    const r = check(call("onlyNull", "0"));
    expect(violated(r)).toBe(1);
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue?.expected).toBe("x = null");
    expect(issue?.actual).toContain("0");
  }
  {
    const r = check(call("onlyNull", '"a"'));
    expect(violated(r)).toBe(1);
  }
  {
    const r = check(call("onlyUndef", "0"));
    expect(violated(r)).toBe(1);
    const issue = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(issue?.expected).toBe("x = undefined");
  }
  {
    const r = check(call("onlyNull", "undefined"));
    expect(violated(r)).toBe(1);
  }
  {
    const r = check(call("onlyUndef", "null"));
    expect(violated(r)).toBe(1);
  }
  {
    const r = check(`export function f(x) { return 1; }
export function use() { return f(0); }`);
    expect(violated(r)).toBe(0);
  }
});









describe("形态分清 —— 裸字面量形态（434）vs union / nullable 形态（429）", () => {
  it("裸 lit(null)：契约**自身**是一条 eq 原子（无成员）；裸 lit(undefined)：契约**自身**是一条 eq 原子（无成员）；nullable(number())：nullish 是**成员**（members[]），不是契约自身；union(lit(null), number())：nullish 是**成员**（members[]），不是契约自身", () => {
  {
    const c = litC___nudojs_core(null);
    expect(c.members ?? []).toHaveLength(0);
    expect(c.preds).toHaveLength(1);
    expect(c.preds[0]?.op).toBe("eq");
  }
  {
    const c = litC___nudojs_core(undefined);
    expect(c.members ?? []).toHaveLength(0);
    expect(c.preds).toHaveLength(1);
    expect(c.preds[0]?.op).toBe("eq");
  }
  {
    const c = nullable(number___nudojs_core());
    expect(c.preds).toHaveLength(0);
    expect(c.members ?? []).toHaveLength(3);
  }
  {
    const c = union___nudojs_core(litC___nudojs_core(null), number___nudojs_core());
    expect(c.preds).toHaveLength(0);
    expect(c.members ?? []).toHaveLength(2);
  }
});



});
});

// ---------------------------------------------------------------------------
// 生成标记只认 nudo 自己写的段头
// ---------------------------------------------------------------------------
describe("生成标记只认 nudo 自己写的段头", () => {
/**
 * 侧车里的**手写契约**只因**注释里出现了 `@generated` 这个词元**就被
 * 判定为「生成段」 ⇒ ① 它的 **L1 义务整体消失**（调用点违例不报、exit 0 ⇒
 * 假绿）；② 契约面误标 `[generated]`；③ `nudo contract --emit` 整段覆盖用户手写
 * 契约（的数据丢失）。
 *
 * 根因：标记判定是**裸子串** `/@generated/`。用户**引用**nudo 的提示语（正面或
 * 反面）就会被误判。⇒ 标记必须是 **nudo 自己写的段头**：注释的**首个记号**是
 * `@generated`，且标注文本点名 nudo（`@generated by nudo …`）。
 *
 * 口径：core `scan-named-exports.ts` / service `contract-derivation-emit.ts` /
 * service `contract-emitter.ts` 三处**同源实现**（跨包一致性由 service 侧的
 * `core--generated-marker-parity.part.ts` 钉住）。
 */



const HANDWRITTEN = `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) });
`;


  it("行注释里**提到** @generated ⇒ 不是生成标记；块注释里**提到** @generated ⇒ 不是生成标记；注释**以** @generated 开头但不是 nudo 的段头 ⇒ 不是生成标记；代码行尾的 @generated ⇒ 不是生成标记（标记必须是独立行）；nudo 段头（完整形）⇒ 是生成标记；nudo 段头（短形 `— do not edit`）⇒ 是生成标记；nudo 段头（最短形 `by nudo`）⇒ 是生成标记；手写契约（无任何标记）⇒ 不", () => {
  {
    const sidecar = `import { fn, number } from "@nudojs/core";
// 手写契约：这里提到了 @generated 这个词
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual([]);
  }
  {
    const sidecar = `import { fn, number } from "@nudojs/core";

/**
 * Handwritten contract — this is NOT a @generated block, keep it as is.
 */
export const scale = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual([]);
  }
  {
    const sidecar = `import { fn, number } from "@nudojs/core";
// @generated 这个词是 nudo 的段头标记，别抄
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual([]);
  }
  {
    const sidecar = `import { fn, number } from "@nudojs/core";
const helper = 1; // @generated by nudo
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual([]);
  }
  {
    const sidecar = `// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
// source: lib.js:f
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["f"]);
  }
  {
    const sidecar = `import { fn, number } from "@nudojs/core";
// @generated by nudo — do not edit
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["f"]);
  }
  {
    const sidecar = `// @generated by nudo
export const f = fn({ x: number().gt(0) });
`;
    expect([...generatedExportNames(sidecar)]).toEqual(["f"]);
  }
  {
    expect([...generatedExportNames(HANDWRITTEN)]).toEqual([]);
  }
});




  // ---- nudo 自己写的段头：一个都不许漏 ----





});

// ---------------------------------------------------------------------------
// 跨文件 default 导入的契约执法
// ---------------------------------------------------------------------------
describe("跨文件 default 导入的契约执法", () => {
/**
 * `export default` 函数的侧车契约在**跨文件调用点**完全不执法
 * ⇒ L1 契约假绿（`calc(-1)` 违反 `x > 0`，CI 门禁放行）——而具名导出 /
 * 命名空间导入 / CJS require / 重命名导入四种形态都执法。
 *
 * 根因：`ImportDefaultSpecifier` 把被调名写死成**导出名** `"default"`，
 * 而契约绑定面（contract.ts）以**本地声明名**为键（`exports[fnName]`）⇒
 * 具名侧车永远绑不上。
 *
 * 钉住：跨文件 default 导入的调用点按被调方的**本地声明名**解析 ⇒
 * - `export default function calc` + 侧车 `export const calc = fn(…)` → 执法
 * - `export { calc as default }` + 同侧车 → 执法
 * - 侧车写 `export default fn(…)` → 仍然执法（不回归）
 * - 具名导入（对照）→ 仍然执法
 */





const SIDECAR_NAMED = `import { fn, number } from "@nudojs/core";
export const calc = fn({ x: number().gt(0) }, number());
`;

const SIDECAR_DEFAULT = `import { fn, number } from "@nudojs/core";
export default fn({ x: number().gt(0) }, number());
`;

const SRC_DEFAULT_FN = `export default function calc(x) { return x + 1; }`;
const SRC_EXPORT_LIST = `export function calc(x) { return x + 1; }\nexport { calc as default };`;

const CALLER = `import calc from "./a.js";
export function use() { return calc(-1); }
`;

{
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  const checkCaller = (files: Record<string, string>) => {
    const { loadModule } = makeFiles(files);
    return checkSource_____index_ts("/t/b.js", CALLER, pTrue_____index_ts, { loadModule, fromFile: "/t/b.js" });
  };

  it("export default function calc + 具名侧车 ⇒ 调用点报违例；export { calc as default } + 具名侧车 ⇒ 调用点报违例；侧车写 export default fn(…) ⇒ 仍然执法（不回归）；具名导入（对照）⇒ 仍然执法", () => {
  {
    resetCheckSourceMemo();


    const r = checkCaller({ "/t/a.js": SRC_DEFAULT_FN, "/t/a.nudo.js": SIDECAR_NAMED });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(r.ok).toBe(false);
  }
  {
    resetCheckSourceMemo();


    const r = checkCaller({ "/t/a.js": SRC_EXPORT_LIST, "/t/a.nudo.js": SIDECAR_NAMED });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(r.ok).toBe(false);
  }
  {
    resetCheckSourceMemo();


    const r = checkCaller({ "/t/a.js": SRC_DEFAULT_FN, "/t/a.nudo.js": SIDECAR_DEFAULT });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
  }
  {
    resetCheckSourceMemo();


    const { loadModule } = makeFiles({
      "/t/a.js": SRC_DEFAULT_FN,
      "/t/a.nudo.js": SIDECAR_NAMED,
    });
    const src = `import { calc } from "./a.js";\nexport function use() { return calc(-1); }\n`;
    const r = checkSource_____index_ts("/t/c.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/c.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(1);
  }
});



}
});

// ---------------------------------------------------------------------------
// 零实参调用用默认值补齐实参位再执法
// ---------------------------------------------------------------------------
describe("零实参调用用默认值补齐实参位再执法", () => {
/**
 * **默认值形参**的默认值**本身违反自身契约**时，零实参调用
 * **整条跳过执法** ⇒ `nudo check` 0 error / exit 0（引擎自己算出了 `-5`
 * 却不对账 —— 假绿）。
 *
 * 根因：`scan-literal-calls.ts`（薄壳）两处零实参早退
 * （`checkOneCall` / `checkExternalCall` 的 `absArgs.length === 0`）
 * ⇒ 形参位 / 返回位契约**一律不查**；而「默认值本身是否满足契约」
 * 完全可以在分析期静态判定（默认值是源码里的字面量）。
 *
 * 修法（S0）：零实参调用时用**被调函数的默认值形参**补齐实参位
 * （`scan/literal-args.ts` 的 `defaultArgAbss` 从被调函数 AST 的
 * `AssignmentPattern` 取默认值表达式并静态求值）⇒ 补齐后再走原执法链。
 *
 * 边界（刻意保守，fail-closed）：
 * - **只认简单默认值**（`f(x = -5)`）。解构模式的默认值
 * （`f({ port = 3000 } = {})`）的 right 是**整个模式的对象**（`{}`），
 * 不含内层默认值 ⇒ 拿它去过契约会误报「缺字段 port」⇒ 不填。
 * - 无默认值的形参位补 `absUnknown()` 占位（无信息 ⇒ 不发明义务）。
 * - 取不到默认值 ⇒ 保持修复前行为（整条跳过）。
 */







const SIDE = `
import { fn, number } from "@nudojs/core";
export const f = fn({ x: number().gt(0) }, number());
`;

/** checkSource + 侧车（共享脚手架 makeFiles，不内联副本） */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  const { loadModule } = makeFiles({ "/t/std444.nudo.js": SIDE });
  return checkSource("/t/std444.js", src, pTrue, {
    loadModule,
    fromFile: "/t/std444.js",
    autoBind: true,
  });
}

/** 契约违例（调用点前置条件）诊断 */
function violations(r: {
  issues: { code: string; severity: string; actual?: string; expected?: string }[];
}) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && i.severity === "error",
  );
}


  it("★ `f(x = -5)` + 契约 x > 0 + 零实参调用 ⇒ 报违例（改前零诊断）；★ 顶层零实参调用同样执法（作用域不再决定裁决）；负控制：默认值满足契约（`x = 5`）⇒ 不报违例；对照：显式传违约实参 ⇒ 照常报违例（既有路径没被弄坏）；负控制：**无默认值**的形参 + 零实参调用 ⇒ 不发明违例（缺参是另一条缺陷）；负控制：解构默认值（`{ port = 3000 } = {}`）⇒ 不发明违例；默认值位对齐：第二个形参有默认值 ⇒ 按形参位补齐（不串位）", () => {
  {
    const r = check(`
export function f(x = -5) { return x; }
export function g() { return f(); }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("-5");
    expect(vs[0].expected).toContain("x > 0");
  }
  {
    const r = check(`
export function f(x = -5) { return x; }
f();
`);
    expect(violations(r).length).toBe(1);
  }
  {
    const r = check(`
export function f(x = 5) { return x; }
export function g() { return f(); }
`);
    expect(violations(r).length).toBe(0);
  }
  {
    const r = check(`
export function f(x = 5) { return x; }
export function g() { return f(-3); }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("-3");
  }
  {
    const r = check(`
export function f(x) { return x; }
export function g() { return f(); }
`);
    expect(violations(r).length).toBe(0);
  }
  {
    const r = check(`
export function f({ port = 3000 } = {}) { return port; }
export function g() { return f(); }
`);
    expect(violations(r).length).toBe(0);
  }
  {
    const r = check(`
export function f(a, x = -5) { return x; }
export function g() { return f(); }
`);
    const vs = violations(r);
    expect(vs.length).toBe(1);
    expect(vs[0].actual).toContain("-5");
  }
  {
    // 共享脚手架 eval-helpers：零实参调用 ⇒ 运行时取默认值 -5
    const rec = callLit(`export function f(x = -5) { return x; }`, "f");
    expect(rec.result.term?.op).toBe("lit");
    const t = rec.result.term;
    expect(t?.op === "lit" ? t.value : undefined).toBe(-5);
  }
});








});

// ---------------------------------------------------------------------------
// 泛型 α 跨形状 kind 绑定
// ---------------------------------------------------------------------------
describe("泛型 α 跨形状 kind 绑定", () => {
/**
 * 收割的**泛型函数**在调用点**不绑定类型实参** ⇒ 返回值落 `any`
 * ⇒ 参与算术即「抽象操作数强制转换」⇒ **L2 假红**（tsc exit 0 的合法代码被门禁判红）。
 *
 * 根因：harvester 把 `T[]` 建成 **`arr`**（元素 = α var），引擎把**数组字面量**
 * 建成 **`tuple`** ⇒ `bindTypeVars` 只做**同 kind** 配对 ⇒ α 永不绑定。
 *
 * 修法（`packages/core/src/algebra/hof.ts` 的 `bindTypeVars`）：加**跨 kind 臂**
 * （`arr` 形参 × `tuple` 实参 / `tuple` 形参 × `arr` 实参）。
 * ⚠ **同 kind 臂排在前** —— 否则 `hof-relation.test.ts` 的既有用例
 * 「deep α: `T[]` param binds T from `number[]` arg (lodash-style)」会被改判。
 */



/** α 变量（any 形状 + var term） */
const alpha = abs({ k: "any" }, { op: "var", id: "T0" }, undefined, "exact");
/** harvester 建的 `T[]` 形参：shape = arr(element = α) */
const arrParam = abs({ k: "arr", element: alpha }, undefined, undefined, "exact");
/** 引擎的数组字面量实参：shape = tuple(elements) */
const tupleArg = abs(
  { k: "tuple", elements: [numLit(1)] },
  undefined,
  undefined,
  "exact",
);
/** 引擎的「arr 形」实参（抽象数组） */
const arrArg = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact");

function fnSig(paramTypes: Abs_____index_ts[], returnType: Abs_____index_ts): Abs_____index_ts {
  return abs(
    { k: "fn", params: paramTypes.map((_, i) => `p${i}`), paramTypes, returnType },
    undefined,
    undefined,
    "exact",
  );
}


  it("arr 形参（收割的 T[]）× tuple 实参（数组字面量）⇒ α 绑定（不再落 any）；同 kind 臂仍排在前：arr 形参 × arr 实参 仍绑出元素类型（既有 deep-α 用例的护栏）；tuple 形参 × arr 实参 ⇒ 各槽绑 arr 的元素类型；空 tuple 实参不绑（无元素 ⇒ 保守留空，不臆造元素类型）；非数组 kind 仍不绑（prim 形参 × prim 实参：无 α 可绑）", () => {
  {
    const fn = fnSig([arrParam], alpha);
    const out = instantiateReturn(fn, [tupleArg]);
    // 改前：any = T0（α 未绑定）⇒ 参与算术即 may-throw（L2 假红）
    expect(out.shape.k).not.toBe("any");
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  }
  {
    const fn = fnSig([arrParam], alpha);
    const out = instantiateReturn(fn, [arrArg]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  }
  {
    const t = abs({ k: "tuple", elements: [alpha] }, undefined, undefined, "exact");
    const fn = fnSig([t], alpha);
    const out = instantiateReturn(fn, [arrArg]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  }
  {
    const empty = abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
    const fn = fnSig([arrParam], alpha);
    const out = instantiateReturn(fn, [empty]);
    // α 未绑定 ⇒ 仍是 any 形状（不假精确）
    expect(out.shape.k).toBe("any");
  }
  {
    const prim = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");
    const fn = fnSig([prim], alpha);
    const out = instantiateReturn(fn, [numLit(1)]);
    expect(out.shape.k).toBe("any");
  }
});





});

// ---------------------------------------------------------------------------
// （延伸）：bigint 字面量契约在字段位 / 元素位与标量位同一裁决
// ---------------------------------------------------------------------------
describe("（延伸）：bigint 字面量契约在字段位 / 元素位与标量位同一裁决", () => {
/**
 * （族 11 片 S7 延伸）：**同一份 `lit(1n)` 契约，标量实参位与
 * 字段位 / 元素位必须是同一个裁决**。
 *
 * 背景：S6 把**标量位**的 bigint 义务补齐了（`BigIntLiteral` 取参快路径 +
 * `or` 臂逐支求值）⇒ `f(2n)` 报违例。但**字段位 / 元素位**走域隶属通道，
 * 该通道的守卫只放行 number / string / boolean / null / undefined
 * ⇒ **bigint 字面量实参被直接跳过** ⇒ `shape({ v: lit(1n) })` 收到
 * `{ v: 2n }` **零诊断**（假绿）⇒ 同一份契约两个位置两种裁决（违反 915）。
 *
 * 钉住三向对照（标量位 / 字段位 / 元素位）：
 * - 违约实参（`2n` / `{ v: 2n }` / `[2n]`）⇒ **都报违例**，且条数一致；
 * - 合法实参（`1n` / `{ v: 1n }` / `[1n]`）⇒ **都零诊断**（不得新增诊断）；
 * - union 成员位（`union(lit(1n), lit(2n))`）⇒ 域外 bigint 报违例；
 * - 既有裁决不得回退：`-0` / `0` 的字面量同一性（S3 的 915 修法）仍然放行，
 * number / string 撞 `lit(1n)` 仍然报违例。
 */







const SIDECAR = `import { lit, shape, array, fn, any, union } from "@nudojs/core";
export const scalarLitN = fn({ x: lit(1n) }, any());
export const fieldLitN = fn({ o: shape({ v: lit(1n) }) }, any());
export const elemLitN = fn({ a: array(lit(1n)) }, any());
export const fieldUnionN = fn({ o: shape({ v: union(lit(1n), lit(2n)) }) }, any());
`;

const DECLS = `
export function scalarLitN(x) { return x; }
export function fieldLitN(o) { return o; }
export function elemLitN(a) { return a; }
export function fieldUnionN(o) { return o; }
`;

/** 跑一次调用点扫描，返回 constraint-violated 诊断条数 */
function violations(calls: string): number {
  const { loadModule } = makeFiles({ "/t/lib.nudo.js": SIDECAR });
  const src = `${DECLS}${calls}\n`;
  const r = checkSource_____index_ts("/t/lib.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/lib.js" });
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}

{
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("域隶属单元层：lit(1n) 接受 1n、拒绝 2n 与 1（bigint 值域已放开）；标量位：f(2n) 报违例、f(1n) 放行（S6 已落，不得回退）；字段位：f({ v: 2n }) 报违例、f({ v: 1n }) 放行（915 延伸）；元素位：f([2n]) 报违例、f([1n]) 放行（915 延伸）；三向对照：同一份 lit(1n) 契约在三个位置的裁决条数一致；union 成员位：域外 bigint 报违例、域内 bigint 放行；既有裁决不得回退：nu", () => {
  {
    resetCheckSourceMemo();


    expect(literalMeetsConstraint_____domain_membership_ts(1n, litC(1n))).toBe(true);
    expect(literalMeetsConstraint_____domain_membership_ts(2n, litC(1n))).toBe(false);
    expect(literalMeetsConstraint_____domain_membership_ts(1, litC(1n))).toBe(false);
  }
  {
    resetCheckSourceMemo();


    expect(violations("scalarLitN(2n);")).toBe(1);
    expect(violations("scalarLitN(1n);")).toBe(0);
  }
  {
    resetCheckSourceMemo();


    expect(violations("fieldLitN({ v: 2n });")).toBe(1);
    expect(violations("fieldLitN({ v: 1n });")).toBe(0);
  }
  {
    resetCheckSourceMemo();


    expect(violations("elemLitN([2n]);")).toBe(1);
    expect(violations("elemLitN([1n]);")).toBe(0);
  }
  {
    resetCheckSourceMemo();


    const scalar = violations("scalarLitN(2n);");
    const field = violations("fieldLitN({ v: 2n });");
    const elem = violations("elemLitN([2n]);");
    expect(scalar).toBe(1);
    expect(field).toBe(scalar);
    expect(elem).toBe(scalar);
    // 合法实参：三处都零诊断
    expect(violations("scalarLitN(1n); fieldLitN({ v: 1n }); elemLitN([1n]);")).toBe(0);
  }
  {
    resetCheckSourceMemo();


    expect(violations("fieldUnionN({ v: 3n });")).toBe(1);
    expect(violations("fieldUnionN({ v: 1n });")).toBe(0);
    expect(violations("fieldUnionN({ v: 2n });")).toBe(0);
  }
  {
    resetCheckSourceMemo();


    expect(violations("fieldLitN({ v: 2 });")).toBe(1);
    expect(violations("fieldLitN({ v: \"x\" });")).toBe(1);
    expect(violations("elemLitN([2]);")).toBe(1);
  }
  {
    resetCheckSourceMemo();


    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, shape, fn, any } from "@nudojs/core";
export const fieldLitZero = fn({ o: shape({ v: lit(0) }) }, any());`,
    });
    const src = `
export function fieldLitZero(o) { return o; }
fieldLitZero({ v: -0 });
`;
    const r = checkSource_____index_ts("/t/lib.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/lib.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  }
});







}
});

// ---------------------------------------------------------------------------
// 字面量同一性（域隶属面：字段位 / 数组元素位）
// ---------------------------------------------------------------------------
describe("字面量同一性（域隶属面：字段位 / 数组元素位）", () => {
/**
 * 同一份 `lit(0)` 契约，**标量实参位**用 `===`（`-0` 放行），
 * **对象字段位 / 数组元素位**走域隶属通道用 `Object.is`（`-0` 报错）⇒
 * 同一条执法路径内部两套字面量同一性（且 domain-membership 的注释自称
 * 「与 leq 同口径」而实现不是）。
 *
 * 钉住：域隶属面的字面量同一性 = `===` + NaN 特例（与 term.ts 的
 * `termEquals` 同口径）：
 * - `-0` 与 `0` 同值（`===`）
 * - NaN 与自身同值（NaN 特例——`===` 对 NaN 为 false）
 * - 真正不同的字面量仍不满足（防「放宽过头」漏判）
 */







{
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("lit(0) 接受 -0、lit(-0) 接受 0（=== 口径，与标量实参位一致）；lit(0) 不接受 1 / -1（不因统一口径而漏判）；lit(NaN) 接受 NaN（NaN 特例；=== 对 NaN 为 false）；字段位 / 数组元素位的 -0 不再报违例（同一执法路径一种裁决）；字段位 / 数组元素位真正违约仍报（不放宽过头）", () => {
  {
    resetCheckSourceMemo();


    expect(literalMeetsConstraint_____domain_membership_ts(-0, litC(0))).toBe(true);
    expect(literalMeetsConstraint_____domain_membership_ts(0, litC(-0))).toBe(true);
  }
  {
    resetCheckSourceMemo();


    expect(literalMeetsConstraint_____domain_membership_ts(1, litC(0))).toBe(false);
    expect(literalMeetsConstraint_____domain_membership_ts(-1, litC(0))).toBe(false);
  }
  {
    resetCheckSourceMemo();


    expect(literalMeetsConstraint_____domain_membership_ts(NaN, litC(NaN))).toBe(true);
    expect(literalMeetsConstraint_____domain_membership_ts(0, litC(NaN))).toBe(false);
  }
  {
    resetCheckSourceMemo();


    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, shape, array, fn, any } from "@nudojs/core";
export const fldLit = fn({ o: shape({ v: lit(0) }) }, any());
export const arrLit = fn({ a: array(lit(0)) }, any());`,
    });
    const src = `
export function fldLit(o) { return o; }
export function arrLit(a) { return a; }
fldLit({ v: -0 });
arrLit([-0]);
`;
    const r = checkSource_____index_ts("/t/lib.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/lib.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  }
  {
    resetCheckSourceMemo();


    const { loadModule } = makeFiles({
      "/t/lib.nudo.js": `import { lit, shape, array, fn, any } from "@nudojs/core";
export const fldLit = fn({ o: shape({ v: lit(0) }) }, any());
export const arrLit = fn({ a: array(lit(0)) }, any());`,
    });
    const src = `
export function fldLit(o) { return o; }
export function arrLit(a) { return a; }
fldLit({ v: 1 });
arrLit([1]);
`;
    const r = checkSource_____index_ts("/t/lib.js", src, pTrue_____index_ts, { loadModule, fromFile: "/t/lib.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(2);
  }
});




}
});

// ---------------------------------------------------------------------------
// 0 / x folding keeps the denominator sign
// ---------------------------------------------------------------------------
describe("0 / x folding keeps the denominator sign", () => {
/**
 * `div` 的 `0 / x` 字面量折叠**丢分母符号**。
 *
 * 根因（`arithmetic/muldiv.ts` 的 `div()`，issue #170 的折叠点）：折叠在判
 * 「分母可证非零」（`excludesZero`）后**直接 `return numLit(0)`** ⇒ 把 IEEE
 * 「`0 / x` 取 x 的符号」丢在门外（分母的符号在 `bb.hi.value < 0` 里现成，
 * 却只被用于判非零）⇒ 负分母的 `-0` 被折成 `+0`。
 *
 * 原生 oracle（node 实跑）：`0 / -5` = `-0`（`Object.is(0 / -5, -0)` 为 true）、
 * `1 / (-0)` = `-Infinity`；分母恒正时才是 `+0` / `+Infinity`。
 * 引擎此前两处都标 `conf: exact` ⇒ **错值 + 自信**（dts / guard / standard
 * 三个产物面会把这个符号当真）。
 *
 * 修法：折叠时**分母符号参与折叠** —— 分母恒正（`bb.lo` 严格 > 0）⇒ `+0`；
 * 分母恒负（`bb.hi` 严格 < 0）⇒ `-0`（`lit` 保真负零，term.ts 的 `lit` 不
 * 归一 `-0`）。分母符号不可证（可能正可能负 / 可能为 0）⇒ 不折（保守）。
 *
 * 对照（issue #170 既有口径不得回归）：分母可证非零且非负 ⇒ 仍折 `+0`；
 * 分母可能是 0 ⇒ 不折字面量。
 */






/** 分母 x：可证 < 0 */
const negX = abs(num_____index_ts().shape, v_____index_ts("x"), lt(v_____index_ts("x"), lit_____index_ts(0)), "path");
/** 分母 x：可证 >= 1（恒正） */
const posX = abs(num_____index_ts().shape, v_____index_ts("x"), ge(v_____index_ts("x"), lit_____index_ts(1)), "path");
/** 分母 x：可证 >= 0 且 ≠ 0（issue #170 的口径） */
const nonNegX = abs(num_____index_ts().shape, v_____index_ts("x"), ge(v_____index_ts("x"), lit_____index_ts(0)), "path");

function lit0() {
  return abs(num_____index_ts().shape, lit_____index_ts(0), undefined, "exact");
}
function lit1() {
  return abs(num_____index_ts().shape, lit_____index_ts(1), undefined, "exact");
}

/** 取字面量值（-0 需按 SameValue 判，不能用 ===） */
function litOf(a: unknown): unknown {
  const t = (a as { term?: { op: string; value?: unknown } }).term;
  return t?.op === "lit" ? t.value : undefined;
}


  it("分母恒负 ⇒ 0 / x 折 -0（原生 0 / -5 = -0）；分母恒负 ⇒ 1 / (0 / x) 折 -Infinity（原生 -Infinity）；分母恒正 ⇒ 仍折 +0 / +Infinity（原生口径不变）；分母符号不可证（可能为 0 / 两侧都有界）⇒ 不折字面量（保守）；issue #170 既有口径不回归：x >= 0 ∧ x ≠ 0 ⇒ 折 +0 字面量；numericBounds 的符号侧：x < 0 ⇒ hi 严格 0（分母恒负可判）", () => {
  {
    const r = div_____arithmetic_ts(lit0(), negX, pTrue, undefined);
    expect(Object.is(litOf(r), -0)).toBe(true);
    expect(formatShape_____index_ts(r)).toBe("-0");
  }
  {
    const inner = div_____arithmetic_ts(lit0(), negX, pTrue, undefined);
    const r = div_____arithmetic_ts(lit1(), inner, pTrue, undefined);
    expect(litOf(r)).toBe(-Infinity);
    expect(formatShape_____index_ts(r)).toBe("-Infinity");
  }
  {
    const r = div_____arithmetic_ts(lit0(), posX, pTrue, undefined);
    expect(Object.is(litOf(r), 0)).toBe(true);
    expect(formatShape_____index_ts(r)).toBe("0");
    const inner = div_____arithmetic_ts(lit0(), posX, pTrue, undefined);
    const recip = div_____arithmetic_ts(lit1(), inner, pTrue, undefined);
    expect(litOf(recip)).toBe(Infinity);
  }
  {
    // 分母 x >= 0（可能为 0）⇒ 0/0 = NaN ⇒ 不折
    const ambiguous = div_____arithmetic_ts(lit0(), nonNegX, pTrue, undefined);
    expect(litOf(ambiguous)).toBeUndefined();
    // 分母 x ∈ [-5, 5]（符号不可证）⇒ 不折
    const bothSides = abs(
      num_____index_ts().shape,
      v_____index_ts("y"),
      and(ge(v_____index_ts("y"), lit_____index_ts(-5)), lt(v_____index_ts("y"), lit_____index_ts(5))),
      "path",
    );
    const mixed = div_____arithmetic_ts(lit0(), bothSides, pTrue, undefined);
    expect(litOf(mixed)).toBeUndefined();
  }
  {
    const r = div_____arithmetic_ts(lit0(), nonNegX, and(ne(v_____index_ts("x"), lit_____index_ts(0))), undefined);
    expect(litOf(r)).toBe(0);
    expect(Object.is(litOf(r), -0)).toBe(false);
    // 无 ne 事实 ⇒ 不折
    const noNe = div_____arithmetic_ts(lit0(), nonNegX, pTrue, undefined);
    expect(litOf(noNe)).toBeUndefined();
  }
  {
    const b = numericBounds(negX, pTrue);
    expect(b?.hi).toEqual({ value: 0, strict: true });
  }
});







describe("端到端：形参带 x < 0 约束", () => {
  it("0 / x（x < 0）⇒ 引擎折 -0（改前折 +0）；1 / (0 / x)（x < 0）⇒ 引擎折 -Infinity（改前折 +Infinity）；分母恒正 ⇒ 端到端仍是 +0 / +Infinity", () => {
  {
    const r = call(`export function f(x) { return 0 / x; }`, "f", [negX]);
    expect(formatShape_____index_ts(r.result)).toBe("-0");
  }
  {
    const r = call(`export function f(x) { return 1 / (0 / x); }`, "f", [negX]);
    expect(formatShape_____index_ts(r.result)).toBe("-Infinity");
  }
  {
    const r = call(`export function f(x) { return 0 / x; }`, "f", [posX]);
    expect(formatShape_____index_ts(r.result)).toBe("0");
    const recip = call(`export function f(x) { return 1 / (0 / x); }`, "f", [posX]);
    expect(formatShape_____index_ts(recip.result)).toBe("Infinity");
  }
});


});
});

// ---------------------------------------------------------------------------
// re-export 的分支条件只看 source，不看 modules 表在不在
// ---------------------------------------------------------------------------
describe("re-export 的分支条件只看 source，不看 modules 表在不在", () => {
/**
 * `collectAbsExports` 的 **re-export 在 `modules` 表缺席时退化成
 * 「本地导出」** ⇒ 凭空造出 named / **default** 导出槽（协议层非法值：
 * default 槽的**存在性**表示「该模块确实有 default 导出」）；同文件的
 * `bindImports` 亦**不查 `mod.default`** ⇒ `import { default as d }` 绑成
 * unknown（与 `import d from` **不等价**）。
 *
 * 根因（abs-modules.ts）：分支条件用「**有没有 `modules` 表**」代替了
 * 「这个 re-export 的来源模块**可达吗**」⇒ `modules` 缺席时落回本地
 * specifier 分支 ⇒ re-export 被误当成本地导出。
 *
 * 钉：
 * - 三形态（modules 未提供 / modules 提供但 mod 不在表里 / modules 提供且
 * mod 在表里）里，前两者必须**逐字相同**（来源不可达 ⇒ 不产生任何导出槽）。
 * - `export { default } from "./m.js"` 在来源不可达时 ⇒ **default 槽必须缺席**。
 * - `import { default as d } from "./m.js"` ⇒ `d` 必须绑定到 `mod.default`
 * （与 `import d from` 同口径）。
 */








const num = abs_____abs_ts({ k: "prim", type: "number" }, undefined, undefined, "exact");
const str = abs_____abs_ts({ k: "prim", type: "string" }, undefined, undefined, "exact");

/** 来源模块（同时有 named.x 与 default） */
const SRC_MOD: AbsModuleExports = { named: { x: str }, default: num };

const MOD_TABLE: Record<string, AbsModuleExports> = { "./m.js": SRC_MOD };
/** modules 提供但来源不在表里 */
const OTHER_TABLE: Record<string, AbsModuleExports> = { "./other.js": { named: {} } };

/** 导出表的形态摘要（named 名单 + default 槽存在性） */
function shapeOf(r: AbsModuleExports): string {
  const named = Object.keys(r.named).sort().join(",");
  return `named={${named}} default=${r.default === undefined ? "absent" : "present"}`;
}

/** 收集某个导出形态在三形态 modules 表下的摘要 */
function threeForms(src: string): [string, string, string] {
  const file = parseSource(src);
  return [
    shapeOf(collectAbsExports(file, emptyEnv())),
    shapeOf(collectAbsExports(file, emptyEnv(), OTHER_TABLE)),
    shapeOf(collectAbsExports(file, emptyEnv(), MOD_TABLE)),
  ];
}


  it("`export { a } from './m.js'`：来源不可达时不产生任何导出槽；`export { default } from './m.js'`：来源不可达时 default 槽必须缺席；`export { default as d } from './m.js'`：来源不可达时不产生任何导出槽；`export * as ns from './m.js'`：来源不可达时不产生任何导出槽；`export * from './m.js'`：来源不可达时不产生任何导出槽", () => {
  {
    const [noMods, modMissing, modPresent] = threeForms(`export { a } from "./m.js";`);
    // 修复前：noMods 形态凭空登记本地导出 a（named={a}）
    expect(noMods).toBe("named={} default=absent");
    // 来源不可达的两种口径必须一致
    expect(noMods).toBe(modMissing);
    // 来源可达但缺名 ⇒ 留 unknown 槽（可达 ≠ 不可达）
    expect(modPresent).toBe("named={a} default=absent");
  }
  {
    const [noMods, modMissing, modPresent] = threeForms(`export { default } from "./m.js";`);
    // 修复前：noMods 形态凭空造出 default 槽（协议层非法值）
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
    // 来源可达 ⇒ default 槽存在
    expect(modPresent).toBe("named={} default=present");
  }
  {
    const [noMods, modMissing, modPresent] = threeForms(`export { default as d } from "./m.js";`);
    // 修复前：noMods 形态凭空登记本地导出 d
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
    expect(modPresent).toBe("named={d} default=absent");
  }
  {
    const [noMods, modMissing] = threeForms(`export * as ns from "./m.js";`);
    // 修复前：noMods 形态凭空登记本地导出 ns
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
  }
  {
    const [noMods, modMissing, modPresent] = threeForms(`export * from "./m.js";`);
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
    expect(modPresent).toBe("named={x} default=absent");
  }
  {
    const file = parseSource(`const a = 1;\nexport { a };\n`);
    const r = collectAbsExports(file, emptyEnv(), OTHER_TABLE);
    expect(Object.keys(r.named)).toEqual(["a"]);
  }
  {
    const bind = (src: string): string => {
      const file = parseSource(src);
      const env = emptyEnv();
      const stmt = file.program.body[0];
      expect(stmt?.type).toBe("ImportDeclaration");
      bindImports(stmt as never, env, MOD_TABLE);
      const out: string[] = [];
      for (const [k, v] of env.vars) out.push(`${k}=${formatShape(v)}`);
      return out.join(",");
    };
    // 修复前：`import { default as d }` 绑成 unknown（与 `import d from` 不等价）
    expect(bind(`import d from "./m.js";`)).toBe("d=number");
    expect(bind(`import { default as d } from "./m.js";`)).toBe("d=number");
    expect(bind(`import { x } from "./m.js";`)).toBe("x=string");
  }
});







});

// ---------------------------------------------------------------------------
// 模块矩阵：字面量算术折叠必须与原生 IEEE 754 一致
// ---------------------------------------------------------------------------
describe("模块矩阵：数值折叠 = 原生 IEEE 754", () => {
const EXPRS = [
  "1 + 2",
  "0.1 + 0.2",
  "1 / 0",
  "0 / 0",
  "-0 * 1",
  "5 % 0",
  "2 ** 1024",
  "Number.MIN_VALUE / 2",
  "-0 + 0",
  "1 - 0.9",
  "Infinity - Infinity",
  "(-0) ** 1",
  "Number.MAX_SAFE_INTEGER + 1",
  "1e308 * 10",
];

it.each(EXPRS)("%s ⇒ 与原生 Object.is 一致", (expr) => {
  const native = Function(`return (${expr});`)() as unknown;
  const r = val(`export function f() { return ${expr}; }`) as { ok: boolean; value?: unknown };
  expect(r.ok).toBe(true);
  expect(Object.is(r.value, native), `engine=${String(r.value)} native=${String(native)}`).toBe(true);
});
});

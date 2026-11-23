/**
 * 模块套件：转译器语句/表达式/类/作用域面。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { litValue, checkSource as checkSource___nudojs_core, pTrue as pTrue___nudojs_core, resetCheckSourceMemo as resetCheckSourceMemo___nudojs_core, resetGeneralizeMemo as resetGeneralizeMemo___nudojs_core } from "@nudojs/core";
import { call, val, throwsError, resetEngineCaches, isNever, effects, callLit } from "./eval-helpers.ts";
import { checkSource, instantiateConstraint, number, pTrue, shape, formatShape, num, objOf, str, strLit, type Abs, constraintAdmitsNullish, constraintToEntryAbs, litC, union, transpileSource, transpileBodyNode, omit, partial, pick, extractRefinesFromSource, findFnDirectiveScope, listFnDirectiveScopes, parseSource as parseSource_____index_ts, extractDeclaredThrows } from "../index.ts";
import { predToString, pTrue as pTrue_____pred_ts, } from "../pred.ts";
import { sidecarOpts, makeFiles, issuesOf, sigOf, l2Count, stdOpts, withStdImport } from "./nudo-constraints.ts";
import { anyAbs, litValue as litValue_____abs_ts, numLit, abs, absLit, num as num_____abs_ts, type Abs as Abs_____abs_ts, type Shape } from "../abs.ts";
import { parseSource } from "../parse-source.ts";
import { injectForFunctionScope, generalizeFromAst, resetGeneralizeMemo } from "../generalize.ts";
import { runTranspiled, callTranspiledExportFull, bindingsOf } from "../exec/run.ts";
import { compileRuntimeModuleUnit, runtimeModuleArgValues } from "../exec/rt.ts";
import { formatShape as formatShape_____format_format_ts } from "../format/format.ts";
import { takeRefineDiags } from "../refine.ts";
import { takeContractDiags } from "../contract/contract.ts";
import { checkSource as checkSource_____check_check_ts, resetCheckSourceMemo } from "../check/check.ts";
import { checkCallSite } from "../diagnostics/diagnostics.ts";
import { $copy } from "../exec/runtime/containers/obj.ts";
import { leqAbs, requiredFnArity } from "../leq.ts";
import { constraintToEntryAbs as constraintToEntryAbs_____constraint_ts, derefConstraint, shape as shape_____constraint_ts, string } from "../constraint.ts";
import { getSlot, makeSum } from "../objects.ts";
import type { CheckIssue } from "../check/check-report.ts";
import { evalThrowsOutcome } from "../check/check-may-throw.ts";
import { throwAbsToKinds } from "../diagnostics/may-throw.ts";
import { contractParamNameSet, formalParamDisplayNames, formalParamsFromNodes, formalParamSignatureNames, locateContractParam, type FormalParam } from "../format/param-surface.ts";
import { listTopFunctions } from "../scan/scan.ts";
import { collectCallResolvers } from "../scan/scan-call-graph.ts";

// ---------------------------------------------------------------------------
// 函数声明基值的可选链
// ---------------------------------------------------------------------------
describe("函数声明基值的可选链", () => {
/**
 * 回归：可选链基值是**函数声明绑定**（转译产物里的原生 JS 函数，
 * 不是 Abs）时，短路守卫 `$nullishTest(f)` 不得读 `.shape` 崩溃。
 * 原生函数恒非 nullish ⇒ g() => 1、h() => "f"，零诊断。
 */




const SRC = `export function f(x) { return x; }
export function g() { return f?.(1); }
export function h() { return f?.name; }
export function ok() { return 1; }`;


  it("f?.(1) ⇒ 1（改前 nudo:internal 崩溃）；f?.name ⇒ 'f'（属性读面同样不崩）；同模块无关导出不受影响；负控制：Abs 基值的可选链短路语义不变", () => {
  {
    const r = call(SRC, "g");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.result.shape.k).not.toBe("never");
  }
  {
    const r = call(SRC, "h");
    expect(litValue(r.result)).toEqual({ ok: true, value: "f" });
  }
  {
    expect(litValue(call(SRC, "ok").result)).toEqual({ ok: true, value: 1 });
  }
  {
    expect(litValue(call(`export function f() { const o = null; return o?.x; }`).result)).toEqual({
      ok: true,
      value: undefined,
    });
  }
});




});

// ---------------------------------------------------------------------------
// shape().optional() 的 undefined 臂在调用点生效
// ---------------------------------------------------------------------------
describe("shape().optional() 的 undefined 臂在调用点生效", () => {
/**
 * 分册 03 · `shape(...).optional()` 的**契约级可选位**未进谓词 ⇒
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


  it("实例化谓词含 undefined 臂（shape 分支不再提前 return）；显式 f(undefined) ⇒ 零违例（改前报 object shape at x）；合法对象 f({ a: 1 }) ⇒ 零违例；省略该位 f() ⇒ 零违例（元数检查已放行）；真违例 f({ a: 0 }) ⇒ 报 x.a > 0；负控制：显式 null 仍不被 .optional() 接纳", () => {
  {
    const text = predToString(instantiateConstraint(shape({ a: number().gt(0) }).optional(), "x"));
    expect(text).toContain("x = undefined");
    expect(text).toContain("x.a > 0");
  }
  {
    const r = check(`export function undefinedArg() { return f(undefined); }`);
    expect(violations(r)).toHaveLength(0);
    expect(r.issues.some((i) => (i.expected ?? "").includes("object shape"))).toBe(false);
  }
  {
    expect(violations(check(`export function ok() { return f({ a: 1 }); }`))).toHaveLength(0);
  }
  {
    expect(violations(check(`export function omitted() { return f(); }`))).toHaveLength(0);
  }
  {
    const v = violations(check(`export function bad() { return f({ a: 0 }); }`));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toBe("x.a > 0");
  }
  {
    expect(violations(check(`export function nullArg() { return f(null); }`)).length).toBeGreaterThan(0);
  }
});






});

// ---------------------------------------------------------------------------
// this 接收者
// ---------------------------------------------------------------------------
describe("this 接收者", () => {
/**
 * 分册 03 · `resolveCalleeFn` 只认 `recv.name`：类体内
 * `this.m(…)` / 静态字符串键 `c["m"](…)` / `K["s"](…)` 的类成员契约零执法。
 *
 * 根因：成员分支写死「非 computed 键 + Identifier 接收者」；`this` 是
 * `ThisExpression`、计算键的 `computed === true` ⇒ 都落不进任何分支。
 *
 * 修法：propOk 认 computed + StringLiteral 静态键；`ScopeFrame.thisClass`
 * 记录 ClassMethod 作用域所属类 ⇒ `this.m` 与 `c.m` 同一条 obligation 路径。
 */




const SIDE = `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const K_s = fn({ a: positive }, number());
`;

function check(src: string, file: string) {
  const side = file.replace(/\.js$/, ".nudo.js");
  const { loadModule } = makeFiles({ [file]: src, [side]: SIDE });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

function violations(r: { issues: Array<{ code: string; fn?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}


  it("类体内 this.m(-1) ⇒ K.m 参数契约执法（改前零诊断）；负控制：this.m(1) 合法 ⇒ 零违例", () => {
  {
    const r = check(`export class K {
  m(a) { return a; }
  n() { return this.m(-1); }
}
`, "/t/bug18-this.js");
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.fn).toBe("K.m");
  }
  {
    const r = check(`export class K {
  m(a) { return a; }
  n() { return this.m(1); }
}
`, "/t/bug18-this-ok.js");
    expect(violations(r)).toHaveLength(0);
  }
});



describe("静态字符串计算键", () => {
  it("c[\"m\"](-1) 与 c.m(-1) 同判据；K[\"s\"](-1)（静态成员）⇒ K.s 执法", () => {
  {
    const r = check(`export class K {
  m(a) { return a; }
}
const c = new K();
export function badComputed() { return c["m"](-1); }
export function badDirect() { return c.m(-1); }
`, "/t/bug18-computed.js");
    expect(violations(r)).toHaveLength(2);
  }
  {
    const r = check(`export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
export function badStaticComputed() { return K["s"](-1); }
`, "/t/bug18-static.js");
    const v = violations(r);
    expect(v).toHaveLength(1);
    expect(v[0]!.fn).toBe("K.s");
  }
});

});
});

// ---------------------------------------------------------------------------
// for 头去影外层 const
// ---------------------------------------------------------------------------
describe("for 头去影外层 const", () => {
/**
 * 回归：`for (let s = …)` 的 test / update 与循环体一样必须用
 * **去影**后的 const 面（循环变量是状态线程形参，遮蔽外层同名 const）。
 * 此前 `s += 1` 命中 isConstAssignTarget ⇒ 误报确定 TypeError、签名塌 never。
 */




  it("s += 1 步进不再误折 TypeError（原生 3）；n = n + 1 通用步进形态同样 total；test 里的复合赋值（(s+=1)<3）也不误报；负控制：写真正的 const 仍抛 TypeError", () => {
  {
    expect(
      val(`export function f() {
        const s = 100;
        let out = 0;
        for (let s = 0; s < 3; s += 1) out += s;
        return out;
      }`),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(
      val(`export function f() {
        const n = 100;
        let out = 0;
        for (let n = 0; n < 3; n = n + 1) out += n;
        return out;
      }`),
    ).toEqual({ ok: true, value: 3 });
  }
  {
    expect(
      val(`export function f() {
        const s = 100;
        let c = 0;
        for (let s = 0; (s += 1) < 3;) c++;
        return c;
      }`),
    ).toEqual({ ok: true, value: 2 });
  }
  {
    const r = val(`export function f() { const s = 1; s = 2; return s; }`);
    expect(r.ok).toBe(false);
  }
});




});

// ---------------------------------------------------------------------------
// union / nullable 成员的 int 义务
// ---------------------------------------------------------------------------
describe("union / nullable 成员的 int 义务", () => {
/**
 * 分册 03 · `union()` / `nullable()` 成员的 `.int()` 在调用点
 * 零执法（假绿；同一契约在返回位与 guard / zod / standard 三面都判违例）。
 *
 * 根因：`.int()` 是**数据标志**（不带 pred），`instantiateOnTerm` 只补
 * typeof / preds ⇒ int 义务不在 `or` 谓词里；`checkUnionMembers` 只挑
 * `fields || element` 成员 ⇒ 消费侧也没人接。
 *
 * 修法：消费侧 `checkUnionIntObligation` 补这条义务（不改谓词代数——
 * 把 int 折进 `or` 成员会变成 `and`，反而把整条 union 压成未决）。
 */




const SIDE = `import { number, string, union, nullable } from "@nudojs/core";
export const intOrStr = union(number().int(), string());
export const maybeInt = nullable(number().int());
export const plainInt = number().int();
`;
const IMP = `/// @nudo:import { intOrStr, maybeInt, plainInt } from "./std78.nudo.js"\n`;
const FILE = "/t/bug78.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource(FILE, src, pTrue, sidecarOpts("std78", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string; expected?: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

{
  it.each([
    ["intOrStr", "union(number().int(), string())"],
    ["maybeInt", "nullable(number().int())"],
    ["plainInt", "非 union 对照 number().int()"],
  ])("%s 收到 1.5 ⇒ 报 x is int", (contract, _label) => {
    const v = violations(check(contract, "1.5"));
    expect(v).toHaveLength(1);
    expect(v[0]!.expected).toBe("x is int");
  });

  it.each([
    ["intOrStr", "2"],
    ["intOrStr", '"a"'],
    ["maybeInt", "null"],
    ["maybeInt", "undefined"],
  ])("负控制：%s 收到满足某一支的 %s ⇒ 零违例", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });
}
});

// ---------------------------------------------------------------------------
// 有界 .optional() 契约在调用点执法
// ---------------------------------------------------------------------------
describe("有界 .optional() 契约在调用点执法", () => {
/**
 * 分册 03 · 标量 `.optional()` 把**有界谓词**整条折成未决 ⇒
 * L1 调用点零执法（假绿；同一契约去掉 `.optional()` 立刻报红，文档指定的
 * 等价写法 `union(<base>, lit(undefined))` 也照常报红）。
 *
 * 根因：`optionalizePred` 把 `and(typeof, 界)` 包进 `or` 的**一个成员**；
 * `judgeOrMember` 只委托 `judgeLiteralPred`（不认 `and`）⇒ undefined ⇒
 * `memberDomainKind(and)` 取出的域与实参兼容 ⇒ 整条 `or` 未决 ⇒ 跳过。
 *
 * 修法：`judgeOrMember` 对 `and` 成员按合取逐原子求值；`judgeLiteralPred`
 * 的 eq(nullish) 分支对**形态确定**的实参判确定假（undefined 臂对 `[1]` /
 * `500` / `{}` 不再是「不可判定」）。
 */




const SIDE = `import { number, string, array, union, lit } from "@nudojs/core";
export const boundedOpt = number().lt(100).optional();
export const bounded = number().lt(100);
export const strMinOpt = string().min(3).optional();
export const arrMinOpt = array(number()).min(2).optional();
export const gtLtOpt = number().gt(0).lt(10).optional();
export const viaUnion = union(number().lt(100), lit(undefined));
export const optNum = number().optional();
`;
const IMP = `/// @nudo:import { boundedOpt, bounded, strMinOpt, arrMinOpt, gtLtOpt, viaUnion, optNum } from "./std96.nudo.js"\n`;
const FILE = "/t/bug96.js";

function check(contract: string, arg: string) {
  const src = `${IMP}/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }
`;
  return checkSource(FILE, src, pTrue, sidecarOpts("std96", SIDE, FILE));
}

function violations(r: { issues: Array<{ code: string }> }) {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

{
  it.each([
    ["boundedOpt", "500", "number().lt(100).optional()"],
    ["strMinOpt", '"ab"', "string().min(3).optional()"],
    ["arrMinOpt", "[1]", "array(number()).min(2).optional()"],
    ["gtLtOpt", "500", "number().gt(0).lt(10).optional()"],
  ])("%s 收到 %s ⇒ 报一条违例（改前假绿）", (contract, arg, _label) => {
    expect(violations(check(contract, arg))).toHaveLength(1);
  });

  it("去掉 .optional() 的同一契约仍报（控制组）；等价写法 union(base, lit(undefined)) 与 .optional() 结论一致", () => {
  {
    expect(violations(check("bounded", "500"))).toHaveLength(1);
  }
  {
    expect(violations(check("viaUnion", "500"))).toHaveLength(1);
    expect(violations(check("boundedOpt", "500"))).toHaveLength(1);
  }
});


  it.each([
    ["boundedOpt", "undefined"],
    ["strMinOpt", "undefined"],
    ["arrMinOpt", "undefined"],
    ["gtLtOpt", "undefined"],
    ["optNum", "undefined"],
  ])("负控制：%s 收到 undefined ⇒ 零违例（088 不回归）", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });

  it.each([
    ["boundedOpt", "5"],
    ["strMinOpt", '"abcd"'],
    ["arrMinOpt", "[1, 2]"],
    ["gtLtOpt", "5"],
    ["optNum", "5"],
  ])("负控制：%s 收到满足界的 %s ⇒ 零违例", (contract, arg) => {
    expect(violations(check(contract, arg))).toHaveLength(0);
  });
}
});

// ---------------------------------------------------------------------------
// / function-scoped @nudo:mock
// ---------------------------------------------------------------------------
describe("/ function-scoped @nudo:mock", () => {
/**
 * / （泄漏半边）：`@nudo:mock` 是**函数级**指令，但未冲突时
 * 落进平表 ⇒ 文件内所有函数都能看到（假绿：真实 ReferenceError 被 mock 掩盖）。
 * 修复：core 的 `scopeSelectedInject` 按源码里的函数级声明再过滤一次。
 */





const SRC = `
/**
 * @nudo:mock alpha = (u) => ({ from: "A" })
 */
export function fa() {
  return alpha("/x");
}

export function fb() {
  return alpha("/x");
}
`;

const file = parseSource(SRC);
const mocks = { alpha: anyAbs, manual: anyAbs };


  it("the declaring function keeps its mock；other functions do not see the mock (no file-level leak)；injected mocks that no directive declares are kept as fallback", () => {
  {
    const inject = injectForFunctionScope({ mocks }, "fa", file);
    expect(inject?.mocks).toHaveProperty("alpha");
  }
  {
    const inject = injectForFunctionScope({ mocks }, "fb", file);
    expect(inject?.mocks).not.toHaveProperty("alpha");
  }
  {
    const inject = injectForFunctionScope({ mocks }, "fb", file);
    expect(inject?.mocks).toHaveProperty("manual");
  }
});



});

// ---------------------------------------------------------------------------
// [merged] as-destructure
// ---------------------------------------------------------------------------
describe("as-destructure", () => {
// MERGED (topic-related bug pins): as-destructure + destructure-binding
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>








{
/**
 * 回归（core 转译层）：`@nudo:as` 挂在**解构声明**上被**静默忽略**
 * （零诊断）⇒ 两条语法等价的声明给出相反的类型。
 *
 * 病灶：packages/core/src/algebra/exec/transpile/stmt/statement.ts 的
 * `emitVariableDeclaration` **解构分支**从头到尾不读 `asVar`——同函数取到的
 * `asVar` 只在 Identifier 分支被消费 ⇒ 解构形态的覆盖**完全失效**。
 * 指令本身**是被采集到的**（service 侧 asTargets 非空）⇒ 连「孤儿指令」
 * 诊断都不触发 ⇒ **彻底静默**（假绿）。
 *
 * 修法（解构分支消费 asVar，与 Identifier 分支同口径）：覆盖值取代 init 的
 * **值**，原 init 仍求值（副作用 + throws 域保留——@nudo:as 是**类型覆盖**
 * 不是求值替换）；随后逐项 $get / $idx 从**覆盖值**取槽 ⇒ 每个绑定各自从
 * 覆盖形状取自己的槽（`const { a, b } = expr` ⇒ a 取槽 a、b 取槽 b）。
 *
 * 覆盖断言（不改既有断言）：
 * - 覆盖生效：解构 + `@nudo:as shape({...})` ⇒ 绑定类型取自覆盖形状；
 * - 对照钉：Identifier 形态仍生效（行为不退化）；
 * - 负控制：无指令的同一源码行为不变；覆盖只作用于被标注的那条语句。
 */






/** content 实参（合法 JSON ⇒ JSON.parse 不抛 ⇒ 返回面可观测） */
const CONTENT: Abs = strLit('{"port":8080,"host":"h"}') as Abs;

/**
 * `@nudo:as` 的命中面（与 service 侧 collectEvalReplacements 同口径）：
 * 承载指令的那条**语句**（AST 节点身份 = 源文本字符区间）。
 */
function asTargets(src: string): { varName: string; stmtStart: number; stmtEnd: number }[] {
  const ast = parseSource(src);
  const out: { varName: string; stmtStart: number; stmtEnd: number }[] = [];
  let i = 0;
  const visit = (stmts: unknown[]): void => {
    for (const s of stmts as Array<Record<string, unknown>>) {
      const t = s?.type as string | undefined;
      if (t === "VariableDeclaration" || t === "ReturnStatement") {
        const comments = ((s.leadingComments as Array<{ value?: string }>) ?? [])
          .map((c) => c.value ?? "")
          .join("\n");
        if (/@nudo:as\b/.test(comments)) {
          out.push({
            varName: `__as${i++}`,
            stmtStart: s.start as number,
            stmtEnd: s.end as number,
          });
        }
      }
      if (t === "BlockStatement") visit(s.body as unknown[]);
      if (t === "ExportNamedDeclaration" && s.declaration) visit([s.declaration]);
      if (t === "FunctionDeclaration" && s.body) {
        visit((s.body as { body: unknown[] }).body);
      }
    }
  };
  visit((ast.program.body as unknown[]) ?? []);
  return out;
}

/** 断言覆盖值：`shape({ port: number(), host: string() })` 的 Abs 形态 */
const SHAPE_ABS: Abs = objOf({
  port: { value: num() },
  host: { value: str() },
});

/** 断言覆盖值：`array(number())` 的 Abs 形态（元素域 number） */
const TUPLE_ABS: Abs = { shape: { k: "arr", element: num() }, conf: "exact" };

/** 带 @nudo:as 注入表转译 + 调用导出函数（override = 断言形状） */
function callAs(
  src: string,
  override: Abs = SHAPE_ABS,
  fnName = "f",
  args: Abs[] = [CONTENT],
) {
  const targets = asTargets(src);
  const exports = runTranspiled(src, {
    mode: "analyze",
    asOverrideTargets: targets.length ? targets : undefined,
    asOverrides: targets.length
      ? Object.fromEntries(targets.map((t) => [t.varName, override]))
      : undefined,
  });
  return callTranspiledExportFull(exports, fnName, args);
}

/** 结果的 shape 字符串 */
function shapeOf(src: string, override: Abs = SHAPE_ABS): string {
  return formatShape(callAs(src, override).result);
}

describe("@nudo:as 挂在解构声明上生效（覆盖按绑定名投影到各绑定）", () => {
  it("解构声明 + @nudo:as：各绑定取覆盖形状的同名槽；解构声明 + @nudo:as：数组模式按位置投影覆盖值；解构声明 + @nudo:as：改名绑定按源键取槽（原生语义）；对照钉：Identifier 形态的覆盖仍生效（行为不退化）；负控制：无指令的同一源码行为不变（不凭空得到覆盖类型）；负控制：覆盖只作用于被标注的那条语句；原 init 仍求值：副作用保留（@nudo:as 是类型覆盖不是求值替换）；原 init 仍求值：throws 域保留（不被覆盖吞掉）", () => {
  {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port, host } = JSON.parse(content);
  return { port, host };
}
`;
    // 修复前：覆盖被静默忽略 ⇒ 返回面落到 unknown
    expect(shapeOf(src)).toBe("{ port: number, host: string }");
  }
  {
    const src = `export function f(content) {
  // @nudo:as array(number())
  const [first, second] = JSON.parse(content);
  return [first, second];
}
`;
    expect(shapeOf(src, TUPLE_ABS)).toBe("[number, number]");
  }
  {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port: p } = JSON.parse(content);
  return p;
}
`;
    expect(shapeOf(src)).toBe("number");
  }
  {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const config = JSON.parse(content);
  return config;
}
`;
    expect(shapeOf(src)).toBe("{ port: number, host: string }");
  }
  {
    const src = `export function f(content) {
  const { port, host } = JSON.parse(content);
  return { port, host };
}
`;
    expect(shapeOf(src)).not.toBe("{ port: number, host: string }");
  }
  {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port, host } = JSON.parse(content);
  const other = JSON.parse(content);
  return { port, host, other };
}
`;
    // other 未被标注 ⇒ 不得取覆盖形状
    expect(shapeOf(src)).not.toContain("other: number");
  }
  {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port } = bump();
  return counter;
}
`;
    const rec = callAs(src);
    expect(litValue_____abs_ts(rec.result)).toMatchObject({ ok: true, value: 1 });
  }
  {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port } = JSON.parse(content);
  return port;
}
`;
    expect(
      throwsError(callAs(src, SHAPE_ABS, "f", [strLit("not json at all") as Abs]).throws, "SyntaxError"),
    ).toBe(true);
  }
});







});
}

describe("destructure-binding", () => {
/**
 * 残留（core 转译层）：**解构声明**的子名此前不进**顶层绑定表**
 * （`$recordBinding` 通道）⇒ 该名字在别处被当作实参时解析不出类型 ⇒
 * 调用点的契约检查被整条跳过 ⇒ **假绿**（同一份值走 Identifier 形态会报
 * `nudo:constraint-violated`，走解构形态一声不吭）。
 *
 * 修法：`emitVariableDeclaration` 的解构分支按 Identifier 分支**同口径**
 * 登记绑定名（顶层 depth 0；块内 / 形参 / catch / for 头不是顶层绑定）。
 */





describe("残留 — 解构声明的子名进顶层绑定表", () => {
  it("对象 / 改名 / 数组 / 嵌套 / rest / 默认值 / export 包装 的子名都进绑定表；绑定表里的值 = 解构出来的槽值（不是 any）；for 头解构：循环体内子名拿到元素槽类型（契约面 signature 不是 any）；端到端：实参来自解构绑定 ⇒ 契约违例被报出（改前静默跳过 = 假绿）；负控制：Identifier 形态仍在绑定表里（本次修改不退化）；负控制：块内解构子名不是顶层绑定；负控制：for 头解构子名不是顶层绑定（循环作用域）", () => {
  {
    const r = runTranspiled(
      `const { a } = { a: 1 };
const { b: c } = { b: 2 };
const [d] = [3];
const { e: { f } } = { e: { f: 4 } };
const { ...rest } = { g: 5 };
const { h = 6 } = {};
const i = 7;
export const { j } = { j: 8 };
`,
      { mode: "analyze" },
    );
    const binds = bindingsOf(r);
    expect(binds).toBeDefined();
    expect([...(binds!.keys())].sort()).toEqual(
      ["a", "c", "d", "f", "h", "i", "j", "rest"].sort(),
    );
  }
  {
    const r = runTranspiled(`const { a } = { a: 1 }; const { b: c } = { b: 2 };`, {
      mode: "analyze",
    });
    const binds = bindingsOf(r)!;
    expect(litValue_____abs_ts(binds.get("a") as never)).toEqual({ ok: true, value: 1 });
    // 改名绑定：表里登记的是**绑定名** c，值是源键 b 的槽值
    expect(binds.has("b")).toBe(false);
    expect(litValue_____abs_ts(binds.get("c") as never)).toEqual({ ok: true, value: 2 });
  }
  {
    const r = issuesOf(`
/**
 * @nudo:contract xs findings
 */
export function f(xs) {
  for (const { severity } of xs) { return severity; }
  return "";
}
`);
    const sig = r.signatures.find((s) => s.name === "f")?.display ?? "";
    // 返回面 = 循环体 `return severity`（与 "" 并）= string；子名若退化成
    // any（解构未求类型），这里会是 any。
    expect(sig).toBe("string");
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  }
  {
    const r = issuesOf(`
const { p } = { p: -5 };
/**
 * @nudo:contract x port
 */
export function g(x) { return x; }
export function h() { return g(p); }
`);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  }
  {
    const r = runTranspiled(`const a = 1;`, { mode: "analyze" });
    expect([...(bindingsOf(r)!.keys())]).toEqual(["a"]);
  }
  {
    const r = runTranspiled(
      `function f() { const { a } = { a: 1 }; return a; }
export { f };`,
      { mode: "analyze" },
    );
    expect(bindingsOf(r)!.has("a")).toBe(false);
  }
  {
    const r = runTranspiled(`const xs = [{ a: 1 }]; for (const { a } of xs) { }`, {
      mode: "analyze",
    });
    const binds = bindingsOf(r)!;
    expect(binds.has("xs")).toBe(true);
    expect(binds.has("a")).toBe(false);
  }
});






});
});
});

// ---------------------------------------------------------------------------
// .optional() 的「可为 undefined」语义必须投影到入口 Abs
// ---------------------------------------------------------------------------
describe(".optional() 的「可为 undefined」语义必须投影到入口 Abs", () => {
/**
 * `.optional()` 的「可缺省 / 可为 undefined」语义在**契约 → 入口
 * Abs 投影**里**整体丢失** ⇒ 调用点与返回位双双**假红**，且 check 签名面与
 * `.d.ts` 对同一形参给出**相反**的可选性。
 *
 * 根因：`constraintOnTermAbs` 的标量分支**从不消费 `c.isOptional`** ⇒ 产出的
 * Abs 是 `prim number + pred(typeof x = "number")`，**没有 undefined 臂** ⇒
 * 下游全部按「该位必填且非 undefined」执法：
 * - L1 调用点前置条件 ⇒ 契约**明确允许**的 `undefined` 实参被判违约（假红）；
 * - L1 返回后置条件 ⇒ 同款假红（修复建议还把用户引向 `nullable(…)` 绕过）；
 * - check 签名面渲染 `f(x: number)` ⇒ 与 .d.ts 的 `f(x?: number)` 矛盾。
 *
 * 修法：`.optional()` 顶层位在**三条通道**上同口径保真
 * - `constraintToEntryAbs`：入口 Abs 带 undefined 臂（与
 * `union(lit(undefined), <base>)` 这条等价写法**同构**）；
 * - `instantiateConstraint`：调用点谓词 = `or(<base>, eq(x, undefined))`；
 * - `constraintAdmitsNullish`：返回位的 nullish 臂放行。
 *
 * 对照组钉住「只作用于顶层位」：对象**字段位**的 `.optional()` 语义是
 * 「键可缺席」（槽位 `optional` 标记），槽值**不得**变成 `number | undefined`。
 */





const LIB = `
export const optNum = number().optional();
export const reqNum = number();
export const optShape = shape({ a: number().optional() });
`;
const opts = (fromFile: string) => sidecarOpts("o.nudo", LIB, fromFile);

const withImport = (body: string, names: string): string =>
  `/// @nudo:import { ${names} } from "./o.nudo.js"\n${body}`;


  it("入口 Abs 带 undefined 臂（与 union(lit(undefined), number()) 同构）；调用点谓词允许 undefined（`or(<base>, eq(x, undefined))`）；返回位：契约承认 nullish（`return undefined` 不再假红）；端到端：调用点传 undefined ⇒ 零 error（改前 nudo:constraint-violated）；端到端：返回 undefined 的实现对 `number()", () => {
  {
    const opt = constraintToEntryAbs(number().optional(), "x");
    const viaUnion = constraintToEntryAbs(union(litC(undefined), number()), "x");
    const optText = formatShape(opt);
    const unionText = formatShape(viaUnion);
    // 改前：`number`（undefined 臂整条丢失）
    expect(optText).toContain("undefined");
    expect(optText).toContain("number");
    // 与 `union(lit(undefined), number())` 这条等价写法**同构**（臂集合一致；
    // 臂顺序由 join 决定，不作断言）
    expect(opt.shape.k).toBe(viaUnion.shape.k);
    expect(optText.split(" | ").sort()).toEqual(unionText.split(" | ").sort());
  }
  {
    const p = instantiateConstraint(number().optional(), "x");
    expect(p.op).toBe("or");
    const text = predToString(p);
    expect(text).toContain('typeof x = "number"');
    expect(text).toContain("x = undefined");
    // 负控制：非可选位仍是单条 typeof（不得被误加 undefined 支）
    expect(instantiateConstraint(number(), "x").op).toBe("typeof");
  }
  {
    expect(constraintAdmitsNullish(number().optional())).toBe(true);
    // 负控制：非可选位仍不承认 nullish
    expect(constraintAdmitsNullish(number())).toBe(false);
    // 字段位不改变**外层对象**的 nullish 判定
    expect(constraintAdmitsNullish(shape({ a: number().optional() }))).toBe(false);
  }
  {
    const src = withImport(
      `
/**
 * @nudo:contract x optNum
 */
function f(x) {
  return x === undefined ? 0 : x;
}
f(undefined);
`,
      "optNum",
    );
    const r = checkSource("/t/bug088/o.js", src, pTrue, opts("/t/bug088/o.js"));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
    const src = withImport(
      `
/**
 * @nudo:contract return optNum
 */
function g() {
  return undefined;
}
`,
      "optNum",
    );
    const r = checkSource("/t/bug088/r.js", src, pTrue, opts("/t/bug088/r.js"));
    const ret = r.issues.filter((i) => i.message.includes("@nudo:contract return"));
    expect(ret).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
    const src = withImport(
      `
/**
 * @nudo:contract x reqNum
 */
function f(x) {
  return x === undefined ? 0 : x;
}
f(undefined);
`,
      "reqNum",
    );
    const r = checkSource("/t/bug088/req.js", src, pTrue, opts("/t/bug088/req.js"));
    expect(r.issues.some((i) => i.severity === "error")).toBe(true);
  }
  {
    const src = withImport(
      `
/**
 * @nudo:contract x optNum
 */
function f(x) {
  return x === undefined ? 0 : x;
}
`,
      "optNum",
    );
    const r = checkSource("/t/bug088/sig.js", src, pTrue, opts("/t/bug088/sig.js"));
    // 改前：形参面是 `number`（必填 number）——与 .d.ts 的 `x?: number` 矛盾
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.join(", ") ?? "").toContain("undefined");
  }
  {
    const a = constraintToEntryAbs(shape({ a: number().optional() }), "o");
    if (a.shape.k !== "obj") throw new Error("expected obj");
    const slot = a.shape.slots.a!;
    expect(slot.optional).toBe(true);
    // 槽值**不得**变成 sum（否则字段面从 `a?: number` 退化成 `a?: number | undefined`）
    expect(slot.value.shape.k).toBe("prim");
    expect(formatShape(a)).toBe("{ a?: number }");
  }
});








});

// ---------------------------------------------------------------------------
// 类声明前的 export 说明符语句不再让类方法签名塌 unknown
// ---------------------------------------------------------------------------
describe("类声明前的 export 说明符语句不再让类方法签名塌 unknown", () => {
/**
 * 类声明**之前**出现一条 `export { … };` 说明符语句 ⇒ 该类的实例
 * 方法 / 静态方法签名静默塌成 `unknown` ⇒ ① 签名面给出错值；② 追加一条**误导**
 * 诊断 `nudo:opaque-result`（提示「加 @nudo:case 或调用点」，真相是引擎内部
 * 异常）；③ **最重**：类方法的返回类型契约违规从 **error 降级成 warning** ⇒
 * `nudo check` exit 0 放行 ⇒ **假绿**；④ **顺序敏感**（同一份代码把
 * `export { q };` 挪到类之后 ⇒ 全部恢复正常）。
 *
 * 根因（generalize.ts 的 `ctorParamCountOf`）：遍历到 `ExportNamedDeclaration`
 * 且 `declaration === null`（说明符语句，不是声明语句）时解引用 `decl.type`
 * ⇒ 空指针 TypeError ⇒ 被 `runCore` 的空 `catch {}` 吞掉 ⇒ fail-closed
 * unknown。修复：显式跳过 null；并把「桥内部异常」与「B run 本身失败」区分
 * （前者记进 eval-fallback 统计，不再静默）。
 *
 * 钉：
 * - 三形态（`export { q }` 在类**前** / 在类**后** / 无）签名**逐字相同**
 * （顺序无关 = 不再顺序敏感）。
 * - 契约面：类方法返回类型契约被违反时必须是 **error**（不是 warning）。
 * - 负控制：`export const q = 1`（声明语句）形态不受影响。
 */






/** `export { q };` 在类**前**（说明符语句） */
const PRE = `const q = 1;
export { q };
export class Cls1031pre { m() { return 1; } }
`;
/** `export { q };` 在类**后** */
const POST = `const q = 1;
export class Cls1031post { m() { return 1; } }
export { q };
`;
/** 无 export 列表 */
const NONE = `const q = 1;
export class Cls1031none { m() { return 1; } }
`;
/** 负控制：`export const q = 1` 是**声明语句**（declaration 非 null） */
const DECL = `export const q = 1;
export class Cls1031decl { m() { return 1; } }
`;


  it("三形态（说明符语句在类前 / 类后 / 无）的符号面逐字相同；pre 形态（说明符语句在类前）的类方法签名不是 unknown；负控制：`export const q = 1`（声明语句）形态不受影响；check 面：三形态的签名显示逐字相同（不是 unknown）；契约面：类方法返回类型契约违规必须是 error（不是 warning）", () => {
  {
    const shapes = [PRE, POST, NONE].map((src) => {
      const cls = /class (\w+)/.exec(src)?.[1] ?? "";
      const g = generalizeFromAst(`${cls}.m`, src);
      expect(g, `generalizeFromAst 失败：${cls}`).toBeDefined();
      return formatShape_____format_format_ts(g!.symbolic);
    });
    // 修复前：pre 形态是 unknown，另两个是 1（顺序敏感）
    expect(shapes).toEqual(["1", "1", "1"]);
  }
  {
    const cls = "Cls1031pre";
    const g = generalizeFromAst(`${cls}.m`, PRE);
    expect(g).toBeDefined();
    expect(formatShape_____format_format_ts(g!.symbolic)).toBe("1");
    expect(g!.display).toBe(`${cls}.m: () => 1`);
  }
  {
    const cls = "Cls1031decl";
    const g = generalizeFromAst(`${cls}.m`, DECL);
    expect(g).toBeDefined();
    expect(formatShape_____format_format_ts(g!.symbolic)).toBe("1");
  }
  {
    const sigs = [PRE, POST, NONE].map((src, i) => {
      const file = `/t/b1031-${i}.js`;
      const r = checkSource(file, src, pTrue, { fromFile: file });
      const sig = r.signatures.find((s) => s.name.endsWith(".m"));
      return sig ?? null;
    });
    // 修复前：pre 形态是 unknown，另两个是 1（顺序敏感）
    // ⚠ `display` 自 起是人类面口径的 shape 渲染（不再带 `#conf` 段）
    expect(sigs.map((s) => s?.display)).toEqual(["1", "1", "1"]);
    expect(sigs.map((s) => s?.conf)).toEqual(["exact", "exact", "exact"]);
  }
  {
    // 侧车契约：Cls1031viol_m 的返回类型是 number，实测返回 string ⇒ 违规
    const src = `const q = 1;
export { q };
export class Cls1031viol { m(x) { return "not a number"; } }
`;
    const file = "/t/b1031-viol.js";
    const { loadModule } = makeFiles({
      "/t/b1031-viol.nudo.js": `export const Cls1031viol_m = fn({ x: number() }, number());\n`,
    });
    const r = checkSource(file, src, pTrue, { loadModule, fromFile: file });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated).toHaveLength(1);
    expect(violated[0]!.severity).toBe("error");
    // 修复前：签名塌 unknown ⇒ 违规降级成 warning 级 nudo:unproven-return
    const downgraded = r.issues.filter((i) => i.code === "nudo:unproven-return");
    expect(downgraded).toEqual([]);
  }
});





});

// ---------------------------------------------------------------------------
// for 循环变量槽 __nudoLv{N} 避开用户标识符
// ---------------------------------------------------------------------------
describe("for 循环变量槽 __nudoLv{N} 避开用户标识符", () => {
/**
 * 回归：for 循环变量捕获槽 `__nudoLv{N}` 必须**避开用户标识符**。
 *
 * 背景（的捕获槽）：`for (let i = …)` 的循环变量在体里是形参槽，
 * 体退出瞬间的最新写经 try/finally 写回**共享槽**（`__nudoLv{N}`），`$for`
 * 的 continue 臂经 `loopVar` 回调取用。槽名此前用**固定名**发射
 * （`__nudoLv${seq}`）⇒ 用户源码里声明了同名绑定时：
 *
 * ```js
 * export function f(){ const __nudoLv0 = 1; let s=0; for (let i=0;i<3;i++){ s+=i; } return s + __nudoLv0; }
 * ```
 *
 * 转译产物在**同一作用域**出现两个 `let __nudoLv0`（用户的绑定 + 生成的
 * 槽 `let`）⇒ `new Function` 抛 SyntaxError（Identifier '__nudoLv0' has
 * already been declared）⇒ 产物不是合法 JS ⇒ **整模块** fail-closed：
 * - **求值面**（`runTranspiled` / 库 API 直调）：整模块求值失败 ⇒ 全部导出
 * 退化 unknown；
 * - **check 面**：受损导出退 unknown + **假** `nudo:opaque-result`（"conf=opaque
 * (path not covered, or native)"——误导诊断）⇒ 该导出的门禁结论失真。
 *
 * 修法（`transpile/stmt/statement.ts`）：槽名经 `internalTmpName` 生成
 * （与 同款）——撞名则加 `_k` 后缀；**无碰撞时原名返回**
 * ⇒ 产物逐字不变；同源文本 ⇒ 同名 ⇒ 确定性（缓存键 / 差分语料依赖它）。
 *
 * 复现口径：槽名里的 `{N}` 取自**模块级全局计数器**（`forLoopVarSeq`）⇒
 * 只有计数器命中用户同名绑定时才撞 ⇒ 回归用 `vi.resetModules()` 取
 * **全新模块实例**（计数器归零 ⇒ 首个 for 循环 ⇒ `__nudoLv0`），复现与
 * 修复都可钉死（不受同文件其它用例的转译次数影响）。
 */


/** 模块图重新求值（首个用例最慢——冷缓存 + 并行负载）⇒ 超时放宽 */
const TIMEOUT = 60_000;

/**
 * 全新模块实例（`forLoopVarSeq` 计数器归零）——转译 / 求值 / check 全部
 * 走同一份新实例（口径一致）。
 */
async function freshCore() {
  vi.resetModules();
  const core = await import("../index.ts");
  const helpers = await import("./eval-helpers.ts");
  const abs = await import("../abs.ts");
  return { ...core, ...helpers, ...abs };
}

/** 用户声明了 `__nudoLv0`（与生成槽同名）+ 另一个必抛导出（L2 门禁探针） */
const SRC = `export function f(){ const __nudoLv0 = 1; let s = 0; for (let i = 0; i < 3; i++){ s += i; } return s + __nudoLv0; }
export function risky(){ throw new Error("boom"); }`;

/** 负控制：用户不同名 ⇒ 槽名保持原形（产物逐字不变） */
const SRC_CTRL = `export function f(){ let s = 0; for (let i = 0; i < 3; i++){ s += i; } return s; }`;

/** 产物里生成的循环变量捕获槽名（`let __nudoLv…;` 声明） */
function slotNames(js: string): string[] {
  return [...js.matchAll(/\blet (__nudoLv\w*);/g)].map((m) => m[1]);
}


  it("产物里不再有重复词法声明（修前：同作用域两个 `let __nudoLv0`）；整模块不再 fail-closed：f() 结果 = 原生 4（修前：SyntaxError ⇒ unknown）；check 面：受损导出拿到签名 + 无假 nudo:opaque-result（修前：f 退 unknown + 假 opaque）；负控制：用户不同名时槽名保持原形 `__nudoLv0`（产物逐字不变）", async () => {
  {
      const { transpileSource } = await freshCore();
      const js = transpileSource(SRC, { source: SRC });
      const slots = slotNames(js);
      expect(slots.length).toBe(1);
      // 槽名不得与用户同名绑定相同（否则重复词法声明 ⇒ 非法 JS）
      expect(slots[0]).not.toBe("__nudoLv0");
      // 用户的绑定原样保留
      expect(js).toContain("__nudoLv0 = $lit(1);");
  }
  {
      const { call, litValue } = await freshCore();
      expect(litValue(call(SRC, "f").result)).toEqual({ ok: true, value: 4 });
  }
  {
      const { checkSource, pTrue } = await freshCore();
      const r = checkSource("/t/loopvar-slot.js", SRC, pTrue, {});
      expect(r.signatures.find((s) => s.name === "f")?.display).not.toBe("unknown");
      expect(r.issues.map((i) => i.code)).not.toContain("nudo:opaque-result");
      // 无关导出的 L2 门禁仍在（不变量：门禁面不被本缺陷吞掉）
      const mayThrow = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
      expect(mayThrow.length).toBe(1);
      expect(mayThrow[0].fn).toBe("risky");
      expect(mayThrow[0].severity).toBe("error");
  }
  {
      const { transpileSource } = await freshCore();
      const js = transpileSource(SRC_CTRL, { source: SRC_CTRL });
      expect(slotNames(js)).toEqual(["__nudoLv0"]);
  }
});




});

// ---------------------------------------------------------------------------
// 展开实参的元数 / 长度边界
// ---------------------------------------------------------------------------
describe("展开实参的元数 / 长度边界", () => {
/**
 * 非字面量展开实参 `f(...args)` 被计为 **1 个**实参 ⇒
 * `nudo:arg-count` **假红**（P0：合法代码被判违约 ⇒ 卡死用户 CI）。
 *
 * 根因（`scan/literal-args.ts` 的 `parseCallArgs`）：`SpreadElement` 分支对
 * **非数组字面量**的展开只 push 一个 `absUnknown()` ⇒ `absArgs.length` = 1 ⇒
 * `scan-literal-calls.ts` 的 `syntacticArgCount` = 1 ⇒ 元数检查报
 * “expects 2 argument(s), got 1”。
 *
 * 同源三症状：
 * - a) `add(...xs)`（xs = [1,2]）同样误计成 1 个实参；
 * - b) **空洞** `three(...[1,,3])`：原生展开产出 `1, undefined, 3` **三个**实参，
 * 此前空洞被 `continue` 跳过 ⇒ 计成 2 个 ⇒ 假红；
 * - c) **幻影槽位**破坏 rest 聚合：`few(1, ...more)` 的 rest 聚合出
 * `[1, unknown]` ⇒ 长度 2 ⇒ 违反 `length(xs) <= 1`（假红）。
 *
 * 修法：
 * - 出现非数组字面量展开 ⇒ 实参**个数不可判** ⇒ `argCount = undefined`
 * ⇒ 元数检查整条跳过（fail-closed：不猜；实参义务检查照跑）；
 * - 数组字面量展开的**空洞**用 `absLit(undefined)` 计入实参数；
 * - rest / length 边界在展开处**停止**（展开后的槽位个数不可知 ⇒ 不计入
 * 已知长度）。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDE = `import { number, array } from "@nudojs/core";
export const few = array(number()).max(1);
`;

function check(src: string, file = "/t/spread.js") {
  const imp = `/// @nudo:import { few } from "./std.nudo.js"\n`;
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

/** 元数检查（`nudo:arg-count`）的 issue */
function argCountIssues(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:arg-count").length;
}

/** 契约违例的 issue */
function violationIssues(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated").length;
}


  it("f(...args) 展开到 2 参函数 ⇒ 不报元数错（个数不可判 ⇒ 跳过）；add(...xs)（xs 是局部数组）⇒ 不报元数错；数组字面量展开的空洞算一个实参（three(...[1,,3]) ⇒ 3 个）；rest 长度边界在展开处停止（few(1, ...more) 不违反 length <= 1）；负控制：真·少传实参仍然报元数错（不掩盖真违规）；负控制：数组字面量展开的实参个数仍按展开后计（f(...[1,2,3]) 对 2 参函数 ⇒ 多传警告）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`function impl(a, b) { return [a, b]; }
export function wrap(...args) { return impl(...args); }
`);
    expect(argCountIssues(r)).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`function add(a, b) { return a + b; }
export function use() { const xs = [1, 2]; return add(...xs); }
`);
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`function three(a, b, c) { return a; }
export function use() { return three(...[1, , 3]); }
`);
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`/** @nudo:contract xs few */
function few(...xs) { return xs; }
export function use() { const more = [1, 2, 3]; return few(1, ...more); }
`);
    expect(violationIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`function impl(a, b) { return [a, b]; }
export function use() { return impl(1); }
`);
    expect(argCountIssues(r)).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`function impl(a, b) { return [a, b]; }
export function use() { return impl(...[1, 2, 3]); }
`);
    expect(argCountIssues(r)).toBeGreaterThan(0);
  }
});






});

// ---------------------------------------------------------------------------
// 裸名 callee 尊重词法作用域
// ---------------------------------------------------------------------------
describe("裸名 callee 尊重词法作用域", () => {
/**
 * 裸名 callee 的解析**不看作用域** ⇒ 无契约也触发元数**假红**
 * （P1）。
 *
 * 复现（已核实）：`function log(level,msg){}` +
 * `export function run(log){ log("hi") }` ⇒ 报 `[ERROR L2 log] log expects 2
 * argument(s), got 1` —— 但 `run` 的形参 `log` **遮蔽**了顶层声明的 `log`
 * ⇒ 这次调用的是**形参**（不是顶层那个 2 参函数）⇒ 元数检查不该套上去。
 *
 * 根因（`scan-call-graph.ts` 的 `resolveCalleeFn` 的 Identifier 分支）：
 * `knownFns.has(name)` 就当被调函数 ⇒ **完全无视**词法作用域。
 *
 * 报告点出的 5 类遮蔽来源（全部钉住）：参数 / 局部 `const` / 嵌套函数 /
 * for-of 绑定 / 解构绑定。
 *
 * 修法：解析裸名 callee 时**尊重作用域** —— 沿作用域链（内层 → 外层）找绑定：
 * 命中别名（`const f = knownFn`）⇒ 用别名；命中同名声明 ⇒ **遮蔽** ⇒ 不解析成
 * 顶层声明的那个函数（fail-closed：不猜）。
 *
 * ⚠ 同一复现里还有一条 `nudo:entry-may-throw`（`run (export): may throw
 * TypeError`）：那是**求值引擎**对「调用未受约束的值」的 fail-closed 判定
 * （`check.ts` / `exec/**` 面，不在本修复范围）⇒ 本钉只断言**元数**通道。
 */






beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 元数检查（`nudo:arg-count`）的 issue 数 */
function argCountIssues(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:arg-count").length;
}

function check(src: string, file = "/t/callee-scope.js") {
  return checkSource(file, src, pTrue, {});
}

const TOP = `function log(level, msg) { return level; }
`;


  it("形参同名 ⇒ 不套顶层函数的元数；局部 const 同名 ⇒ 不套顶层函数的元数；嵌套函数同名 ⇒ 不套顶层函数的元数；for-of 绑定同名 ⇒ 不套顶层函数的元数；解构绑定同名 ⇒ 不套顶层函数的元数；负控制：没有同名遮蔽 ⇒ 顶层函数的元数照常检查（真违规仍报）；负控制：别名绑定仍按别名解析（const f = log ⇒ f() 查 log 的元数）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`${TOP}
export function run(log) { log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`${TOP}
export function run() { const log = (a, b) => a; log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`${TOP}
export function run() { function log(a, b) { return a; } log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`${TOP}
export function run(xs) { for (const log of xs) { log("hi"); } }
`);
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`${TOP}
export function run(o) { const { log } = o; log("hi"); }
`);
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`${TOP}
export function run() { log("hi"); }
`);
    expect(argCountIssues(r)).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`${TOP}
export function run() { const f = log; f("hi"); }
`);
    expect(argCountIssues(r)).toBe(1);
  }
});







});

// ---------------------------------------------------------------------------
// 成员调用绑定按作用域分桶
// ---------------------------------------------------------------------------
describe("成员调用绑定按作用域分桶", () => {
/**
 * `memberToFn`（成员调用绑定）按**变量名**做键 ⇒ 同名局部 / 参数
 * 互相串味 ⇒ 假红（P1）。
 *
 * 复现（ambient 侧车 `A_m=fn({x:number().gt(0)})` / `B_m=fn({x:string()})`）：
 * - `useA(){const c=new A(); return c.m(1)}` +
 * `useB(){const c=new B(); return c.m("s")}` ⇒ 误报
 * `B.m[x]: 1 !<= typeof x="string"`（`c.m` 的键被**后写覆盖**）；
 * - `const c=new A(); export function other(c){return c.m(-1)}` ⇒ 在**无关参数**
 * 上套用了 `A.m` 的契约（形参 `c` 遮蔽了顶层 `c`）；
 * - `let c=new C(); c={m:x=>x}; c.m(-1)` ⇒ 重新赋值后别名仍有效。
 *
 * 根因（`scan-call-graph.ts` 的 `memberToFn`，引入）：键只有
 * `变量名.属性名` ⇒ 与作用域无关；`walkStatements` 还会下探函数体 ⇒ 后写覆盖
 * 先写；别名也不会在重新赋值时失效。
 *
 * 修法：
 * - 成员绑定**按作用域分桶**（作用域帧）⇒ 同名局部 / 参数不再串味；
 * - 沿作用域链解析 `obj.prop`：本作用域有绑定就用；本作用域**声明**了 `obj`
 * 但没有该成员绑定 ⇒ **遮蔽** ⇒ 不回落外层；
 * - **重新赋值**使别名 / 成员绑定失效。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

const SIDECAR = `import { fn, number, string } from "@nudojs/core";
export const A_m = fn({ x: number().gt(0) });
export const B_m = fn({ x: string() });
export const C_m = fn({ x: number().gt(0) });
`;

/** ambient 侧车（同名 .nudo.js 文件）——类方法契约绑 `A_m` ↔ `A.m` */
function check(src: string, file = "/t/member-scope.js") {
  const { loadModule } = makeFiles({ "/t/member-scope.nudo.js": SIDECAR });
  return checkSource(file, src, pTrue, { loadModule, fromFile: file });
}

/** 调用点前置条件违例 */
function violated(r: { issues: { code: string; fn?: string }[] }): unknown[] {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}


  it("两个函数里的同名局部（new A / new B）不再串味 ⇒ 零违例；负控制：A.m 的契约仍执法（c.m(-1) 报违例）；负控制：B.m 的契约仍执法（c.m(1) 报违例）；形参遮蔽顶层实例 ⇒ 不套用顶层实例的成员契约；重新赋值使成员别名失效（c = {m:x=>x} 之后不再套 C.m 的契约）；负控制：顶层实例的成员契约仍执法（未被遮蔽 / 未重新赋值）", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`export class A { m(x) { return x; } }
export class B { m(x) { return x; } }
export function useA() { const c = new A(); return c.m(1); }
export function useB() { const c = new B(); return c.m("s"); }
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`export class A { m(x) { return x; } }
export function useA() { const c = new A(); return c.m(-1); }
`);
    expect(violated(r).length).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`export class B { m(x) { return x; } }
export function useB() { const c = new B(); return c.m(1); }
`);
    expect(violated(r).length).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`export class A { m(x) { return x; } }
const c = new A();
export function other(c) { return c.m(-1); }
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`export class C { m(x) { return x; } }
export function use() { let c = new C(); c = { m: (x) => x }; return c.m(-1); }
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(`export class C { m(x) { return x; } }
const c = new C();
c.m(-1);
`);
    expect(violated(r).length).toBe(1);
  }
});






});

// ---------------------------------------------------------------------------
// 可省略形参不计入必选元数
// ---------------------------------------------------------------------------
describe("可省略形参不计入必选元数", () => {
/**
 * TS `x?: T` 与 JSDoc `[x]` 的形参被当成**必需**参数 ⇒ 元数检查
 * **假红**（P1）。
 *
 * 复现（已核实）：`/** @param {number} [x] *\/ function h(x){}` +
 * `export function caller(){ return h(); }` ⇒ 报 `[ERROR L3 h] h expects 1
 * argument(s), got 0` —— 但 JSDoc 的方括号 = **可省略** ⇒ `h()` 是合法调用。
 *
 * 根因（`param-surface.ts` 的 `formalParamsFromNodes`）：标识符形参一律写死
 * `optional: false` ⇒ 必选元数（`diagnostics.ts` 的 `arityFace` 据
 * `formals[].optional` 算）把可省略的形参算成必填 ⇒ 元数检查假红。
 *
 * 修法（两路来源）：
 * - **JSDoc**：`@param {T} [x]` / `@param {T} [x=1]` 的方括号形态 = 可选；
 * - **TS**：`x?: T` 的 `?` 标记 —— 注意 AST 的 `optional` 标志在 parse 阶段的
 * 类型擦除里已被**删掉**（TS-only 字段）⇒ 只能从**源码文本**判定（绑定名 /
 * 模式之后的 `?`；默认值与类型注解里的 `?` 不误判）。
 *
 * 形参表来自泛化结果（memo 共享）⇒ 只换一份带 `optional` 的副本，不改原对象。
 */






beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** 元数检查（`nudo:arg-count`）的 issue 数 */
function argCountIssues(r: { issues: { code: string }[] }): number {
  return r.issues.filter((i) => i.code === "nudo:arg-count").length;
}

function check(src: string, file: string) {
  return checkSource(file, src, pTrue, {});
}


  it("JSDoc @param {number} [x] ⇒ h() 不报元数错；JSDoc @param {string} [y=\"a\"] ⇒ 带默认值的方括号形态也算可选；TS x?: number ⇒ h() 不报元数错；TS export function h(x?: number) ⇒ 同样不报（JSDoc/TS 挂在 export 上）；负控制：必需形参少传实参仍然报元数错；负控制：JSDoc 的非方括号 @param 是必填 ⇒ 仍报元数错", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(
      `/** @param {number} [x] */
function h(x) {}
export function caller() { return h(); }
`,
      "/t/jsdoc-optional.js",
    );
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(
      `/** @param {string} [y="a"] */
function h(y) {}
export function caller() { return h(); }
`,
      "/t/jsdoc-optional-default.js",
    );
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(
      `function h(x?: number) {}
export function caller() { return h(); }
`,
      "/t/ts-optional.ts",
    );
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(
      `export function h(x?: number) {}
export function caller() { return h(); }
`,
      "/t/ts-optional-export.ts",
    );
    expect(argCountIssues(r)).toBe(0);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(
      `function h(x) {}
export function caller() { return h(); }
`,
      "/t/required.js",
    );
    expect(argCountIssues(r)).toBe(1);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = check(
      `/** @param {number} x */
function h(x) {}
export function caller() { return h(); }
`,
      "/t/jsdoc-required.js",
    );
    expect(argCountIssues(r)).toBe(1);
  }
});






});

// ---------------------------------------------------------------------------
// CJS 对象字面量导出的普查键必须是**成员键**
// ---------------------------------------------------------------------------
describe("CJS 对象字面量导出的普查键必须是**成员键**", () => {
/**
 * （并发 review F20 / P2）—— 对**具名函数表达式**（CJS 对象字面量）
 * 的修复不完整。
 *
 * 根因：`packages/core/src/algebra/export-slot.ts` 的 `cjsMemberSlotsOf` 用
 * `fnId ?? key`（具名函数表达式的**内层 id**）当普查键，而普查面
 * （`scan-top-functions.ts` 的 CJS 分支，#152/之后）早已改用
 * **成员键**（`pushFnFromInit(keyName, …)` ⇒ `fallbackName ?? r.id?.name`）
 * ⇒ 两侧口径分裂：
 *
 * - `module.exports = { greet: function inner(x) { … } }` ⇒ 普查名 = `greet`，
 * 但导出槽表里的键是 `inner` ⇒ `resolveExportSlotCall("greet")` 查不到 ⇒
 * 侧车契约**整个不绑定** ⇒ 只剩 `nudo:unproven-return` 警告，`greet` 签名
 * 退成 `unknown`（**假绿**：应报 `nudo:constraint-violated`）；
 * - 匿名 FE / 箭头 / 对象方法 / `exports.greet = function inner(){}` ⇒ 都走
 * 成员键 ⇒ 都报 `constraint-violated` ⇒ **行为不一致**；
 * - 碰撞：`{ a: function b(){return 1}, b: () => "bad" }` ⇒ 表里只有
 * `b -> a` ⇒ 成员 `b` 被解析到成员 `a` 的函数（映射串了）。
 *
 * 修法：导出槽表**只用成员键**（普查名口径 = 成员键）。
 */








/** 侧车：`greet` 的返回必须是 > 0 的数（源码返回 -1 ⇒ 应报 constraint-violated） */
const SIDECAR = `import { fn, number } from "@nudojs/core";
export const greet = fn({ x: number() }, number().gt(0));
`;

const FILE = "/t/bug1128/D.js";

/** 跑一遍 check（同一份侧车 ⇒ 同一份契约面） */
function run(src: string) {
  const { loadModule } = makeFiles({ "/t/bug1128/D.nudo.js": SIDECAR });
  return checkSource_____check_check_ts(FILE, src, pTrue_____pred_ts, { loadModule, fromFile: FILE });
}

/** issue 码集合（按出现顺序） */
const codesOf = (r: { issues: { code: string }[] }): string[] => r.issues.map((i) => i.code);

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("具名函数表达式：侧车契约绑定 ⇒ 报 constraint-violated（修前：只有 unproven-return + unknown）；与其它导出形态**同口径**（匿名 FE / 箭头 / 对象方法 / exports.greet = 具名 FE）；成员键不串：{ a: function b(){…}, b: () => \"bad\" } ⇒ a / b 各归各", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = run(`module.exports = {
  greet: function inner(x) {
    return -1;
  },
};
`);
    expect(codesOf(r)).toContain("nudo:constraint-violated");
    // 契约绑定 ⇒ 签名不再是「不可解析」的 unknown
    expect(sigOf(r, "greet")).not.toBe("unknown");
    expect(sigOf(r, "greet")).toBe("-1");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const forms: Record<string, string> = {
      "匿名 FE": `module.exports = {
  greet: function (x) {
    return -1;
  },
};
`,
      箭头: `module.exports = {
  greet: (x) => -1,
};
`,
      对象方法: `module.exports = {
  greet(x) {
    return -1;
  },
};
`,
      "exports.greet = 具名 FE": `exports.greet = function inner(x) {
  return -1;
};
`,
      "具名 FE（对象字面量）": `module.exports = {
  greet: function inner(x) {
    return -1;
  },
};
`,
    };
    const seen = new Map<string, string[]>();
    for (const [label, src] of Object.entries(forms)) {
      seen.set(label, codesOf(run(src)));
    }
    // 匿名 FE 是基准（它一直是对的）
    const baseline = seen.get("匿名 FE");
    expect(baseline).toContain("nudo:constraint-violated");
    for (const [label, codes] of seen) {
      expect(codes, label).toEqual(baseline);
    }
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = run(`module.exports = {
  a: function b() { return 1; },
  b: () => "bad",
};
`);
    // a ⇒ function b(){return 1} ⇒ 返回 1
    expect(sigOf(r, "a")).toBe("1");
    // b ⇒ 箭头 ⇒ 返回 "bad"
    expect(sigOf(r, "b")).toBe('"bad"');
  }
});


}
});

// ---------------------------------------------------------------------------
// 超参 warning 只按**非 rest 形参总数**判
// ---------------------------------------------------------------------------
describe("超参 warning 只按**非 rest 形参总数**判", () => {
/**
 * （并发 review F25 / P2）—— 超参 warning 忽略**可选 / 默认槽位**。
 *
 * 现象：`f(a, b = 1)` 被 `f(1, 2)` 调用（2 个实参）⇒ 报
 * 「f takes 1 argument(s) but 2 were passed」——但 JS 里 `b` **吃下**第二个
 * 实参（`b === 2`）⇒ 合法调用 ⇒ 误报（假红）。
 *
 * 根因：`packages/core/src/algebra/diagnostics.ts` 的 `arityFace` 只回
 * `required`（**必填**实参位个数），超参判定直接拿它当上界
 * （`argCount > required`）⇒ 默认形参占的位被当成「不存在」。
 *
 * 修法：超参 warning 只在 `argCount > formals.length`（**非 rest** 的形参
 * 总数）时才发；少参 error 仍按 `required`（必填位）判。
 */









/** 调一次调用点，返回 issue 码 + 消息 */
function callSite(src: string, callee: string, args: number[]) {
  const issues = checkCallSite(src, callee, args.map((n) => numLit(n)), { argCount: args.length });
  return issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message }));
}

{
  beforeEach(() => {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();
  });

  it("默认形参吃下第 2 个实参 ⇒ 不报超参；真超参（形参位不够）⇒ 仍报 warning；rest 形参吸收多余实参 ⇒ 不报超参；少传必填位 ⇒ 仍是 error（口径不变）；端到端：check 面上 f(1, 2) 不再误报（文档示例 cartTotal(items, couponPercent = 0) 同形）", () => {
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = `export function f(a, b = 1) { return a + b; }`;
    expect(callSite(src, "f", [1, 2])).toEqual([]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = `export function f(a, b) { return a + b; }`;
    const issues = callSite(src, "f", [1, 2, 3]);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("nudo:arg-count");
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toContain("takes 2 argument(s) but 3 were passed");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = `export function f(a, ...rest) { return a; }`;
    expect(callSite(src, "f", [1, 2, 3, 4, 5])).toEqual([]);
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const src = `export function f(a, b = 1) { return a + b; }`;
    const issues = callSite(src, "f", []);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("expects 1 argument(s), got 0");
  }
  {
    resetEngineCaches();
    takeRefineDiags();
    takeContractDiags();


    const r = checkSource_____check_check_ts(
      "/t/bug1131.js",
      `export function cartTotal(items, couponPercent = 0) {
  return items.length + couponPercent;
}
export function receipt(items, couponPercent = 0) {
  return cartTotal(items, couponPercent);
}
`,
      pTrue_____pred_ts,
      { fromFile: "/t/bug1131.js" },
    );
    expect(r.issues.filter((i) => i.code === "nudo:arg-count")).toEqual([]);
  }
});




}
});

// ---------------------------------------------------------------------------
// await 位置表与转译侧对齐（模块不得整份编译失败）
// ---------------------------------------------------------------------------
describe("await 位置表与转译侧对齐（模块不得整份编译失败）", () => {
/**
 * 回归 —— `await` 的**位置表**与转译侧脱节 ⇒ `yield` 落进嵌套箭头
 * ⇒ `new Function` SyntaxError ⇒ **整个模块**编译失败 ⇒ 全部导出丢失
 * ⇒ L2 闸门（`nudo:entry-may-throw`）看不到任何入口 ⇒ **零诊断 + exit 0**
 * ⇒ **CI 闸门假绿**（合法代码与违约代码都判绿）。
 *
 * 机理：async 体的真挂起靠**宿主生成器**（`function*(){…}` + `await` 发射
 * `yield`）实现 ⇒ `yield` 必须落在生成器**体内联**位置。转译侧把若干操作数
 * 包进**宿主 thunk**（`() => {…}` / `() => [args]`）——`yield` 落在里面是
 * 语法错误。`async-plan.ts` 的位置表此前只把「分支臂 / 循环体 / 短路右臂 /
 * 三元两臂」判为 thunk，漏了：
 *
 * - **成员调用的实参**（`o.m(await 1)`）——的求值序（成员读先于
 * 实参求值）把实参包进 `$invoke` 内部的 `() => [args]`；
 * - **成员赋值的接收者 / 计算键 / 右值**（`o.x = await 1` / `o[k] = v`）——
 * member-path 的读改写 IIFE **体**内；
 * - **标识符/成员自增的计算键**（`o[await k]++`）；
 * - **逻辑赋值的右值**（`x ||= await 1`）——`$fork` 臂内；
 * - **循环判别式与步进式**（`while (i < await 1)` / `for(;;i += await 1)`）；
 * - **switch 的 case 测试**（`case await 1:`）；
 * - **早退守卫之后的后续语句**（`if (!c) return null; … await …`）——
 * 转译侧把它们搬进 `$fork` 的 alt 臂（宿主 thunk）。
 *
 * 修法（两处，缺一不可）：
 * 1. **位置表补齐**（`async-plan.ts`）：上列位置一律判 thunk ⇒ 该 async 体
 * 回落 `$async` 同步路径（`await` → `$await`）⇒ 产物是**合法 JS**。
 * 2. **安全网**（`run.ts`）：生成器模式编译失败（SyntaxError）时**关闭
 * asyncGen 重试一次** ⇒ 纵有未来新增的脱节位置，模块也**编译得出来**
 * ⇒ 导出可见 ⇒ 闸门照常判定（宁可少精确，不可整模块消失）。
 *
 * 断言口径：
 * - **产物面**：每个 `await` 位置的转译产物都**能编译**（`new Function`）。
 * - **闸门面**：整模块不再 fail-closed ⇒ 同文件的其它导出（`risky()`）仍报
 * `nudo:entry-may-throw`（error 级）⇒ 修前该诊断消失（假绿）。
 */




/**
 * 转译产物能否编译（`new Function`）。
 *
 * 产物首行是 runtime import（`import { … } from "@nudojs/core/exec";`）——
 * 剥掉它，把 runtime 绑定名当形参传进 `new Function`（与求值引擎同口径：
 * runtime 绑定由宿主注入）。`export` 前缀也要剥（`new Function` 体不是模块）。
 */
function compiles(src: string): { ok: boolean; error?: string } {
  const out = transpileSource(src, { source: src });
  const lines = out.split("\n");
  const impLine = lines.find((l) => l.startsWith("import ")) ?? "";
  const m = impLine.match(/\{([^}]*)\}/);
  const names = m
    ? m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const body = out.replace(impLine, "").replace(/^export /gm, "");
  try {
    // eslint-disable-next-line no-new-func
    new Function(...names, body);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** async 函数的 await 位置矩阵（表达式位） */
const EXPR_SLOTS: Array<[string, string]> = [
  ["变量初始化", "const x = AWAIT; return x;"],
  ["return 实参", "return AWAIT;"],
  ["标识符调用实参", "return k(AWAIT);"],
  ["成员调用实参", "return o.m(AWAIT);"],
  ["成员调用实参（嵌套）", "return o.m(k(AWAIT));"],
  ["计算成员读", "return o[AWAIT];"],
  ["成员赋值右值", "o.x = AWAIT;"],
  ["成员赋值计算键", "o[AWAIT] = 1;"],
  ["成员复合赋值", "o.x += AWAIT;"],
  ["标识符赋值", "x = AWAIT;"],
  ["标识符复合赋值", "x += AWAIT;"],
  ["逻辑赋值", "x ||= AWAIT;"],
  ["逻辑与赋值", "x &&= AWAIT;"],
  ["空值合并赋值", "x ??= AWAIT;"],
  ["成员自增计算键", "o[AWAIT]++;"],
  ["数组元素", "const a = [AWAIT]; return a;"],
  ["对象字面量值", "const o2 = { a: AWAIT }; return o2;"],
  ["模板字面量", "return `${AWAIT}`;"],
  ["new 实参", "return new C(AWAIT);"],
  ["spread 实参", "return k(...AWAIT);"],
  ["二元左", "return AWAIT + 1;"],
  ["二元右", "return 1 + AWAIT;"],
  ["一元", "return !AWAIT;"],
  ["typeof", "return typeof AWAIT;"],
  ["三元测试", "return AWAIT ? 1 : 2;"],
  ["三元真臂", "return 1 ? AWAIT : 2;"],
  ["三元假臂", "return 1 ? 2 : AWAIT;"],
  ["短路左", "return AWAIT || 1;"],
  ["短路右", "return 1 || AWAIT;"],
  ["与左", "return AWAIT && 1;"],
  ["与右", "return 1 && AWAIT;"],
  ["空值合并左", "return AWAIT ?? 1;"],
  ["空值合并右", "return 1 ?? AWAIT;"],
];

/** async 函数的 await 位置矩阵（语句位） */
const STMT_SLOTS: Array<[string, string]> = [
  ["if 测试", "if (AWAIT) { g(); }"],
  ["if 臂", "if (x) { return AWAIT; }"],
  ["if-else 臂", "if (x) { return AWAIT; } else { return 2; }"],
  ["while 判别式", "while (AWAIT) { break; }"],
  ["do-while 判别式", "do { break; } while (AWAIT);"],
  ["for 判别式", "for (; AWAIT; ) { break; }"],
  ["for 步进式", "for (;; AWAIT) { break; }"],
  ["for 初始化", "for (let i = AWAIT; i < 2; i++) { break; }"],
  ["for-of 右值", "for (const x of AWAIT) { break; }"],
  ["for-in 右值", "for (const k in AWAIT) { break; }"],
  ["switch 判别式", "switch (AWAIT) { default: break; }"],
  ["case 测试", "switch (x) { case AWAIT: break; default: break; }"],
  ["try 块", "try { const x = AWAIT; } catch (e) { }"],
  ["catch 体", "try { } catch (e) { const x = AWAIT; }"],
  ["throw 实参", "throw AWAIT;"],
  ["标签语句", "lbl: g(AWAIT);"],
  ["裸块", "{ const x = AWAIT; }"],
  ["早退守卫之后", "if (!c) return null; const x = AWAIT; return x;"],
  ["早抛守卫之后", "if (!c) throw new Error('x'); const x = AWAIT; return x;"],
  ["守卫块形态", "if (!c) { return null; } const x = AWAIT; return x;"],
  ["守卫在嵌套块", "{ if (!c) return null; const x = AWAIT; return x; }"],
];

/** 触发源（async 函数 + await 占位） */
function srcOf(slot: string): string {
  return `export async function f() { ${slot.replace(/AWAIT/g, "await 1")} }\n`;
}

{
  for (const [name, slot] of [...EXPR_SLOTS, ...STMT_SLOTS]) {
    it(`表达式位/语句位：${name} ⇒ 转译产物可编译`, () => {
      const r = compiles(srcOf(slot));
      expect(r.ok, `${name}: ${r.error ?? ""}`).toBe(true);
    });
  }

  it("闸门面：整模块不再 fail-closed ⇒ 其它导出的 L2 门禁仍触发；闸门面：常见的 fetch 形态（早退守卫 + await）不再整模块假绿；安全网：关闭 asyncGen 后同一份源仍能编译（生成器路径的兜底）；位置表：成员调用实参 / 成员赋值 / 循环判别式 / case 测试 / 守卫之后 ⇒ 判 thunk", () => {
  {
    // 修前：`o.m(await 1)` 让**整个模块**编译失败 ⇒ `risky` 的
    // `nudo:entry-may-throw` 消失（零诊断 + exit 0 ⇒ 假绿）。
    const src = `const o = { m(x) { return x; } };
export async function f() { return o.m(await 1); }
export function risky() { throw new Error("boom"); }`;
    const r = checkSource("/t/async-await-pos.js", src, pTrue, {});
    expect(l2Count(r, "risky")).toBe(1);
    // async 导出本身可见（不是 opaque/unknown 消失）
    expect(sigOf(r, "f")).not.toBe("(missing)");
  }
  {
    const src = `export async function load(id) {
  if (!id) return null;
  const res = await fetch("/x/" + id);
  return res.json();
}
export function risky() { throw new Error("boom"); }`;
    const r = checkSource("/t/async-await-guard.js", src, pTrue, {});
    expect(l2Count(r, "risky")).toBe(1);
    expect(sigOf(r, "load")).not.toBe("(missing)");
  }
  {
    const src = `export async function f() { return o.m(await 1); }`;
    const out = transpileSource(src, { source: src, disableAsyncGen: true });
    expect(out).toContain("$await(");
    expect(out).not.toContain("(yield ");
  }
  {
    // 直接钉 `asyncBodyPlan` 的判定（产物面的行为由上面的矩阵覆盖）。
    const cases: Array<[string, boolean]> = [
      // [源片段, 是否应回落 $async（即位置表判 thunk ⇒ allSafe=false）]
      ["return o.m(await 1);", true],
      ["return k(await 1);", false],
      ["o.x = await 1;", true],
      ["x = await 1;", false],
      ["x ||= await 1;", true],
      ["while (i < await 1) { break; }", true],
      ["switch (x) { case await 1: break; }", true],
      ["if (!c) return null; const z = await 1; return z;", true],
      ["const z = await 1; return z;", false],
    ];
    for (const [frag, expectThunk] of cases) {
      const src = `export async function f() { ${frag} }`;
      const out = transpileSource(src, { source: src });
      const generatorMode = out.includes("$asyncGen(function*");
      expect(generatorMode, `${frag} ⇒ 生成器路径应=${!expectThunk}`).toBe(!expectThunk);
    }
  }
});



}
});

// ---------------------------------------------------------------------------
// 导入类的成员调用点执法
// ---------------------------------------------------------------------------
describe("导入类的成员调用点执法", () => {
/**
 * 类成员的参数契约在**导入类实例** / **内联 `new`** / **静态调用**
 * 形态下不执法（假绿）。
 *
 * 复现（`lib.js` 的类方法带侧车契约 `K_m` / `K_s`，`main.js` 导入 K）：
 * - `const c = new K(); c.m(-1)` ⇒ 0 诊断（本地类实例 `c.m(-1)` 已执法）；
 * - `new K().m(-1)`（导入 / 本地都）⇒ 0；
 * - `K.s(-1)`（导入 / 本地都）⇒ 0。
 *
 * 根因：`scan-call-graph.ts` 的实例成员绑定只按 `knownFns` 前缀收**本地**类，
 * 导入类（`externalFn`）不建成员绑定；`resolveCalleeFn` 只认 Identifier
 * 接收者，没有静态（`K.s`）与内联（`new K().m`）路径。
 *
 * 修法：类成员的调用点解析改由**类 AST 事实**驱动（own 实例 / 静态方法），
 * 本地类仍走 `knownFns` 闸门（未导出的类保持零诊断），导入类走外部模块
 * 描述（`checkExternalCall` + 定义文件侧车）。守卫：继承 / 构造器
 * `this.m = …` / getter-setter / computed / 遮蔽 / 重新赋值 / 静态实例交叉
 * 调用一律不解析。
 */





beforeEach(() => {
  resetCheckSourceMemo();
});

/** 类 + 普通函数（侧车契约绑 K_m / K_s / f） */
const LIB = `export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
export function f(a) { return a; }
`;

const LIB_SIDECAR = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const K_s = fn({ a: positive }, number());
export const f = fn({ a: positive }, number());
`;

/** 同文件本地类（导出 ⇒ 进 knownFns 普查面，与 的本地实例路径同闸门） */
const LOCAL = `export class L {
  m(a) { return a; }
  static s(a) { return a; }
}

const c = new L();
c.m(-1);
`;

const LOCAL_SIDECAR = `export const positive = number().gt(0);
export const L_m = fn({ a: positive }, number());
export const L_s = fn({ a: positive }, number());
`;

/** 默认虚拟文件集：lib 三件套 */
function filesOf(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "/t/lib.js": LIB,
    "/t/lib.nudo.js": LIB_SIDECAR,
    ...extra,
  };
}

function check(
  source: string,
  extra: Record<string, string> = {},
  file = "/t/b1154-main.js",
) {
  const { loadModule } = makeFiles(filesOf(extra));
  return checkSource(file, source, pTrue, { loadModule, fromFile: file });
}

/** 调用点契约违例（按被调名可过滤） */
function violated(
  r: { issues: Array<{ code: string; fn?: string }> },
  fn?: string,
): Array<{ code: string; fn?: string }> {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (fn === undefined || i.fn === fn),
  );
}


  it("导入类实例：const c = new K(); c.m(-1) ⇒ K.m 违例；导入类内联：new K().m(-1) ⇒ K.m 违例；导入类静态：K.s(-1) ⇒ K.s 违例；导入类：合法实参（1 / 5）三种形态都不报；导入普通函数 f(-1) 既有强制不回归（负控制）；导入普通函数 f(5) 不报（负控制）", () => {
  {
  resetCheckSourceMemo();


    const r = check(`import { K } from "./lib.js";
const c = new K();
c.m(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.m")).toHaveLength(1);
    expect(r.ok).toBe(false);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { K } from "./lib.js";
new K().m(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { K } from "./lib.js";
K.s(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.s")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { K } from "./lib.js";
const c = new K();
c.m(1);
new K().m(1);
K.s(5);
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { f } from "./lib.js";
f(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "f")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { f } from "./lib.js";
f(5);
`);
    expect(violated(r)).toEqual([]);
  }
});







describe("本地类：内联 new / 静态调用补齐（实例路径不回归）", () => {
  it("本地类实例：const c = new L(); c.m(-1) ⇒ L.m（既有路径）；本地类内联：new L().m(-1) ⇒ L.m；本地类静态：L.s(-1) ⇒ L.s；本地类：合法实参（1 / 5）不报（负控制）", () => {
  {
  resetCheckSourceMemo();


    const r = check(LOCAL, { "/t/local.js": LOCAL, "/t/local.nudo.js": LOCAL_SIDECAR }, "/t/local.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const src = `export class L {
  m(a) { return a; }
}
new L().m(-1);
`;
    const r = check(
      src,
      { "/t/local-inline.js": src, "/t/local-inline.nudo.js": LOCAL_SIDECAR },
      "/t/local-inline.js",
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const src = `export class L {
  static s(a) { return a; }
}
L.s(-1);
`;
    const r = check(
      src,
      { "/t/local-static.js": src, "/t/local-static.nudo.js": LOCAL_SIDECAR },
      "/t/local-static.js",
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.s")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const src = `export class L {
  m(a) { return a; }
  static s(a) { return a; }
}
const c = new L();
c.m(1);
new L().m(1);
L.s(5);
`;
    const r = check(
      src,
      { "/t/local-ok.js": src, "/t/local-ok.nudo.js": LOCAL_SIDECAR },
      "/t/local-ok.js",
    );
    expect(violated(r)).toEqual([]);
  }
});



});

describe("同名静态 / 实例：按 AST 事实区分", () => {
  /** 静态 m 有源码契约；实例 m 无契约（的 scope 名 `C.static.m`） */
  const COLLIDE_LIB = `/// @nudo:import { positive } from "./lib2.nudo.js"
export class C {
  m(a) { return a; }

  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }
}
`;
  const COLLIDE_SIDECAR = `export const positive = number().gt(0);
`;

  const collideFiles = {
    "/t/lib2.js": COLLIDE_LIB,
    "/t/lib2.nudo.js": COLLIDE_SIDECAR,
  };

  it("静态同名调用 C.m(-1) ⇒ 只套静态契约（C.static.m）；实例同名调用（new C().m / const c = new C(); c.m）⇒ 实例无契约，零诊断；静态同名调用合法实参 C.m(1) 不报（负控制）；本地类同名：C.m(-1) 只套静态契约，实例调用零诊断", () => {
  {
  resetCheckSourceMemo();


    const r = check(`import { C } from "./lib2.js";
C.m(-1);
`, collideFiles);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "C.static.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { C } from "./lib2.js";
new C().m(-1);
const c = new C();
c.m(-1);
`, collideFiles);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { C } from "./lib2.js";
C.m(1);
`, collideFiles);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const src = `/// @nudo:import { positive } from "./lib8.nudo.js"
export class C {
  m(a) { return a; }

  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }
}
C.m(-1);
const c = new C();
c.m(-1);
new C().m(-1);
`;
    const r = check(
      src,
      { "/t/lib8.js": src, "/t/lib8.nudo.js": COLLIDE_SIDECAR },
      "/t/lib8.js",
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "C.static.m")).toHaveLength(1);
  }
});



});

describe("不确定形态一律不解析（守卫假红）", () => {
  it("extends 且 m 不是 own 方法 ⇒ 零诊断；构造器 this.m = … 覆盖方法 ⇒ 零诊断；接收者被遮蔽（形参 / 局部同名）或重新赋值 ⇒ 零诊断；静态 / 实例交叉调用（K.m 实例方法 / new K().s 静态方法）⇒ 零诊断；getter / computed 成员 ⇒ 零诊断；未契约的导入类方法 ⇒ 零新诊断（不扩面）", () => {
  {
  resetCheckSourceMemo();


    const lib = `export class Base {
  m(a) { return a; }
}
export class K extends Base {}
`;
    const sidecar = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const Base_m = fn({ a: positive }, number());
`;
    const r = check(
      `import { K } from "./lib3.js";
new K().m(-1);
const k = new K();
k.m(-1);
`,
      { "/t/lib3.js": lib, "/t/lib3.nudo.js": sidecar },
    );
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const lib = `export class K {
  constructor() { this.m = (a) => a; }
  m(a) { return a; }
}
`;
    const sidecar = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
`;
    const r = check(
      `import { K } from "./lib4.js";
new K().m(-1);
const k = new K();
k.m(-1);
`,
      { "/t/lib4.js": lib, "/t/lib4.nudo.js": sidecar },
    );
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { K } from "./lib.js";
export function shadowParam(K) {
  const c = new K();
  return c.m(-1);
}
export function shadowLocal() {
  const K = { m: (a) => a };
  return K.m(-1);
}
export function reassign() {
  let c = new K();
  c = { m: (a) => a };
  return c.m(-1);
}
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import { K } from "./lib.js";
K.m(-1);
new K().s(-1);
const k = new K();
k.s(-1);
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const getterLib = `export class K {
  get m() { return 1; }
}
`;
    const computedLib = `export class K {
  ["m"](a) { return a; }
}
`;
    const sidecar = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
`;
    const r = check(
      `import { K as G } from "./lib5.js";
import { K as H } from "./lib6.js";
new G().m(-1);
new H().m(-1);
`,
      {
        "/t/lib5.js": getterLib,
        "/t/lib5.nudo.js": sidecar,
        "/t/lib6.js": computedLib,
        "/t/lib6.nudo.js": sidecar,
      },
    );
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const lib = `export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
`;
    const r = check(
      `import { K } from "./lib7.js";
const c = new K();
c.m(-1);
new K().m(-1);
K.s(-1);
`,
      { "/t/lib7.js": lib },
    );
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  }
});





});
});

// ---------------------------------------------------------------------------
// (a) 未导出的本地类：与本地函数同一条调用点义务
// ---------------------------------------------------------------------------
describe("(a) 未导出的本地类：与本地函数同一条调用点义务", () => {
/**
 * 类成员调用点义务的**三条保守边界**（假绿）。
 *
 * 前置事实（本次修复的基准，已用 probe 验证）：
 * - 普通函数面：**未导出的本地函数**带 `@nudo:contract` 时，调用点照常执法
 * （普查面 `listTopFunctions` 收全部顶层函数）；
 * - 导入面：`import { f }` / `export { f } from` / `export * from` /
 * `import * as ns; ns.f(…)` 都执法（`default.m` 的具名 default 类同）。
 *
 * 三条边界（修前均为 0 诊断）：
 * - (a) 未导出的本地类：`class L { @nudo:contract m }` 的
 * `const c = new L(); c.m(-1)` / `new L().m(-1)` / `L.s(-1)` —— 类成员名
 * 此前只有**导出类**进普查面 ⇒ knownFns 闸门挡住 ⇒ 与本地函数规则不一致；
 * - (b) 匿名 `export default class { m(a){} }` 作为 `import K from './lib.js'`
 * 的默认导出 ⇒ 没有本地名 ⇒ 类绑定解析不到（具名 `export default class K`
 * 已可用，本文作为负控制）；
 * - (c) `import * as ns from './lib.js'` 的 `new ns.K().m(-1)` / `ns.K.s(-1)`
 * ⇒ 命名空间只登记了 `ns.__module__`（普通函数路径），没有类解析。
 *
 * 修法：
 * - (a) `scan-call-graph.localClassMemberNames` 把模块级类（不只导出类）的
 * own 方法名并入**调用点扫描**的 knownFns（签名普查面不动 ⇒ 签名列表不扩）；
 * - (b) 匿名默认类的绑定名 = 导出槽名 `default`（`default.m` 契约键，与
 * generalize / 指令 scope 同口径）；`localNamedExports` 同步登记成员键；
 * - (c) `ns.K` 复用 `classBindingOf`（与具名导入同一套类 AST 解析），
 * 命名空间模块按**词法作用域**解析（内层同名遮蔽 ⇒ 不解析）。
 *
 * 守卫（A4 既有口径全部保留）：继承无 own 方法 / 构造器 `this.m = …` /
 * getter-setter / computed / 形参遮蔽 / 重新赋值（**沿作用域链**失效）/
 * static 与实例同名消歧 / 未契约类零诊断。
 *
 * parity（有意保持不执法，不发明更宽义务）：
 * - `export { K as J } from './lib.js'` 的**别名**再导出（普通函数同样不执法：
 * 再导出解析保留的是导出名、定义模块按本地名查契约）；
 * - `import { K } from './lib.js'; export { K }`（普通函数同样不执法）；
 * - `import * as ns from './index.js'`（index 再导出 ⇒ `ns.f` 同样不执法）。
 * 以上有测试钉住（0 诊断），避免后续误扩。
 */





beforeEach(() => {
  resetCheckSourceMemo();
});

/** 指令契约用的公共约束模块（`/// @nudo:import` 绑定名，不是同名侧车） */
const POS_MODULE = `export const positive = number().gt(0);
`;

const POS_IMPORT = `/// @nudo:import { positive } from "./pos.nudo.js"
`;

/** 导入类的类 + 普通函数（侧车契约绑 K_m / K_s） */
const LIB = `export class K {
  m(a) { return a; }
  static s(a) { return a; }
}
`;

const LIB_SIDECAR = `export const positive = number().gt(0);
export const K_m = fn({ a: positive }, number());
export const K_s = fn({ a: positive }, number());
`;

/** 匿名 / 具名 default 类定义（b 切片） */
const ANON_DEFAULT = `${POS_IMPORT}export default class {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
`;

/** 默认虚拟文件集：pos 约束模块 + 导入类三件套 */
function filesOf(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "/t/pos.nudo.js": POS_MODULE,
    "/t/lib.js": LIB,
    "/t/lib.nudo.js": LIB_SIDECAR,
    ...extra,
  };
}

function check(
  source: string,
  extra: Record<string, string> = {},
  file = "/t/b1156-main.js",
) {
  const { loadModule } = makeFiles(filesOf(extra));
  return checkSource(file, source, pTrue, { loadModule, fromFile: file });
}

/** 调用点契约违例（按被调名可过滤） */
function violated(
  r: { issues: Array<{ code: string; fn?: string }> },
  fn?: string,
): Array<{ code: string; fn?: string }> {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (fn === undefined || i.fn === fn),
  );
}

/** 未导出的本地类（指令契约在本文件内；侧车不绑未导出名，与普通函数同口径） */
function localClassSrc(head = ""): string {
  return `${POS_IMPORT}class L {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }

  /**
   * @nudo:contract a positive
   */
  static s(a) { return a; }
}
${head}`;
}


  it("实例（const c = new L()）：c.m(-1) ⇒ L.m 违例；内联 new：new L().m(-1) ⇒ L.m 违例；静态：L.s(-1) ⇒ L.s 违例；合法实参（1 / 5）三种形态都不报（负控制）；未契约的本地类 ⇒ 零新诊断（不扩面）；本地类方法不进签名普查面（调用点义务 ≠ 签名面扩面）；本地类的侧车契约不绑（未导出名）——与未导出本地函数同口径（parity）；守卫：extends 无 own / 构造器 this.m / getter / ", () => {
  {
  resetCheckSourceMemo();


    const src = `${localClassSrc("const c = new L();\n")}export function viaConst() { return c.m(-1); }
`;
    const r = check(src, { "/t/local.js": src }, "/t/local.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const src = `${localClassSrc()}export function viaInline() { return new L().m(-1); }
`;
    const r = check(src, { "/t/local-inline.js": src }, "/t/local-inline.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const src = `${localClassSrc()}export function viaStatic() { return L.s(-1); }
`;
    const r = check(src, { "/t/local-static.js": src }, "/t/local-static.js");
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "L.s")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const src = `${localClassSrc()}const c = new L();
export function use() { c.m(1); new L().m(1); L.s(5); return c; }
`;
    const r = check(src, { "/t/local-ok.js": src }, "/t/local-ok.js");
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const src = `class L {
  m(a) { return a; }
  static s(a) { return a; }
}
const c = new L();
export function use() { c.m(-1); new L().m(-1); L.s(-1); return c; }
`;
    const r = check(src, { "/t/local-bare.js": src }, "/t/local-bare.js");
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const src = `${localClassSrc()}export function use() { return 1; }
`;
    const r = check(src, { "/t/local-sig.js": src }, "/t/local-sig.js");
    expect(r.signatures.map((s) => s.name)).toEqual(["use"]);
  }
  {
  resetCheckSourceMemo();


    const src = `class L {
  m(a) { return a; }
}
const c = new L();
export function use() { return c.m(-1); }
`;
    const r = check(
      src,
      {
        "/t/local-sidecar.js": src,
        "/t/local-sidecar.nudo.js": `export const positive = number().gt(0);
export const L_m = fn({ a: positive }, number());
`,
      },
      "/t/local-sidecar.js",
    );
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const src = `${POS_IMPORT}class Base {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class E1 extends Base {}
class E2 {
  constructor() { this.m = (a) => a; }
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class E3 {
  get m() { return 1; }
}
class E4 {
  ["m"](a) { return a; }
}
const e1 = new E1();
const e2 = new E2();
const e3 = new E3();
export function use() {
  e1.m(-1);
  e2.m(-1);
  return e3.m + new E4().m(-1);
}
`;
    const r = check(src, { "/t/local-guard.js": src }, "/t/local-guard.js");
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const src = `${POS_IMPORT}class G1 {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class G2 {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
class G3 {
  /**
   * @nudo:contract a positive
   */
  static s(a) { return a; }
}
export function shadowParam(G1) {
  return new G1().m(-1);
}
export function reassignInstance() {
  let c = new G2();
  c = { m: (a) => a };
  return c.m(-1);
}
export function reassignClass() {
  G3 = { s: (a) => a };
  return G3.s(-1);
}
export function cross() {
  G2.m(-1);
  return new G3().s(-1);
}
`;
    const r = check(src, { "/t/local-guard2.js": src }, "/t/local-guard2.js");
    expect(violated(r)).toEqual([]);
  }
});










describe("(b) 匿名 export default class 的成员调用点", () => {
  it("匿名 default 类（指令契约）⇒ default.m 违例；匿名 default 类（侧车 default_m）⇒ default.m 违例；匿名 default 类：合法实参不报（负控制）；匿名 default 类未契约 ⇒ 零诊断（不扩面）；具名 export default class K 已可用（负控制，不得回归）；匿名 default 类的静态成员：K.s(-1) ⇒ default.s 违例", () => {
  {
  resetCheckSourceMemo();


    const r = check(`import K from "./anon.js";
new K().m(-1);
const c = new K();
c.m(-1);
`, { "/t/anon.js": ANON_DEFAULT });
    expect(violated(r)).toHaveLength(2);
    expect(violated(r, "default.m")).toHaveLength(2);
  }
  {
  resetCheckSourceMemo();


    const lib = `export default class {
  m(a) { return a; }
}
`;
    const sidecar = `export const positive = number().gt(0);
export const default_m = fn({ a: positive }, number());
`;
    const r = check(
      `import K from "./anon2.js";
new K().m(-1);
`,
      { "/t/anon2.js": lib, "/t/anon2.nudo.js": sidecar },
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "default.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import K from "./anon3.js";
new K().m(1);
const c = new K();
c.m(2);
`, { "/t/anon3.js": ANON_DEFAULT });
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const lib = `export default class {
  m(a) { return a; }
}
`;
    const r = check(
      `import K from "./anon4.js";
new K().m(-1);
`,
      { "/t/anon4.js": lib },
    );
    expect(violated(r)).toEqual([]);
    expect(r.issues).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const lib = `export default class K {
  /**
   * @nudo:contract a positive
   */
  m(a) { return a; }
}
`;
    const r = check(
      `import K from "./named.js";
new K().m(-1);
`,
      { "/t/named.js": `${POS_IMPORT}${lib}` },
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.m")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const lib = `${POS_IMPORT}export default class {
  /**
   * @nudo:contract a positive
   */
  static s(a) { return a; }
}
`;
    const r = check(
      `import K from "./anon-static.js";
K.s(-1);
`,
      { "/t/anon-static.js": lib },
    );
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "default.s")).toHaveLength(1);
  }
});





});

describe("(c) 命名空间导入的类", () => {
  it("new ns.K().m(-1) ⇒ K.m 违例；ns.K.s(-1) ⇒ K.s 违例；命名空间：合法实参不报（负控制）；命名空间名被形参 / 局部 const 遮蔽 ⇒ 零诊断（守卫）；命名空间类：实例方法不许当静态、静态不许当实例 ⇒ 零诊断（守卫）；require 的模块命名空间同一路径（const m = require）；命名空间经再导出 index（parity：普通函数 ns.f 也不执法）⇒ 0", () => {
  {
  resetCheckSourceMemo();


    const r = check(`import * as ns from "./lib.js";
new ns.K().m(-1);
const c = new ns.K();
c.m(-1);
`);
    expect(violated(r)).toHaveLength(2);
    expect(violated(r, "K.m")).toHaveLength(2);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import * as ns from "./lib.js";
ns.K.s(-1);
`);
    expect(violated(r)).toHaveLength(1);
    expect(violated(r, "K.s")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import * as ns from "./lib.js";
new ns.K().m(1);
ns.K.s(5);
const c = new ns.K();
c.m(2);
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import * as ns from "./lib.js";
export function shadowParam(ns) {
  return new ns.K().m(-1);
}
export function shadowLocal() {
  const ns = { K: class { m(a) { return a; } } };
  return new ns.K().m(-1);
}
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(`import * as ns from "./lib.js";
ns.K.m(-1);
new ns.K().s(-1);
const c = new ns.K();
c.s(-1);
`);
    expect(violated(r)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(`const m = require("./lib.js");
new m.K().m(-1);
m.K.s(-1);
`);
    expect(violated(r)).toHaveLength(2);
  }
  {
  resetCheckSourceMemo();


    const r = check(
      `import * as ns from "./idx.js";
new ns.K().m(-1);
ns.K.s(-1);
`,
      {
        "/t/idx.js": `export { K } from "./lib.js";\n`,
        "/t/idx.nudo.js": LIB_SIDECAR,
      },
    );
    expect(violated(r)).toEqual([]);
  }
});






});

describe("再导出链：已可用形态不回归 / 未执法形态保持（parity）", () => {
  it("export { K } from：成员调用执法（不回归）；export * from：成员调用执法（不回归）；别名再导出 export { K as J } from / import+export ⇒ 0（parity：普通函数同样不执法）；再导出环（a ↔ b）终止且零诊断", () => {
  {
  resetCheckSourceMemo();


    const r = check(
      `import { K } from "./idx.js";
new K().m(-1);
K.s(-1);
`,
      { "/t/idx.js": `export { K } from "./lib.js";\n` },
    );
    expect(violated(r)).toHaveLength(2);
    expect(violated(r, "K.m")).toHaveLength(1);
    expect(violated(r, "K.s")).toHaveLength(1);
  }
  {
  resetCheckSourceMemo();


    const r = check(
      `import { K } from "./idx.js";
new K().m(-1);
K.s(-1);
`,
      { "/t/idx.js": `export * from "./lib.js";\n` },
    );
    expect(violated(r)).toHaveLength(2);
  }
  {
  resetCheckSourceMemo();


    const sidecar = LIB_SIDECAR;
    const alias = check(
      `import { J } from "./idx.js";
new J().m(-1);
J.s(-1);
`,
      {
        "/t/idx.js": `export { K as J } from "./lib.js";\n`,
        "/t/idx.nudo.js": sidecar,
      },
    );
    expect(violated(alias)).toEqual([]);
    const reexp = check(
      `import { K } from "./idx2.js";
new K().m(-1);
K.s(-1);
`,
      {
        "/t/idx2.js": `import { K } from "./lib.js";\nexport { K };\n`,
        "/t/idx2.nudo.js": sidecar,
      },
    );
    expect(violated(reexp)).toEqual([]);
  }
  {
  resetCheckSourceMemo();


    const r = check(
      `import { K } from "./a.js";
new K().m(-1);
import * as ns from "./a.js";
new ns.K().m(-1);
`,
      {
        "/t/a.js": `export { K } from "./b.js";\n`,
        "/t/b.js": `export { K } from "./a.js";\n`,
      },
    );
    expect(violated(r)).toEqual([]);
  }
});



});
});

// ---------------------------------------------------------------------------
// user class shadows host global
// ---------------------------------------------------------------------------
describe("user class shadows host global", () => {
/**
 * `$new` 先查内建派发表、从不查用户类注册表 ⇒ 用户同名类被内建
 * 构造器吞掉（`class URL {}` 的实例被判成 host URL）。修复：用户类优先。
 */




const SRC = `
export function shadowUrl() { class URL { constructor() { this.a = 1; } } return new URL(); }
export function shadowError() { class Error { constructor() { this.a = 1; } } return new Error(); }
export function shadowMap() { class Map { constructor() { this.a = 1; } } return new Map(); }
export function shadowDate() { class Date { constructor() { this.a = 1; } } return new Date(); }
export function shadowPromise() { class Promise { constructor() { this.a = 1; } } return new Promise(); }
`;


  it("every same-named user class wins over the builtin dispatch table", () => {
    const r = checkSource("/t/bug-166.js", SRC, pTrue);
    expect(sigOf(r, "shadowUrl")).toBe("URL");
    expect(sigOf(r, "shadowError")).toBe("Error");
    expect(sigOf(r, "shadowMap")).toBe("Map");
    expect(sigOf(r, "shadowDate")).toBe("Date");
    expect(sigOf(r, "shadowPromise")).toBe("Promise");
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// this before super()
// ---------------------------------------------------------------------------
describe("this before super()", () => {
/**
 * 派生构造器在 `super()` 之前访问 `this` ⇒ 原生必抛 ReferenceError，
 * 但门只在 return 路径上 ⇒ 漏判。修复：`this` 可达性由 pending-super 标记
 * 在每次成员读/写/调用时断言（`$get`/`$set`/`$invoke` 包装）。
 */




const SRC = `
export class BaseX { constructor(){ this.p = 1; } }
export class DerivedX extends BaseX {
  constructor(){ this.q = 2; super(); }
}
export function derivedThisBeforeSuper(){ return new DerivedX(); }
`;


  it("derived constructor and its call site may throw ReferenceError；normal derived constructors stay total", () => {
  {
    const r = checkSource("/t/bug-173.js", SRC, pTrue);
    expect(sigOf(r, "derivedThisBeforeSuper")).toBe("never throws ReferenceError");
    expect(sigOf(r, "DerivedX")).toBe("DerivedX throws ReferenceError");
    expect(sigOf(r, "BaseX")).toBe("BaseX");
  }
  {
    const ok = checkSource(
      "/t/bug-173-ok.js",
      `
export class A { constructor(){ this.a = 1; } }
export class B extends A { constructor(){ super(); this.b = 2; } }
export function mkB(){ return new B(); }
`,
      pTrue,
    );
    expect(sigOf(ok, "mkB")).toBe("B");
  }
});


});

// ---------------------------------------------------------------------------
// fork 快照不得对宿主全局抛裸 TypeError
// ---------------------------------------------------------------------------
describe("fork 快照不得对宿主全局抛裸 TypeError", () => {
/**
 * 分支块内给**宿主全局**赋值 ⇒ fork 快照对宿主真全局发射
 * `$copy(<宿主对象>)` ⇒ `$copy` 裸读 `a.shape.k` ⇒ 引擎抛裸 TypeError
 * ⇒ `run.ts` 归为 `nudo:internal` ⇒ 合法代码门禁假红（宿主上完全正常）。
 *
 * 修复：`$copy` 与 `$get` / `$set` 的 DEC-006 口径对齐——非 Abs（宿主值）
 * fail-closed **原值返回**（调用点 `x = $copy(x)` 重绑为自赋值 no-op），
 * 禁止读 `.shape` 炸宿主。
 */






  it("$copy 对非 Abs 宿主值原值返回（不读 .shape）；分支块内写宿主全局可求值（不产生内部异常），且不污染宿主全局；顶层形态（对照组）同样不崩 —— 两种写法结论一致", () => {
  {
    const host = globalThis as unknown;
    expect(() => $copy(host as never)).not.toThrow();
    expect($copy(host as never)).toBe(host);
    expect(() => $copy(undefined as never)).not.toThrow();
  }
  {
    const src = `if (true) { globalThis.__nudo_bug194_probe = 1; }
export function f() { return 1; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const rec = callTranspiledExportFull(exports, "f", []);
    expect(litValue_____abs_ts(rec.result)).toEqual({ ok: true, value: 1 });
    // fail-closed：引擎不真的写宿主全局
    expect((globalThis as Record<string, unknown>).__nudo_bug194_probe).toBeUndefined();
  }
  {
    const src = `globalThis.__nudo_bug194_probe2 = 1;
export function f() { return 1; }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue_____abs_ts(callTranspiledExportFull(exports, "f", []).result)).toEqual({
      ok: true,
      value: 1,
    });
  }
});



});

// ---------------------------------------------------------------------------
// 契约 `.optional()` 位的元数面（本地 / 跨文件同口径）
// ---------------------------------------------------------------------------
describe("契约 `.optional()` 位的元数面（本地 / 跨文件同口径）", () => {
/**
 * `fn` **形参位**的 `.optional()` 在产物面（dts / schema）被认成
 * 「该位可省略」，执法面（`nudo:arg-count`）却按**实现签名**认「必填」。
 *
 * 症状（同一份契约，两面互斥）：
 * - `nudo export --format dts` ⇒ `export declare function opt(a: string, b?: number): any;`
 * - `nudo check caller.js` ⇒ `opt expects 2 argument(s), got 1 (nudo:arg-count)`
 * ⇒ TS 合法调用被 nudo 判红（假红），且 `--from-dts` 往返会把 `.d.ts` 的 `b?`
 * 主动生成为 `number().optional()` ⇒ 往返一次就制造这种不一致。
 *
 * 根因：`checkCallSite()` 的 `arityFace(g)` 只看实现签名（`x?: T` / 默认参）
 * ⇒ 契约级 `constraint.isOptional` 从未进入元数面。
 *
 * 修法：元数检查前先取 `effectiveContract`，把 handwritten 契约的
 * `constraint.isOptional` 经**同一套位次映射**（`contractOptionalIndexes`）
 * 变成可选位集合 → `arityFace` **优先采用**（与产物面「三来源」序一致：
 * 契约级 > 实现签名）。本地调用与跨文件调用共用该映射 ⇒ 两面同结论。
 */







beforeEach(() => {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();
});

/** `b` 契约级可选；`need2` 的两位都必填（对照组） */
const SIDE = `import { fn, number, string, any } from "@nudojs/core";
export const opt = fn({ a: string(), b: number().optional() }, any());
export const need2 = fn({ a: string(), b: number() }, any());
`;

const IMPL = `export function opt(a, b) { return a; }
export function need2(a, b) { return a; }
`;

/** `nudo:arg-count` 的 issue（可按 fn 过滤） */
function argCount<T extends { code: string; fn?: string }>(
  r: { issues: T[] },
  fn?: string,
): T[] {
  return r.issues.filter(
    (i) => i.code === "nudo:arg-count" && (fn === undefined || i.fn === fn),
  );
}

function files(caller?: string) {
  const vfs: Record<string, string> = {
    "/t/opt.nudo.js": SIDE,
    "/t/opt.js": IMPL,
  };
  if (caller !== undefined) vfs["/t/caller.js"] = caller;
  return makeFiles(vfs);
}

/** 同文件调用：契约与调用点同一模块 */
function localCheck(call: string) {
  const { loadModule } = files();
  return checkSource("/t/opt.js", `${IMPL}\n${call}\n`, pTrue, {
    loadModule,
    fromFile: "/t/opt.js",
  });
}

/** 跨文件调用：`caller.js` 从 `./opt.js` 导入被调方 */
function crossCheck(call: string) {
  const caller = `import { opt, need2 } from "./opt.js";\n${call}\n`;
  const { loadModule } = files(caller);
  return checkSource("/t/caller.js", caller, pTrue, {
    loadModule,
    fromFile: "/t/caller.js",
  });
}


  it("本地调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count；跨文件调用：契约可选位少传实参 ⇒ 不报 nudo:arg-count（与本地同结论）；本地调用：真正缺必填实参仍报（对照组，两位都必填）；跨文件调用：真正缺必填实参仍报（对照组，两位都必填）；两位都传齐 ⇒ 两面都不报元数错", () => {
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = localCheck(`opt("a");`);
    expect(argCount(r, "opt")).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = crossCheck(`opt("a");`);
    expect(argCount(r, "opt")).toEqual([]);
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = localCheck(`need2("a");`);
    expect(argCount(r, "need2")).toHaveLength(1);
    expect(argCount(r, "need2")[0]!.severity).toBe("error");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    const r = crossCheck(`need2("a");`);
    expect(argCount(r, "need2")).toHaveLength(1);
    expect(argCount(r, "need2")[0]!.severity).toBe("error");
  }
  {
  resetEngineCaches();
  takeRefineDiags();
  takeContractDiags();


    expect(argCount(localCheck(`opt("a", 1);`), "opt")).toEqual([]);
    expect(argCount(crossCheck(`opt("a", 1);`), "opt")).toEqual([]);
  }
});





});

// ---------------------------------------------------------------------------
// pick/omit/partial 必须保留约束的 optional 标志
// ---------------------------------------------------------------------------
describe("pick/omit/partial 必须保留约束的 optional 标志", () => {
/**
 * `pick()` / `omit()` / `partial()` 三个**纯结构变换**静默丢掉约束的
 * `optional` 标志 ⇒ 契约被**收紧** ⇒ 合法调用被判违约（假红）+ 签名 / dts
 * 少一个 `?`。
 *
 * 根因：三个变换重建 builder 时只搬 `prim` / `preds` / `fields`，**不搬
 * `isOptional`**（`makeBuilder(d.prim, d.preds, { fields })`）⇒ flag 在 builder
 * 层就没了。消费端恰是从 `field.constraint.isOptional` 读可选性
 * （`constraintToEntryAbs` / `instantiateConstraint` 的字段分支）⇒ 下游永远读到
 * 「必填」。对照组：直接写（不套变换）时 `shape()` 会把 flag 抬到字段上 ⇒ 可选。
 *
 * 修法：三处 `makeBuilder(...)` 补回 `d.isOptional`（**被包进去的那个 shape
 * 自身**的可选性必须保留；`partial` 内部字段的可选性由 `partial` 自己处理）。
 */





const LIB = `
export const cA = shape({ s: shape({ a: number() }).optional() });
export const cB = shape({ s: pick(shape({ a: number() }).optional(), ["a"]) });
export const cC = shape({ s: omit(shape({ a: number() }).optional(), ["a"]) });
export const cD = shape({ s: partial(shape({ a: number() }).optional()) });
`;

/** 四个函数各自被 `f({})` 调用一次（与复现夹具同形） */
const SRC = `/// @nudo:import { cA, cB, cC, cD } from "./lib.nudo.js"

/**
 * @nudo:contract x cA
 */
function fA(x) { return x; }

/**
 * @nudo:contract x cB
 */
function fB(x) { return x; }

/**
 * @nudo:contract x cC
 */
function fC(x) { return x; }

/**
 * @nudo:contract x cD
 */
function fD(x) { return x; }

fA({});
fB({});
fC({});
fD({});
`;


  it("builder 层：三个变换都保留 isOptional（改前全部丢失）；入口 Abs 层：字段槽仍是 optional（渲染带 `s?`）；前置条件层：字段谓词不再要求必填（可选字段不进硬 pred）；端到端：合法调用 f({}) 零 error、签名面保留 `s?`（改前 3 条假红）；负控制：不套变换时行为不变（直接把 optional 抬到字段上）；负控制：非可选 shape 经变换后仍必填（不得被顺手放宽）", () => {
  {
    const base = shape({ a: number() }).optional();
    expect(base.isOptional).toBe(true);
    expect(pick(base, ["a"]).isOptional).toBe(true);
    expect(omit(base, ["a"]).isOptional).toBe(true);
    expect(partial(base).isOptional).toBe(true);
  }
  {
    for (const c of [
      shape({ s: pick(shape({ a: number() }).optional(), ["a"]) }),
      shape({ s: omit(shape({ a: number() }).optional(), ["a"]) }),
      shape({ s: partial(shape({ a: number() }).optional()) }),
    ]) {
      const a = constraintToEntryAbs(c, "x");
      if (a.shape.k !== "obj") throw new Error("expected obj");
      expect(a.shape.slots.s!.optional).toBe(true);
      expect(formatShape(a)).toContain("s?:");
    }
  }
  {
    const p = predToString(
      instantiateConstraint(
        shape({ s: pick(shape({ a: number() }).optional(), ["a"]) }),
        "x",
      ),
    );
    // 改前：`x.s.a` 出现在硬 pred 里（= 必填字段）
    expect(p).not.toContain("x.s");
  }
  {
    const r = checkSource("/t/bug209/lib.js", SRC, pTrue, sidecarOpts("lib.nudo", LIB, "/t/bug209/lib.js"));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(sigOf(r, "fA")).toContain("s?:");
    for (const fn of ["fB", "fC", "fD"]) {
      const sig = r.signatures.find((s) => s.name === fn);
      expect(sig, fn).toBeDefined();
      expect(sig!.paramTypes?.join(", ") ?? "", fn).toContain("s?:");
    }
  }
  {
    const a = constraintToEntryAbs(shape({ s: shape({ a: number() }).optional() }), "x");
    if (a.shape.k !== "obj") throw new Error("expected obj");
    expect(a.shape.slots.s!.optional).toBe(true);
  }
  {
    const a = constraintToEntryAbs(shape({ s: pick(shape({ a: number() }), ["a"]) }), "x");
    if (a.shape.k !== "obj") throw new Error("expected obj");
    expect(a.shape.slots.s!.optional).toBeUndefined();
    expect(checkSource(
      "/t/bug209/req.js",
      `/// @nudo:import { cE } from "./lib2.nudo.js"

/**
 * @nudo:contract x cE
 */
function fE(x) { return x; }
fE({});
`,
      pTrue,
      sidecarOpts("lib2.nudo", `export const cE = shape({ s: pick(shape({ a: number() }), ["a"]) });`, "/t/bug209/req.js"),
    ).issues.filter((i) => i.severity === "error").length).toBeGreaterThan(0);
  }
});






});

// ---------------------------------------------------------------------------
// optional call reads the getter once
// ---------------------------------------------------------------------------
describe("optional call reads the getter once", () => {
/**
 * `g.m?.()`（可选调用）对同一 getter 读两次 ⇒ 第二次读到不同值，
 * 推断结果错位。修复：`$invoke`/`$invokeKey` 接受预读值，可选链只读一次。
 */



const SRC = `
export function f() {
  let i = 0;
  const g = {
    get m() {
      i++;
      return i === 1 ? () => 1 : () => "two";
    },
  };
  return g.m?.();
}
`;


  it("returns the first getter value (1), not the second (two)", () => {
    expect(val(SRC)).toEqual({ ok: true, value: 1 });
  });

});

// ---------------------------------------------------------------------------
// 可选槽吸收 undefined（对称规则）
// ---------------------------------------------------------------------------
describe("可选槽吸收 undefined（对称规则）", () => {
/**
 * 可选槽（`slot.optional`）必须吸收源值里的 `undefined`。
 *
 * TS 默认 `exactOptionalPropertyTypes: false` 下 `{ a?: string }` 的槽类型是
 * `string | undefined` ⇒ `{ a: undefined }` 合法。修前 `leqShape` 的 obj 分支
 * **只在源槽缺失时**看 `slot.optional`（`if (slot.optional) continue`），源槽
 * 存在但值可能 undefined 时直接拿槽值比目标槽值 ⇒ `undefined ⊭ string` 假红。
 *
 * 修复把可选性写成**一条对称规则**：目标槽 optional ⇔ 源侧「缺失 or undefined」
 * 可赋。这里逐条钉住矩阵，重点是对照组：必填目标槽**仍须判红**，且
 * `number | undefined` 不得被 optional `string` 槽放过（不能整体放宽）。
 */









/** 结构化对象 Abs（测试侧最小构造）。 */
function obj(slots: Record<string, { value: Abs_____abs_ts; optional?: boolean }>): Abs_____abs_ts {
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
}

/** 契约 builder → 参数入口 Abs（槽上带锚在 `o.a` 上的 typeof 谓词）。 */
function contract(b: unknown): Abs_____abs_ts {
  return constraintToEntryAbs_____constraint_ts(derefConstraint(b as never), "o");
}

/** 取对象 Abs 的槽值（保留该槽自带的谓词/项）。 */
function slotValue(a: Abs_____abs_ts, key: string): Abs_____abs_ts {
  const s = a.shape;
  if (s.k !== "obj") throw new Error("expected obj abs");
  const slot = getSlot(s.slots, key);
  if (!slot) throw new Error(`missing slot ${key}`);
  return slot.value;
}

const OPTIONAL = contract(shape_____constraint_ts({ a: string().optional() }));
const REQUIRED = contract(shape_____constraint_ts({ a: string() }));
/** 契约槽自带的 string 形态（谓词锚在 `o.a` 上）——并集源的 string 臂用它。 */
const OPTIONAL_STRING = slotValue(OPTIONAL, "a");

const sourceWithA = (value: Abs_____abs_ts, optional?: boolean): Abs_____abs_ts =>
  obj({ a: { value, ...(optional ? { optional: true } : {}) } });


  it("可选契约 + 源槽存在且为 undefined ⇒ 可赋；对照：必填契约 + 同一源 ⇒ 仍判红；可选契约 + 源值 string | undefined ⇒ 可赋（undefined 臂被吸收）；不得整体放宽：number | undefined ⊄ optional string；null 不被可选槽吸收（strictNullChecks）；源槽标 optional 时：可赋给可选目标槽，不可赋给必填目标槽；源槽缺失：可选目标槽放行、必填目标槽判红（既有口径）；非空值仍按", () => {
  {
    expect(leqAbs(sourceWithA(absLit(undefined)), OPTIONAL).ok).toBe(true);
  }
  {
    const r = leqAbs(sourceWithA(absLit(undefined)), REQUIRED);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/slot a:/);
  }
  {
    const src = sourceWithA(makeSum(OPTIONAL_STRING, absLit(undefined)));
    expect(leqAbs(src, OPTIONAL).ok).toBe(true);
  }
  {
    const src = sourceWithA(makeSum(num_____abs_ts(), absLit(undefined)));
    expect(leqAbs(src, OPTIONAL).ok).toBe(false);
  }
  {
    expect(leqAbs(sourceWithA(absLit(null)), OPTIONAL).ok).toBe(false);
  }
  {
    expect(leqAbs(sourceWithA(OPTIONAL_STRING, true), OPTIONAL).ok).toBe(true);
    const r = leqAbs(sourceWithA(OPTIONAL_STRING, true), REQUIRED);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/optional ⊭ required/);
  }
  {
    expect(leqAbs(obj({}), OPTIONAL).ok).toBe(true);
    expect(leqAbs(obj({}), REQUIRED).ok).toBe(false);
  }
  {
    expect(leqAbs(sourceWithA(OPTIONAL_STRING), OPTIONAL).ok).toBe(true);
    expect(leqAbs(sourceWithA(num_____abs_ts()), OPTIONAL).ok).toBe(false);
  }
  {
    // 整体可缺省 ≠ 某一槽可缺省——目标对象本身不可缺省。
    const optionalObj = constraintToEntryAbs_____constraint_ts(
      derefConstraint(shape_____constraint_ts({ a: string() }).optional() as never),
      "o",
    );
    expect(leqAbs(optionalObj, OPTIONAL).ok).toBe(false);
  }
});










// ── L1 契约门禁（`nudo check` 的判定面）────────────────────────────────────
// 同一事实在**两个面**都不得判红：`leqAbs`（代数原语）与 `checkShapeAgainstAbs`
// （L1 字面量实参通道，`nudo:constraint-violated` 的产生处）。这批用例走真实
// `checkSource` + 侧车 `fn()` 契约，即 `nudo check` 的同一代码路径（CLI 只是
// 把 issues 渲染成 exit code：error ⇒ 1，无 error ⇒ 0）。

const OPTIONAL_SIDECAR = `
import { fn, shape, string } from "@nudojs/core";
export const f = fn({ o: shape({ a: string().optional() }) });
`;
const REQUIRED_SIDECAR = `
import { fn, shape, string } from "@nudojs/core";
export const g = fn({ o: shape({ a: string() }) });
`;
const BODY = `export function PLACEHOLDER(o) { return o.a; }`;

function gate(sidecar: string, name: string, calls: string) {
  const opts = sidecarOpts(`${name}.nudo.js`, sidecar, `/t/${name}.js`);
  return checkSource(
    `/t/${name}.js`,
    `${BODY.replace("PLACEHOLDER", name)}\n${calls}\n`,
    pTrue,
    opts,
  );
}

function violations(r: { issues: CheckIssue[] }, fn: string): CheckIssue[] {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated" && i.fn === fn);
}

/** 签名面形参类型（`nudo check` 的 `o: { a?: string }` 就由它渲染）。 */
function paramTypesOf(
  r: { signatures: { name: string; paramTypes?: string[] }[] },
  fn: string,
): string[] {
  return r.signatures.find((s) => s.name === fn)?.paramTypes ?? [];
}

describe("L1 契约门禁与 leqAbs 同口径", () => {
  it("optional 契约 + `{ a: undefined }` / `{}` / `{ a: 'x' }` 全部放行；required 契约 + `{ a: undefined }` 仍判红（对照）；required 契约 + `{ a: 'x' }` 放行（对照的正例）；optional 契约不吸收 null / 错 prim（不整体放宽）", () => {
  {
    const r = gate(OPTIONAL_SIDECAR, "f", `f({ a: undefined });\nf({ a: "x" });\nf({});`);
    expect(violations(r, "f")).toHaveLength(0);
    // 签名面同样是可选位（两面不得自相矛盾）
    expect(paramTypesOf(r, "f")).toEqual(["{ a?: string }"]);
  }
  {
    const r = gate(REQUIRED_SIDECAR, "g", `g({ a: undefined });`);
    const vs = violations(r, "g");
    expect(vs).toHaveLength(1);
    expect(vs[0]!.expected).toBe('typeof o.a = "string"');
  }
  {
    const r = gate(REQUIRED_SIDECAR, "g", `g({ a: "x" });`);
    expect(violations(r, "g")).toHaveLength(0);
  }
  {
    expect(violations(gate(OPTIONAL_SIDECAR, "f", `f({ a: null });`), "f")).toHaveLength(1);
    expect(violations(gate(OPTIONAL_SIDECAR, "f", `f({ a: 1 });`), "f")).toHaveLength(1);
  }
});



});

// ── `@nudo:case` 见证面（第三个面）──────────────────────────────────────────
// `check-case-scan.ts` 的 `witnessViolations` 有自己的一套字段对账，同样要吸收
// undefined（共享同一 helper），否则同一个 `{ a: undefined }` 在 `nudo check`
// 放行、在 `nudo test` / case 见证面报 `nudo:case-inconsistency`。

function caseGate(sidecar: string, name: string, doc: string) {
  const opts = sidecarOpts(`${name}.nudo.js`, sidecar, `/t/${name}.js`);
  return checkSource(
    `/t/${name}.js`,
    `/**\n * ${doc}\n */\nexport function ${name}(o) { return o.a; }\n`,
    pTrue,
    opts,
  );
}

function caseInconsistency(r: { issues: CheckIssue[] }): CheckIssue[] {
  return r.issues.filter((i) => i.code === "nudo:case-inconsistency");
}

describe("`@nudo:case` 见证面与 leqAbs / L1 同口径", () => {
  it("optional 契约 + 见证 `{ a: undefined }` ⇒ 不报 case-inconsistency；required 契约 + 同一见证 ⇒ 仍报 case-inconsistency（对照）；optional 契约：见证 `{ a: 'x' }` 放行、`{ a: 1 }` / `{ a: null }` 仍报", () => {
  {
    const r = caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: undefined }) => undefined`);
    expect(caseInconsistency(r)).toHaveLength(0);
  }
  {
    const r = caseGate(REQUIRED_SIDECAR, "g", `@nudo:case "u" ({ a: undefined }) => undefined`);
    const vs = caseInconsistency(r);
    expect(vs).toHaveLength(1);
    expect(vs[0]!.fn).toBe("g");
  }
  {
    expect(
      caseInconsistency(caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: "x" }) => "x"`)),
    ).toHaveLength(0);
    expect(
      caseInconsistency(caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: 1 }) => 1`)),
    ).toHaveLength(1);
    expect(
      caseInconsistency(caseGate(OPTIONAL_SIDECAR, "f", `@nudo:case "u" ({ a: null }) => null`)),
    ).toHaveLength(1);
  }
});


});
});

// ---------------------------------------------------------------------------
// 类值不带 new 被调 → TypeError
// ---------------------------------------------------------------------------
describe("类值不带 new 被调 → TypeError", () => {
/**
 * 类值（class 声明 / 类表达式）**不带 new** 被调 —— 原生定抛
 * TypeError（"Class constructor A cannot be invoked without 'new'"）。
 * 类值只有 [[Construct]] 面：被当普通函数调即抛。
 *
 * 修复（packages/core/src/algebra/exec/call.ts）：
 * - `$callDispatch` 在可调用判定表之前加类值判定（isClassValueCallee）：
 * brand 形（类值 brand 带 `ctor: true` facet + class-mark 类值标记）
 * 与 fn 形（空类体类表达式快路径 `$classExpr` 的签名）⇒ hard NudoThrow。
 *
 * 修复前：类值不在可调用判定表内 ⇒ 落 `return unknown` 且**不记 may-throw**
 * ⇒ 声称「永不抛」⇒ L2 `nudo:entry-may-throw` 假绿（漏报 TypeError）。
 */




function v(src: string) {
  return litValue(call(src, "f").result);
}


  it("class 声明被调 → throws TypeError（此前 unknown + never）；class 声明被调（try/catch 吸收）→ catch 命中 TypeError；非空类表达式被调 → throws TypeError；空类体类表达式被调（$classExpr 快路径）→ throws TypeError；控制组：new A() 正常构造；静态方法调用正常；普通函数调用正常", () => {
  {
    const r = call(
      `class A {}
export function f() {
  return A();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      v(`class A {}
export function f() {
  try { A(); return "nothrow"; } catch (e) { return "threw:" + e.name; }
}`),
    ).toEqual({ ok: true, value: "threw:TypeError" });
  }
  {
    const r = call(
      `const A = class { m() { return 1; } };
export function f() {
  return A();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    const r = call(
      `const A = class {};
export function f() {
  return A();
}`,
      "f",
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
  {
    expect(
      v(`class A { constructor() { this.x = 1; } }
export function f() {
  const a = new A();
  return a.x;
}`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      v(`class A { static s() { return 7; } }
export function f() {
  return A.s();
}`),
    ).toEqual({ ok: true, value: 7 });
    expect(
      v(`function g() { return 3; }
export function f() {
  return g();
}`),
    ).toEqual({ ok: true, value: 3 });
  }
});





});

// ---------------------------------------------------------------------------
// 类实例的 enumerable:false 自有键必须对所有枚举面生效
// ---------------------------------------------------------------------------
describe("类实例的 enumerable:false 自有键必须对所有枚举面生效", () => {
/**
 * 类实例上 `Object.defineProperty(inst, "x", { enumerable: false })`
 * 的**自有属性**在枚举视图（`Object.keys` / `values` / `entries` /
 * `JSON.stringify` / `Object.assign` / spread）面上**整体不可见**（引擎把它
 * 当可枚举键发布），而同一引擎的 `for-in` 面与描述符面（gOPD）说它**不可
 * 枚举** ⇒ **同一引擎两面互斥** + 产物面发布自信的错值。
 *
 * 根因：flags 表有**两套载体**（brand 自身 / brand 的内层 obj）。类实例的
 * `defineProperty` 只把 flags 记在 **brand** 上，而枚举视图的 `enumKeys` 只
 * 查**内层 obj** 那一套 ⇒ 漏判。
 *
 * 修法：① `applyPropertyDescriptor` 的 brand 臂把 flags **并落内层 obj**（与
 * 原型 brand 路径同口径），并迁移旧 brand 的不变性侧表；② 枚举视图的
 * `enumKeys` / `assignSourceSlots` 走 `isEnumerableView` / brand 载体，
 * **并查两套载体**。
 *
 * 严格单变量对照：唯一变量 = 接收者的 kind（类实例 vs 普通对象），
 * `defineProperty` 写法逐字相同。
 */




const PRELUDE = `
class C { constructor() { this.x = 1; this.y = 2; } }
function mk() {
  const inst = new C();
  Object.defineProperty(inst, "x", { enumerable: false });
  return inst;
}
function mkPlain() {
  const plain = { x: 1, y: 2 };
  Object.defineProperty(plain, "x", { enumerable: false });
  return plain;
}
`;

/** 求值 f() 的结果 Abs */
function absOf(body: string): Abs_____abs_ts {
  return call(`${PRELUDE}\nexport function f() { ${body} }`, "f").result;
}

/** tuple 的逐元素字面量（任一元素无 lit 项 ⇒ undefined） */
function tupleLits(a: Abs_____abs_ts): unknown[] | undefined {
  if (a.shape.k !== "tuple") return undefined;
  const out = a.shape.elements.map((e) => {
    const v = litValue_____abs_ts(e);
    return v.ok ? v.value : undefined;
  });
  return out.some((v) => v === undefined) ? undefined : out;
}


  it("Object.keys 剔除不可枚举自有键（宿主同键集）；Object.values 同键集；Object.entries 同键集（键值对不重复发布不可枚举键）；JSON.stringify 只序列化可枚举自有键；Object.assign 只拷可枚举自有键；spread 只拷可枚举自有键；五个枚举面 + for-in + gOPN 同结论（引擎内部不再互斥）；描述符面：gOPD 说 x 是「自有 + 不可枚举」的数据属性；单变量对照：普通对象（同一 defineProper", () => {
  {
    expect(tupleLits(absOf("return Object.keys(mk());"))).toEqual(["y"]);
  }
  {
    expect(tupleLits(absOf("return Object.values(mk());"))).toEqual([2]);
  }
  {
    const a = absOf("return Object.entries(mk());");
    expect(a.shape.k).toBe("tuple");
    const els = (a.shape as { elements: Abs_____abs_ts[] }).elements;
    expect(els.length).toBe(1);
    expect(tupleLits(els[0]!)).toEqual(["y", 2]);
  }
  {
    const a = absOf("return JSON.stringify(mk());");
    expect(litValue_____abs_ts(a)).toEqual({ ok: true, value: '{"y":2}' });
  }
  {
    expect(tupleLits(absOf("return Object.keys(Object.assign({}, mk()));"))).toEqual(["y"]);
  }
  {
    expect(tupleLits(absOf("return Object.keys({ ...mk() });"))).toEqual(["y"]);
  }
  {
    expect(tupleLits(absOf("const s = []; for (const k in mk()) s.push(k); return s;"))).toEqual([
      "y",
    ]);
    // gOPN 是「**全部**自有键」语义 ⇒ 不可枚举的 x 照列
    expect(tupleLits(absOf("return Object.getOwnPropertyNames(mk());"))).toEqual(["x", "y"]);
  }
  {
    expect(
      tupleLits(
        absOf(`
  const inst = mk();
  const d = Object.getOwnPropertyDescriptor(inst, "x");
  return [d.value, d.writable, d.enumerable, d.configurable, Object.hasOwn(inst, "x")];
`),
      ),
    ).toEqual([1, true, false, true, true]);
  }
  {
    expect(tupleLits(absOf("return Object.keys(mkPlain());"))).toEqual(["y"]);
    expect(litValue_____abs_ts(absOf("return JSON.stringify(mkPlain());"))).toEqual({
      ok: true,
      value: '{"y":2}',
    });
  }
  {
    expect(
      tupleLits(
        absOf(`
  const inst = mk();
  Object.defineProperty(inst, "x", { enumerable: true });
  return Object.keys(inst);
`),
      ),
    ).toEqual(["x", "y"]);
  }
  {
    expect(
      tupleLits(
        absOf(`
  const inst = mk();
  Object.defineProperty(inst, "y", { enumerable: false });
  return Object.keys(inst);
`),
      ),
    ).toEqual([]);
  }
});











});

// ---------------------------------------------------------------------------
// CJS 顶层 this === module.exports
// ---------------------------------------------------------------------------
describe("CJS 顶层 this === module.exports", () => {
/**
 * CJS **顶层 `this`** 是 `undefined`（原生是 `module.exports`）
 * → 整个模块**定抛** ⇒ 假绿。
 *
 * 改前：CJS 前导只造 `exports` / `module`，**不绑 `this`**；转译器又把
 * 顶层 `this` 折成 `$lit(void 0)`（ESM 语义）⇒ `this.x = v` 写 undefined
 * ⇒ TypeError ⇒ 模块装载失败 ⇒ 全文件退化 unknown ⇒ 门禁绿灯。
 *
 * 改后：CJS 源给转译器 `thisParam`（顶层 this → 模块级绑定
 * `__nudoCjsThis`），CJS 前导把它绑到 `exports`（=== `module.exports`
 * 的同一对象）⇒ `this.x = v` 对 `module.exports` 可见（原生同口径）。
 * ESM 源保持 `undefined`（原生 ESM 顶层 this 就是 undefined）。
 */





  it("this.x = v 对 module.exports 可见（不再定抛）；只用顶层 this 的 CJS 源（无 export 语法）：this.x = v 不再定抛，槽进导出面；ESM 源顶层 this 仍是 undefined（原生一致）⇒ this.x = v 抛", () => {
  {
    const src = `this.answer = 42;
module.exports.probe = function(){ return module.exports.answer; };
export function f() { return module.exports.answer; }`;
    const exports = runTranspiled(src, { mode: "exec" });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(litValue_____abs_ts(full.result)).toEqual({ ok: true, value: 42 });
  }
  {
    // 原生 CJS：`this` === module.exports ⇒ `this.answer = 7` ⇒ 导出 { answer: 7 }
    const src = `this.answer = 7;`;
    const exports = runTranspiled(src, { mode: "exec" });
    expect(litValue_____abs_ts(exports["answer"] as never)).toEqual({ ok: true, value: 7 });
  }
  {
    const src = `export function f() { return 1; }
this.x = 1;`;
    expect(() => runTranspiled(src, { mode: "exec" })).toThrow();
  }
});



});

// ---------------------------------------------------------------------------
// 对照组：无 assume ⇒ 采用生效，返回面可证
// ---------------------------------------------------------------------------
describe("对照组：无 assume ⇒ 采用生效，返回面可证", () => {
/**
 * `@nudo:assume` 的前提槽按**形参名**作用域化。
 *
 * 旧行为：前提槽非 pTrue ⇒ **整体**关掉 callee 契约面的采用（#152 的
 * soundness 护栏）。一条与本次调用无关的惰性公理（如 `p <= q`，p/q 是调用方
 * 的局部量）会把调用方的返回类型退化成 `any`，并造出假红
 * （nudo:unproven-return / nudo:entry-may-throw）。
 *
 * 新行为：只有当**引理前提的自由变量里确实含该位被重锚成的 callee 形参名**
 * 时，才跳过这一位的采用；与调用无关的惰性引理不再整体关掉采用。
 * #152 的 soundness 护栏**保留**（引理名字与 callee 形参名撞名时仍跳过）。
 */




const SIDE_X = `import { fn, number } from "@nudojs/core";
export const helper = fn({ x: number().ge(0) });
export const sim = fn({}, number().ge(0));
`;

/** callee 形参名 = d（与引理里的 d 撞名 ⇒ soundness 护栏必须生效） */
const SIDE_D = `import { fn, number } from "@nudojs/core";
export const helper = fn({ d: number().ge(0) });
export const sim = fn({}, number().ge(0));
`;

const SRC_CONTROL = `export function helper(x) { return x; }
export function sim(s) {
  const p = 1;
  const q = 2;
  const h = helper(s);
  return h;
}
`;

/** 惰性引理：p/q 是 sim 的局部量，与 callee 形参名 x 无交集 */
const SRC_LAZY = `export function helper(x) { return x; }
/**
 * @nudo:assume p <= q
 */
export function sim(s) {
  const p = 1;
  const q = 2;
  const h = helper(s);
  return h;
}
`;

/** 撞名引理：d 是 helper 的形参名，也是 sim 的形参 ⇒ 采用必须跳过 */
const SRC_COLLIDE = `export function helper(d) { return d; }
export function wild(w) { return w ** 2; }
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  const dd = helper(wild(undefined));
  return dd;
}
`;

function run(file: string, src: string, side: string) {
  return checkSource___nudojs_core(file, src, pTrue___nudojs_core, {
    loadModule: (spec: string): string | undefined =>
      spec.includes(".nudo.js") ? side : undefined,
    fromFile: file,
  });
}

{
  const r = run("/t/b346-a.js", SRC_CONTROL, SIDE_X);
  it("无 unproven-return，返回面是 number", () => {
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    expect(sigOf(r, "sim")).toContain("number");
  });
}

describe("惰性引理：与调用无关的前提不得关掉采用", () => {
  const r = run("/t/b346-b.js", SRC_LAZY, SIDE_X);
  it("不产生假红（unproven-return 不在）；返回面仍是 number（旧行为退化成 any）", () => {
  {
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
    expect(r.issues.some((i) => i.severity === "error")).toBe(false);
  }
  {
    expect(sigOf(r, "sim")).toContain("number");
    expect(sigOf(r, "sim")).not.toContain("any");
  }
});
});

describe("soundness：引理名字与 callee 形参名撞名 ⇒ 该位仍不采用", () => {
  const r = run("/t/b346-d.js", SRC_COLLIDE, SIDE_D);
  it("采用被跳过 ⇒ 返回面不可证（unproven-return 在）；不得出现靠引理折出的假证明（assume-relied 不在）", () => {
  {
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(true);
  }
  {
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  }
});
});
});

// ---------------------------------------------------------------------------
// [merged] class-instance-method-l2
// ---------------------------------------------------------------------------
describe("class-instance-method-l2", () => {
// MERGED (topic-related bug pins): class-instance-method-l2 + instance-method-bridge
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>








{
/**
 * 导出类的**实例方法**在 L2 入口门禁面**整体漏检**（假绿）。
 *
 * 根因：check-may-throw.ts 的类分支**只有静态方法桥**（`$staticInvoke`）。
 * 静态桥对**不存在**的静态方法折 unknown（**不抛**）⇒ 实例方法走静态桥拿不到
 * 任何 throws 证据 ⇒ `evalThrowsOf` 交出「无证据」⇒ L2 门禁把
 * 「没分析出 may-throw」与「分析出没有 may-throw」当成同一件事 ⇒
 * 一个显式 `throw new TypeError()` 的公开实例方法判 OK / exit 0。
 *
 * 修法：类分支补**实例方法桥**（类 Abs → `$new`（构造实参 any，与
 * generalize.ts 同口径）→ `$invoke`），静态/实例按**源码类声明**判定
 * （运行期无法用返回值区分「静态方法返回 unknown」与「这是实例方法」）。
 *
 * 附带修：generalize.ts 的类方法桥此前把「方法体必抛」落进外层 catch ⇒
 * 签名退 unknown + 误导的 nudo:opaque-result（谎称「推断失败」）⇒ 改为
 * 返回位 never（与顶层导出同口径）。
 */





const clsSrc = `export class Counter {
  boom() { throw new TypeError("explicit"); }
  inc(by) { return by + 1; }
  static smake() { return 1 + Symbol("x"); }
}
export function plainBoom() { throw new TypeError("explicit"); }
`;

describe("类实例方法的 L2 入口 may-throw 不得整体漏检", () => {
  it("实例方法显式 throw ⇒ 报 nudo:entry-may-throw（改前：零 error / exit 0）；静态方法与顶层函数口径不变（各 1 条 L2）；实例方法必抛 ⇒ 签名面为 never（改前：unknown = 谎称「推断失败」）；eval 层：实例方法体必抛 ⇒ 调用返回 never + throws TypeError（无回归）", () => {
  {
    const r = checkSource("cls.js", clsSrc, pTrue, stdOpts);
    expect(l2Count(r, "Counter.boom")).toBe(1);
    const issue = r.issues.find(
      (i) => i.code === "nudo:entry-may-throw" && i.fn === "Counter.boom",
    );
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("may throw TypeError");
  }
  {
    const r = checkSource("cls.js", clsSrc, pTrue, stdOpts);
    expect(l2Count(r, "Counter.smake")).toBe(1);
    expect(l2Count(r, "plainBoom")).toBe(1);
  }
  {
    const r = checkSource("cls.js", clsSrc, pTrue, stdOpts);
    const sig = sigOf(r, "Counter.boom");
    expect(sig).toContain("never");
    expect(sig).not.toContain("unknown");
    expect(sig).toContain("throws TypeError");
  }
  {
    const r = call(
      `export class Counter { boom() { throw new TypeError("x"); } }
       export function probe() { return new Counter().boom(); }`,
      "probe",
      [],
    );
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  }
});



});
}

describe("instance-method-bridge", () => {
/**
 * （单元层）：类**实例方法桥**的 throws 证据。
 *
 * check-may-throw.ts 的类分支此前只有静态桥（`$staticInvoke`）⇒ 实例方法
 * 走静态桥只会折 unknown（**不抛**）⇒ 拿不到任何 throws 证据 ⇒ L2 门禁对
 * 类实例方法完全无感（假绿）。
 *
 * 修法：补实例方法桥（类 Abs → `$new`（构造实参 any）→ `$invoke`）；
 * 静态/实例按**源码类声明**判定（运行期无法用返回值区分）。
 */






const clsSrc = `export class Counter {
  boom() { throw new TypeError("explicit"); }
  inc(by) { return by + 1; }
  static smake() { return 1 + Symbol("x"); }
}
`;

describe("类实例方法桥（单元层）", () => {
  it("实例方法 ⇒ analyzed 且 throws 域带 TypeError（改前：absent / 无证据）；静态方法口径不变（仍走 $staticInvoke）；export default class 的实例方法同样走实例桥（导出槽兜底）", () => {
__scenario_1: {
    const file = parseSource(clsSrc);
    const out = evalThrowsOutcome(clsSrc, "Counter.boom", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") break __scenario_1;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  }
__scenario_2: {
    const file = parseSource(clsSrc);
    const out = evalThrowsOutcome(clsSrc, "Counter.smake", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") break __scenario_2;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  }
__scenario_3: {
    const src = `export default class D { boom() { throw new TypeError("x"); } }`;
    const file = parseSource(src);
    const out = evalThrowsOutcome(src, "D.boom", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") break __scenario_3;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  }
});


});
});
});

// ---------------------------------------------------------------------------
// [merged] transpiler-reject-l2-failclosed
// ---------------------------------------------------------------------------
describe("transpiler-reject-l2-failclosed", () => {
// MERGED (topic-related bug pins): transpiler-reject-l2-failclosed + unanalyzable-outcome
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * **转译器「不支持的构造」让 L2 入口 may-throw 门禁由红转绿**。
 *
 * 根因：check-may-throw.ts 的 `evalThrowsOf` 在 `tryRunTranspiled` 返回
 * undefined（转译器抛 NudoUnsupportedError）时**放弃整条 L2 证据** ⇒
 * 门禁看到的是「**没有** may-throw」⇒ 与「**没分析出** may-throw」混同
 * ⇒ 逐字只差一个 `++` 的两个表达式结论相反：
 * `return g().x` → L2 error（may throw TypeError）
 * `return g().x++` → 零 error（假绿，exit 0）
 *
 * 修法（fail-closed）：转译失败 ⇒ 入口**不可判定** ⇒ 记一条 fail-closed
 * 证据（kind=Error ⇒「入口**可能**抛 Error」是 sound 的过近似：未能分析
 * ⇒ 不能证明入口 total）。用户可用 `@nudo:throws Error` / `--ignore-throws
 * Error` 显式放行。
 */





const updSrc = `export function f(g) { return g().x++; }`;
const delSrc = `export function f(g) { return delete (g() + 1); }`;

describe("转译器拒绝构造 ⇒ L2 门禁不得由红转绿", () => {
  it("g().x++（不可写回的 update 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）；delete (g() + 1)（非成员 delete 目标）⇒ 报 nudo:entry-may-throw（改前：零 error）；fail-closed 证据可被 @nudo:throws Error 显式放行（用户可自证有意 fail-fast）；同模块的**其它**入口不做过度断言（原生下它们并不抛）；eval 层：可分析的孪生表达式记 Type", () => {
  {
    const r = checkSource("c6.js", updSrc, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  }
  {
    const r = checkSource("c7.js", delSrc, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(1);
  }
  {
    const src = `/**
 * @nudo:throws Error
 */
export function f(g) { return g().x++; }`;
    const r = checkSource("c6.js", src, pTrue, stdOpts);
    expect(l2Count(r, "f")).toBe(0);
    // 证据仍上屏（门禁过滤 ≠ 藏事实）
    expect(sigOf(r, "f")).toContain("throws");
  }
  {
    // 转译失败是模块级的（tricky 里的不支持构造让整个模块未求值）⇒ 若对
    // 兄弟入口 safe 也断言「可能抛 Error」，那是**不 sound** 的过度断言。
    const src = `export function safe() { return 1; }
export function tricky(g) { return g().x++; }`;
    const r = checkSource("mixed.js", src, pTrue, stdOpts);
    expect(l2Count(r, "tricky")).toBe(1);
    expect(l2Count(r, "safe")).toBe(0);
  }
  {
    expect(effects(`export function f(g) { return g().x; }`, "f")).toContain("TypeError");
    // 转译器拒绝 ⇒ 模块整体未求值（这正是「证据整条丢失」的根因）
    expect(() => effects(updSrc, "f")).toThrow();
  }
});




});
}

describe("unanalyzable-outcome", () => {
/**
 * （单元层）：转译器拒绝构造 ⇒ 求值结局必须是「不可判定」。
 *
 * `evalThrowsOf` 把「转译失败」与「无桥接」都折成 undefined ⇒ L2 证据面
 * 分不出「没分析出 may-throw」与「分析出没有 may-throw」。新增的
 * `evalThrowsOutcome` 把三种结局分开：**unanalyzable**（转译失败）/ analyzed
 * （已求值）/ absent（无桥接）。
 */




const updSrc = `export function f(g) { return g().x++; }`;

describe("转译失败的求值结局（单元层）", () => {
  it("转译器拒绝 ⇒ 结局是 unanalyzable（不是 analyzed / absent）；可分析的入口 ⇒ 结局仍是 analyzed（fail-closed 不得误伤正常路径）", () => {
__scenario_4: {
    const out = evalThrowsOutcome(updSrc, "f", []);
    expect(out.kind).toBe("unanalyzable");
    if (out.kind !== "unanalyzable") break __scenario_4;
    expect(out.reason).toContain("unsupported:");
  }
  {
    const src = `export function f(g) { return g().x; }`;
    const out = evalThrowsOutcome(src, "f", []);
    expect(out.kind).toBe("analyzed");
  }
});

});
});
});

// ---------------------------------------------------------------------------
// [merged] this-param-transpile
// ---------------------------------------------------------------------------
describe("this-param-transpile", () => {
// MERGED (topic-related bug pins): this-param-transpile + this-parameter
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>








{
/**
 * 回归（**转译面**）：TS 的 `this: T` 是**接收者标注**，不是运行时
 * 形参 —— 但转译器此前把它当**真形参**发射 ⇒ 产物是
 * `function withThis(this, a) { … }` ⇒ `this` **不是合法形参名**
 * （strict / sloppy 皆 `SyntaxError`）⇒ `new Function` 抛 ⇒
 * **整个模块装载失败** ⇒ 求值面（case@ / entry@ / call@）全折 `unknown`
 * （fail-closed）。
 *
 * 模型层（形参表排除 `this`）见 `this-parameter`；
 * 产物面（dts / zod / standard / case 四面）见
 * `packages/service/src/__tests__/service--this-param-product-faces.part.ts`；
 * 本钉只钉**转译面**：模块必须**装载成功**（不是 unknown），
 * 且形参表里**没有** `this`、实参**不因** `this` 占用而错位。
 */





const FN_DECL = `export function withThis(this: { x: number }, a: number): number { return a + 1; }`;
const CLASS_METHOD = `export class C { m(this: C, a: number): number { return a + 1; } }`;

describe("（转译面）：`this: T` 标注不得被发射成运行时形参", () => {
  it("带 `this: T` 的函数声明：实参按**实参位**绑定（`this` 不占位）；带 `this: T` 的函数声明：形参表里没有 `this`；带 `this: T` 的类方法：形参表里没有 `this`；带 `this: T` 的类方法：模块装载成功（产物语法合法，不抛 SyntaxError）", () => {
  {
    // `this` 是接收者标注 ⇒ 原生 `f(1)` 的 `a` = 1（不是 undefined）
    const r = callLit(FN_DECL, "withThis", 1);
    expect(r.result.shape.k).toBe("prim");
    expect(r.result.term?.op).toBe("lit");
    expect((r.result.term as { value?: unknown } | undefined)?.value).toBe(2);
  }
  {
    const poly = generalizeFromAst("withThis", FN_DECL, { label: "397" });
    expect(poly).toBeDefined();
    expect(poly!.params).toEqual(["a"]);
    expect(poly!.params).not.toContain("this");
  }
  {
    const poly = generalizeFromAst("C.m", CLASS_METHOD, { label: "397m" });
    expect(poly).toBeDefined();
    expect(poly!.params).toEqual(["a"]);
    expect(poly!.params).not.toContain("this");
  }
  {
    // 宿主方法签名此前是 `(__this, this, a) => {…}` ⇒ `this` 不是合法形参名
    // ⇒ 产物语法非法 ⇒ `new Function` 抛 ⇒ 整个模块装载失败
    expect(() => runTranspiled(CLASS_METHOD, { mode: "analyze" })).not.toThrow();
  }
});



});
}

describe("this-parameter", () => {
/**
 * TS 的 `this: T` **接收者标注**被当成运行时形参 ⇒ 形参表多一槽。
 *
 * 根因：TS 的 `this: T` 在 Babel AST 里就是普通 `Identifier("this")`
 * （**不是** TSParameterProperty），`formalParamsFromNodes` 的 `Identifier`
 * 分支没有「名字是 `this` ⇒ 接收者标注」的判据 ⇒ `this` 进形参表 ⇒ 顺着
 * `extractParamNames` → `fn.paramNames` 流向全部下游面（check 签名面 /
 * `--abs` / dts 形参表 / zod 槽名 / standard 导出名 / case 实参绑定）。
 *
 * 修法（族 08 · S3）：`formalParamsFromNodes` 跳过名字为 `this` 的形参
 * （`this` 是 JS 保留字，不可能有同名真形参 ⇒ 判据用标识符文本即可，
 * 与 harvester 路径 同口径）。跳过后**形参表的位置要跟着前移**
 * （`index` 与 `formalParamDisplayNames` 同序）。
 *
 * ⚠ **产物面在 S5**（dts / zod / standard / case）：它们消费
 * `fn.paramNames`（由 `formalParamDisplayNames(formalParamsFromNodes(…))`
 * 派生）⇒ 本片的模型修正自动传导过去。
 *
 * 反向钉：HEAD（未修）上 `formalParamDisplayNames` 是 `["this", "a"]`
 * ⇒ 本文件的断言**必失败**。
 */







const thisParamSource =
  "export function withThis(this: { x: number }, a: number) { return a + this.x; }\n";

describe("TS this-parameter is not a runtime param", () => {
  it("identifier named this is skipped from the formal param table；this does not appear in display / signature / contract names；generalize keeps only the real runtime params；check signature lists one param, not two；a param literally named this ca", () => {
  {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "this" },
      { type: "Identifier", name: "a" },
    ] as never);
    expect(formals).toHaveLength(1);
    expect(formals[0]).toMatchObject({ kind: "id", name: "a", index: 0 });
  }
  {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "this" },
      { type: "Identifier", name: "a" },
    ] as never);
    expect(formalParamDisplayNames(formals)).toEqual(["a"]);
    expect(formalParamSignatureNames(formals)).toEqual(["a"]);
    expect(contractParamNameSet(formals).has("this")).toBe(false);
    expect(locateContractParam(formals, "this")).toBeUndefined();
  }
  {
    const g = generalizeFromAst("withThis", thisParamSource);
    expect(g?.params).toEqual(["a"]);
    expect(g?.formals?.map((f) => f.kind)).toEqual(["id"]);
    expect(g?.formals?.map((f) => (f.kind === "id" ? f.name : f.kind))).toEqual([
      "a",
    ]);
  }
  {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    const r = checkSource("/t/lib.ts", thisParamSource, pTrue, {});
    expect(r.signatures).toHaveLength(1);
    expect(r.signatures[0]!.params).toEqual(["a"]);
    expect(r.signatures[0]!.paramTypes).toEqual(["number"]);
  }
  {
    // `function f(this) {}` 是 JS 语法错误 ⇒ 名字是 `this` 只能是接收者标注
    expect(() => new Function("function f(this) {}")).toThrow();
  }
});




});
});
});

// ---------------------------------------------------------------------------
// [merged] fn-optional-params
// ---------------------------------------------------------------------------
describe("fn-optional-params", () => {
// MERGED (topic-related bug pins): fn-optional-params + optional-params-write-side + param-optional-flag
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>






{
/**
 * 回归：默认形参**可省略** ⇒ 必选元数不能靠名字后缀猜。
 *
 * 根因（实测）：`packages/core/src/algebra/leq.ts` 的 `requiredFnArity` 按
 * 形参**名字**判必选（跳过 `...rest` / `x?`），而默认形参（`f(a, b = 1)`）
 * 在形参表面上只是**光秃秃的名字**（`b`）⇒ 被计成必选元数 ⇒
 * `f = (x = 1) => x` 被判「需要 1 个参数」⇒ `nudo:assign-mismatch` **假红**
 * （JS 语义下 `(x = 1) => x` 的 `length` 是 0）。
 *
 * 修法（读侧，本片）：fn shape 增**可选**字段 `optionalParams?: boolean[]`
 * （与 `params` 同下标，true = 该位可省），`leq` 读它算必选元数；缺省回退
 * `requiredFnArity`（**公开签名与既有行为一字不改**）。
 *
 * 写侧（模型 → shape）由族内另一片负责：形参表面（`FormalParam.optional`，
 * 族 03 已落）→ fn shape 的 `optionalParams`。本钉把**写侧口径**一并钉住
 * （形参表面 → shape → `leq` 判定），使写侧落地后不必再改钉。
 */





/** fn shape（可选带 `optionalParams` 标记——写侧口径） */
function fnAbs(params: string[], optionalParams?: boolean[]): Abs_____abs_ts {
  const shape = {
    k: "fn" as const,
    params,
    ...(optionalParams ? { optionalParams } : {}),
  };
  return abs(shape as Shape, undefined, undefined, "exact");
}

/** 形参表面 → fn shape（写侧口径：形参 optional 标记 → shape optionalParams） */
function fnAbsFromFormals(formals: FormalParam[]): Abs_____abs_ts {
  return fnAbs(
    formalParamDisplayNames(formals),
    formals.map((f) => f.optional === true),
  );
}

/** AST 形参节点（结构化字面量——不必引 parser） */
function paramsOf(...nodes: Array<Record<string, unknown>>) {
  return formalParamsFromNodes(nodes as never);
}

describe("默认形参可省略 ⇒ 必选元数读 optionalParams 标记", () => {
  it("模型层：默认形参带 optional 标记、普通形参不带；端到端（读侧）：f(a, b = 1) 赋给「只需 1 个必选元」的 fn ⇒ 可赋值；反向控制：f(a, b)（无默认）⇒ 不可赋值（必选 2 > 目标必选 1）；反向控制：f(a, b = 1) 赋给「0 个必选元」的 fn ⇒ 仍不可赋值（a 是必选）；缺省标记时回退名字后缀判据（既有行为不变）；公开口径 requiredFnArity 一字不改", () => {
  {
    const formals = paramsOf(
      { type: "Identifier", name: "a" },
      {
        type: "AssignmentPattern",
        left: { type: "Identifier", name: "b" },
        right: { type: "NumericLiteral", value: 1 },
      },
    );
    expect(formals.map((f) => f.optional)).toEqual([false, true]);
    expect(formalParamDisplayNames(formals)).toEqual(["a", "b"]);
  }
  {
    const src = fnAbsFromFormals(
      paramsOf(
        { type: "Identifier", name: "a" },
        {
          type: "AssignmentPattern",
          left: { type: "Identifier", name: "b" },
          right: { type: "NumericLiteral", value: 1 },
        },
      ),
    );
    expect(src.shape.k).toBe("fn");
    expect(leqAbs(src, fnAbs(["a"])).ok).toBe(true);
  }
  {
    const src = fnAbsFromFormals(
      paramsOf({ type: "Identifier", name: "a" }, { type: "Identifier", name: "b" }),
    );
    const r = leqAbs(src, fnAbs(["a"]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 2");
  }
  {
    const src = fnAbsFromFormals(
      paramsOf(
        { type: "Identifier", name: "a" },
        {
          type: "AssignmentPattern",
          left: { type: "Identifier", name: "b" },
          right: { type: "NumericLiteral", value: 1 },
        },
      ),
    );
    const r = leqAbs(src, fnAbs([]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 1");
  }
  {
    expect(leqAbs(fnAbs(["a", "b"]), fnAbs(["a"])).ok).toBe(false);
    expect(leqAbs(fnAbs(["a", "...rest"]), fnAbs(["a"])).ok).toBe(true);
    expect(leqAbs(fnAbs(["a", "b?"]), fnAbs(["a"])).ok).toBe(true);
  }
  {
    expect(requiredFnArity(["x0", "...paths"])).toBe(1);
    expect(requiredFnArity(["options?"])).toBe(0);
    expect(requiredFnArity(["path", "ext?"])).toBe(1);
    expect(requiredFnArity(["a", "b"])).toBe(2);
    expect(requiredFnArity(undefined)).toBe(0);
  }
});





});
}

describe("optional-params-write-side", () => {
/**
 * 回归（**写侧**）：形参表面（`FormalParam.optional`）→ fn shape 的
 * `optionalParams` 标记 → `leq` 的必选元数判定。
 *
 * 读侧钉在 `core--fn-optional-params.part.ts`（模型层：形参表面 →
 * shape → `leq`）；本钉走**真实管线**（源码 → 转译 → fn shape），
 * 因为写侧的每一跳都在真实路径上才生效：
 *
 * - 转译面：函数表达式 / 箭头 → `transpile/expr/function.ts` 的 `$fnVal(...)`
 * 发射 `optionalParams: [...]`（`transpile/helpers.ts` 的
 * `paramOptionalFlags`，与 `paramDisplayNames` 同源同长度 ⇒ 下标对齐）；
 * - 声明面：`generalize.ts` 的 6 个 `env.fns.set` 写 `optionalParams`，
 * `abs-modules.ts` 的 `fnToAbs` 读出；
 * - 载体：`AbsFnImpl.optionalParams` → `absFunction` 落进 `Shape.k==="fn"`；
 * - 消费：`leq.ts` 的 `fnRequiredArity`（先读标记，缺省回退名字后缀）。
 *
 * 产品症状：`let f = () => 2; f = (x = 1) => x;` ⇒ 新值被计成「需要 1 个
 * 参数」而旧值是 0 ⇒ `nudo:assign-mismatch` **假红**（JS 语义下
 * `(x = 1) => x` 的 `length` 是 0 ⇒ 可零参调用）。
 */





/** 转译产物里取某个导出绑定的 fn shape */
function fnShapeOf(src: string, name: string): { params: string[]; optionalParams?: boolean[] } | undefined {
  const exports = runTranspiled(src, { mode: "analyze" }) as Record<string, Abs_____abs_ts>;
  const v = exports[name];
  const sh = v?.shape;
  if (!sh || sh.k !== "fn") return undefined;
  return { params: sh.params, optionalParams: sh.optionalParams };
}

/** fn shape（无标记）——目标侧 */
function fnAbs(params: string[]): Abs_____abs_ts {
  return abs({ k: "fn", params }, undefined, undefined, "exact");
}

describe("（写侧）：默认形参的「可省略」标记真的落到了 fn shape 上", () => {
  it("箭头函数：默认形参位标为可省略；箭头函数：普通形参位不标为可省略；必选元数按标记算：`(x = 1) => x` 赋给「0 个必选元」的 fn ⇒ 可赋值；反向控制：无默认值的 `(x, y)` 赋给「0 个必选元」的 fn ⇒ 不可赋值；反向控制：默认形参**不**抹掉前面形参的必选性（`(x, y = 1)` 仍需 1 个）", () => {
  {
    const sh = fnShapeOf("export const f = (x = 1) => x;", "f");
    expect(sh).toBeDefined();
    expect(sh!.params).toEqual(["x"]);
    expect(sh!.optionalParams).toEqual([true]);
  }
  {
    const sh = fnShapeOf("export const f = (x, y = 1) => x + y;", "f");
    expect(sh).toBeDefined();
    expect(sh!.optionalParams).toEqual([false, true]);
  }
  {
    const sh = fnShapeOf("export const f = (x = 1) => x;", "f");
    const src = abs(
      { k: "fn", params: sh!.params, optionalParams: sh!.optionalParams },
      undefined,
      undefined,
      "exact",
    );
    expect(leqAbs(src, fnAbs([])).ok).toBe(true);
  }
  {
    const sh = fnShapeOf("export const f = (x, y) => x + y;", "f");
    const src = abs(
      { k: "fn", params: sh!.params, optionalParams: sh!.optionalParams },
      undefined,
      undefined,
      "exact",
    );
    const r = leqAbs(src, fnAbs([]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 2");
  }
  {
    const sh = fnShapeOf("export const f = (x, y = 1) => x + y;", "f");
    const src = abs(
      { k: "fn", params: sh!.params, optionalParams: sh!.optionalParams },
      undefined,
      undefined,
      "exact",
    );
    const r = leqAbs(src, fnAbs([]));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("fn arity required 1");
  }
});




});
});

describe("param-optional-flag", () => {
/**
 * （S3 只落**模型层**）—— 默认形参**可省略**，形参表必须带
 * `optional` 标记。
 *
 * 根因：`requiredFnArity` 靠**名字后缀**（`...rest` / `?`）判「可省」，
 * 而默认形参在 `formalParamDisplayNames` 里被渲染成**光秃秃的名字**
 * ⇒ 既非 `...` 也非 `?` ⇒ 默认形参被计成必选元数。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：`FormalParam` 的每个变体带
 * `optional?: boolean` 标记（true = 该位可省略），消费侧（S1 的
 * `requiredFnArity`）改读这个标记，不再靠名字后缀猜。
 *
 * 语义：`optional === true` ⇔ 该形参位**可以省略**：
 * - `kind: "default"`（`f(a, b = 1)`）⇒ true（默认形参可省）
 * - `kind: "rest"`（`f(...args)`）⇒ true（rest 恒可省）
 * - `kind: "pattern"` 且带默认值（`f({ a } = {})`）⇒ true
 * - `kind: "id"` / 无默认值的 pattern ⇒ false（必填）
 *
 * 反向钉：HEAD（未修）上 `optional` 字段不存在（undefined）⇒ 断言**必失败**。
 */



describe("formal param optional marker", () => {
  it("default param is marked optional；pattern with a default value is optional, bare pattern is not；the marker is independent of the display name (no name-suffix guessing)", () => {
  {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
      { type: "RestElement", argument: { type: "Identifier", name: "args" } },
    ] as never);
    expect(formals[0]!.optional).toBe(false);
    expect(formals[1]!.optional).toBe(true);
    expect(formals[2]!.optional).toBe(true);
  }
  {
    const withDefault = formalParamsFromNodes([
      {
        type: "AssignmentPattern",
        left: {
          type: "ObjectPattern",
          properties: [
            {
              type: "ObjectProperty",
              key: { type: "Identifier", name: "a" },
              value: { type: "Identifier", name: "a" },
            },
          ],
        },
      },
    ] as never);
    const bare = formalParamsFromNodes([
      {
        type: "ObjectPattern",
        properties: [
          {
            type: "ObjectProperty",
            key: { type: "Identifier", name: "a" },
            value: { type: "Identifier", name: "a" },
          },
        ],
      },
    ] as never);
    expect(withDefault[0]!.optional).toBe(true);
    expect(bare[0]!.optional).toBe(false);
  }
  {
    const formals = formalParamsFromNodes([
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
    ] as never);
    // 名字不带 `?` / `...` 后缀 ⇒ 消费侧必须读 optional 标记
    const p = formals[0]!;
    expect(p.kind === "default" ? p.name : undefined).toBe("b");
    expect(p.optional).toBe(true);
  }
});


});
});
});

// ---------------------------------------------------------------------------
// rest 形参的实参聚合
// ---------------------------------------------------------------------------
describe("rest 形参的实参聚合", () => {
/**
 * rest 形参的调用点执法：实参必须**聚合成数组**再与契约比。
 *
 * 根因：`locateContractParam` 算出了 `rest: true`，但 `scan-literal-calls.ts`
 * 的 `entries.push` **没把它带进**（`RefineEntry`）⇒ 下游无从知道要聚合；
 * 执法侧的实参映射又是**恒等**（`(i) => i`）⇒ rest 形参拿到的是**首个**
 * 实参 ⇒ 合法调用 `sum(1, 2)` 被判「实参 1 ⊭ array 约束」（假红），且报出
 * 的实参值也是错的（`1` 而不是 `[1, 2]`）。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：标志要**透传** + 执法侧按 rest
 * 聚合实参（该位之后的全部实参 → 精确元组 Abs）。
 *
 * 反向钉：HEAD（未修）上 `sum(1, 2)` 报违例 ⇒ 本文件在 HEAD 上**必失败**。
 */






const SIDECAR = `import { fn, number, array } from "@nudojs/core";
export const sum = fn({ nums: array(number().gt(0)) }, number());
`;

const SUM = `export function sum(...nums) {
  let s = 0;
  for (const n of nums) s += n;
  return s;
}
`;

/** 调用点违例（nudo:constraint-violated）——每次只放**一个**调用点 */
function violated(callSrc: string): Array<{ message: string; actual?: string; expected?: string }> {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  const { loadModule } = makeFiles({ "/t/sum.nudo.js": SIDECAR });
  const r = checkSource_____check_check_ts("/t/sum.js", `${SUM}${callSrc}`, pTrue_____pred_ts, {
    loadModule,
    fromFile: "/t/sum.js",
    autoBind: true,
  });
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}


  it("合法调用 sum(1, 2) 不报违例（rest 实参聚合成 [1, 2] 再与 array 契约比）；sum(1, -2) 报违例，且 actual 是整个聚合值 [1, -2]（不是首个实参 1）", () => {
  {
    expect(violated("export function g() { return sum(1, 2); }\n").length).toBe(0);
  }
  {
    const v = violated("export function h() { return sum(1, -2); }\n");
    expect(v.length).toBe(1);
    expect(v[0]!.message).toContain("sum");
    expect(v[0]!.actual).toContain("[1, -2]");
    expect(v[0]!.expected).toContain("nums");
  }
});


});

// ---------------------------------------------------------------------------
// static / 实例同名：指令 scope 名必须区分
// ---------------------------------------------------------------------------
describe("static / 实例同名：指令 scope 名必须区分", () => {
/**
 * `static` 方法与实例方法**共用指令 scope 名 `C.m`**
 * ⇒ 叠加 的「按名首个命中」⇒ **只存活一条** `@nudo:contract`，
 * 且被**同时套到两个方法**上（静态的契约套到实例方法 ⇒ 参数名不匹配假红）。
 *
 * 根因（`directive-scan.ts` 的 `ClassMethod` 分支）：scope 名由
 * `${cname}.${keyName}` 合成，**不区分 `static` 与实例**。
 *
 * 修法：类里有**同名实例方法**时，静态方法的 scope 改名 `C.static.m`
 * （实例方法保名 `C.m`）。口径与**普查面**（`scan-top-functions.ts` 的
 * `collectClassMethods`：同名时只登记**实例**方法）一致 ⇒ 指令面与普查面
 * 对「`C.m` 是哪个方法」的理解一致。
 */





const STATIC_AND_INST = `export class C {
  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }

  /**
   * @nudo:contract b shortName
   */
  m(b) { return b; }
}
`;

const STATIC_ONLY = `export class C {
  /**
   * @nudo:contract a positive
   */
  static m(a) { return a; }
}
`;

const INST_ONLY = `export class C {
  /**
   * @nudo:contract b shortName
   */
  m(b) { return b; }
}
`;

function scopesOf(src: string) {
  return listFnDirectiveScopes(parseSource_____index_ts(src));
}


  it("同名时：静态方法改名 C.static.m，实例方法保名 C.m；同名时：按名查找 C.m 命中的是**实例**方法的注释块；同名时：两条契约各自可见（互不顶替）；只有静态方法时：scope 名仍是 C.m（与普查面同名，不改名）；只有实例方法时：scope 名仍是 C.m（对照）；同名时：普查面仍只登记 C.m（族 11 口径未变）", () => {
  {
    const names = scopesOf(STATIC_AND_INST).map((s) => s.name);
    expect(names).toEqual(["C.static.m", "C.m"]);
  }
  {
    const scope = findFnDirectiveScope(parseSource_____index_ts(STATIC_AND_INST), "C.m");
    expect(scope?.commentLines.join(" ")).toContain("@nudo:contract b shortName");
    expect(scope?.commentLines.join(" ")).not.toContain("@nudo:contract a positive");
  }
  {
    const src = withStdImport(STATIC_AND_INST);
    expect(extractRefinesFromSource(src, "C.m", stdOpts).map((e) => e.param)).toEqual(["b"]);
    expect(extractRefinesFromSource(src, "C.static.m", stdOpts).map((e) => e.param)).toEqual([
      "a",
    ]);
  }
  {
    expect(scopesOf(STATIC_ONLY).map((s) => s.name)).toEqual(["C.m"]);
    expect(listTopFunctions(STATIC_ONLY)).toEqual(["C.m"]);
  }
  {
    expect(scopesOf(INST_ONLY).map((s) => s.name)).toEqual(["C.m"]);
    expect(listTopFunctions(INST_ONLY)).toEqual(["C.m"]);
  }
  {
    expect(listTopFunctions(STATIC_AND_INST)).toEqual(["C.m"]);
  }
});






});

// ---------------------------------------------------------------------------
// CJS 赋值形态：指令必须落在导出名上
// ---------------------------------------------------------------------------
describe("CJS 赋值形态：指令必须落在导出名上", () => {
/**
 * **CJS 赋值形态**（`exports.f = function` / `module.exports.f =` /
 * `module.exports = fn`）的**函数级指令整条被静默丢弃**
 * ⇒ L1 契约**假绿** + `@nudo:throws` 抑制**失效**（假红）+ `@nudo:case`
 * **蒸发**——零诊断。
 *
 * 根因（`directive-scan.ts` 的 `AssignmentExpression` 分支）：CJS 赋值形态
 * **没有 AST 绑定名可取**（`exports.f` 的 `f` 不是绑定）⇒ scope 名落成
 * `<anonymous>` ⇒ 消费口按**导出名**（`f`）查不到 ⇒ 指令全部蒸发。
 *
 * 修法：识别 CJS 导出槽（`exports.f` / `module.exports.f` / `module.exports`）
 * ⇒ 给该形态一个**绑定名**（导出槽名）并把**语句级**注释挂上去。
 */





const CJS_CONTRACT = `/**
 * @nudo:contract x positive
 */
exports.f = function (x) {
  return x + 1;
};
`;

const CJS_MODULE_CONTRACT = `/**
 * @nudo:contract x positive
 */
module.exports.f = function (x) {
  return x + 1;
};
`;

const CJS_MODULE_DEFAULT = `/**
 * @nudo:contract x positive
 */
module.exports = function (x) {
  return x + 1;
};
`;

const CJS_MODULE_NAMED = `/**
 * @nudo:contract x positive
 */
module.exports = function inner(x) {
  return x + 1;
};
`;

const CJS_ARROW = `/**
 * @nudo:contract x positive
 */
exports.f = (x) => x + 1;
`;

const CJS_THROWS = `/**
 * @nudo:throws TypeError
 */
exports.f = function (x) {
  return x + 1;
};
`;

const ESM_CONTROL = `/**
 * @nudo:contract x positive
 */
export function f(x) {
  return x + 1;
}
`;

function scopeNames(src: string): string[] {
  return listFnDirectiveScopes(parseSource_____index_ts(src)).map((s) => s.name);
}


  it("exports.f = function ⇒ scope 名是导出槽名 f；module.exports.f = function ⇒ scope 名是 f；module.exports = function ⇒ scope 名是 default；module.exports = function inner() ⇒ 回退内层 id（普查面同口径）；exports.f = 箭头 ⇒ scope 名是 f；语句级 JSDoc 挂到 CJS scope 上（不再蒸发）；L1 契约", () => {
  {
    expect(scopeNames(CJS_CONTRACT)).toEqual(["f"]);
  }
  {
    expect(scopeNames(CJS_MODULE_CONTRACT)).toEqual(["f"]);
  }
  {
    expect(scopeNames(CJS_MODULE_DEFAULT)).toEqual(["default"]);
  }
  {
    expect(scopeNames(CJS_MODULE_NAMED)).toEqual(["inner"]);
  }
  {
    expect(scopeNames(CJS_ARROW)).toEqual(["f"]);
  }
  {
    const scope = findFnDirectiveScope(parseSource_____index_ts(CJS_CONTRACT), "f");
    expect(scope?.commentLines.join(" ")).toContain("@nudo:contract x positive");
  }
  {
    const cjs = extractRefinesFromSource(
      withStdImport(CJS_CONTRACT),
      "f",
      stdOpts,
    ).map((e) => e.param);
    const esm = extractRefinesFromSource(
      withStdImport(ESM_CONTROL),
      "f",
      stdOpts,
    ).map((e) => e.param);
    expect(cjs).toEqual(["x"]);
    expect(cjs).toEqual(esm);
  }
  {
    expect(extractDeclaredThrows(CJS_THROWS, "f")).toEqual(["TypeError"]);
  }
  {
    expect(l2Count(issuesOf(CJS_THROWS, "/t/b428/throws.js"), "f")).toBe(0);
  }
  {
    expect(scopeNames(ESM_CONTROL)).toEqual(["f"]);
    expect(
      extractRefinesFromSource(withStdImport(ESM_CONTROL), "f", stdOpts).map((e) => e.param),
    ).toEqual(["x"]);
  }
  {
    expect(listTopFunctions(CJS_CONTRACT)).toEqual(["f"]);
    expect(scopeNames(CJS_CONTRACT)).toEqual(listTopFunctions(CJS_CONTRACT));
    expect(listTopFunctions(CJS_MODULE_CONTRACT)).toEqual(["f"]);
    expect(scopeNames(CJS_MODULE_CONTRACT)).toEqual(listTopFunctions(CJS_MODULE_CONTRACT));
    expect(listTopFunctions(CJS_MODULE_NAMED)).toEqual(["inner"]);
    expect(scopeNames(CJS_MODULE_NAMED)).toEqual(listTopFunctions(CJS_MODULE_NAMED));
  }
});











});

// ---------------------------------------------------------------------------
// union 契约的 prim 成员（typeof 原子可判定）
// ---------------------------------------------------------------------------
describe("union 契约的 prim 成员（typeof 原子可判定）", () => {
/**
 * union 契约的 **prim 成员**：成员实例化成 `typeof` 原子
 * （`union(number(), string())` ⇒ `or(typeof(x,"number"), typeof(x,"string"))`）
 * ⇒ 执法侧判不了 `typeof` 原子 ⇒ or 聚合臂拿到 `unknown` ⇒
 * **整条 union 契约零义务**（不在成员域内的实参全放行 = 假绿）。
 *
 * 症状（族 11 / S1 修前实测，闸① oracle）：
 * - `union(number(), string())` 收到 `true` ⇒ 0 违例（**假绿**）
 * - `union(number(), boolean())` 收到 `"x"` ⇒ 0 违例（**假绿**）
 * - `union(number(), lit("a"))` 收到 `true` ⇒ 0 违例（**假绿**）
 *
 * 根因：`scan/literal-preds.ts` 的 `judgeLiteralPred` 只认 eq / 数值界原子，
 * 没有 `typeof`（`ptypeof` 构造器产物）分支 ⇒ 类型级成员判不了。
 *
 * 修法（S1，`scan/literal-preds.ts`）：`judgeLiteralPred` 加 `typeof` 分支 ——
 * 按实参 Abs 的 prim 形状（prim / obj / arr / tuple / fn + nullish 分档）算出
 * JS `typeof` 名，再与谓词的 `type` 比。
 *
 * ⚠ **不在本钉范围内（消费侧 `scan/literal-shapes.ts`，S2 在途）**：
 * 实参**不是标量字面量**（如 `{}` / `[]`）时，or 聚合臂仍被 `lv` 值类型门
 * 挡在门外 ⇒ 那几种实参仍零义务（假绿）。本钉只钉**标量实参**这一族。
 */





const SIDE = `import { number, string, boolean, lit, union } from "@nudojs/core";
export const numOrStr = union(number(), string());
export const numOrBool = union(number(), boolean());
export const numOrA = union(number(), lit("a"));
`;

const IMP = `/// @nudo:import { numOrStr, numOrBool, numOrA } from "./std431.nudo.js"\n`;

const FILE = "/t/std431.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo___nudojs_core();
  resetGeneralizeMemo___nudojs_core();
  return checkSource___nudojs_core(FILE, IMP + src, pTrue___nudojs_core, sidecarOpts("std431", SIDE, FILE));
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


  it("union(number(), string()) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), boolean()) 收到 'x' ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), lit('a')) 收到 true ⇒ 判违例（改前 0 违例 = 假绿）；union(number(), string()) 收到 's' ⇒ 放行（成员域内的实参不误伤）；union(number(), string()) 收到", () => {
  {
    const r = check(call("numOrStr", "true"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ typeof x = "string")');
    expect(vs[0]?.actual).toContain("true");
  }
  {
    const r = check(call("numOrBool", '"x"'));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ typeof x = "boolean")');
  }
  {
    const r = check(call("numOrA", "true"));
    const vs = violated(r);
    expect(vs.length).toBe(1);
    expect(vs[0]?.expected).toBe('(typeof x = "number" ∨ x = "a")');
  }
  {
    const r = check(call("numOrStr", '"s"'));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(call("numOrStr", "1"));
    expect(violated(r).length).toBe(0);
  }
  {
    const r = check(`export function f(x) { return x; }
export function use() { return f(true); }`);
    expect(violated(r).length).toBe(0);
  }
});






});

// ---------------------------------------------------------------------------
// union 成员的结构义务不再丢失
// ---------------------------------------------------------------------------
describe("union 成员的结构义务不再丢失", () => {
/**
 * `union(...)` 含 shape / array 成员时**成员结构义务整体丢失**（假绿）。
 *
 * 契约侧（`constraint.ts` 的 `instantiateConstraint`）把 union 成员摊成顶层
 * `or(...)` 谓词，成员的 `fields` / `element` 不会抬到 union 约束上；执法侧
 * 原本也没有 union 成员分支 ⇒ 两侧都缺 ⇒ `fUnioned({ id: "x" })` /
 * `fArrUnion(["x"])` 零诊断。
 *
 * 修法：消费侧（`scan/literal-shapes.ts` 的 `checkShapeReqs`）补 union 成员
 * 分支——与实参形态匹配的成员**全部**不满足才报违例（union 是析取）。
 *
 * 三类形态覆盖（消费侧形态覆盖验证）：
 * ① 成员是 array → `union(array(number()), lit(1))`
 * ② 嵌套 shape → `union(shape({ a: shape({ b: number() }) }), lit(1))`
 * ③ 成员带界 → `union(number().gt(0), shape({ a: number() }))`
 */





const NUDO_SRC = `
import { fn, number, shape, array, union, lit, any } from "@nudojs/core";
const user = shape({ id: number() });
export const fDirect = fn({ o: user }, any());
export const fUnioned = fn({ u: union(user, lit(1)) }, any());
export const fArrUnion = fn({ a: union(array(number()), lit(1)) }, any());
export const fNested = fn({ n: union(shape({ a: shape({ b: number() }) }), lit(1)) }, any());
export const fBounds = fn({ b: union(number().gt(0), shape({ a: number() })) }, any());
`;

const opts = sidecarOpts("core-bug-433.nudo.js", NUDO_SRC, "/t/core-bug-433.js");

function check(src: string) {
  return checkSource("/t/core-bug-433.js", src, pTrue, opts);
}

function violated(r: { issues: CheckIssue[] }, fn?: string) {
  return r.issues.filter(
    (i) => i.code === "nudo:constraint-violated" && (!fn || i.fn === fn),
  );
}

const DECLS = `
export function fDirect(o) { return o; }
export function fUnioned(u) { return u; }
export function fArrUnion(a) { return a; }
export function fNested(n) { return n; }
export function fBounds(b) { return b; }
`;


  it("shape 成员：union(user, lit(1)) 收到 { id: \"x\" } 报违例；形态①：array 成员——union(array(number()), lit(1)) 收到 [\"x\"] 报违例；形态②：嵌套 shape 成员——收到 { a: { b: \"x\" } } 报违例；形态③：成员带界——union(number().gt(0), shape({a:number()})) 收到 { a: \"x\" } 报违例；析取语义：任一成员满足即放行（不误报）；标", () => {
  {
    const r = check(`${DECLS}\nfUnioned({ id: "x" });\n`);
    const v = violated(r, "fUnioned");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof u.id = "number"');
  }
  {
    const r = check(`${DECLS}\nfArrUnion(["x"]);\n`);
    const v = violated(r, "fArrUnion");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof a[0] = "number"');
  }
  {
    const r = check(`${DECLS}\nfNested({ a: { b: "x" } });\n`);
    const v = violated(r, "fNested");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof n.a.b = "number"');
  }
  {
    const r = check(`${DECLS}\nfBounds({ a: "x" });\n`);
    const v = violated(r, "fBounds");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof b.a = "number"');
  }
  {
    const r = check(
      `${DECLS}\nfUnioned({ id: 5 });\nfArrUnion([1, 2]);\nfNested({ a: { b: 1 } });\nfBounds({ a: 1 });\n`,
    );
    expect(violated(r)).toEqual([]);
  }
  {
    // `1` 满足 lit(1) 成员 ⇒ union 满足 ⇒ 无违例
    const r = check(`${DECLS}\nfUnioned(1);\n`);
    expect(violated(r)).toEqual([]);
  }
  {
    const r = check(`${DECLS}\nfDirect({ id: "x" });\n`);
    const v = violated(r, "fDirect");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toContain('typeof o.id = "number"');
  }
});







});

// ---------------------------------------------------------------------------
// 本地类实例的调用点执法
// ---------------------------------------------------------------------------
describe("本地类实例的调用点执法", () => {
/**
 * **类方法**的侧车契约在任何调用点都不执法
 * （`c.m(-1)` 违反 `a > 0` 却零诊断 ⇒ 假绿）——而契约面 / 签名面都声称
 * 它生效（`C.m [handwritten] (a: number().gt(0))`）。
 *
 * 根因：调用图的被调名解析只认**对象字面量**成员（memberToFn 只收
 * `const api = { f }`），不认**本地类实例**（`const c = new C()`）⇒
 * `c.m` 解析不出源码函数名 ⇒ 整条调用被跳过（绑定面认 `C_m` ↔ `C.m`，
 * 执法面不认 ⇒ 两面名字空间不一致）。
 *
 * 钉住：
 * - memberToFn 收下本地类实例的成员（`c.m` ⇒ `C.m`）
 * - 调用点 `c.m(-1)` 报 nudo:constraint-violated
 * - 满足契约的实参（`c.m(1)`）不报（不放宽过头）
 */







const SRC = `
export function plain(a) { return a; }
export class C {
  m(a) { return a; }
}
plain(-1);
const c = new C();
c.m(-1);
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const plain = fn({ a: number().gt(0) }, number());
export const C_m = fn({ a: number().gt(0) }, number());
`;

{
  beforeEach(() => {
    resetCheckSourceMemo();
  });

  it("memberToFn 收下本地类实例成员（c.m ⇒ C.m）；c.m(-1) 违反类方法契约 ⇒ nudo:constraint-violated；满足契约的实参不报（c.m(1) 放行）", () => {
  {
    resetCheckSourceMemo();


    const known = listTopFunctions(SRC);
    expect(known).toContain("C.m");
    const resolve = collectCallResolvers(SRC, known);
    expect(resolve.memberToFn.get("c.m")).toBe("C.m");
  }
  {
    resetCheckSourceMemo();


    const { loadModule } = makeFiles({ "/t/lib.nudo.js": SIDECAR });
    const r = checkSource("/t/lib.js", SRC, pTrue, { loadModule, fromFile: "/t/lib.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    // plain(-1) 与 c.m(-1) 两条都必须报（此前只有 plain 一条）
    expect(violated.length).toBe(2);
    expect(violated.some((i) => i.fn === "C.m")).toBe(true);
    expect(r.ok).toBe(false);
  }
  {
    resetCheckSourceMemo();


    const { loadModule } = makeFiles({ "/t/lib.nudo.js": SIDECAR });
    const src = `
export class C {
  m(a) { return a; }
}
const c = new C();
c.m(1);
`;
    const r = checkSource("/t/lib2.js", src, pTrue, { loadModule, fromFile: "/t/lib2.js" });
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  }
});


}
});

// ---------------------------------------------------------------------------
// TS 声明合并（function / class / enum + 同名 namespace）
// ---------------------------------------------------------------------------
describe("TS 声明合并：同名 namespace 不得覆盖同名值绑定", () => {
  it("transpile：function + namespace 不再发同名 const（改前 `const f = $unknown()` 与 `function f` 重复 ⇒ 产物非法）；模块可装载且 f(1) = 2", () => {
    const merged = `export function f(x: number): number { return x + 1; }
export namespace f { export const v = 1; }`;
    const code = transpileSource(merged, { target: "host", runtimeImport: null, filename: "/t/m.ts" });
    expect(code).not.toContain("const f = $unknown()");
    expect(code).toContain("function f(x)");
  });

  it("check：三形态（function / class / enum + 同名 namespace）与无 namespace 对照同判 OK，签名不回退 unknown", () => {
    const ctl = checkSource("/t/ctl.ts", `export function merged(x: number): number { return x + 1; }`, pTrue, stdOpts);
    expect(sigOf(ctl, "merged")).toContain("number");
    expect(ctl.issues.filter((i) => i.code === "nudo:module-throw")).toEqual([]);

    const fn = checkSource(
      "/t/fn.ts",
      `export function f(x: number): number { return x + 1; }
export namespace f { export const v = 1; }`,
      pTrue,
      stdOpts,
    );
    expect(fn.issues.filter((i) => i.code === "nudo:module-throw")).toEqual([]);
    // 与无 namespace 的对照**同签名**（不回退 unknown）
    expect(sigOf(fn, "f")).toBe(sigOf(ctl, "merged"));
    expect(sigOf(fn, "f")).not.toContain("unknown");

    const cl = checkSource(
      "/t/cl.ts",
      `export class C { n = 1; }
export namespace C { export const v = 2; }
export function h(): number { return new C().n; }`,
      pTrue,
      stdOpts,
    );
    expect(cl.issues.filter((i) => i.code === "nudo:module-throw")).toEqual([]);
    expect(sigOf(cl, "h")).toBe("1");

    const en = checkSource(
      "/t/en.ts",
      `export enum E { A = 1 }
export namespace E { export const v = 3; }
export function g(): number { return E.A; }`,
      pTrue,
      stdOpts,
    );
    expect(en.issues.filter((i) => i.code === "nudo:module-throw")).toEqual([]);
    expect(sigOf(en, "g")).toBe("1");
  });

  it("裸 namespace 发运行时对象（BUG-369）；同名 namespace 重复声明只发一次（改前：重复词法声明 ⇒ 整模块 fail-closed）", () => {
    const bare = transpileSource(
      `export namespace N { export const v = 1; }`,
      { target: "host", runtimeImport: null, filename: "/t/bare.ts" },
    );
    expect(bare).toContain("const N = (() =>");
    expect(bare).toContain("$obj(");

    const twice = transpileSource(
      `export namespace M { export const a = 1; }
export namespace M { export const b = 2; }
export function probe(): number { return 1; }`,
      { target: "host", runtimeImport: null, filename: "/t/twice.ts" },
    );
    expect(twice.split("const M = (() =>").length - 1).toBe(1);
    expect(call("export namespace M { export const a = 1; }\nexport namespace M { export const b = 2; }\nexport function probe() { return 1; }", "probe").result.shape.k).not.toBe("never");
  });
});

// ---------------------------------------------------------------------------
// 转译产物的算子名卫生（模块级 gensym）
// ---------------------------------------------------------------------------
describe("算子名卫生：用户同名顶层绑定不得被算子改写捕获", () => {
  it("导出函数名叫 $add（与运行时算子同名）⇒ 不再自递归栈溢出：签名 number | string、无 nudo:internal / 无 unknown", () => {
    const src = `export function $add(a, b) { return a + b; }`;
    const r = checkSource("/t/h1.js", src, pTrue, stdOpts);
    expect(r.issues.filter((i) => i.code === "nudo:internal")).toEqual([]);
    expect(sigOf(r, "$add")).toContain("number | string");
    expect(sigOf(r, "$add")).not.toContain("unknown");
  });

  it("顶层 `const $call = …`（改前 Identifier '$call' has already been declared）⇒ 模块可装载，f 的签名与原生口径一致", () => {
    const src = `const $call = (x) => x + 1;
export function f(a) { return $call(a); }`;
    const r = checkSource("/t/h3.js", src, pTrue, stdOpts);
    expect(r.issues.filter((i) => i.code === "nudo:module-throw")).toEqual([]);
    expect(sigOf(r, "f")).toContain("number | string");
  });

  it("形参叫 $add（改前 `$add is not a function` / 引擎内部错误）⇒ 生成名换成 gensym，f($add, x) 仍精确", () => {
    const src = `export function f($add, x) { return x + 1; }`;
    const r = checkSource("/t/h4.js", src, pTrue, stdOpts);
    expect(r.issues.filter((i) => i.code === "nudo:internal")).toEqual([]);
    expect(sigOf(r, "f")).toContain("number | string");
  });

  it("有冲突时生成名是 gensym（`$add$1`）+ 改名表行；用户绑定名与导出名逐字不变；ESM 面 import 取别名", () => {
    const src = `export function $add(a, b) { return a + b; }`;
    const host = transpileSource(src, { target: "host", runtimeImport: null, filename: "/t/h1.js" });
    expect(host).toContain("//@nudo-op-renames {\"$add\":\"$add$1\"}");
    expect(host).toContain("function $add(a, b)");
    expect(host).toContain("return($add$1(a, b));");
    expect(host).toContain('__nudoExportLazy("$add", () => $add);');
    const esm = transpileSource(src, { filename: "/t/h1.js" });
    expect(esm).toContain("$add as $add$1");
    expect(esm).toContain("export function $add(a, b)");
  });

  it("无冲突对照：产物不含改名表行、算子名逐字不变（同一份源码连跑两次也逐字相同——源 AST 占位名必须还原）", () => {
    const src = `export function f(a, b) { return a + b; }`;
    const once = transpileSource(src, { target: "host", runtimeImport: null, filename: "/t/clean.js" });
    const twice = transpileSource(src, { target: "host", runtimeImport: null, filename: "/t/clean.js" });
    expect(once).toBe(twice);
    expect(once).not.toContain("@nudo-op-renames");
    expect(once).not.toContain("$add$1");
    expect(once).toBe(`// nudo evaluator transpile — values are Abs; operators are overloaded calls

function f(a, b) {
    a = $absVal(a);
    b = $absVal(b);
    return($add(a, b));
}
__nudoExportLazy("f", () => f);
`);
  });
});

describe("算子名卫生：gensym 避让、非引用位置不动、宿主注入同口径", () => {
  it("用户已占用 `$add$1` ⇒ gensym 跳到 `$add$2`（生成名不得与用户标识符相撞）", () => {
    const src = `const $add$1 = 1;
export function $add(a, b) { return a + b + $add$1 * 0; }`;
    const code = transpileSource(src, { target: "host", runtimeImport: null, filename: "/t/g.js" });
    expect(code).toContain('{"$add":"$add$2"}');
    expect(code).toContain("$add$2(a, b)");
    expect(code).toContain("let $add$1 = $lit(1);");
    expect(call(src, "$add", []).result.shape.k).not.toBe("never");
  });

  it("属性名 / 字符串 / 模板原文里的同名文本一律不动（只改调用位的算子引用）", () => {
    const src = `const $add = 1;
export function f(o) { return o.$add + $add; }
export const s = "$add(1)";
export function t(x) { return \`\${x}$add(\`; }`;
    const code = transpileSource(src, { target: "host", runtimeImport: null, filename: "/t/p.js" });
    expect(code).toContain('$get(o, "$add")');
    expect(code).toContain('$lit("$add(1)")');
    expect(code).toContain('$lit("$add(")');
    // 用户绑定本身不动（只有算子的调用位改名）
    expect(code).toContain("let $add = $lit(1);");
    expect(code).toContain('$recordBinding("$add", $add);');
  });

  it("body 单元（形参叫 $call）：transpileBodyNode 产出改名表 + gensym（改前形参捕获算子 ⇒ `$call is not a function`）", () => {
    const body = parseSource("x + 1").program.body[0];
    const code = transpileBodyNode(body, { userIdents: new Set(["$add", "x"]) });
    expect(code).toContain('//@nudo-op-renames {"$add":"$add$1"}');
    expect(code).toContain("$add$1(");
  });

  it("宿主侧按改名表注入形参：带改名表行的单元里 `$lit$1` 解析得到真算子（改前 ReferenceError）", () => {
    const fn = compileRuntimeModuleUnit<unknown>(`//@nudo-op-renames {"$lit":"$lit$1"}\nreturn $lit$1(7);`);
    const r = fn(...runtimeModuleArgValues());
    expect(litValue(r as never)).toEqual({ ok: true, value: 7 });
  });
});

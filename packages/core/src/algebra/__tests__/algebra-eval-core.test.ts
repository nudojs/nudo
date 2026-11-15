/**
 * 模块套件：求值面：其余核心语义。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { litC, union, instantiateConstraint, constraintToEntryAbs, number as numberC } from "../constraint.ts";
import { formatAbs } from "../format/format.ts";
import { absToConstraint } from "../contract/projection.ts";
import { predToString, pTrue, gtNum } from "../pred.ts";
import { denoteGuard } from "../../internal.ts";
import { checkSource, resetCheckSourceMemo } from "../check/check.ts";
import { resetGeneralizeMemo, buildArgsFromAssume } from "../generalize.ts";
import type { CheckIssue } from "../check/check-report.ts";
import { sidecarOpts, errorsOf, issuesOf, sigOf, withStdImport, stdOpts } from "./nudo-constraints.ts";
import { litValue, abs, pTrue as pTrue___nudojs_core, type Abs as Abs___nudojs_core, str, type Abs as Abs___nudojs_core_1, anyAbs, runTranspiled as runTranspiled___nudojs_core, callTranspiledExportFull as callTranspiledExportFull___nudojs_core, unknown, relationFn, formatShape, type Abs as Abs___nudojs_core_2 } from "@nudojs/core";
import { call, throwsError, val, isNever, tupleEls } from "./eval-helpers.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { $lit, undef } from "../exec/runtime/state.ts";
import { litValue as litValue_____index_ts, type Abs, checkSource as checkSource_____index_ts, pTrue as pTrue_____index_ts } from "../index.ts";
import { parseSource } from "../parse-source.ts";
import { abs as abs_____abs_ts, strLit, numLit, litValue as litValue_____abs_ts, type Abs as Abs_____abs_ts, anyAbs as anyAbs_____abs_ts } from "../abs.ts";
import { getSlot, objOf } from "../objects.ts";
import { getFnImpl, absOnly } from "../abs-fn.ts";
import { makeMapAbs, makeSetAbs } from "../collections.ts";
import { collectionIteratorFor } from "../builtins/error/iterator.ts";
import { $get } from "../exec/runtime/containers/member.ts";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v } from "../term.ts";
import { formatConstraint } from "../contract/contract.ts";
import { formalParamsFromNodes } from "../format/param-surface.ts";
import { relGuardOf } from "../exec/transpile/stmt/predicates.ts";
import { absShapeForTsTypeText } from "../contract/ts-type-shape.ts";

// ---------------------------------------------------------------------------
// bigint 字面量契约的 prim 标注
// ---------------------------------------------------------------------------
describe("bigint 字面量契约的 prim 标注", () => {
/**
 * （core 面）—— bigint 字面量契约必须带 `prim: "bigint"`。
 *
 * 病灶：`litC(v)` 只给 number / string / boolean 标 prim，**bigint 字面量不带
 * prim** ⇒ `constraintOnTermAbs` 落到「有界但无 prim ⇒ 按 number 处理」的兜底
 * ⇒ 契约 Abs 的 shape 说 number、pred 说 bigint（`x = 1n`）：
 * - guard 面渲染成 `(typeof data === "number") && (data === 1n)` ⇒ 契约申报的
 * **唯一合法值 `1n` 被守卫拒收**（假红）；
 * - dts 面把 bigint 契约的返回类型写成 `number`；
 * - union 成员面更糟：`samePrimLiteralUnionAbs` 按 `typeof v` 归类，bigint 落到
 * 兜底分支 ⇒ `union(lit(1n))` 的 shape 说 **boolean**。
 *
 * 修法：`litC` 补 bigint 分支 ⇒ `prim: "bigint"`，与 number / string / boolean
 * 字面量契约**同款口径**（`constraint-builders.test.ts` 钉的
 * `typeof x = "number" ∧ x = 42` 就是这条口径）。
 */











/** 契约 Abs → 守卫体（service 的 guard-generator 用的就是同一个 denoteGuard） */
function guardOf(c: ReturnType<typeof litC>): (data: unknown) => boolean {
  const body = denoteGuard(constraintToEntryAbs(c, "x"), "data");
  // denoteGuard 的产物是可直接求值的表达式（`(typeof data === "bigint") && …`）
  return new Function("data", `return ${body};`) as (data: unknown) => boolean;
}

const SIDE = `import { lit } from "@nudojs/core";
export const bigOne = lit(1n);
`;

const IMP = `/// @nudo:import { bigOne } from "./std1046.nudo.js"\n`;

const FILE = "/t/std1046.js";

/** 走共享脚手架（nudo-constraints.ts）的侧车 opts —— 不内联副本 */
function check(src: string) {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  return checkSource(FILE, IMP + src, pTrue, sidecarOpts("std1046", SIDE, FILE));
}

/** 调用点前置条件违例（nudo:constraint-violated） */
function violated(r: { issues: CheckIssue[] }): CheckIssue[] {
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

/** 带指定契约的调用（契约写在形参 x 上） */
function call(contract: string, arg: string): string {
  return `/** @nudo:contract x ${contract} */
export function f(x) { return x; }
export function use() { return f(${arg}); }`;
}

describe("bigint 字面量契约的 prim 标注", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
  });

  it("litC(1n)：builder 带 prim bigint（改前无 prim ⇒ Abs 落 number 兜底）", () => {
    expect(litC(1n).prim).toBe("bigint");
    // 负控制：其余 prim 口径不变
    expect(litC(1).prim).toBe("number");
    expect(litC("a").prim).toBe("string");
    expect(litC(true).prim).toBe("boolean");
    // nullish 字面量仍**无** prim（nullish 有独立编码，不落 number 兜底）
    expect(litC(null).prim).toBeUndefined();
    expect(litC(undefined).prim).toBeUndefined();
  });

  it("契约 Abs 的 shape 是 prim bigint（不是 number）", () => {
    const entry = constraintToEntryAbs(litC(1n), "x");
    expect(entry.shape).toEqual({ k: "prim", type: "bigint" });
    expect(formatAbs(entry)).toContain("bigint");
    expect(formatAbs(entry)).not.toContain("number");
  });

  it('guard 面：渲染含 typeof data === "bigint"，且 guard(1n) === true（改前假红）', () => {
    const entry = constraintToEntryAbs(litC(1n), "x");
    const body = denoteGuard(entry, "data");
    expect(body).toContain('typeof data === "bigint"');
    expect(body).not.toContain('typeof data === "number"');
    const guard = guardOf(litC(1n));
    expect(guard(1n)).toBe(true);
    expect(guard(1)).toBe(false);
    expect(guard("1n")).toBe(false);
  });

  it("union 成员：union(lit(1n)) 的 shape 也是 prim bigint（改前落 boolean 兜底）", () => {
    const u = union(litC(1n));
    expect(constraintToEntryAbs(u, "x").shape).toEqual({ k: "prim", type: "bigint" });
    const u2 = union(litC(1n), litC(2n));
    expect(constraintToEntryAbs(u2, "x").shape).toEqual({ k: "prim", type: "bigint" });
    const body = denoteGuard(constraintToEntryAbs(u2, "x"), "data");
    expect(body).toContain('typeof data === "bigint"');
  });

  it("实例化口径：bigint 字面量契约带 typeof 义务（与 number/string/boolean 同款）", () => {
    expect(predToString(instantiateConstraint(litC(1n), "x"))).toBe(
      'typeof x = "bigint" ∧ x = 1n',
    );
    // 负控制：既有 prim 的实例化口径不变
    expect(predToString(instantiateConstraint(litC(1), "x"))).toBe(
      'typeof x = "number" ∧ x = 1',
    );
  });

  it("schema 面入口：absToConstraint 对 prim bigint 仍返回 undefined（zod 面走 eq 主导支）", () => {
    // zod / standard 面按「pred 主导」投影：bigint prim 无解码器 ⇒ 仍落 eq 支
    // ⇒ 节点仍是 {k:"lit", value:1n}（的 zod 面判定，见 service 侧钉）。
    expect(absToConstraint(constraintToEntryAbs(litC(1n), "x"))).toBeUndefined();
  });

  it("门禁接受集不变：lit(1n) 收到 1n ⇒ 零违例", () => {
    const r = check(call("bigOne", "1n"));
    expect(violated(r)).toHaveLength(0);
  });

  it("门禁：bigint 字面量契约收到非 bigint 实参 ⇒ 报违例（literal 义务仍在）", () => {
    const r = check(call("bigOne", "1"));
    const vs = violated(r);
    expect(vs.length).toBeGreaterThan(0);
    // literal 义务（`x = 1n`）仍被报出来——不只是类型义务
    expect(vs.some((v) => String(v.expected).includes("1n"))).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// 赋值目标的引用求值顺序 + 计算键只求值一次
// ---------------------------------------------------------------------------
describe("赋值目标的引用求值顺序 + 计算键只求值一次", () => {
/**
 * 赋值目标**引用求值顺序**颠倒（RHS 先于对象 / 计算键）+ 计算键 /
 * 自增自减 / delete 的键**重复求值**。
 *
 * 根因（转译层，core/src/algebra/exec/transpile）：
 * - 成员写把 RHS 提成 IIFE **实参**（`((__v) => { …写… })(rhs)`）⇒ 实参先于
 * 体内求值 ⇒ RHS 跑在**引用**（对象 + 计算键）之前（原生顺序是
 * EvaluatePropertyAccess → GetValue → RHS → PutValue）；
 * - 路径层把**计算键**内联进读/写两处（`$get(o, KEY)` + `$idxSet(o, KEY, …)`）
 * ⇒ 键跑两次（原生各一次）。
 *
 * 修法：引用（根 + 各层键 + 中间层取值）先求值并落临时量，RHS 落在其后；
 * 计算键绑临时量、读/写共用同一绑定（各求值一次）。
 *
 * 负控制：非计算键 / 单层路径 / delete 的既有口径不受本条影响。
 */




function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("赋值目标的引用求值顺序 + 计算键只求值一次", () => {
  it("A1 赋值：计算键先于 RHS（原生 k,v）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")] = (log.push("v"),2); return log.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "k,v" });
  });

  it("A2 赋值：对象先于计算键先于 RHS（原生 f,k,v）", () => {
    expect(
      v(
        `export function f() { let log=[]; function g(){return (log.push("f"),{a:1});} g()[(log.push("k"),"a")] = (log.push("v"),2); return log.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "f,k,v" });
  });

  it("A3 下标赋值：a[i++] = i + 10（原生 11,0|1）", () => {
    expect(
      v(`export function f() { let i=0; const a=[0,0]; a[i++] = i + 10; return a.join(",") + "|" + i; }`),
    ).toEqual({ ok: true, value: "11,0|1" });
  });

  it("A4 下标赋值：a[i++] = i（原生 1,0|1）", () => {
    expect(
      v(`export function f() { let i=0; const a=[0,0]; a[i++] = i; return a.join(",") + "|" + i; }`),
    ).toEqual({ ok: true, value: "1,0|1" });
  });

  it("B1 复合赋值：计算键只跑一次且先于 RHS（原生 k,v）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")] += (log.push("v"),2); return log.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "k,v" });
  });

  it("B2 自增：计算键只跑一次（原生 k）", () => {
    expect(
      v(`export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")]++; return log.join(","); }`),
    ).toEqual({ ok: true, value: "k" });
  });

  it("B3 delete：计算键只跑一次（原生 k）", () => {
    expect(
      v(`export function f() { let log=[]; const o={a:1}; delete o[(log.push("k"),"a")]; return log.join(","); }`),
    ).toEqual({ ok: true, value: "k" });
  });

  it("B4 赋值：顺序修正后值仍落位（原生 k,v|2）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")] = (log.push("v"),2); return log.join(",") + "|" + o.a; }`,
      ),
    ).toEqual({ ok: true, value: "k,v|2" });
  });

  it("B5 自增：键一次且新值落位（原生 k|2）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; o[(log.push("k"),"a")]++; return log.join(",") + "|" + o.a; }`,
      ),
    ).toEqual({ ok: true, value: "k|2" });
  });

  it("B6 delete：键一次且槽真被删（原生 k|gone）", () => {
    expect(
      v(
        `export function f() { let log=[]; const o={a:1}; delete o[(log.push("k"),"a")]; return log.join(",") + "|" + ("a" in o ? "still" : "gone"); }`,
      ),
    ).toEqual({ ok: true, value: "k|gone" });
  });

  // —— 负控制：非计算键 / 单层路径 / 常规路径不受本条影响 ——
  it("C1 负控制：o.a = 2 → 2", () => {
    expect(v(`export function f() { const o={a:1}; o.a = 2; return o.a; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("C2 负控制：o.a += 2 → 3", () => {
    expect(v(`export function f() { const o={a:1}; o.a += 2; return o.a; }`)).toEqual({
      ok: true,
      value: 3,
    });
  });

  it("C3 负控制：o.a++ → 2", () => {
    expect(v(`export function f() { const o={a:1}; o.a++; return o.a; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("C4 负控制：delete o.a → gone", () => {
    expect(
      v(`export function f() { const o={a:1}; delete o.a; return "a" in o ? "still" : "gone"; }`),
    ).toEqual({ ok: true, value: "gone" });
  });

  it("C5 负控制：a[i++] = 5 → 5,0|1", () => {
    expect(
      v(`export function f() { let i=0; const a=[0,0]; a[i++] = 5; return a.join(",") + "|" + i; }`),
    ).toEqual({ ok: true, value: "5,0|1" });
  });

  it("C6 负控制：嵌套成员写 o.a.b = 2 → 2", () => {
    expect(v(`export function f() { const o={a:{b:1}}; o.a.b = 2; return o.a.b; }`)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("C7 负控制：赋值表达式的值 = 写入的值（原生 5|5）", () => {
    expect(
      v(`export function f() { const o={a:1}; const x = (o.a = 5); return x + "|" + o.a; }`),
    ).toEqual({ ok: true, value: "5|5" });
  });

  it("C8 负控制：delete o.a.b（数据属性链）→ gone", () => {
    expect(
      v(`export function f() { const o={a:{b:1}}; delete o.a.b; return "b" in o.a ? "still" : "gone"; }`),
    ).toEqual({ ok: true, value: "gone" });
  });
});
});

// ---------------------------------------------------------------------------
// @nudo:as 命中的表达式仍求值（副作用 + throws 域保留）
// ---------------------------------------------------------------------------
describe("@nudo:as 命中的表达式仍求值（副作用 + throws 域保留）", () => {
/**
 * 回归（core 转译层）：`@nudo:as` 是**类型覆盖**（文档口径）——
 * 被断言的表达式**仍要求值**：副作用与 throws 域保留，**结果**取断言值。
 *
 * 修复前：`asVar` 分支在**转译期**把 init / return 实参整段换成注入常量
 * ⇒ 原表达式根本不进转译 ⇒ ① 副作用丢失（`bump()` 不被调用）；② 原表达式
 * 的抛错域消失（`JSON.parse` 的 SyntaxError 被吞 ⇒ L2 `nudo:entry-may-throw`
 * 门禁**假绿**）；③ 运行时值被换掉 ⇒ 下游观测到错值。
 *
 * 修复后：发射 `(原表达式, 注入值)`——原表达式求值一次（副作用与 throws 域
 * 保留），本次的值取注入值（与 @nudo:replace / 同款修法）。
 *
 * 负控制钉住：未被标注的语句照常求值；无指令的对照源码行为不变。
 */







/** 断言值（exact number） */
const NUMBER_ABS: Abs = $lit(42) as Abs;

/** 结果字面量值（非字面量 → "not-lit"） */
function lit(a: Abs): unknown {
  const r = litValue_____index_ts(a);
  return r.ok ? r.value : "not-lit";
}

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

/** 带 @nudo:as 注入表转译 + 调用导出函数 */
function callAs(src: string, fnName = "f", args: Abs[] = []) {
  const targets = asTargets(src);
  const exports = runTranspiled(src, {
    mode: "analyze",
    asOverrideTargets: targets.length ? targets : undefined,
    asOverrides: targets.length
      ? Object.fromEntries(targets.map((t) => [t.varName, NUMBER_ABS]))
      : undefined,
  });
  return callTranspiledExportFull(exports, fnName, args);
}

describe("@nudo:as 命中的表达式仍求值（副作用 + throws 域保留）", () => {
  it("副作用保留：被断言的调用仍被调用", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  // @nudo:as number()
  const x = bump();
  return counter;
}
`;
    // 修复前：bump() 整段被替换 → 从不调用 → counter 停在 0
    expect(lit(callAs(src).result)).toBe(1);
  });

  it("throws 域保留：被断言调用的抛错不被吞", () => {
    const src = `export function f() {
  // @nudo:as number()
  const x = JSON.parse("not json at all");
  return x;
}
`;
    // 修复前：JSON.parse 整段被替换 → 不抛 → throws 面空（L2 门禁假绿）
    expect(throwsError(callAs(src).throws, "SyntaxError")).toBe(true);
  });

  it("return 位的 @nudo:as 同样仍求值", () => {
    const src = `export function f() {
  // @nudo:as number()
  return JSON.parse("not json at all");
}
`;
    expect(throwsError(callAs(src).throws, "SyntaxError")).toBe(true);
  });

  it("结果取断言值（类型覆盖生效）", () => {
    const src = `export function f() {
  // @nudo:as number()
  const x = 1;
  return x;
}
`;
    expect(lit(callAs(src).result)).toBe(42);
  });

  it("负控制：未被标注的相邻语句照常求值", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  // @nudo:as number()
  const x = bump();
  const y = bump();
  return counter;
}
`;
    // 被断言的 bump() 求值一次（副作用保留），未被标注的 bump() 照常求值
    expect(lit(callAs(src).result)).toBe(2);
  });

  it("负控制：同样的源码无指令时行为不变（对照）", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  const x = bump();
  return counter;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const rec = callTranspiledExportFull(exports, "f", []);
    expect(lit(rec.result)).toBe(1);
  });
});
});

// ---------------------------------------------------------------------------
// @nudo:replace 命中的子表达式仍求值
// ---------------------------------------------------------------------------
describe("@nudo:replace 命中的子表达式仍求值", () => {
/**
 * 回归（core 转译层）：@nudo:replace 命中的子表达式**仍要求值**。
 *
 * 修复前：命中节点被**整段替换**成注入变量 → 原表达式从不求值 →
 * ① 副作用归零（`bump()` 不被调用）；② 抛错域消失（`JSON.parse` 的
 * TypeError 被吞 → L2 门禁假绿）。
 *
 * 修复后：发射 `(原表达式, 注入值)`——原表达式求值一次（副作用与 throws
 * 域保留），**结果**取注入值。
 *
 * 负控制钉住：未被标注的相邻子表达式照常求值（`b` 不受影响）。
 */






/** 注入值：exact number（类型覆盖面） */
const NUMBER_ABS: Abs___nudojs_core = abs({ k: "prim", type: "number" }, undefined, pTrue___nudojs_core, "exact");

/** 结果字面量值（非字面量 → "not-lit"） */
function lit(a: Abs___nudojs_core): unknown {
  const r = litValue(a);
  return r.ok ? r.value : "not-lit";
}

/** 源文本中某个片段的字符区间（AST 节点身份） */
function rangeOf(src: string, needle: string, len = needle.length): { start: number; end: number } {
  const start = src.indexOf(needle);
  if (start < 0) throw new Error(`needle not found: ${needle}`);
  return { start, end: start + len };
}

/** 带注入表转译 + 调用导出函数 */
function callInjected(
  src: string,
  fnName: string,
  args: Abs___nudojs_core[],
  inject: {
    replacements?: Record<string, Abs___nudojs_core>;
    replacementTargets?: Array<{ target: string; varName: string; stmtStart: number; stmtEnd: number }>;
  },
) {
  const exports = runTranspiled(src, { mode: "analyze", ...inject });
  return callTranspiledExportFull(exports, fnName, args);
}

describe("@nudo:replace 命中的子表达式仍求值", () => {
  it("被替换的调用仍被调用（副作用保留）", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f() {
  const x = bump();
  return counter;
}
`;
    const r = rangeOf(src, "bump();");
    const rec = callInjected(src, "f", [], {
      replacements: { __rep0: NUMBER_ABS },
      replacementTargets: [
        { target: "bump()", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    // 修复前：bump() 整段被替换 → 从不调用 → counter 停在 0
    expect(lit(rec.result)).toBe(1);
  });

  it("被替换的调用的抛错域保留（throws 面不被吞）", () => {
    const src = `export function f() {
  const x = boom();
  return x;
}
function boom() { throw new TypeError("boom"); }
`;
    const r = rangeOf(src, "boom();");
    const rec = callInjected(src, "f", [], {
      replacements: { __rep0: NUMBER_ABS },
      replacementTargets: [
        { target: "boom()", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    // 修复前：boom() 整段被替换 → 不抛 → throws 面空
    expect(throwsError(rec.throws, "TypeError")).toBe(true);
  });

  it("负控制：未被标注的相邻子表达式照常求值", () => {
    const src = `export function f(a, b) {
  const x = a + b;
  return x;
}
`;
    // 标注的是 `a + b` 里的左操作数 `a`（节点身份 = 该标识符的字符区间）
    const r = rangeOf(src, "a + b", 1);
    const rec = callInjected(src, "f", [$lit(5) as Abs___nudojs_core, $lit(10) as Abs___nudojs_core], {
      replacements: { __rep0: $lit(100) as Abs___nudojs_core },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    // a → 100（注入值），b → 10（照常求值）
    expect(lit(rec.result)).toBe(110);
  });

  it("替换结果取注入值（原表达式的值被取代）", () => {
    const src = `export function f(a) {
  const x = a + 1;
  return x;
}
`;
    const r = rangeOf(src, "a + 1", 1);
    const rec = callInjected(src, "f", [$lit(5) as Abs___nudojs_core], {
      replacements: { __rep0: $lit(100) as Abs___nudojs_core },
      replacementTargets: [
        { target: "a", varName: "__rep0", stmtStart: r.start, stmtEnd: r.end },
      ],
    });
    expect(lit(rec.result)).toBe(101);
  });
});
});

// ---------------------------------------------------------------------------
// [merged] s20-residual-live-iter
// ---------------------------------------------------------------------------
describe("s20-residual-live-iter", () => {
// MERGED (topic-related bug pins): s20-residual-live-iter + collection-live-iter
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>








describe("s20-residual-live-iter", () => {
/**
 * 残留修补（S20）回归：live 迭代器的**元素面 / 长度 / @@iterator 读值**
 * 三条口径必须与原生一致。
 *
 * 1. **$arrRest 的「侧表迭代物」门**（iterate.ts）：S17 把 live 集合迭代器的
 * **静态侧表**去掉后（静态表 = 创建期拷贝，会把元素面与长度冻结在创建
 * 时刻），`$arrRest` 只查静态侧表 ⇒ live 迭代物**不被认成迭代物** ⇒
 * `const [x, ...rest] = m.keys()` 的 rest 退 `<abs:unknown>`（精度回退）。
 * 门改为「静态侧表 **或** 消费视图」。
 * 2. **数组迭代器的静态侧表陈旧**（invoke-arr.ts）：数组迭代器**显式**登记了
 * 一面「与 live 同步的剩余元素镜像」⇒ 长度探针（sideIterLen）读到**陈旧**
 * 的剩余长度 ⇒ for-of 轮数停在创建时刻（`a.values(); a.push(3)` 后原生再跑
 * 2 轮，引擎只跑 1 轮）。静态侧表整体删除，元素面交给 live 消费视图。
 * 3. **Map/Set 原型的 @@iterator 臂**（member.ts）：`@@iterator` 臂直接吃
 * **快照**（mapEntriesAbs / setElementsAbs）⇒ 迭代期间的增删不可见；且
 * `m[Symbol.iterator]` 直读折成 **no-op fn** ⇒ 调用折 `<abs:never>`
 * （**自信的错值**——原生返回集合迭代器）。
 *
 * 负控制：生成器 rest 解构、普通数组 rest 解构、静态快照语义（`[...m.keys()]`
 * 在改动前后都取当前条目表）不受影响。
 */



describe("S20-①：$arrRest 的「侧表迭代物」门认消费视图（live 集合迭代器）", () => {
  it("Map.keys() 的 rest 解构 → 取剩余键（原生 \"b\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const [x, ...rest] = m.keys();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "b" });
  });

  it("Map.values() 的 rest 解构 → 取剩余值（原生 \"2\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const [x, ...rest] = m.values();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("Map.entries() 的 rest 解构 → 取剩余条目元组（原生 \"b:2\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const [x, ...rest] = m.entries();
        return rest.map((e) => e.join(":")).join(",");
      }`),
    ).toEqual({ ok: true, value: "b:2" });
  });

  it("Set.values() 的 rest 解构 → 取剩余元素（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2, 3]);
        const [x, ...rest] = s.values();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("负控制：生成器 rest 解构不受影响（原生 \"2\"）", () => {
    expect(
      val(`export function f() {
        function* g() { yield 1; yield 2; }
        const [x, ...rest] = g();
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2" });
  });

  it("负控制：普通数组 rest 解构不受影响（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2, 3];
        const [x, ...rest] = a;
        return rest.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });
});

describe("S20-②：数组迭代器不登记静态侧表（剩余长度是 live 的）", () => {
  it("values() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.values();
        it.next();
        a.push(3);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("values() 迭代器：push 之后的展开取剩余（原生 \"2,3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.values();
        it.next();
        a.push(3);
        return [...it].join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("keys() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 \"1,2\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.keys();
        it.next();
        a.push(3);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("entries() 迭代器：push 之后的 for-of 跑满剩余轮数（原生 \"1:2,2:3\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.entries();
        it.next();
        a.push(3);
        const out = [];
        for (const v of it) out.push(v.map(String).join(":"));
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1:2,2:3" });
  });

  it("负控制：未变更的数组迭代器 for-of 不受影响（原生 \"1,2\"）", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.values();
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });
});

describe("S20-③：Map/Set 的 @@iterator 是原型上的同一个函数对象", () => {
  it("m[Symbol.iterator]() → 集合迭代器（原生 \"a:1\"，修复前折 never）", () => {
    const r = call(`export function f() {
      const m = new Map([["a", 1]]);
      const it = m[Symbol.iterator]();
      return it.next().value.join(":");
    }`);
    expect(isNever(r.result)).toBe(false);
    expect(val(`export function f() {
      const m = new Map([["a", 1]]);
      const it = m[Symbol.iterator]();
      return it.next().value.join(":");
    }`)).toEqual({ ok: true, value: "a:1" });
  });

  it("s[Symbol.iterator]() → 元素迭代器（原生 1，非 [el,el]）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const it = s[Symbol.iterator]();
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("借调 Map.prototype[Symbol.iterator].call(m) → 集合迭代器（原生 \"a:1\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        return Map.prototype[Symbol.iterator].call(m).next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "a:1" });
  });

  it("借调 Set.prototype[Symbol.iterator].call(s) → 元素迭代器（原生 1）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        return Set.prototype[Symbol.iterator].call(s).next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("m[Symbol.iterator] 是函数（原生 \"function\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        return typeof m[Symbol.iterator];
      }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("for-of 走 m[Symbol.iterator]() → 逐条目（原生 \"a=1\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        for (const [k, v] of m[Symbol.iterator]()) out.push(k + "=" + v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a=1" });
  });

  it("m[Symbol.iterator]() 是 live 迭代器：迭代期间的 set 可见（原生 \"a,b\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m[Symbol.iterator]();
        m.set("b", 2);
        const out = [];
        for (const [k] of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("借调 Map.prototype[Symbol.iterator].call(m) 是 live 迭代器（原生 \"a,b\"）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = Map.prototype[Symbol.iterator].call(m);
        m.set("b", 2);
        const out = [];
        for (const [k] of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("s[Symbol.iterator]() 是 live 迭代器：迭代期间的 add 可见（原生 \"1,2\"）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const it = s[Symbol.iterator]();
        s.add(2);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("负控制：m.entries() / m.keys() / m.values() 不受影响", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        return [m.entries().next().value.join(":"), m.keys().next().value, m.values().next().value].join("|");
      }`),
    ).toEqual({ ok: true, value: "a:1|a|1" });
  });
});
});

describe("collection-live-iter", () => {
/**
 * 回归：`Map` / `Set` 的**集合条目遍历必须是接收者的 live 视图**。
 *
 * ES 语义：`Set.prototype.forEach` / `Map.prototype.forEach` / `for-of`（走
 * 集合自身的迭代器）都是**活**的——回调里新增/删除条目，迭代必须看到
 * 接收者**当前**的条目表（新增的条目在追加位置被访问，已删除的条目被跳过）。
 *
 * 修复前：引擎把集合条目**快照**成数组再遍历 ⇒ 回调里的增删对迭代**不可见**
 * （wrong-exact）：
 * - `s.forEach` 删掉 2 → 引擎仍访问 2（原生只访问 1、3）；
 * - `s.forEach` 新增 2 → 引擎漏掉 2（原生访问 1、2）；
 * - `m.forEach` 新增 "b" → 引擎漏掉 "b"（原生访问 a、b）。
 *
 * 负控制：**快照语义**的静态视图（`[...m.keys()]` / `[...s]`）不受影响；
 * 普通对象 / 数组的 forEach 不受影响。
 */








describe("Map/Set 集合条目遍历是接收者的 live 视图", () => {
  it("Set.forEach：回调里删除条目 → 被删条目不再被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2, 3]);
        const out = [];
        s.forEach((v) => { out.push(v); if (v === 1) s.delete(2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,3" });
  });

  it("Set.forEach：回调里新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const out = [];
        s.forEach((v) => { out.push(v); s.add(2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("Map.forEach：回调里新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        m.forEach((v, k) => { out.push(k); m.set("b", 2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("Map.forEach：回调里 clear() → 后续条目不再被访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const out = [];
        m.forEach((v, k) => { out.push(k); m.clear(); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("Map.forEach：回调里改写已有条目的值 → 读到的是新值", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const out = [];
        m.forEach((v, k) => { out.push(v); if (k === "a") m.set("b", 9); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1,9" });
  });

  it("for-of（Set）：回调体里删除条目 → 被删条目不再被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const out = [];
        for (const v of s) { out.push(v); if (v === 1) s.delete(2); }
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("for-of（Map）：循环体里新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        for (const [k] of m) { out.push(k); m.set("b", 2); }
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("for-of（Set）：循环体里 clear() → 立即终止", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const out = [];
        for (const v of s) { out.push(v); s.clear(); }
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "1" });
  });

  it("负控制：静态快照视图不受影响（[...m.keys()] / [...s]）", () => {
    expect(val(`export function f() { const m = new Map([["a",1],["b",2]]); return [...m.keys()].join(","); }`)).toEqual({
      ok: true,
      value: "a,b",
    });
    expect(val(`export function f() { const s = new Set([1,2]); return [...s].join(","); }`)).toEqual({
      ok: true,
      value: "1,2",
    });
  });

  it("负控制：数组 / 普通对象的 forEach 不受影响", () => {
    expect(
      val(`export function f() { const a = [1,2]; const out = []; a.forEach((v) => out.push(v)); return out.join(","); }`),
    ).toEqual({ ok: true, value: "1,2" });
    expect(
      val(`export function f() { const o = {a:1,b:2}; const out = []; Object.keys(o).forEach((k) => out.push(k)); return out.join(","); }`),
    ).toEqual({ ok: true, value: "a,b" });
  });
});

/**
 * 手动迭代器（`m.keys()` / `m.values()` / `m.entries()` / `a.keys()` /
 * `a.values()` / `a.entries()` / `a[Symbol.iterator]()`）同样是**接收者的
 * live 视图**——原生迭代器持条目指针（Map/Set）或 nextIndex 指针（数组）：
 * - Map/Set：迭代期间**新增**的条目被访问、**删除**的条目被跳过；
 * - 数组：每次 next() 按**当前** LengthOfArrayLike(O) 判结束、按当前内容取值
 * （push / unshift / shift 对迭代可见）。
 *
 * 修复前：手动迭代器是**创建时的快照** ⇒ 删除的条目仍被访问、新增的条目
 * 看不到、数组迭代器读到陈旧值（wrong-exact）。
 */
describe("手动迭代器是接收者的 live 视图", () => {
  it("Map.keys()：迭代期间删除条目 → 被删条目不再被访问（done 提前为 true）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.keys();
        it.next();
        m.delete("b");
        return it.next().done;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("Map.keys()：迭代期间新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m.keys();
        it.next();
        m.set("b", 2);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: "b" });
  });

  it("Map.values()：迭代期间改写已有条目的值 → 读到新值（非陈旧值）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.values();
        it.next();
        m.set("b", 9);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 9 });
  });

  it("Map.entries()：迭代期间新增条目 → 新条目被追加访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m.entries();
        it.next();
        m.set("b", 2);
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "b:2" });
  });

  it("Set.values()：迭代期间删除元素 → 被删元素不再被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const it = s.values();
        it.next();
        s.delete(2);
        return it.next().done;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("Set.entries()：迭代期间新增元素 → 新元素被追加访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const it = s.entries();
        it.next();
        s.add(2);
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "2:2" });
  });

  it("数组 entries()：迭代期间 shift() → 读到移位后的当前内容", () => {
    expect(
      val(`export function f() {
        const a = [1, 2, 3];
        const it = a.entries();
        it.next();
        a.shift();
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "1:3" });
  });

  it("数组 @@iterator()（= values）：迭代期间 unshift() → 读到移位后的当前内容", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a[Symbol.iterator]();
        it.next();
        a.unshift(0);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("数组 keys()：迭代期间 push() → 展开取到新增下标", () => {
    expect(
      val(`export function f() {
        const a = [1, 2];
        const it = a.keys();
        it.next();
        a.push(3);
        return [...it].join(",");
      }`),
    ).toEqual({ ok: true, value: "1,2" });
  });

  it("负控制：无变异时手动迭代器与快照一致", () => {
    expect(
      val(`export function f() { const m = new Map([["a",1],["b",2]]); const it = m.keys(); it.next(); return it.next().value; }`),
    ).toEqual({ ok: true, value: "b" });
    expect(
      val(`export function f() { const a = [1,2,3]; const it = a.entries(); return it.next().value.join(":"); }`),
    ).toEqual({ ok: true, value: "0:1" });
    expect(
      val(`export function f() { const a = [1,2,3]; return [...a.entries()].map((e) => e.join(":")).join(","); }`),
    ).toEqual({ ok: true, value: "0:1,1:2,2:3" });
  });

  it("负控制：迭代器对象仍不是数组（Array.isArray → false）", () => {
    expect(val(`export function f() { return Array.isArray([1,2,3].entries()); }`)).toEqual({
      ok: true,
      value: false,
    });
  });
});

/**
 * S17 收尾接线（根治点）：
 *
 * ① **投影同口径**：Map/Set 的 keys/values/entries 迭代器，`next().value`
 * 必须是**投影后**的值（Map 的键 / 值；Set 的 [el,el] 元组）——live 视图
 * 与快照路径走同一份 project 逻辑。此前 live 视图吐的是**未投影**的原始
 * 条目 ⇒ next().value 给原始条目（wrong-exact）。
 *
 * ② **live 迭代器不登记静态元素侧表**：静态表一旦登记，matchIterElements 会
 * 命中创建期快照 ⇒ 长度探针（sideIterLen）读到**冻结**的剩余长度 ⇒
 * for-of 的迭代轮数停在创建时刻（迭代器不再随接收者变化）。
 * 修前：`it.next()` 后接收者新增条目 ⇒ for-of 只跑 1 轮（原生 2 轮）。
 */
describe("（S17）：投影同口径 + live 迭代器不登记静态侧表", () => {
  it("① Map.keys() 的 next().value 是键（不是 [k,v] 条目元组）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        return m.keys().next().value;
      }`),
    ).toEqual({ ok: true, value: "a" });
  });

  it("① Map.values() 的 next().value 是值（不是条目元组）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        return m.values().next().value;
      }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("① Set.entries() 的 next().value 是 [el, el] 元组（不是元素本身）", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        return s.entries().next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "1:1" });
  });

  it("① 投影在 live 路径上同样成立（迭代期间新增条目 → 新条目按投影给出）", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const it = m.values();
        it.next();
        m.set("b", 2);
        return it.next().value;
      }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      val(`export function f() {
        const s = new Set([1]);
        const it = s.entries();
        it.next();
        s.add(2);
        return it.next().value.join(":");
      }`),
    ).toEqual({ ok: true, value: "2:2" });
  });

  it("② for-of 走**当前剩余**：消费一条后接收者新增条目 ⇒ 新条目仍被访问", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.keys();
        it.next();
        m.set("c", 3);
        const out = [];
        for (const k of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "b,c" });
  });

  it("② for-of 走**当前剩余**：消费一条后接收者删除条目 ⇒ 被删条目被跳过", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const it = m.keys();
        it.next();
        m.delete("b");
        const out = [];
        for (const k of it) out.push(k);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "" });
  });

  it("② Set 迭代器同口径：消费一条后接收者新增元素 ⇒ 新元素被访问", () => {
    expect(
      val(`export function f() {
        const s = new Set([1, 2]);
        const it = s.values();
        it.next();
        s.add(3);
        const out = [];
        for (const v of it) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "2,3" });
  });

  it("负控制：forEach 的 live 路径不受影响", () => {
    expect(
      val(`export function f() {
        const m = new Map([["a", 1]]);
        const out = [];
        m.forEach((v, k) => { out.push(k); m.set("b", 2); });
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "a,b" });
  });

  it("负控制：用户迭代器协议（@@iterator）不受影响", () => {
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x","y"][Symbol.iterator](); } };
        const out = [];
        for (const v of o) out.push(v);
        return out.join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
    expect(
      val(`export function f() {
        const o = { [Symbol.iterator]() { return ["x","y"][Symbol.iterator](); } };
        return [...o].join(",");
      }`),
    ).toEqual({ ok: true, value: "x,y" });
  });
});

/**
 * ① 的**根因**直测：直接调 `collectionIteratorFor`（集合迭代器的唯一构造
 * 入口），断言 live 视图的 `next().value` 已是**投影后**的值。
 *
 * 这条不走产品路径（产品路径此前被 dispatch.ts 的自建绕行版本遮住），是
 * 「live 视图与快照同口径投影」这条不变量的直钉——修前 live 视图吐的是
 * **未投影**的原始条目（Map 给 [k,v] 元组而不是键 / 值）。
 */
describe("（S17）：collectionIteratorFor 的 live 视图与快照同口径投影", () => {
  /** 迭代器对象的 next().value（litValue 后的字面量值；tuple → 元素数组） */
  function nextValue(iter: Abs_____abs_ts): unknown {
    const slots = (iter.shape as { slots: Record<string, { value: Abs_____abs_ts }> }).slots;
    const next = getSlot(slots, "next")!.value;
    const impl = getFnImpl(next)!;
    const res = absOnly(impl.apply!([], iter));
    const rSlots = (res.shape as { slots: Record<string, { value: Abs_____abs_ts }> }).slots;
    const v = getSlot(rSlots, "value")!.value;
    const sh = v.shape as { k: string; elements?: Abs_____abs_ts[] };
    if (sh.k === "tuple" && sh.elements) {
      return sh.elements.map((e) => {
        const lv = litValue_____abs_ts(e);
        return lv.ok ? lv.value : "<abs>";
      });
    }
    const lv = litValue_____abs_ts(v);
    return lv.ok ? lv.value : "<abs>";
  }

  const mapAbs = (): Abs_____abs_ts =>
    makeMapAbs(
      abs_____abs_ts(
        {
          k: "tuple",
          elements: [
            abs_____abs_ts({ k: "tuple", elements: [strLit("a"), numLit(1)] }, undefined, undefined, "exact"),
            abs_____abs_ts({ k: "tuple", elements: [strLit("b"), numLit(2)] }, undefined, undefined, "exact"),
          ],
        },
        undefined,
        undefined,
        "exact",
      ),
    );

  const setAbs = (): Abs_____abs_ts =>
    makeSetAbs(
      abs_____abs_ts({ k: "tuple", elements: [numLit(1), numLit(2)] }, undefined, undefined, "exact"),
    );

  it("Map.keys()：live 视图给键（不是 [k,v] 条目元组）", () => {
    expect(nextValue(collectionIteratorFor(mapAbs(), "keys"))).toBe("a");
  });

  it("Map.values()：live 视图给值（不是条目元组）", () => {
    expect(nextValue(collectionIteratorFor(mapAbs(), "values"))).toBe(1);
  });

  it("Map.entries()：live 视图给条目元组", () => {
    const v = nextValue(collectionIteratorFor(mapAbs(), "entries"));
    expect(Array.isArray(v) ? v.join(":") : v).toBe("a:1");
  });

  it("Set.keys()/values()：live 视图给元素", () => {
    expect(nextValue(collectionIteratorFor(setAbs(), "values"))).toBe(1);
  });

  it("Set.entries()：live 视图给 [el, el] 元组（不是元素本身）", () => {
    const v = nextValue(collectionIteratorFor(setAbs(), "entries"));
    expect(Array.isArray(v) ? v.join(":") : v).toBe("1:1");
  });
});
});
});

// ---------------------------------------------------------------------------
// 宿主 / 命名空间对象的自有属性投影（不止可枚举键）
// ---------------------------------------------------------------------------
describe("宿主 / 命名空间对象的自有属性投影（不止可枚举键）", () => {
/**
 * 回归：宿主 / 命名空间对象（`Math` / `JSON` / `Reflect`）的自有属性
 * 投影**不得只取可枚举键**。
 *
 * 根因：`litAbsFromJs` 用 `Object.entries` 投影宿主对象——只取**可枚举**自有
 * 属性；而 `Math` / `JSON` / `Reflect` 的自有属性几乎**全部不可枚举**
 * （原生 `Object.keys(Math)` → `[]`，`Object.getOwnPropertyNames(Math)` → 非空）。
 * 投影因此丢光整个自有面，却仍把对象标成**闭 + conf:"exact"** ⇒ 下游走
 * 「确定无此属性」分支：gOPN 折 exact `[]`、hasOwn 折 exact `false`、
 * gOPD 折 exact `undefined`（再读 `.value` 就定抛）、`Reflect.ownKeys` 折
 * exact `[]`。
 *
 * 修法：按 `Object.getOwnPropertyNames`（全部自有字符串键）投影，并逐键记下
 * 原生描述符标志（enumerable / writable / configurable）——不可枚举键仍**不**
 * 进枚举面（`Object.keys(Math)` 仍为 0，与原生一致），描述符面与原生逐字段一致。
 *
 * 不变量（负控制钉住）：
 * - 可枚举面不变：`Object.keys(Math)` → 0、`Object.keys({a:1,b:2})` → 2；
 * - 成员读面不变：`String(Math.PI)` → "3.141592653589793"；
 * - 用户对象的 gOPN / hasOwn / gOPD 不受影响；
 * - 用户对象的**不可枚举**自有键：进 gOPN 面、不进 keys 面。
 */




/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("宿主 / 命名空间对象的自有属性投影（不止可枚举键）", () => {
  it("gOPN(Math) 非空（此前折 exact 0）", () => {
    expect(v(wrap(`return Object.getOwnPropertyNames(Math).length > 0;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("gOPN(Math) 含 'PI'（此前整个自有面被丢弃）", () => {
    expect(
      v(wrap(`return Object.getOwnPropertyNames(Math).join(",").indexOf("PI") >= 0;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("gOPN(JSON) 非空（此前折 exact 0）", () => {
    expect(v(wrap(`return Object.getOwnPropertyNames(JSON).length > 0;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("Reflect.ownKeys(Math) 非空（此前折 exact 0）", () => {
    expect(v(wrap(`return Reflect.ownKeys(Math).length > 0;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("hasOwn(Math,'PI') → true（此前折 exact false）", () => {
    expect(v(wrap(`return String(Object.hasOwn(Math,"PI"));`))).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("gOPD(Math,'PI').value → '3.141592653589793'（此前折 exact undefined → 读 .value 定抛）", () => {
    expect(
      v(wrap(`return String(Object.getOwnPropertyDescriptor(Math,"PI").value);`)),
    ).toEqual({ ok: true, value: "3.141592653589793" });
  });

  it("gOPD(Math,'PI').enumerable → 'false'（原生 Math.PI 不可枚举）", () => {
    expect(
      v(wrap(`return String(Object.getOwnPropertyDescriptor(Math,"PI").enumerable);`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("gOPD(Math,'PI').writable → 'false'（原生 Math.PI 不可写）", () => {
    expect(
      v(wrap(`return String(Object.getOwnPropertyDescriptor(Math,"PI").writable);`)),
    ).toEqual({ ok: true, value: "false" });
  });

  it("负控制：Object.keys(Math) 仍为 0（可枚举面本就空）", () => {
    expect(v(wrap(`return Object.keys(Math).length;`))).toEqual({ ok: true, value: 0 });
  });

  it("负控制：成员读 Math.PI 不受影响", () => {
    expect(v(wrap(`return String(Math.PI);`))).toEqual({
      ok: true,
      value: "3.141592653589793",
    });
  });

  it("负控制：用户对象 gOPN / hasOwn / gOPD 不受影响", () => {
    expect(v(wrap(`return Object.getOwnPropertyNames({a:1}).length;`))).toEqual({
      ok: true,
      value: 1,
    });
    expect(v(wrap(`return String(Object.hasOwn({a:1},"a"));`))).toEqual({
      ok: true,
      value: "true",
    });
    expect(v(wrap(`return String(Object.getOwnPropertyDescriptor({a:1},"a").value);`))).toEqual({
      ok: true,
      value: "1",
    });
    expect(v(wrap(`return Object.keys({a:1,b:2}).length;`))).toEqual({ ok: true, value: 2 });
  });

  it("负控制：用户对象的不可枚举自有键进 gOPN 面、不进 keys 面", () => {
    expect(
      v(
        wrap(
          `const o={}; Object.defineProperty(o,"x",{value:1,enumerable:false}); return Object.getOwnPropertyNames(o).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "x" });
    expect(
      v(
        wrap(
          `const o={}; Object.defineProperty(o,"x",{value:1,enumerable:false}); return Object.keys(o).length;`,
        ),
      ),
    ).toEqual({ ok: true, value: 0 });
  });
});
});

// ---------------------------------------------------------------------------
// 开放对象读臂使用声明的索引值域
// ---------------------------------------------------------------------------
describe("开放对象读臂使用声明的索引值域", () => {
/**
 * 回归（core 侧接线）：**开放对象**的成员读必须使用声明的索引值域
 * （`shape.index.value`），不得无条件退 unknown。
 *
 * 语境：`process.env` 是开放键对象（值域 `string | undefined`）、
 * `process.versions` 值域 `string`。env 侧（packages/env）已带索引值域声明；
 * core 侧读臂此前**无条件** `return unknown` ⇒ 同一对象两面自相矛盾
 * （展示面 `Record<string, string | undefined>` vs 读面 unknown）+ 触发**假**
 * `nudo:unknown-inference`。
 *
 * 接线：`exec/runtime/containers/member.ts` 的开放对象读臂调
 * `openIndexValueOf`（exec/runtime/members.ts）——符号键例外
 * （`process.env[Symbol.iterator]` 原生 undefined）。
 */







/** 开放对象：声明索引值域（key = string 键，value = 值域） */
function openObj(value: Abs___nudojs_core_1): Abs___nudojs_core_1 {
  return objOf({}, { open: true, index: { key: str(), value } });
}

describe("开放对象读臂使用声明的索引值域", () => {
  it("有索引声明 → 成员读返回该值域（string | undefined）", () => {
    const domain = abs(
      { k: "sum", members: [str(), undef()] },
      undefined,
      undefined,
      "exact",
    );
    const got = $get(openObj(domain), "HOME");
    expect(formatAbs(got)).toContain("string");
    expect(formatAbs(got)).toContain("undefined");
  });

  it("有索引声明 → 值域是 string 时读到 string", () => {
    const got = $get(openObj(str()), "node");
    expect(formatAbs(got)).toContain("string");
  });

  it("无索引声明 → 诚实退 unknown（那才是真正的推断失败）", () => {
    const got = $get(objOf({}, { open: true }), "HOME");
    expect(formatAbs(got)).toContain("unknown");
  });

  it("符号键例外：符号键读不落到索引值域（原生 undefined）", () => {
    const got = $get(openObj(str()), "@@iterator", { symbolKey: true });
    expect(formatAbs(got)).toContain("unknown");
  });
});
});

// ---------------------------------------------------------------------------
// sort 保留稀疏数组的空洞
// ---------------------------------------------------------------------------
describe("sort 保留稀疏数组的空洞", () => {
/**
 * Array.prototype.sort 把稀疏数组的空洞（hole）实体化成 undefined
 * 元素 → Object.keys 多一键、`in` 变真、HOF 不再跳过。
 *
 * 原生语义（node 实测）：
 * - 就地 `sort`：hole 位**不参与比较**、排序后**仍是 hole**
 * （`[3,,1].sort()` → Object.keys = ["0","1"]、length 3、`2 in a` false、
 * forEach 回调 2 次、filter 结果长度 2）。
 * - `toSorted`：拷贝面走 Get（hole 读成 undefined 并**写实**为元素）→
 * Object.keys = ["0","1","2"]（本钉是负控制：不得把 toSorted 也改成保留洞）。
 * - 真实 `undefined` **元素**与 hole 不同：它始终是自有可枚举键。
 */




function v(src: string): unknown {
  const r = litValue(call(`export function f() { ${src} }`, "f").result);
  expect(r.ok).toBe(true);
  return r.ok ? r.value : undefined;
}

describe("sort 保留稀疏数组的空洞", () => {
  it("sort 后 Object.keys 不含洞位（改前多出 '2'）", () => {
    expect(v(`const a=[3,,1]; a.sort(); return Object.keys(a).join(",");`)).toBe("0,1");
  });

  it("sort 后洞位 `in` 判定为 false（改前为 true）", () => {
    expect(v(`const a=[1,,2]; a.sort(); return String(2 in a);`)).toBe("false");
  });

  it("sort 后 HOF 跳过洞位（forEach 回调 2 次、改前 3 次）", () => {
    expect(
      v(`const a=[1,,2]; a.sort(); let n=0; a.forEach(()=>{n++;}); return String(n);`),
    ).toBe("2");
  });

  it("sort 后 filter 结果长度 2（改前 3）", () => {
    expect(v(`const a=[1,,2]; a.sort(); return String(a.filter(()=>true).length);`)).toBe("2");
  });

  it("自定义比较器分支同样保留洞位", () => {
    expect(
      v(`const a=[3,,1]; a.sort((x,y)=>x-y); return Object.keys(a).join(",");`),
    ).toBe("0,1");
  });

  it("长度不变（洞位仍在数组内）", () => {
    expect(v(`const a=[3,,1]; a.sort(); return String(a.length);`)).toBe("3");
  });

  it("负控制：toSorted 走 Get 语义把洞写实为 undefined 元素", () => {
    expect(v(`const a=[1,,2]; const b=a.toSorted(); return Object.keys(b).join(",");`)).toBe(
      "0,1,2",
    );
  });

  it("负控制：真实 undefined 元素仍是自有可枚举键（不是洞）", () => {
    expect(
      v(`const a=[3,undefined,1]; a.sort(); return Object.keys(a).join(",");`),
    ).toBe("0,1,2");
  });

  it("负控制：sort 之前洞位语义不变（keys 0,2 / forEach 2 次）", () => {
    expect(v(`const a=[3,,1]; return Object.keys(a).join(",");`)).toBe("0,2");
    expect(
      v(`const a=[1,,2]; let n=0; a.forEach(()=>{n++;}); return String(n);`),
    ).toBe("2");
  });

  it("负控制：稠密数组排序结果不变", () => {
    expect(v(`const a=[3,1,2]; a.sort(); return a.join(",");`)).toBe("1,2,3");
  });
});
});

// ---------------------------------------------------------------------------
// 实例字段初始化器里的 new.target 恒为 undefined
// ---------------------------------------------------------------------------
describe("实例字段初始化器里的 new.target 恒为 undefined", () => {
/**
 * 回归：**实例字段初始化器里的 `new.target`** 折成类值（原生恒为
 * undefined）。
 *
 * 修复前：`class A { f = new.target; }` → `new A().f` 是类值（原生 undefined
 * ——`new.target` 只在**构造器体**里有值；字段初始化器是普通函数）。
 * 根因：`$new` 的 ctor 帧覆盖「构造器体 + 实例字段初始化器」整段，而字段
 * 初始化器**不走调用边界**（不经 $call/$invoke ⇒ withNewTargetReset 不触发）
 * ⇒ 继承外层 ctor 帧。
 *
 * 修法（packages/core/src/algebra/exec/class/declare.ts 的 applyInstanceFields）：
 * 字段初始化器求值期清掉 new.target 帧（构造器帧只在构造器体内成立）。
 */




const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("实例字段初始化器里的 new.target 恒为 undefined", () => {
  it("字段初始化器直接读 new.target → undefined", () => {
    expect(
      v(wrap(`class A { f = new.target; } return new A().f === undefined;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("字段初始化器里 typeof new.target → \"undefined\"", () => {
    expect(
      v(wrap(`class A { f = (new.target); } return typeof new A().f;`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("字段初始化器里的箭头函数读 new.target → undefined", () => {
    expect(
      v(wrap(`class A { f = (() => new.target)(); } return String(new A().f);`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("派生类的字段初始化器 → undefined", () => {
    expect(
      v(wrap(`class A { f = new.target; } class B extends A {} return String(new B().f);`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("静态字段初始化器里的 new.target → undefined（原生 class 定义期求值）", () => {
    expect(
      v(wrap(`class A { static s = new.target; } return typeof A.s;`)),
    ).toEqual({ ok: true, value: "undefined" });
  });

  it("负控制：构造器体里的 new.target 仍是类值（不得被一起清掉）", () => {
    // 构造器体内 new.target === 构造器（原生）——以「是本类实例」间接断言：
    // 构造器体里 new.target.name 恒为类名。
    expect(
      v(wrap(`class A { constructor(){ this.n = new.target.name; } } return new A().n;`)),
    ).toEqual({ ok: true, value: "A" });
  });

  it("负控制：字段初始化器的值本身照常落地（不是 undefined 化）", () => {
    expect(
      v(wrap(`class A { f = 42; } return new A().f;`)),
    ).toEqual({ ok: true, value: 42 });
  });
});
});

// ---------------------------------------------------------------------------
// 对象 rest 解构触发 getter
// ---------------------------------------------------------------------------
describe("对象 rest 解构触发 getter", () => {
/**
 * 对象 **rest 解构**不触发 getter → getter 的副作用丢失。
 *
 * 原生语义：对象 rest 是 CopyDataProperties —— 对每个**保留**键发一次 Get，
 * 访问器被调用（副作用发生），rest 里落的是 getter 的**返回值**。
 * 引擎此前按结构搬槽（直接取 slots[k]）→ getter 从未被调用。
 */




function v(src: string): unknown {
  const r = litValue(call(`export function f() { ${src} }`, "f").result);
  expect(r.ok).toBe(true);
  return r.ok ? r.value : undefined;
}

describe("对象 rest 解构触发 getter", () => {
  it("rest 解构调用 getter（副作用可见，改前为 0）", () => {
    expect(
      v(`let n=0; const o={get g(){n++;return 1;}, a:2}; const {a, ...r}=o; return String(n);`),
    ).toBe("1");
  });

  it("rest 槽落 getter 的返回值（改前为 undefined）", () => {
    expect(v(`const o={get g(){return 42;}, a:2}; const {a, ...r}=o; return String(r.g);`)).toBe(
      "42",
    );
  });

  it("负控制：对象展开仍触发 getter（同族路径不受影响）", () => {
    expect(v(`let n=0; const o={get g(){n++;return 1;}}; const r2={...o}; return String(n);`)).toBe(
      "1",
    );
  });

  it("负控制：Object.assign 源仍触发 getter", () => {
    expect(
      v(`let n=0; const o={get g(){n++;return 1;}}; Object.assign({}, o); return String(n);`),
    ).toBe("1");
  });

  it("负控制：被具名解构排除的键，其 getter 只由具名绑定触发一次", () => {
    expect(
      v(`let n=0; const o={get g(){n++;return 1;}}; const {g, ...r}=o; return String(n);`),
    ).toBe("1");
  });

  it("负控制：无 getter 的普通 rest 内容不变", () => {
    expect(v(`const o={a:2,b:3}; const {a, ...r}=o; return JSON.stringify(r);`)).toBe('{"b":3}');
  });
});
});

// ---------------------------------------------------------------------------
// union 接收者的 .length 保留各成员长度
// ---------------------------------------------------------------------------
describe("union 接收者的 .length 保留各成员长度", () => {
/**
 * core 对 **union 接收者**读 `.length` 时丢弃各成员的长度、恒返回
 * `number` ⇒ L1 契约门禁**假绿**（`number()` 契约被判定成立，零诊断）。
 *
 * 原生语义：`"ab" | 7` 的 `.length` 是 `2 | undefined`（数字分支没有 length
 * 属性 → 读出 undefined）⇒ `@nudo:contract return number()` 违约。
 */





/** 结果里是否含「undefined 臂」（lit undefined term 的 sum 成员） */
function hasUndefArm(r: unknown): boolean {
  const a = r as { shape?: { k?: string; members?: unknown[] } };
  if (a?.shape?.k !== "sum") return false;
  return (a.shape.members ?? []).some((m) => {
    const x = m as { term?: { op?: string; value?: unknown } };
    return x?.term?.op === "lit" && x.term.value === undefined;
  });
}

const UNION_SRC = `
export function pickStrNum(x) { if (x) { return "ab"; } return 7; }
/** @nudo:contract return num */
export function lenOf(y) { return pickStrNum(y).length; }
`;

describe("union 接收者的 .length 保留各成员长度", () => {
  it("union 接收者读 .length 带 undefined 臂（改前恒 number）", () => {
    const r = call(
      `export function f(y) { function p(x){ if (x) { return "ab"; } return 7; } return p(y).length; }`,
      "f",
      [anyAbs],
    ).result;
    expect(hasUndefArm(r)).toBe(true);
  });

  it("L1 契约门禁不再假绿：number() 契约被判违约（改前零诊断）", () => {
    const errs = errorsOf(
      `/// @nudo:import { num } from "./std.nudo.js"\n${UNION_SRC}`,
      "/t/bug239.js",
    );
    expect(errs.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("L1 门禁面：签名显示 undefined 臂", () => {
    const r = issuesOf(
      `/// @nudo:import { num } from "./std.nudo.js"\n${UNION_SRC}`,
      "/t/bug239.js",
    );
    expect(sigOf(r, "lenOf")).toContain("undefined");
  });

  it("负控制：全成员都有 length 的 union 不带 undefined 臂（不制造假红）", () => {
    const r = call(
      `export function f(y) { function p(x){ if (x) { return "ab"; } return "cde"; } return p(y).length; }`,
      "f",
      [anyAbs],
    ).result;
    expect(hasUndefArm(r)).toBe(false);
  });

  it("负控制：单成员（无 union）读 .length 仍是诚实的 unknown", () => {
    const r = call(`export function f() { return (7).length; }`, "f").result;
    expect((r as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });

  it("负控制：字符串 .length 仍是精确值", () => {
    const r = call(`export function f() { return "ab".length; }`, "f").result;
    expect((r as { term?: { op?: string; value?: unknown } }).term?.op).toBe("lit");
  });
});
});

// ---------------------------------------------------------------------------
// 宿主函数 → Abs 的稳定门面
// ---------------------------------------------------------------------------
describe("宿主函数 → Abs 的稳定门面", () => {
/**
 * 回归（**主 agent 接线面**）：宿主函数 → Abs 的**稳定门面**。
 *
 * 接线（主 agent 已落地，本文件只钉行为，不改源码）：
 * `exec/runtime/state.ts` 的 `asAbsVal` 对宿主函数走 `WeakMap` 缓存
 * （`hostFnAbsCache`）⇒ 同一宿主函数**恒同一 Abs** ⇒ 以 Abs 为键的旁表
 * （propFlags / extState / userFnSlots）跨调用不再丢失。
 *
 * 原生依据（node v26.10.0 实测）：同一函数**恒同一身份**（`g === g` 真、
 * `Object.isFrozen(g)` 恒定）；freeze / seal 的标志挂在**函数对象本身**上，
 * 与「谁在读它」无关：
 * - `function g(){} Object.freeze(g); Object.isFrozen(g)` → true；
 * - `function g(){} Object.freeze(g); Object.isSealed(g)` → true（freeze ⇒ seal）；
 * - `function g(){} Object.seal(g); Object.isSealed(g)` → true；
 * - `function g(){} const a = g; Object.freeze(g); Object.isFrozen(a)` → true
 * （别名读同一对象 ⇒ 标志可见）；
 * - 跨函数边界同样可见：helper 里 freeze ⇒ 外面读 isFrozen → true；
 * helper 里读 isFrozen → true；
 * - `g === g` → true；两次读 `const a = g; const b = g; a === b` → true。
 *
 * 修前：每次 `asAbsVal(hostFn)` 都新建 Abs ⇒ 旁表跨读丢失 ⇒
 * `Object.isFrozen(g)` 折 false（标志留在第一次新建的 Abs 上，再读是全新
 * Abs ⇒ 查不到）；`g === g` 落「不可判」（`strictEqAbs` 对 fn 只在**同一
 * Abs 引用**上折 true）。
 *
 * 对照（同族既有行为）：函数表达式（`$fnVal` 造的稳定 fn Abs）freeze 后
 * `Object.isFrozen` 恒 true。
 */




/** 端到端取一段函数体的字面量结果 */
function v(body: string): { ok: boolean; value?: unknown } {
  return litValue(call(`export function f() { ${body} }`, "f").result);
}

describe("宿主函数 → Abs 的稳定门面", () => {
  it("函数声明 freeze 后 isFrozen 可见（修前折 false）", () => {
    expect(v(`function g(){} Object.freeze(g); return Object.isFrozen(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("函数声明 freeze 后 isSealed 亦为 true（原生：freeze ⇒ seal）", () => {
    expect(v(`function g(){} Object.freeze(g); return Object.isSealed(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("函数声明 seal 后 isSealed 可见（修前折 false）", () => {
    expect(v(`function g(){} Object.seal(g); return Object.isSealed(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("别名读：const a = g 后 freeze，isFrozen(a) 仍为 true（修前折 false）", () => {
    expect(
      v(`function g(){} const a = g; Object.freeze(g); return Object.isFrozen(a);`),
    ).toEqual({ ok: true, value: true });
  });

  it("跨调用可见：helper 里 freeze ⇒ 外面读 isFrozen 为 true", () => {
    expect(
      v(
        `function g(){} function freezeIt(){ Object.freeze(g); } freezeIt(); return Object.isFrozen(g);`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("跨调用可见：helper 里读 isFrozen 为 true（标志随同一 Abs 门面）", () => {
    expect(
      v(
        `function g(){} function read(){ return Object.isFrozen(g); } Object.freeze(g); return read();`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("跨调用可见：helper 里 seal ⇒ 外面读 isSealed 为 true", () => {
    expect(
      v(
        `function g(){} function sealIt(){ Object.seal(g); } sealIt(); return Object.isSealed(g);`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("同引用读：g === g 折 true（修前不可判）", () => {
    expect(v(`function g(){} return g === g;`)).toEqual({ ok: true, value: true });
  });

  it("同引用读：两次读同一宿主函数恒等（a === b 折 true）", () => {
    expect(v(`function g(){} const a = g; const b = g; return a === b;`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("同引用读：helper 返回的同一宿主函数与直接读恒等", () => {
    expect(
      v(`function g(){} function id(){ return g; } return id() === g;`),
    ).toEqual({ ok: true, value: true });
  });

  it("对照：函数表达式的既有行为（freeze 后 isFrozen 恒 true）", () => {
    expect(v(`const g = function(){}; Object.freeze(g); return Object.isFrozen(g);`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：freeze / seal 之前 isFrozen / isSealed 均为 false", () => {
    expect(v(`function g(){} return Object.isFrozen(g);`)).toEqual({
      ok: true,
      value: false,
    });
    expect(v(`function g(){} return Object.isSealed(g);`)).toEqual({
      ok: true,
      value: false,
    });
  });
});
});

// ---------------------------------------------------------------------------
// 装箱 BigInt 的 valueOf 面（原生 "bigint"，修前 "object"）
// ---------------------------------------------------------------------------
describe("装箱 BigInt 的 valueOf 面（原生 \"bigint\"，修前 \"object\"）", () => {
/**
 * 回归：`Object(prim)` 装箱面的 `valueOf` / `description` 语义。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 * typeof Object(1n).valueOf() → "bigint"
 * String(Object(1n) + 1) → **抛 TypeError**
 * （"Cannot mix BigInt and other types,
 * use explicit conversions"）
 * Object(1n) + 1 → **抛 TypeError**（同款）
 * String(Object(1n).valueOf()) → "1"
 * typeof Object(1n) → "object"
 * typeof Object("s").valueOf() → "string"
 * String(Object(Symbol("x")).description) → "x"
 * typeof Object(Symbol("x")).description → "string"
 * Symbol("x").description → "x"（非装箱路径，对照组）
 *
 * 修前：
 * - 装箱 BigInt 的 `valueOf` 折 **"object"**（自信的错值；原生是 "bigint"）
 * ⇒ `Object(1n) + 1` 落 BigInt 混算的**错臂** ⇒ **不抛**（原生确定抛
 * TypeError）⇒ 假绿（漏报真实的 may-throw）。
 * - 装箱 Symbol 的 `description` 折 exact **undefined**（原生是 "x"）
 * ⇒ 对「装箱符号的描述」给出自信的错值。
 *
 * 取证（原生 oracle）：
 * node -e 'console.log(typeof Object(1n).valueOf(), String(Object(1n).valueOf()),
 * typeof Object(1n), typeof Object("s").valueOf(),
 * Object(Symbol("x")).description, Symbol("x").description);
 * try { String(Object(1n)+1) } catch (e) { console.log(e.constructor.name) }'
 */




const wrap = (body: string) => `export function f() { ${body} }`;

describe("装箱 BigInt 的 valueOf 面（原生 \"bigint\"，修前 \"object\"）", () => {
  it("typeof Object(1n).valueOf() → \"bigint\"（修前是 \"object\"——自信的错值）", () => {
    const r = call(wrap(`return typeof Object(1n).valueOf();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "bigint" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("String(Object(1n) + 1) → 记 may-throw TypeError（原生确定抛：BigInt 不得与其它类型混算）", () => {
    // 原生：TypeError "Cannot mix BigInt and other types, use explicit conversions"
    const r = call(wrap(`return String(Object(1n) + 1);`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("Object(1n) + 1 → 记 may-throw TypeError（不经 String 包装的同一混算臂）", () => {
    const r = call(wrap(`return Object(1n) + 1;`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("String(Object(1n).valueOf()) → \"1\"（显式取原值后转字符串合法且确定）", () => {
    const r = call(wrap(`return String(Object(1n).valueOf());`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("typeof Object(1n) → \"object\"（装箱体本身是对象）", () => {
    const r = call(wrap(`return typeof Object(1n);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });
});

describe("装箱 Symbol 的 description 面（原生 \"x\"，修前 exact undefined）", () => {
  it("String(Object(Symbol(\"x\")).description) → \"x\"", () => {
    const r = call(wrap(`return String(Object(Symbol("x")).description);`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("typeof Object(Symbol(\"x\")).description → \"string\"", () => {
    const r = call(wrap(`return typeof Object(Symbol("x")).description;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  });

  it("对照组：Symbol(\"x\").description → \"x\"（非装箱路径不变）", () => {
    const r = call(wrap(`return Symbol("x").description;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });
});

describe("负控制（其它装箱原语面不回归）", () => {
  it("typeof Object(\"s\").valueOf() → \"string\"（装箱字符串的 valueOf 面）", () => {
    const r = call(wrap(`return typeof Object("s").valueOf();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "string" });
  });

  it("typeof Object(1).valueOf() → \"number\"（装箱数字的 valueOf 面）", () => {
    const r = call(wrap(`return typeof Object(1).valueOf();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "number" });
  });

  it("String(Object(\"s\").valueOf()) → \"s\"（装箱字符串取原值）", () => {
    const r = call(wrap(`return String(Object("s").valueOf());`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "s" });
  });
});
});

// ---------------------------------------------------------------------------
// 函数种类标签（async × generator 四象限）
// ---------------------------------------------------------------------------
describe("函数种类标签（async × generator 四象限）", () => {
/**
 * 回归（**主 agent 接线面**）：函数**种类**戳（async × generator 四象限）
 * 驱动的 `Object.prototype.toString.call(f)` 标签。
 *
 * 接线（主 agent 已落地，本文件只钉行为，不改源码）：
 * - `algebra/abs-fn.ts`：`AbsFnImpl` 新增独立字段 `fnKind`
 * （"function" | "async" | "generator" | "async-generator"）——与 `impl.kind`
 * **分开**（`kind` 是「派发角色」维度，如 "protoMethod"）；
 * - `exec/runtime/state.ts`：`$fnVal` 的 opts 新增 `fnKind`，透传到 impl；
 * - `exec/transpile/helpers.ts`：新增 `fnKindSrc(fn)`（发射 `, fnKind: "..."`
 * 源码片段）与 `fnKindOf(fn)`（纯值）；
 * - `exec/transpile/expr/function.ts`（函数表达式）、
 * `exec/transpile/expr/object.ts`（方法简写 + 方法型函数表达式）、
 * `exec/transpile/class-emit.ts`（类方法 / 静态类方法，种类随 spec 的
 * `methodKinds` / `staticMethodKinds` 下传）三条产生路径都打戳；
 * - `builtins/object-proto.ts`：`Object.prototype.toString.call(f)` 按
 * `impl.fnKind` 给标签。
 *
 * 原生依据（node v26.10.0 实测，`Object.prototype.toString.call(x)`）：
 * - `function(){}` → "[object Function]"；
 * - `async function(){}` → "[object AsyncFunction]"；
 * - `function*(){}` → "[object GeneratorFunction]"；
 * - `async function*(){}` → "[object AsyncGeneratorFunction]"；
 * - 箭头 `() => 1` → "[object Function]"、`async () => 1` → "[object AsyncFunction]"；
 * - `{m(){}}.m` → "[object Function]"；
 * - `{async m(){}}.m` → "[object AsyncFunction]"；
 * - `{*m(){}}.m` → "[object GeneratorFunction]"；
 * - `{async *m(){}}.m` → "[object AsyncGeneratorFunction]"；
 * - `class A{m(){}}` 的 `A.prototype.m` → "[object Function]"；
 * - `class A{async m(){}}` 的 `A.prototype.m` → "[object AsyncFunction]"；
 * - `class A{*m(){}}` 的 `A.prototype.m` → "[object GeneratorFunction]"；
 * - `class A{static async m(){}}` 的 `A.m` → "[object AsyncFunction]"；
 * - `class A{static m(){}}` / `{static *m(){}}` / `{static async *m(){}}` 的
 * `A.m` → "[object Function]" / "[object GeneratorFunction]" /
 * "[object AsyncGeneratorFunction]"；
 * - `Object` / `Array.prototype.slice` → "[object Function]"（宿主内建无种类戳）。
 *
 * **函数声明形态**（`export async function f(){}` 等）此前是已知缺口：
 * 声明转译后是宿主**普通函数**（async 体包 `$async`、generator 体包 `$gen`）
 * ⇒ async/generator 种类**无法从宿主侧反推** ⇒ 标签恒为 "[object Function]"。
 * 修法（族 05 收尾）：转译侧在声明处显式戳一次（`$fnKindStamp`，
 * `exec/runtime/state.ts` 的宿主函数→种类旁表）⇒ `asAbsVal` 建 fn Abs 时
 * 读戳 ⇒ 标签面给出原生标签（与表达式 / 箭头 / 方法四条路径同口径）。
 */




/** 端到端取 `Object.prototype.toString.call(x)` 的标签字面量（body 形态） */
function tag(body: string): { ok: boolean; value?: unknown } {
  return litValue(
    call(`export function f() { ${body} }`, "f").result,
  );
}

/** 端到端取**函数声明**形态的标签（声明在模块顶层，读声明名 `f`） */
function declTag(decl: string): { ok: boolean; value?: unknown } {
  return litValue(
    call(
      `${decl}
export function probe() { return Object.prototype.toString.call(f); }`,
      "probe",
    ).result,
  );
}

/** 期望值：原生标签字符串 */
const FUNCTION = "[object Function]";
const ASYNC = "[object AsyncFunction]";
const GENERATOR = "[object GeneratorFunction]";
const ASYNC_GENERATOR = "[object AsyncGeneratorFunction]";

describe("函数种类标签（async × generator 四象限）", () => {
  it("函数表达式：四种象限各折原生标签", () => {
    expect(tag(`return Object.prototype.toString.call(function () {});`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(async function () {});`)).toEqual({
      ok: true,
      value: ASYNC,
    });
    expect(tag(`return Object.prototype.toString.call(function* () {});`)).toEqual({
      ok: true,
      value: GENERATOR,
    });
    expect(tag(`return Object.prototype.toString.call(async function* () {});`)).toEqual({
      ok: true,
      value: ASYNC_GENERATOR,
    });
  });

  it("箭头函数：同步折 Function、async 折 AsyncFunction（原生同款）", () => {
    expect(tag(`return Object.prototype.toString.call(() => 1);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(async () => 1);`)).toEqual({
      ok: true,
      value: ASYNC,
    });
  });

  it("对象方法简写：种类随 async × generator 变", () => {
    expect(tag(`return Object.prototype.toString.call(({ m() {} }).m);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(({ async m() {} }).m);`)).toEqual({
      ok: true,
      value: ASYNC,
    });
    expect(tag(`return Object.prototype.toString.call(({ *m() {} }).m);`)).toEqual({
      ok: true,
      value: GENERATOR,
    });
    expect(tag(`return Object.prototype.toString.call(({ async *m() {} }).m);`)).toEqual({
      ok: true,
      value: ASYNC_GENERATOR,
    });
  });

  it("类实例方法：种类随 async × generator 变", () => {
    expect(
      tag(`class A { m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: FUNCTION });
    expect(
      tag(`class A { async m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: ASYNC });
    expect(
      tag(`class A { *m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: GENERATOR });
    expect(
      tag(`class A { async *m() {} } return Object.prototype.toString.call(A.prototype.m);`),
    ).toEqual({ ok: true, value: ASYNC_GENERATOR });
  });

  it("类静态方法：staticMethodKinds 下传的种类戳生效", () => {
    expect(tag(`class A { static m() {} } return Object.prototype.toString.call(A.m);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(
      tag(`class A { static async m() {} } return Object.prototype.toString.call(A.m);`),
    ).toEqual({ ok: true, value: ASYNC });
    expect(
      tag(`class A { static *m() {} } return Object.prototype.toString.call(A.m);`),
    ).toEqual({ ok: true, value: GENERATOR });
    expect(
      tag(`class A { static async *m() {} } return Object.prototype.toString.call(A.m);`),
    ).toEqual({ ok: true, value: ASYNC_GENERATOR });
  });

  it("负控制：宿主内建函数（无种类戳）仍折 [object Function]", () => {
    expect(tag(`return Object.prototype.toString.call(Object);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
    expect(tag(`return Object.prototype.toString.call(Array.prototype.slice);`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
  });

  it("函数声明：同步折 Function、async 折 AsyncFunction（宿主普通函数的种类戳）", () => {
    expect(declTag(`function f() {}`)).toEqual({ ok: true, value: FUNCTION });
    expect(declTag(`async function f() {}`)).toEqual({ ok: true, value: ASYNC });
  });

  it("函数声明：generator 折 GeneratorFunction、async generator 折 AsyncGeneratorFunction", () => {
    expect(declTag(`function* f() {}`)).toEqual({ ok: true, value: GENERATOR });
    expect(declTag(`async function* f() {}`)).toEqual({
      ok: true,
      value: ASYNC_GENERATOR,
    });
  });

  it("函数声明：种类戳在**声明提升**下也生效（声明前先调用）", () => {
    // 声明提升 ⇒ 声明前的调用可能先建出 fn Abs（Abs 按宿主函数缓存）⇒
    // 戳必须早于任何调用（转译侧把戳放在声明之前）
    expect(
      declTag(`async function f() { return 1; }
const early = f();
`),
    ).toEqual({ ok: true, value: ASYNC });
  });

  it("负控制：函数声明的宿主原生标签不被误用（同步声明仍是 Function）", () => {
    expect(declTag(`function f() { return 1; }`)).toEqual({
      ok: true,
      value: FUNCTION,
    });
  });
});
});

// ---------------------------------------------------------------------------
// 函数种类标签（AsyncFunction / GeneratorFunction / …）
// ---------------------------------------------------------------------------
describe("函数种类标签（AsyncFunction / GeneratorFunction / …）", () => {
/**
 * 回归：Object.prototype.toString 的**函数种类标签**。
 *
 * 原生（node v26 实测）：
 * - 普通函数 / 箭头 ⇒ "[object Function]"；
 * - async 函数 ⇒ "[object AsyncFunction]"；
 * - generator ⇒ "[object GeneratorFunction]"；
 * - async generator ⇒ "[object AsyncGeneratorFunction]"；
 * 判别式：`Object.prototype.toString.call(x).slice(8, -1) === "AsyncFunction"`。
 *
 * 修复前：整族折 "[object Function]"（wrong-exact——上述判别式恒假）。
 * 种类戳由 transpile 侧 $fnVal opts.kind 打（async × generator 四象限），
 * 读取面在 builtins/object-proto.ts 的 typeTagOf。
 *
 * 已知边界（**不是**本条的缺口）：**方法简写**（`{ async m(){} }.m`）与
 * **函数声明**（`async function f(){}`）走另外两条产生路径（transpile/
 * expr/object.ts、transpile/stmt/statement.ts——不在本分片文件清单内），
 * 尚未打戳 ⇒ 仍折 "[object Function]"（越界诉求见分片报告）。
 */




function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("函数种类标签（AsyncFunction / GeneratorFunction / …）", () => {
  it("async 函数 ⇒ [object AsyncFunction]（改前折 [object Function]）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(async () => 1);`))).toEqual({
      ok: true,
      value: "[object AsyncFunction]",
    });
  });

  it("generator ⇒ [object GeneratorFunction]（改前折 [object Function]）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(function* () {});`))).toEqual({
      ok: true,
      value: "[object GeneratorFunction]",
    });
  });

  it("async generator ⇒ [object AsyncGeneratorFunction]（改前折 [object Function]）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(async function* () {});`))).toEqual({
      ok: true,
      value: "[object AsyncGeneratorFunction]",
    });
  });

  it("负控制：普通函数表达式 ⇒ [object Function]（原生同款）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(function () {});`))).toEqual({
      ok: true,
      value: "[object Function]",
    });
  });

  it("负控制：箭头函数 ⇒ [object Function]（原生同款）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(() => 1);`))).toEqual({
      ok: true,
      value: "[object Function]",
    });
  });

  it("负控制：generator 仍有原生 prototype（Bug 93 面不被新值域破坏）", () => {
    expect(v(wrap(`const g = function* () {}; return typeof g.prototype;`))).toEqual({
      ok: true,
      value: "object",
    });
  });
});
});

// ---------------------------------------------------------------------------
// .ts 形参类型注解进入推断
// ---------------------------------------------------------------------------
describe(".ts 形参类型注解进入推断", () => {
/**
 * `.ts` 源的**形参类型注解**从未进入推断：剥除 pass（core 的
 * `strip-types.ts`）在解析阶段就 `delete` 掉 `typeAnnotation` ⇒ 形参一律
 * `any` ⇒ 合法 TypeScript 拿到 **`nudo:entry-may-throw` 假红**，诊断还宣称
 * 「unconstrained value」。
 *
 * 修法（core 侧）：
 * - `strip-types.ts`：删注解前把**类型注解的源码文本**留在节点上
 * （`nudoTypeText`）——存字符串而非 AST 节点，AST 遍历器看不见它 ⇒
 * 分析管线语义零变化；
 * - `param-surface.ts`：`FormalParam.tsType` 带出该文本；
 * - `generalize.ts`：入口形参按声明类型建 Abs（基本类型子集）⇒ 不再是
 * 「无约束 any」。
 *
 * 本文件钉住：
 * - 正控制：`.ts` 源的形参按声明类型推断（string），且**不再**报
 * `nudo:entry-may-throw` 假红；
 * - 负控制：同形 `.js` 源**行为不变**（形参仍是 any，may-throw 仍在）；
 * - 原生 oracle 对拍（node 另起进程）：`upper("x")` 返回 "X"，不抛。
 */









beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

const TS_SOURCE = `export function upper(a: string): string {
  return a.toUpperCase();
}
`;

const JS_SOURCE = `export function upper(a) {
  return a.toUpperCase();
}
`;

describe(".ts 形参类型注解进入推断", () => {
  it("形参按声明类型推断（string），不再是 any", () => {
    const r = checkSource("/t/upper.ts", TS_SOURCE, pTrue);
    const sig = r.signatures.find((s) => s.name === "upper");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("string");
    expect(sig!.display).toContain("string");
  });

  it("合法 .ts 不再触发 nudo:entry-may-throw 假红", () => {
    const r = checkSource("/t/upper.ts", TS_SOURCE, pTrue);
    const throws = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
    expect(throws).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("负控制：同形 .js 源行为不变（形参仍是 any，may-throw 仍在）", () => {
    const r = checkSource("/t/upper.js", JS_SOURCE, pTrue);
    const sig = r.signatures.find((s) => s.name === "upper");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("any");
    const throws = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
    expect(throws.length).toBe(1);
  });

  it("原生 oracle：upper('x') 返回 'X' 且不抛（node 另起进程对拍）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug479-"));
    const mod = join(dir, "mod.mjs");
    writeFileSync(
      mod,
      `export function upper(a) {
  return a.toUpperCase();
}
`,
      "utf8",
    );
    const runner = join(dir, "run.mjs");
    writeFileSync(
      runner,
      `import { upper } from "./mod.mjs";
console.log(JSON.stringify({ value: upper("x") }));
`,
      "utf8",
    );
    const res = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    const native = JSON.parse(res.stdout.trim()) as { value: string };
    expect(native.value).toBe("X");

    // 引擎侧。ts 源的同一函数不得报 may-throw（原生不抛）
    const r = checkSource("/t/upper.ts", TS_SOURCE, pTrue);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// 具名 default 导出的 check 面查表兜底
// ---------------------------------------------------------------------------
describe("具名 default 导出的 check 面查表兜底", () => {
/**
 * `export default function f() { … }` 的**入口求值按「局部名」查
 * 导出表** ⇒ ESM 语义下默认导出只挂在 `default` 槽 ⇒ 查表落空 ⇒ 签名退成
 * `unknown` + 一条**指向错误**的 `nudo:opaque-result`。
 *
 * 修法（core 侧）：`algebra/export-slot.ts` 给出「本地名 → 导出槽」的兜底
 * 解析（局部名找不到 ⇒ 回退 `default` 槽），`algebra/generalize.ts` 消费它。
 *
 * 本文件钉住：
 * - 正控制：具名 default 导出的签名是**实值**（不是 unknown），且不再产生
 * 那条指向错误的 nudo:opaque-result；
 * - 负控制：普通具名导出的行为**不变**；default 导出**不得劫持**别的函数；
 * - 原生 oracle 对拍（node 另起进程，ESM 严格模式）：默认槽挂的就是那个
 * 函数，调用返回同样的值。
 */









beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

/** 具名 default 导出（ESM）：本地名 f，导出槽只有 default */
const DEFAULT_EXPORT_SRC = `export default function f() {
  return 41 + 1;
}
`;

describe("具名 default 导出的 check 面查表兜底", () => {
  it("签名是实值（41+1），不是 unknown", () => {
    const r = checkSource("/t/d.js", DEFAULT_EXPORT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig, "default 导出的本地名 f 必须出现在签名面").toBeDefined();
    expect(sig!.display).toContain("42");
    expect(sig!.conf).not.toBe("opaque");
  });

  it("不再产生指向错误的 nudo:opaque-result", () => {
    const r = checkSource("/t/d.js", DEFAULT_EXPORT_SRC, pTrue);
    const opaque = r.issues.filter((i) => i.code === "nudo:opaque-result");
    expect(opaque).toEqual([]);
  });

  it("负控制：普通具名导出行为不变（default 导出不得劫持别的函数）", () => {
    const src = `export default function f() {
  return 1;
}
export function g() {
  return 2;
}
function local() {
  return 3;
}
`;
    const r = checkSource("/t/d2.js", src, pTrue);
    const byName = new Map(r.signatures.map((s) => [s.name, s]));
    expect(byName.get("f")!.display).toContain("1");
    expect(byName.get("g")!.display).toContain("2");
    expect(byName.get("local")!.display).toContain("3");
  });

  it("同源：`export default class C { m() }` 的方法也走 default 槽（不再 unknown）", () => {
    const src = `export default class C {
  m() {
    return 7;
  }
}
`;
    const r = checkSource("/t/d3.js", src, pTrue);
    const sig = r.signatures.find((s) => s.name === "C.m");
    expect(sig, "默认导出的类方法必须出现在签名面").toBeDefined();
    expect(sig!.display).toContain("7");
    expect(sig!.conf).not.toBe("opaque");
  });

  it("原生 oracle：ESM 默认槽挂的就是那个函数（node 另起进程对拍）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug489-"));
    const mod = join(dir, "mod.mjs");
    writeFileSync(
      mod,
      `export default function f() {
  return 41 + 1;
}
`,
      "utf8",
    );
    const runner = join(dir, "run.mjs");
    writeFileSync(
      runner,
      `import def from "./mod.mjs";
console.log(JSON.stringify({ type: typeof def, value: def() }));
`,
      "utf8",
    );
    const res = spawnSync(process.execPath, [runner], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, `subprocess stderr: ${res.stderr}`).toBe(0);
    const native = JSON.parse(res.stdout.trim()) as { type: string; value: number };
    expect(native.type).toBe("function");
    expect(native.value).toBe(42);

    // 引擎侧：同一个函数的返回值必须与原生一致
    const r = checkSource("/t/d.js", DEFAULT_EXPORT_SRC, pTrue);
    const sig = r.signatures.find((s) => s.name === "f")!;
    expect(sig.display).toContain(String(native.value));
  });
});
});

// ---------------------------------------------------------------------------
// 依赖不可读不得炸穿整轮 check
// ---------------------------------------------------------------------------
describe("依赖不可读不得炸穿整轮 check", () => {
/**
 * 依赖模块**不可读**（EACCES / EIO / EMFILE…）⇒ core 侧两个装载
 * 消费点（check.ts 的 memo 包装、scan-call-graph.ts 的 loadSpecFrom）把异常
 * 抛到 `nudo check` 的整轮外面（stdout 0 字节、无任何报告）。
 *
 * 修法（core 侧）：`algebra/load-guard.ts` 的读错误降级闸（口径对齐 service
 * 侧 `guardedLoadModule` / `ModuleReadError`：不可读 ≠ 不存在）+ check.ts
 * 把它收口成一条 `nudo:module-unreadable` 诊断（与 service 面同码；消息写明
 * errno，不谎报「文件不存在」）。
 *
 * 本文件钉住：
 * - 不可读依赖 ⇒ **不抛异常**，且产出一条明确诊断（含 errno）；
 * - 真·不存在（miss）⇒ **不得**报读失败（保持既有静默语义）；
 * - 读失败轮不得与「真不存在」轮共享 memo（陈旧命中）。
 */





beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

const MAIN = `import { d } from './dep.js';
export function run() {
  return d();
}
`;

const throwingLoader = (code: string, path: string) => () => {
  throw Object.assign(new Error(`${code}: permission denied, open '${path}'`), { code, path });
};

describe("依赖不可读不得炸穿整轮 check", () => {
  it("EACCES 依赖 ⇒ 不抛异常，且产出一条明确诊断", () => {
    let r!: ReturnType<typeof checkSource>;
    expect(() => {
      r = checkSource("/t/main.js", MAIN, pTrue, {
        fromFile: "/t/main.js",
        loadModule: throwingLoader("EACCES", "/t/dep.js"),
      });
    }).not.toThrow();
    const missing = r.issues.filter((i) => i.code === "nudo:module-unreadable");
    expect(missing.length).toBe(1);
    expect(missing[0]!.severity).toBe("error");
    // 消息必须写明「读失败」的事实与 errno——不得谎报「文件不存在」
    expect(missing[0]!.message).toContain("EACCES");
    expect(missing[0]!.message).toContain("/t/dep.js");
    expect(missing[0]!.message.toLowerCase()).not.toContain("not found");
  });

  it("真·不存在（miss）⇒ 不报读失败（既有静默语义不变）", () => {
    const r = checkSource("/t/main.js", MAIN, pTrue, {
      fromFile: "/t/main.js",
      loadModule: () => undefined,
    });
    expect(r.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
  });

  it("读失败轮不得与「真不存在」轮共享 memo（陈旧命中）—— **同一个 loader 闭包**切换行为", () => {
    const src = MAIN;
    // ⚠ 断言强度：两次调用必须**共用同一个 loader 对象**——`checkMemoKey` 含
    // loader 身份 ⇒ 换 loader 就换 key ⇒ 旧写法（miss 一个 loader /
    // unreadable 另一个 loader）**不可能**陈旧命中 ⇒ 钉不到失效逻辑。
    let mode: "miss" | "unreadable" = "miss";
    const loader = () => {
      if (mode === "miss") return undefined;
      throw Object.assign(new Error("EACCES: permission denied, open '/t/dep.js'"), {
        code: "EACCES",
        path: "/t/dep.js",
      });
    };
    const opts = { fromFile: "/t/main2.js", loadModule: loader };
    const miss = checkSource("/t/main2.js", src, pTrue, opts);
    expect(miss.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
    // 同一 loader、同一文件、同一份源码：切到不可读 ⇒ 必须重新判定并报出读失败
    mode = "unreadable";
    const unreadable = checkSource("/t/main2.js", src, pTrue, opts);
    expect(unreadable.issues.filter((i) => i.code === "nudo:module-unreadable").length).toBe(1);
    // 读失败轮**不得**把 memo 写成「读失败」的结论 ⇒ 切回 miss 后仍是静默
    mode = "miss";
    const missAgain = checkSource("/t/main2.js", src, pTrue, opts);
    expect(missAgain.issues.filter((i) => i.code === "nudo:module-unreadable")).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// 族 60 · 第 1 条：assume 的用户界落进入口 Abs 谓词
// ---------------------------------------------------------------------------
describe("族 60 · 第 1 条：assume 的用户界落进入口 Abs 谓词", () => {
/**
 * 族 60 · core 代数层 5 条精度债的钉（片 W10）。
 *
 * 逐条对应（台账原文 → 本钉的落点）：
 * 1. **core `buildArgsFromAssume` 写死 `x > 0`** —— 被假设形参的入口 Abs 谓词
 * 必须是**用户写的界**，不是引擎发明的界（族 08 · 已修；本钉**锁**）。
 * 2. **S11-534 core 字面量渲染** —— bigint 字面量必须与 number 字面量
 * **可分**（`lit(10n)` vs `lit(10)`；族 06 · 已修；本钉**锁**）。
 * 3. **S6-1008 观测层根因（core）** —— rest 形参的**元数信息**在 core 层可读
 * （必选元数 + 变长标记；**本片新修**）。
 * 4. **复合测试不接关系守卫** —— `relGuardOf` 认**复合**（合取）关系式
 * （**本片新修**；补集方向**不**接 ⇒ 不假绿）。
 * 5. **core 侧 `absShapeForTsTypeText` 未公共化** —— 正解必然新增公共导出 ⇒
 * 触及公共 API 冻结面 ⇒ **本片只报告不擅自新增**；本钉锁住「内部可用 /
 * 公共面缺席」的现状（**负控**）。
 *
 * 负控贯穿：非相关形态**逐字不变**（数字字面量渲染、单关系式守卫、非 rest
 * 形参、公共导出面）。
 */













// ---------------------------------------------------------------------------
// 第 1 条：assume 的界落进形参自己的 pred（不是写死的 x > 0）
// ---------------------------------------------------------------------------

const ASSUME_SRC = `export function k(x) {
  if (x < 0) {
    return "neg";
  }
  return "pos";
}
`;

describe("族 60 · 第 1 条：assume 的用户界落进入口 Abs 谓词", () => {
  it("用户声明的界直接落进形参 pred（不是写死的 x > 0）", () => {
    const bounds = new Map([["x", gtNum(v("x"), -5)]]);
    const args = buildArgsFromAssume(ASSUME_SRC, "k", new Set(["x"]), bounds);
    expect(args.length).toBe(1);
    expect(args[0]!.pred).toBeDefined();
    expect(predToString(args[0]!.pred!)).toBe("x > -5");
    // 负控：写死的 x > 0 不许出现（它比用户界更强 ⇒ 观察面说谎）
    expect(predToString(args[0]!.pred!)).not.toBe("x > 0");
  });

  it("负控：没有声明界 ⇒ 不写界（不替用户发明一个更强的默认界）", () => {
    const args = buildArgsFromAssume(ASSUME_SRC, "k", new Set(["x"]));
    expect(args.length).toBe(1);
    expect(args[0]!.pred).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 第 2 条：core 字面量渲染（bigint 与 number 可分）
// ---------------------------------------------------------------------------

describe("族 60 · 第 2 条：core 字面量渲染 bigint 可分", () => {
  it("bigint 字面量渲染成 lit(10n)（与 lit(10) 可分）", () => {
    expect(formatConstraint(litC(10n))).toBe("lit(10n)");
    expect(formatConstraint(litC(10n))).not.toBe(formatConstraint(litC(10)));
  });

  it("负控：数字字面量的渲染逐字不变（lit(10) / lit(-0) / number().gt(10)）", () => {
    expect(formatConstraint(litC(10))).toBe("lit(10)");
    expect(formatConstraint(litC(-0))).toBe("lit(-0)");
    expect(formatConstraint(litC("a"))).toBe('lit("a")');
    expect(formatConstraint(numberC().gt(10))).toBe("number().gt(10)");
  });
});

// ---------------------------------------------------------------------------
// 第 3 条：rest 形参的元数信息在 core 层可读
// ---------------------------------------------------------------------------

describe("族 60 · 第 3 条：rest 形参的元数信息", () => {
  it("rest 形参带 arity：必选元数 + 变长标记", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "Identifier", name: "b" },
      { type: "RestElement", argument: { type: "Identifier", name: "rest" } },
    ] as never);
    const rest = formals[2]!;
    expect(rest.kind).toBe("rest");
    if (rest.kind !== "rest") throw new Error("expected rest formal");
    expect(rest.arity).toEqual({ min: 2, variadic: true });
  });

  it("负控：默认形参不计入必选元数；非 rest 形参没有 arity 字段", () => {
    const formals = formalParamsFromNodes([
      { type: "Identifier", name: "a" },
      { type: "AssignmentPattern", left: { type: "Identifier", name: "b" } },
      { type: "RestElement", argument: { type: "Identifier", name: "rest" } },
    ] as never);
    const rest = formals[2]!;
    if (rest.kind !== "rest") throw new Error("expected rest formal");
    // b 有默认值 ⇒ 可省略 ⇒ 不计入必选元数
    expect(rest.arity).toEqual({ min: 1, variadic: true });
    // 非 rest 形参：**逐字不变**（没有 arity 字段）
    expect(formals[0]!).not.toHaveProperty("arity");
    expect(formals[1]!).not.toHaveProperty("arity");
  });
});

// ---------------------------------------------------------------------------
// 第 4 条：复合（合取）关系式接关系守卫
// ---------------------------------------------------------------------------

/** 取表达式 AST（测试用：把表达式包成 const 声明后取 initializer） */
function testNode(expr: string): unknown {
  const file = parseSource(`const _ = ${expr};`);
  const stmt = file.program.body[0] as unknown as {
    declarations?: Array<{ init?: unknown }>;
  };
  return stmt.declarations?.[0]?.init;
}

describe("族 60 · 第 4 条：复合关系式接关系守卫", () => {
  it("relGuardOf 认复合（合取）关系式，并带上其余合取项的界", () => {
    const guard = relGuardOf(testNode("x > 0 && x < 10"));
    expect(guard).toBeDefined();
    expect(guard!.name).toBe("x");
    expect(guard!.op).toBe("gt");
    expect(guard!.k).toBe(0);
    // 复合标记 ⇒ 补集方向必须跳过（消费方按此口径）
    expect(guard!.composite).toBe(true);
    // 其余合取项的界一并带上（事实臂同时持有两个界）
    expect(guard!.extra).toEqual([{ op: "lt", k: 10 }]);
  });

  it("relGuardOf 异名合取：每个名字各自保留自己的界（issue #185 others）", () => {
    const guard = relGuardOf(testNode("x >= 1 && y >= 2"));
    expect(guard).toBeDefined();
    expect(guard!.name).toBe("x");
    expect(guard!.op).toBe("ge");
    expect(guard!.k).toBe(1);
    expect(guard!.composite).toBe(true);
    // 旧实现只取先到的名字 ⇒ 后名 facts 丢失 ⇒ x+y 只折一侧
    expect(guard!.others).toEqual([{ name: "y", op: "ge", k: 2 }]);
    // 同名 + 异名混排：同名其余界进 extra，异名进 others
    const mixed = relGuardOf(testNode("x > 0 && x < 10 && y >= 2"));
    expect(mixed!.extra).toEqual([{ op: "lt", k: 10 }]);
    expect(mixed!.others).toEqual([{ name: "y", op: "ge", k: 2 }]);
  });

  it("负控：单一关系式的守卫逐字不变（无 composite / extra 标记）", () => {
    expect(relGuardOf(testNode("x > 0"))).toEqual({ name: "x", op: "gt", k: 0 });
    expect(relGuardOf(testNode("0 < x"))).toEqual({ name: "x", op: "gt", k: 0 });
    expect(relGuardOf(testNode("x >= 3"))).toEqual({ name: "x", op: "ge", k: 3 });
  });

  it("负控：析取（||）不接守卫（合取才蕴含；析取单项不被蕴含）", () => {
    expect(relGuardOf(testNode("x > 0 || x < 10"))).toBeUndefined();
  });

  it("端到端：复合关系式的 return 契约证得（改前判「证不出」）", () => {
    const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
export function f(x) {
  if (x > 0 && x < 10) { return x; }
  return 1;
}`);
    const r = checkSource_____index_ts("/t/bug60.js", src, pTrue_____index_ts, stdOpts);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(0);
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return").length).toBe(0);
  });

  it("负控：补集方向不接（后续路径不断言否定界 ⇒ 不假绿）", () => {
    // `¬(x > 0 && x < 10)` = `x ≤ 0 ∨ x ≥ 10` —— 不是单一关系 ⇒
    // 后续路径上**不得**断言 `x ≤ 0`（否则假绿）。
    const src = withStdImport(`/**
 * @nudo:contract x num
 * @nudo:contract return positive
 */
export function f(x) {
  if (x > 0 && x < 10) { return 1; }
  return x;
}`);
    const r = checkSource_____index_ts("/t/bug60.js", src, pTrue_____index_ts, stdOpts);
    // 后续路径**不**断言否定界（`x <= 0`）——值域仍是「任意 number」⇒
    // 声明域参数的值域已知 ⇒ `positive` 不蕴含 ⇒ 契约不成立
    // （x=0 即违约）⇒ error。**不**是「假红」：否定界没被断言，判违约的依据
    // 是「值域 ⊄ 契约域」，不是「断言了 x <= 0」。
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated").length).toBe(1);
    expect(r.issues.filter((i) => i.code === "nudo:unproven-return").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 第 5 条：absShapeForTsTypeText 的导出面现状——已单源：经
// `@nudojs/core/internal` 导出供 service 复用（不再复刻同表）；**公共面**
// 仍不收（负控钉住：internal ≠ public）
// ---------------------------------------------------------------------------

describe("族 60 · 第 5 条：absShapeForTsTypeText 不进**公共**面（负控；internal 面已单源供 service 复用）", () => {
  it("core 内部可用（TS 声明类型文本 → Abs 形状）", () => {
    expect(absShapeForTsTypeText("number")).toEqual({ k: "prim", type: "number" });
    expect(absShapeForTsTypeText("string")).toEqual({ k: "prim", type: "string" });
    expect(absShapeForTsTypeText("Array<string>")).toBeUndefined();
  });

  it("负控：公共 API 冻结面零新增（该工具不在公共导出里）", async () => {
    const pub = (await import("@nudojs/core")) as unknown as Record<string, unknown>;
    expect(pub.absShapeForTsTypeText).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// 族 65 · 第 1 条 —— Object.getOwnPropertySymbols 自有 symbol 键面
// ---------------------------------------------------------------------------
describe("族 65 · 第 1 条 —— Object.getOwnPropertySymbols 自有 symbol 键面", () => {
/**
 * 族 65 · core 剩余 6 条（BC #28 / #44 / #45 + 族 62 的 3 条）——新钉。
 *
 * 每条断言的期望值均与 **node v26.10.0 原生**逐条对拍（见各例注释里的
 * 「原生：」行；探针脚本 tmp/probe/fix-r95/W17/*.mjs 跑的是同一批源码，
 * 引擎侧与 node 侧逐值比对）。
 *
 * 覆盖面：
 * - 第 1 条 · BC #44：`Object.getOwnPropertySymbols` 的自有 symbol 键面
 * （原生：普通对象 / 数组 / 字符串 / 数字 / 函数 / Error 实例 / TA 实例 /
 * **生成器对象** ⇒ `[]`；Math / JSON / Intl / Reflect ⇒ `[Symbol.toStringTag]`）。
 * - 第 2 条 · BC #45：生成器身份面（`Object.prototype.toString.call(g())`
 * 原生 "[object Generator]"）——**不扩 Abs 形状**的部分（生成器对象仍是
 * 闭 obj；类型投影面仍与空对象同形 ⇒ 属 A 类架构债，见交回报告）。
 * - 第 3 条 · BC #28：try/catch 与控制流信号（break / continue 穿过 catch；
 * 块内早退提升不得把「后续路径的值」当函数返回值）。
 * - 第 4 条 · 族 62①：`Intl.Collator` 实例面（compare / resolvedOptions）。
 * - 第 5 条 · 族 62③：Error 的 `cause` 槽（**继承**面：原生
 * `new Error("m", Object.create({cause: 1})).cause` === 1 ⇒ 存在性确定；
 * 键不可判时读出 unknown，不得读出「确定不存在」）。
 * - 第 6 条 · 族 62④：类型化数组的元素**值**面（原生
 * `new Int8Array(["3"])[0]` === 3）。
 */




/** 结果的 shape 摘要（用于「值域」类断言） */
function shapeOf(r: unknown): string {
  const a = r as { shape?: { k?: string; elements?: unknown[]; element?: { shape?: { type?: string } } } };
  const s = a?.shape;
  if (!s) return "?";
  if (s.k === "tuple") return `tuple[${s.elements?.length ?? 0}]`;
  if (s.k === "arr") return `arr<${s.element?.shape?.type ?? "?"}>`;
  return s.k ?? "?";
}

/* ── 第 1 条 · BC #44：Object.getOwnPropertySymbols 的自有 symbol 键面 ──── */

describe("族 65 · 第 1 条 —— Object.getOwnPropertySymbols 自有 symbol 键面", () => {
  it("1.1 生成器对象 ⇒ [] （原生：Object.getOwnPropertySymbols(g()) === []）", () => {
    const r = call(
      `export function f() { function* g() { yield 1; } return Object.getOwnPropertySymbols(g()); }`,
    ).result;
    expect(tupleEls(r)).toEqual([]);
    // 无 yield 的生成器同款（原生同 [])
    const r2 = call(
      `export function f() { function* g() {} return Object.getOwnPropertySymbols(g()); }`,
    ).result;
    expect(tupleEls(r2)).toEqual([]);
  });

  it("1.2 普通对象 / 数组 / 字符串 / 数字 / 函数 / Error / TA ⇒ [] （原生同）", () => {
    for (const body of [
      `return Object.getOwnPropertySymbols({a:1});`,
      `return Object.getOwnPropertySymbols([1,2]);`,
      `return Object.getOwnPropertySymbols("ab");`,
      `return Object.getOwnPropertySymbols(1);`,
      `return Object.getOwnPropertySymbols(function f(){});`,
      `return Object.getOwnPropertySymbols(new Error("m"));`,
      `return Object.getOwnPropertySymbols(new Uint8Array([1,2]));`,
    ]) {
      expect(tupleEls(call(`export function f() { ${body} }`).result)).toEqual([]);
    }
  });

  it("1.3 宿主命名空间对象 ⇒ 1 个 symbol 键 （原生：Math ⇒ [Symbol.toStringTag]）", () => {
    const r = call(`export function f() { return Object.getOwnPropertySymbols(Math); }`).result;
    expect(shapeOf(r)).toBe("tuple[1]");
  });

  it("1.4 负控：键集不可判的接收者仍是保守 symbol[] （不折空）", () => {
    const r = call(`export function f(x) { return Object.getOwnPropertySymbols(x); }`, "f", [anyAbs_____abs_ts]).result;
    expect(shapeOf(r)).toBe("arr<symbol>");
    // A10 残余已收口：内建原型的自有 symbol 键由随值携带的键集精确给出
    // （数量随宿主 Node 版本变化，故动态对拍，不写死常量）。
    const p = call(`export function f() { return Object.getOwnPropertySymbols(Array.prototype); }`).result;
    expect(shapeOf(p)).toBe(`tuple[${Object.getOwnPropertySymbols(Array.prototype).length}]`);
  });

  it("1.5 负控：nullish 接收者定抛 TypeError （原生同）", () => {
    const r = call(`export function f() { return Object.getOwnPropertySymbols(null); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});

/* ── 第 2 条 · BC #45：生成器身份面（不扩 Abs 形状的部分） ───────────── */

describe("族 65 · 第 2 条 —— 生成器身份面", () => {
  it("2.1 Object.prototype.toString.call(g()) ⇒ \"[object Generator]\" （原生同）", () => {
    // 原生：Object.prototype.toString.call((function* g(){})()) === "[object Generator]"
    expect(
      val(`export function f() { function* g() {} return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object Generator]" });
    expect(
      val(`export function f() { function* g() { yield 1; } return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object Generator]" });
  });

  it("2.2 async 生成器 ⇒ \"[object AsyncGenerator]\" （原生同，既有口径不回归）", () => {
    expect(
      val(`export function f() { async function* g() { yield 1; } return Object.prototype.toString.call(g()); }`),
    ).toEqual({ ok: true, value: "[object AsyncGenerator]" });
  });

  it("2.3 负控：生成器对象仍无自有可枚举属性 / 无自有 symbol 键 （原生同）", () => {
    // 原生：Object.getOwnPropertyNames(g()) === []；Object.getOwnPropertySymbols(g()) === []
    expect(
      tupleEls(call(`export function f() { function* g() {} return Object.getOwnPropertyNames(g()); }`).result),
    ).toEqual([]);
    expect(
      tupleEls(call(`export function f() { function* g() {} return Object.getOwnPropertySymbols(g()); }`).result),
    ).toEqual([]);
  });
});

/* ── 第 3 条 · BC #28：try/catch 与控制流信号 ────────────────────────── */

describe("族 65 · 第 3 条 —— try/catch 与控制流信号", () => {
  it("3.1 try { break } catch {} ⇒ break 穿过 catch，外层循环退出 （原生同）", () => {
    // 原生：n === 1（break 退出 for 循环 ⇒ n++ 不再执行）
    expect(
      val(`export function f() { let n=0; for (let i=0;i<3;i++){ n++; try { break; } catch (e) {} n++; } return n; }`),
    ).toEqual({ ok: true, value: 1 });
    // 原生：out === "1"（break 前 push 已发生，break 后不再 push）
    expect(
      val(
        `export function f() { const out=[]; for (const x of [1,2,3]) { out.push(x); try { break; } catch (e) {} out.push("after"); } return out.join(","); }`,
      ),
    ).toEqual({ ok: true, value: "1" });
  });

  it("3.2 try { continue } catch {} ⇒ continue 穿过 catch （原生同）", () => {
    // 原生：n === 3（continue 跳过本轮剩余语句 ⇒ 三轮都只 n++ 一次）
    expect(
      val(`export function f() { let n=0; for (let i=0;i<3;i++){ n++; try { continue; } catch (e) {} n++; } return n; }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("3.3 try 块内的早退提升：后续路径的值不得被当成函数返回值 （原生：1）", () => {
    // 原生：let n=0; try { if (0) return 42; n++; } catch (e) {} return n; ⇒ 1
    // （此前引擎折 undefined —— 把「块内后续路径的值」当成了函数返回值）
    expect(
      val(`export function f() { let n=0; try { if (0) return 42; n++; } catch (e) {} return n; }`),
    ).toEqual({ ok: true, value: 1 });
    // 原生：try 块内测试为真 ⇒ 早退值 42
    expect(
      val(`export function f() { let n=0; try { if (1) return 42; n++; } catch (e) {} return n; }`),
    ).toEqual({ ok: true, value: 42 });
  });

  it("3.4 catch 体 / finally 体内的早退提升同口径 （原生：1 / 2）", () => {
    expect(
      val(`export function f() { let n=0; try { throw 1; } catch (e) { if (0) return 42; n++; } return n; }`),
    ).toEqual({ ok: true, value: 1 });
    expect(
      val(`export function f() { let n=0; try { n=1; } finally { if (0) return 42; n++; } return n; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("3.5 负控：函数体顶层（块外）的早退提升口径不变 （原生：1 / 42）", () => {
    expect(val(`export function f() { let n=0; if (0) return 42; n++; return n; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(val(`export function f() { let n=0; if (1) return 42; n++; return n; }`)).toEqual({
      ok: true,
      value: 42,
    });
  });
});

/* ── 第 4 条 · 族 62①：Intl.Collator 实例面 ─────────────────────────── */

describe("族 65 · 第 4 条 —— Intl.Collator 实例面", () => {
  it("4.1 compare / resolvedOptions ⇒ \"function\" （原生同）", () => {
    // 原生：typeof new Intl.Collator().compare === "function"
    expect(
      val(`export function f() { return typeof new Intl.Collator().compare; }`),
    ).toEqual({ ok: true, value: "function" });
    expect(
      val(`export function f() { return typeof new Intl.Collator().resolvedOptions; }`),
    ).toEqual({ ok: true, value: "function" });
  });

  it("4.2 负控：已建模的 Intl.NumberFormat 面不回归 （原生同）", () => {
    expect(
      val(`export function f() { return typeof new Intl.NumberFormat().format; }`),
    ).toEqual({ ok: true, value: "function" });
  });
});

/* ── 第 5 条 · 族 62③：Error 的 cause 槽（继承面） ───────────────────── */

describe("族 65 · 第 5 条 —— Error 的 cause 槽", () => {
  it("5.1 继承的 cause ⇒ 读出 unknown （不得读出「确定不存在」）", () => {
    // 原生：new Error("m", Object.create({cause: 1})).cause === 1（原型链命中）
    // 引擎口径：值不经原型链 Get 解析 ⇒ 保守 unknown；**不得**是精确 undefined
    const r = call(
      `export function f() { const o = Object.create({cause: 1}); return new Error("m", o).cause; }`,
    ).result;
    const disp = shapeOf(r);
    expect(disp).not.toBe("prim");
    const v = val(
      `export function f() { const o = Object.create({cause: 1}); return new Error("m", o).cause; }`,
    );
    expect(v.ok).toBe(false);
  });

  it("5.2 继承的 cause ⇒ 存在性确定（原生：\"cause\" in e === true）", () => {
    expect(
      val(
        `export function f() { const o = Object.create({cause: 1}); return "cause" in new Error("m", o); }`,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("5.3 自有 cause 键 ⇒ 值精确 （原生：1）", () => {
    expect(
      val(`export function f() { return new Error("m", {cause: 1}).cause; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("5.4 负控：无 options / 闭 obj 无 cause 键 ⇒ 确定无 cause 槽 （原生同）", () => {
    // 原生：new Error("m").cause === undefined；"cause" in e === false
    expect(val(`export function f() { return new Error("m").cause; }`)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(val(`export function f() { return "cause" in new Error("m"); }`)).toEqual({
      ok: true,
      value: false,
    });
    expect(val(`export function f() { return new Error("m", {a:1}).cause; }`)).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

/* ── 第 6 条 · 族 62④：类型化数组的元素值面 ─────────────────────────── */

describe("族 65 · 第 6 条 —— 类型化数组的元素值面", () => {
  it("6.1 字符串源逐元素 ToNumber ⇒ 精确值 （原生：new Int8Array([\"3\"])[0] === 3）", () => {
    expect(val(`export function f() { return new Int8Array(["3"])[0]; }`)).toEqual({
      ok: true,
      value: 3,
    });
    expect(val(`export function f() { return new Int8Array([1])[0]; }`)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("6.2 整数 TA 的取值转换（模 2^n 回绕 / 向零截断） （原生同）", () => {
    // 原生：new Uint8Array([256])[0] === 0；new Int8Array([200])[0] === -56
    expect(val(`export function f() { return new Uint8Array([256])[0]; }`)).toEqual({
      ok: true,
      value: 0,
    });
    expect(val(`export function f() { return new Int8Array([200])[0]; }`)).toEqual({
      ok: true,
      value: -56,
    });
    // 原生：new Int8Array([1.5])[0] === 1；new Uint8Array([-1])[0] === 255
    expect(val(`export function f() { return new Int8Array([1.5])[0]; }`)).toEqual({
      ok: true,
      value: 1,
    });
    expect(val(`export function f() { return new Uint8Array([-1])[0]; }`)).toEqual({
      ok: true,
      value: 255,
    });
  });

  it("6.3 浮点 / bigint 家族同口径 （原生同）", () => {
    // 原生：new Float64Array([1.5])[0] === 1.5
    expect(val(`export function f() { return new Float64Array([1.5])[0]; }`)).toEqual({
      ok: true,
      value: 1.5,
    });
    // 原生：new Float32Array([0.1])[0] === 0.10000000149011612（Float32 舍入）
    expect(val(`export function f() { return new Float32Array([0.1])[0]; }`)).toEqual({
      ok: true,
      value: 0.10000000149011612,
    });
    // 原生：new BigInt64Array([1n])[0] === 1n
    expect(val(`export function f() { return new BigInt64Array([1n])[0]; }`)).toEqual({
      ok: true,
      value: 1n,
    });
  });

  it("6.4 负控：长度形态（元素不可知）仍是元素域 ∪ undefined （不假精确）", () => {
    // 原生：new Uint8Array(3)[0] === 0，但长度形态的元素值未建模 ⇒ 保守
    const r = call(`export function f() { return new Uint8Array(3)[0]; }`).result;
    expect(val(`export function f() { return new Uint8Array(3)[0]; }`).ok).toBe(false);
    expect(r).toBeTruthy();
  });
});
});

// ---------------------------------------------------------------------------
// 具名导入的 fn 绑定保留 env 声明类型
// ---------------------------------------------------------------------------
describe("具名导入的 fn 绑定保留 env 声明类型", () => {
/**
 * 回归：env 模块的**具名导入**（`import { promisify } from "node:util"`）
 * 不得把 env 里**声明完整**的 fn 导出包成 JS 箭头 wrapper。
 *
 * 缺陷：具名导入的绑定值是 wrapper（`w = (...args) => $call(v, args)`，原 Abs 只
 * 挂在 `w.__nudoAbsFn` 上、无人读）⇒ 绑定 Abs 退化成引擎为宿主函数合成的**裸
 * fn 形状**（无 `paramTypes` / 无 `returnType`）⇒ 签名面渲染成**非法占位符**
 * `() => ?`；而**同一份 env 声明**经**命名空间导入**（槽直填原 Abs）渲染成完整
 * 的 `(CallbackFn) => PromiseFn` ⇒ 同一文件、同一导出、两种导入形态两种类型。
 *
 * 断言：
 * - 具名 / 命名空间两种导入形态给出**同一个**类型（= env 声明的类型）
 * - 渲染面不含非法占位符 `?`
 * - 调用面（`promisify(x)`）返回域 = 声明的 returnType
 * - 负控制：用户模块（桥接 Abs，无声明返回域）两种导入形态同样一致
 */



const brand = (name: string): Abs___nudojs_core_2 =>
  abs({ k: "brand", name, shape: unknown }, undefined, undefined, "path");

/** env 声明面（对齐 packages/env/src/node.ts 的 util.promisify 形态） */
const callbackFn = brand("CallbackFn");
const promiseFn = brand("PromiseFn");
const promisify = relationFn([callbackFn], promiseFn, { params: ["x"] });

const modules = {
  "node:util": { named: { promisify } },
  "./lib.js": { named: { helper: relationFn([brand("Num")], brand("Num")) } },
};

function sigOf(src: string, fn: string): string {
  const run = runTranspiled___nudojs_core(src, { mode: "analyze", modules: modules as never });
  const r = callTranspiledExportFull___nudojs_core(run, fn, []);
  return formatShape(r.result as Abs___nudojs_core_2);
}

describe("具名导入的 fn 绑定保留 env 声明类型", () => {
  const src = `
import { promisify } from "node:util";
import * as util from "node:util";
export function named() { return promisify; }
export function namespace() { return util.promisify; }
export function callIt() { return promisify(promisify); }
`;

  it("具名导入渲染 env 声明的类型（不再退化成裸 fn 的 `() => ?`）", () => {
    expect(sigOf(src, "named")).toBe("(CallbackFn) => PromiseFn");
  });

  it("具名导入与命名空间导入给出同一个类型（同一文件、同一导出、两种形态）", () => {
    const named = sigOf(src, "named");
    const namespace = sigOf(src, "namespace");
    expect(named).toBe(namespace);
    expect(named).toBe("(CallbackFn) => PromiseFn");
  });

  it("签名面不含非法占位符 `?`", () => {
    expect(sigOf(src, "named")).not.toContain("?");
  });

  it("调用面返回域 = 声明的 returnType（实参也是原 Abs，不是裸 fn）", () => {
    expect(sigOf(src, "callIt")).toBe("PromiseFn");
  });

  it("负控制：用户模块（桥接 Abs，无声明返回域）两种导入形态同样一致", () => {
    const userSrc = `
import { helper } from "./lib.js";
import * as lib from "./lib.js";
export function named() { return helper; }
export function namespace() { return lib.helper; }
`;
    const named = sigOf(userSrc, "named");
    expect(named).toBe(sigOf(userSrc, "namespace"));
    expect(named).toBe("(Num) => Num");
  });
});
});

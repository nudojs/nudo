/**
 * Bug 1157 —— 调用点的**非标量字面量实参**（函数/箭头/类表达式、`new Date(0)`、
 * 正则、`Symbol('s')`、`NaN` / `Infinity`、模板字面量、`new Map()/Set()`、
 * `void 0`）对 `number()` / `string()` / union 契约**零义务**（假绿）。
 *
 * 复现（函数体内调用，静态扫描路径）：
 *   `@nudo:contract x positive` 标在 `function u(x){return x}`
 *   `export function use(){ return u(() => 1) }`            ⇒ 0 条
 *   `export function use(){ return u(new Date(0)) }`        ⇒ 0 条
 *   `export function use(){ return u(NaN) }`                ⇒ 0 条
 * 同一实参在**顶层**调用（执行态实参回退）已报违例 ⇒ 同一个实参两种裁决。
 *
 * 根因两层：
 * 1. `scan/literal-args.ts` 的 `parseCallArgs` 只对「标量 / 对象 / 数组」字面量
 *    抽 Abs，其余形态（函数 / 箭头 / 类 / new / 正则 / 模板 / Symbol / NaN /
 *    Infinity / void）落兜底 `absUnknown()` ⇒ `hasInfo=false` ⇒
 *    `scan-literal-calls.ts` 把**整条调用点**跳过 ⇒ 契约面零义务。
 * 2. `scan/literal-shapes.ts` 的 `typeof` 通道不拆 `brand` 包装 ⇒ 即使 Abs 到了
 *    分类器（顶层执行态回退），`new Date(0)` / `/re/` / `new Map()`（brand obj）
 *    仍落 `actualPrim === undefined` ⇒ 裸 prim 契约（`positive` / `number()` /
 *    `string()`）零义务；而同一条 typeof 判据在 union 面（`literal-preds.ts` 的
 *    `typeofNameOf`）**会**拆 brand ⇒ 引擎内两套 typeof 口径。
 *
 * 修法（只在**确定**时报，宁漏勿错）：
 * - 抽取层：函数/箭头/类表达式（恒为 function）、正则（恒为对象）、模板
 *   （恒为 string）、`void`（恒为 undefined）、已知全局构造器的 `new`
 *   （恒为对象）、`Symbol(...)`（恒为 symbol）、未遮蔽的 `NaN` / `Infinity`
 *   （恒为 number 字面量）走字面量快路径；其余仍 unknown（fail-closed）。
 * - 分类器：`typeof` 通道拆 brand；`shape` 通道拆 brand（brand 的内层是对象
 *   ⇒ `shape({})` 不再把 `new Date(0)` 误报成「object shape」）。
 *
 * 本文件的行是**表驱动**的，每行只钉「确定违例 / 确定放行」两类原生事实：
 * 函数/对象/symbol/bigint 绝不是 number/string/null；`NaN` 是 number（裸
 * `number()` 放行）但 `NaN > 0` 为 false；`Infinity > 0` 为 true 而
 * `Infinity < 10` 为 false；`-Infinity` 相反。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sidecarOpts } from "./nudo-constraints.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  takeRefineDiags();
  takeInterfaceDiags();
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
  return checkSource(file, imp + src, pTrue, sidecarOpts("std.nudo", SIDE, file));
}

/** 函数体内调用（静态扫描路径 —— Bug 1157 的缺口所在） */
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

describe("Bug 1157 —— 非标量字面量实参不再静默通过数值/字符串契约", () => {
  it.each(TABLE)(
    "%s 收到 %s ⇒ %i 条违例（%s）",
    (contract, literal, want) => {
      const r = check(callInBody(contract, literal));
      expect(violations(r)).toBe(want);
    },
  );
});

describe("Bug 1157 —— 报告文案与 brand 拆壳（shape 通道不再误报 object shape）", () => {
  it("new Date(0) 撞 number().gt(0) ⇒ 文案是 typeof 义务", () => {
    const r = check(callInBody("positive", "new Date(0)"));
    const v = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toBe('typeof x = "number"');
    expect(r.ok).toBe(false);
  });

  it("箭头字面量撞 string() ⇒ 文案是 typeof x = \"string\"", () => {
    const r = check(callInBody("nonEmpty", "(() => 1)"));
    const v = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toBe('typeof x = "string"');
  });

  it("new Date(0) 撞 shape({ id }) ⇒ 报 missing field（不是 object shape 假红）", () => {
    const r = check(callInBody("idShape", "new Date(0)"));
    const v = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(v).toHaveLength(1);
    expect(String(v[0]!.expected)).toBe("missing field x.id");
  });

  it("负控制：顶层调用与函数体内调用同口径（同一实参、同一契约同条数）", () => {
    for (const [contract, literal, want] of TABLE) {
      const top = check(`/** @nudo:contract x ${contract} */
function u(x) { return x; }
export const r = u(${literal});
`);
      expect(violations(top), `${contract}(${literal}) @top`).toBe(want);
    }
  });

  it("负控制：没有契约的形参收到非标量字面量 ⇒ 零诊断（噪声来自契约，不是引擎）", () => {
    const r = check(`function u(x) { return x; }
function v(x) { return x; }
export function use() { return [u(() => 1), v(new Date(0)), u(NaN), v(new Map())]; }
`);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

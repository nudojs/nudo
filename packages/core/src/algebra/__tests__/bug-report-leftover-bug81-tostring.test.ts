/**
 * Bug 81 残留回归（第一波只修了 `${x}` 模板插值）：
 *
 * 其余 **ToString 消费点**此前仍用 **ToNumber-hint** 判据
 * （`methods.ts:toStringArgTier` 的 `prim ? "ok" : "may"`、
 * `builtins/shared.ts:mayCoerceThrowOperand`）⇒ `Date` / `Map` / 普通闭对象在
 * `String.prototype.concat/includes/indexOf/padStart/split/replace/…`、
 * `parseInt` / `parseFloat` / `Math.abs` / `isNaN` / `isFinite` / `Number` /
 * `encodeURI` / `Symbol()` / `URL.canParse` / `String.raw` 等处被假记
 * `throws TypeError`（L2 假红）。
 *
 * 修法：这些点统一改调 **ToString 分档判据** `mayToStringThrowOperand`（引擎
 * 已有、原先只服务 `String(x)` 与 `${x}`）⇒ 与 `"x" + x` / `String(x)` /
 * `${x}` 三种拼写同一裁决。
 *
 * 对照组（不得越界）：`any` 操作数与用户自定义类 brand 仍记 may（判据对
 * unknown brand / any/unknown/fn 恒 true），#119 的软通道不失效。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../diagnostics/may-throw.ts";
import { effects } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;
const wrapAny = (body: string) => `export function f(x) { ${body} }`;
const withDate = (expr: string) => wrap(`const D = new Date(0); return ${expr};`);

/** 自定义 Abs 实参的软 may-throw 收集（expr 里的形参由 args 提供）。 */
function effectsWithArgs(src: string, args: Abs[]): string[] {
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
}

/** 已知 total 的三种 operand × ToString 消费点：一律不记软 may-throw。 */
const DATE_CASES: Array<[string, string]> = [
  ["模板插值（第一波已修，作基准）", wrap("const D = new Date(0); return `at ${D}`;")],
  ["String(x)（判据原消费点，作基准）", withDate("String(D)")],
  ['"x" + x（+ 臂，作基准）', withDate('"x" + D')],
  ["String.prototype.concat", withDate('"x".concat(D)')],
  ["parseInt", withDate("parseInt(D)")],
  ["Math.abs", withDate("Math.abs(D)")],
  ["String.prototype.includes", withDate('"a".includes(D)')],
  ["String.prototype.padStart fill", withDate('"a".padStart(5, D)')],
  ["String.prototype.indexOf", withDate('"abc".indexOf(D)')],
  ["String.prototype.split separator", withDate('"a,b".split(D)')],
  ["String.prototype.localeCompare", withDate('"a".localeCompare(D)')],
  ["String.prototype.replace pattern", withDate('"abc".replace(D, "z")')],
  ["isNaN", withDate("isNaN(D)")],
  ["isFinite", withDate("isFinite(D)")],
  ["Number", withDate("Number(D)")],
  ["parseFloat", withDate("parseFloat(D)")],
  ["encodeURI", withDate("encodeURI(D)")],
  ["Symbol() description", withDate("typeof Symbol(D)")],
  ["URL.canParse", withDate("URL.canParse(D)")],
  ["String.raw substitution", withDate('String.raw({ raw: ["a", "b"] }, D)')],
];

describe("Bug 81 — ToString 消费点统一用 ToString 分档判据", () => {
  it.each(DATE_CASES)("%s：Date 不记 TypeError", (_name, src) => {
    expect(effects(src)).not.toContain("TypeError");
  });

  it.each([
    ["Map", 'const M = new Map(); return "x".concat(M);'],
    ["plain obj", 'const O = {}; return "x".concat(O);'],
  ] as const)("%s 的 concat 与模板插值同裁决（不记 TypeError）", (_name, body) => {
    expect(effects(wrap(body))).not.toContain("TypeError");
  });

  it.each([
    ["parseInt", "parseInt(M)"],
    ["Math.abs", "Math.abs(M)"],
    ["includes", '"a".includes(M)'],
    ["String()", "String(M)"],
  ] as const)("Map 在 %s 也不记 TypeError", (_name, expr) => {
    expect(effects(wrap(`const M = new Map(); return ${expr};`))).not.toContain("TypeError");
  });

  it("普通闭对象在 parseInt / Math.abs / isNaN 也不记 TypeError", () => {
    for (const expr of ["parseInt(O)", "Math.abs(O)", "isNaN(O)", "Number(O)"]) {
      expect(effects(wrap(`const O = {}; return ${expr};`)), expr).not.toContain("TypeError");
    }
  });
});

describe("Bug 81 对照组 — 打点不越界", () => {
  it("any 操作数的 Math.abs / concat 仍记 may TypeError（既定 policy）", () => {
    expect(effects(wrapAny("return Math.abs(x);"))).toContain("TypeError");
    expect(effects(wrapAny('return "x".concat(x);'))).toContain("TypeError");
  });

  it("用户自定义类 brand（toString 覆写体不可见）仍记 may TypeError", () => {
    expect(
      effects(wrap("class C {}; const c = new C(); return 'x'.concat(c);")),
    ).toContain("TypeError");
  });

  it("抽象 obj 分隔符（conf 非 exact）的 split 保守 may 面保持（Bug 13 既有钉）", () => {
    const strAbs = abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    const abstractObj = abs({ k: "obj", slots: {} }, undefined, undefined, "path");
    expect(
      effectsWithArgs(`export function f(s, sep) { return s.split(sep); }`, [strAbs, abstractObj]),
    ).toContain("TypeError");
  });
});

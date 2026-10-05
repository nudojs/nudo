/**
 * Bug 34：TaggedTemplateExpression lowering——tag`a${b}c` ≡
 * tag(GetTemplateObject, b)。此前无 case → unsupported → 模块级 opaque
 * （同文件其余签名连坐），原生 TypeError（1`x` definite / x`x` may）被吞。
 *
 * 模板对象模型（$tpl）：数字槽 cooked（无效转义 → undefined，node 实测）、
 * length 精确、.raw 数组、@@iterator 面 + 元素侧表（spread/join 精确）。
 * 调用路由：标识符 → $callNamed；obj.method → $invoke；其余 → $call
 * （callee 校验在 Bug 2 修复位）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  anyAbs,
  formatAbs,
  transpile,
} from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../exec/may-throw.ts";

function evalSrc(
  src: string,
  fnName = "f",
  args: unknown[] = [],
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result ?? $lit(undefined)),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

const prelude = `
function tag(s, v) { return s[0] + v + s.raw[1]; }
function rawCount(s, ...vs) { return s.raw.length + ":" + vs.length; }
function quasis(s) { return s.length; }
`;

describe("Bug 34: tagged template lowering", () => {
  it("transpiles to $tpl + call routing（不再 unsupported）", () => {
    const out = transpile(`export function f(t) { return t\`a\${1}b\`; }`);
    expect(out).toContain("$tpl(");
    expect(out).toContain("$callNamed(");
    expect(transpile(`export function g() { return (1)\`x\`; }`)).toContain("$call(");
    expect(transpile(`export function h(o) { return o.t\`x\`; }`)).toContain("$invoke(");
  });

  it("known tag：cooked / raw / substitutions / length 全精确（native 对齐）", () => {
    const src = prelude + `
export function a() { return tag\`x\${1}y\`; }
export function b() { return rawCount\`p\${1}q\${2}r\`; }
export function c() { return quasis\`a\${1}b\${2}c\`; }
`;
    expect(evalSrc(src, "a").value).toBe('"x1y"');
    expect(evalSrc(src, "b").value).toBe('"3:2"');
    expect(evalSrc(src, "c").value).toBe("3");
  });

  it("无效转义：cooked 是 undefined、raw 保留原文（node 实测对齐）", () => {
    const src = `
function c0(s) { return s[0]; }
function r0(s) { return s.raw[0]; }
function cUndef(s) { return s[0] === undefined; }
export function q1() { return c0\`\\u\`; }
export function q2() { return r0\`\\u\`; }
export function q3() { return cUndef\`\\u\`; }
`;
    expect(evalSrc(src, "q1").value).toBe("undefined");
    expect(evalSrc(src, "q2").value).toBe('"\\\\u"');
    expect(evalSrc(src, "q3").value).toBe("true");
  });

  it("非函数字面量标签 → definite TypeError（native: 1 is not a function）", () => {
    expect(evalSrc(`export function f() { return 1\`x\`; }`).throws).toContain("TypeError");
    expect(evalSrc(`export function f() { return null\`x\`; }`).throws).toContain("TypeError");
  });

  it("any 标签 → may TypeError（值域 unknown）", () => {
    const r = evalSrc(`export function g(x) { return x\`x\`; }`, "g", [anyAbs]);
    expect(r.effects).toContain("TypeError");
    expect(r.throws).not.toContain("TypeError");
  });

  it("同文件其余签名不再被 opaque 连坐", () => {
    const src = `
export function bad() { return 1\`x\`; }
export function h() { return 42; }
export function i() { return \`x\`; }
`;
    expect(evalSrc(src, "h").value).toBe("42");
    expect(evalSrc(src, "i").value).toBe('"x"');
  });

  it("表达式 / 成员 / 绑定标签形态", () => {
    const src = `
function tag(s, v) { return s[0] + v + s.raw[1]; }
const NS = { t: (s) => s.raw[0] };
export function e() { return (function () { return 1; })\`x\`; }
export function j() { return NS.t\`ab\`; }
export function m() { const t = tag; return t\`q\${2}w\`; }
`;
    expect(evalSrc(src, "e").value).toBe("1");
    expect(evalSrc(src, "j").value).toBe('"ab"');
    expect(evalSrc(src, "m").value).toBe('"q2w"');
  });

  it("模板对象可迭代面：[...s] 精确（不再假 may-symbol）", () => {
    const src = `
function iterTag(s) { return [...s].join("|"); }
function spreadLen(s) { return [...s].length; }
export function d() { return iterTag\`mn\${3}\`; }
export function dl() { return spreadLen\`mn\${3}\`; }
`;
    const d = evalSrc(src, "d");
    // 字面量元组 join 精确折叠（原生 ToString 语义）；
    // 关键是元素精确后不再记 may-symbol join TypeError
    expect(d.value).toBe('"mn|"');
    expect(d.throws).not.toContain("TypeError");
    expect(d.effects).not.toContain("TypeError");
    // [...s] 元素 = quasis（"mn"、"")：长度精确 2（原生同）
    expect(evalSrc(src, "dl").value).toBe("2");
  });
});

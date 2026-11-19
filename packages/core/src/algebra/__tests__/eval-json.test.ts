/**
 * JSON.parse / JSON.stringify 折叠与失败 THROW：
 * 此前 evalJsonMethod 恒返回 unknown（parse）/ strPrim（stringify）——
 * 字面量实参不折叠、非法输入不抛：
 * - JSON.parse('{bad') 原生 SyntaxError，evaluator 静默成功 → catch 不进入，
 * r 保持旧值（假精确）
 * - JSON.stringify(1n) 原生 TypeError，同样被静默吞掉
 * - JSON.parse('{"a":1}').a 原生 1，evaluator 折 unknown（精度缺口）
 * 修复：字面量实参真执行（JSON 值 ↔ Abs 双向折叠）；语法失败硬抛
 * NudoThrow(SyntaxError)、序列化失败硬抛 NudoThrow(TypeError)——
 * evaluator catch 经 $catchVal 吸收，ast-eval 在 namespace 调用点吸收为
 * EvalResult{threw}。抽象实参保持保守（parse → unknown，stringify →
 * strPrim）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../diagnostics/may-throw.ts";

describe("evaluator JSON.parse folding", () => {
  it("folds literal object/array/primitive results", () => {
    expect(litValue(call(`export function f() { return JSON.parse('{"a":1}').a; }`).result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return JSON.parse('[1,2,3]').length; }`).result)).toEqual({ ok: true, value: 3 });
    expect(litValue(call(`export function f() { return JSON.parse('[1,2,3]')[1]; }`).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return JSON.parse('42'); }`).result)).toEqual({ ok: true, value: 42 });
    expect(litValue(call(`export function f() { return JSON.parse('"hi"'); }`).result)).toEqual({ ok: true, value: "hi" });
    expect(litValue(call(`export function f() { return JSON.parse('true'); }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return JSON.parse('null'); }`).result)).toEqual({ ok: true, value: null });
    expect(litValue(call(`export function f() { return JSON.parse('{"a":[1,{"b":2}]}').a[1].b; }`).result)).toEqual({ ok: true, value: 2 });
  });

  it("__proto__ key is an own data property, not prototype pollution", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = JSON.parse('{"__proto__":{"p":1}}'); return o.p === undefined && "toString" in o; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it("ToStrings non-string literal args (JSON.parse(42) ≡ 42)", () => {
    expect(litValue(call(`export function f() { return JSON.parse(42); }`).result)).toEqual({ ok: true, value: 42 });
    expect(litValue(call(`export function f() { return JSON.parse(true); }`).result)).toEqual({ ok: true, value: true });
  });
});

describe("evaluator JSON.parse invalid input throws SyntaxError", () => {
  it("malformed literal string is caught", () => {
    for (const src of [
      `export function f() { try { JSON.parse('{bad'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse('nope'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse(''); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse('null x'); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse(); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { JSON.parse(undefined); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toEqual({ ok: true, value: "caught" });
    }
  });

  it("uncaughced parse failure interrupts with SyntaxError", () => {
    const r = call(`export function f() { return JSON.parse('{bad'); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });
});

describe("evaluator JSON.stringify folding", () => {
  it("folds literal values", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({a:1}); }`).result)).toEqual({ ok: true, value: '{"a":1}', });
    expect(litValue(call(`export function f() { return JSON.stringify([1,2]); }`).result)).toEqual({ ok: true, value: "[1,2]", });
    expect(litValue(call(`export function f() { return JSON.stringify(null); }`).result)).toEqual({ ok: true, value: "null" });
    expect(litValue(call(`export function f() { return JSON.stringify(42); }`).result)).toEqual({ ok: true, value: "42" });
    expect(litValue(call(`export function f() { return JSON.stringify('x'); }`).result)).toEqual({ ok: true, value: '"x"' });
    expect(litValue(call(`export function f() { return JSON.stringify(true); }`).result)).toEqual({ ok: true, value: "true" });
  });

  it("NaN/Infinity serialize as null; sparse holes too", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({a:NaN}); }`).result)).toEqual({ ok: true, value: '{"a":null}', });
    expect(litValue(call(`export function f() { return JSON.stringify({a:Infinity}); }`).result)).toEqual({ ok: true, value: '{"a":null}', });
    expect(litValue(call(`export function f() { return JSON.stringify([1,,3]); }`).result)).toEqual({ ok: true, value: "[1,null,3]", });
  });

  it("undefined/function slots are skipped; top-level undefined stays undefined", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({a:undefined,b:1}); }`).result)).toEqual({ ok: true, value: '{"b":1}', });
    expect(litValue(call(`export function f() { return JSON.stringify([undefined,null,1]); }`).result)).toEqual({ ok: true, value: "[null,null,1]", });
    const r = call(`export function f() { return JSON.stringify(undefined); }`);
    const t = r.result as unknown as { term?: { op: string; value: unknown } };
    expect(t.term?.op).toBe("lit");
    expect(t.term?.value).toBe(undefined);
  });

  it("respects literal space/replacer args", () => {
    expect(litValue(call(`export function f() { return JSON.stringify({x:1},null,2); }`).result)).toEqual({ ok: true, value: '{\n  "x": 1\n}', });
    expect(litValue(call(`export function f() { return JSON.stringify({a:1,b:2},['a']); }`).result)).toEqual({ ok: true, value: '{"a":1}', });
    expect(litValue(call(`export function f() { return JSON.stringify({a:1},null,'\\t'); }`).result)).toEqual({ ok: true, value: '{\n\t"a": 1\n}', });
    // 非数组非函数的 replacer 原生忽略（照常序列化）
    expect(litValue(call(`export function f() { return JSON.stringify({a:1},5); }`).result)).toEqual({ ok: true, value: '{"a":1}', });
    expect(litValue(call(`export function f() { return JSON.stringify({a:1},null); }`).result)).toEqual({ ok: true, value: '{"a":1}', });
  });

  it("reviver arg stays conservative (per-key transform unmodeled)", () => {
    expect(
      litValue(
        call(
          `export function f() { return JSON.parse('{"a":1}', (k,v) => k === 'a' ? 9 : v).a; }`,
        ).result,
      ),
    ).toEqual({ ok: false });
    expect(
      litValue(call(`export function f() { return JSON.parse('5', (k,v) => v + 1); }`).result),
    ).toEqual({ ok: false });
  });

  it("skips non-enumerable slots (defineProperty descriptor honored)", () => {
    expect(
      litValue(
        call(
          `export function f() { const o = {}; Object.defineProperty(o, 'x', {value: 1, enumerable: false}); return JSON.stringify(o); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "{}" });
    expect(
      litValue(
        call(
          `export function f() { const o = {}; Object.defineProperty(o, 'x', {value: 1, enumerable: false}); o.y = 2; return JSON.stringify(o); }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: '{"y":2}' });
  });

  it("stringify bigint throws TypeError (catchable)", () => {
    expect(
      litValue(call(`export function f() { try { JSON.stringify(1n); } catch(e) { return 'caught'; } return 'missed'; }`).result),
    ).toEqual({ ok: true, value: "caught" });
    const r = call(`export function f() { return JSON.stringify(1n); }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("abstract args stay conservative", () => {
    const src = `export function f(x) { return JSON.parse(x); }`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const x = { shape: { k: "prim", type: "string" }, conf: "path" } as never;
    expect(litValue(callTranspiledExportFull(exports, "f", [x]).result)).toEqual({ ok: false });
  });
});

/**
 * 联合（sum）实参的 total 判定。
 *
 * 值面早已精确（`pair() => 1 | 2`，conf exact），throws 面却把**每个成员都
 * 可证明 total** 的联合一律记 `may-throw TypeError`（诊断文案里的三个由头
 * ——BigInt 成员 / 循环引用 / 抛错 toJSON——对 `1 | 2` 一个都不成立）⇒ 合法
 * 序列化 helper 被判 L2 假红。根因是 `jsonStringifyTotal` 逐分支处理
 * lit / prim / tuple / arr / brand / obj，**没有 sum 组合臂**。
 *
 * 不变量（正反两面一起钉住）：
 * - 联合的 total 性 = 成员逐个 total ⇒ `1 | 2` / `"a" | "b"`、对象字段位、
 *   数组元素位都不记 may-throw（值域仍是 `string` partial，不伪装精确）；
 * - 成员里真带着 BigInt 的联合照旧记 may（原生 `JSON.stringify(1n)` 定抛）；
 * - 环 / 抛错 toJSON 仍按既有判据记（定抛面：never + throws）。
 */
describe("JSON.stringify union (sum) argument totality", () => {
  /** union 探针：无约束实参（缺省会绑成 undefined 字面量 ⇒ `x ? a : b` 只走一支） */
  const anyArg = { shape: { k: "any" }, conf: "path" } as never;

  /** 调用导出 f（实参 any），收集 may-throw 效果的 kind 面 */
  function effectsOf(src: string): string[] {
    const exports = runTranspiled(src, { mode: "analyze" });
    const eff: MayThrowEffect[] = [];
    runWithMayThrowSession(() => {
      setMayThrowCollector((e) => eff.push(e));
      try {
        callTranspiledExportFull(exports, "f", [anyArg]);
      } catch {
        /* 入口整抛：效果经 throws 面表达 */
      }
      setMayThrowCollector(null);
    });
    return [...new Set(eff.map((e) => e.kind))];
  }

  it("每个成员都是 prim 的联合 ⇒ 不记 TypeError；BigInt 成员 / 环 / 抛错 toJSON 仍记", () => {
    // 四个合法形态：direct 分支值 / 三元 / 对象字段位 / 数组元素位
    for (const src of [
      `export function f(x) { let v; if (x) v = 1; else v = 2; return JSON.stringify(v); }`,
      `export function f(x) { return JSON.stringify(x ? "a" : "b"); }`,
      `export function f(x) { let v; if (x) v = 1; else v = 2; return JSON.stringify({ x: v }); }`,
      `export function f(x) { let v; if (x) v = "a"; else v = "b"; return JSON.stringify([v]); }`,
    ]) {
      expect(effectsOf(src), src).toEqual([]);
    }
  });

  it("合法联合的值域仍是 string（partial，不伪装精确）；入口不是 never", () => {
    const r = call(`export function f(x) { let v; if (x) v = 1; else v = 2; return JSON.stringify(v); }`, "f", [
      anyArg,
    ]);
    expect(isNever(r.result)).toBe(false);
    expect((r.result as { shape?: unknown }).shape).toMatchObject({ k: "prim", type: "string" });
  });

  it("含 BigInt 的联合照旧记 TypeError（原生 JSON.stringify(1n) 定抛）", () => {
    expect(
      effectsOf(`export function f(x) { let v; if (x) v = 1n; else v = 2n; return JSON.stringify(v); }`),
    ).toContain("TypeError");
    // 混型联合：一支 BigInt、一支 number ⇒ 仍可能抛
    expect(
      effectsOf(`export function f(x) { let v; if (x) v = 1n; else v = 1; return JSON.stringify(v); }`),
    ).toContain("TypeError");
    // 嵌套位同款：联合带 BigInt 成员时对象字段位不得被放过
    expect(
      effectsOf(`export function f(x) { let v; if (x) v = 1n; else v = 2n; return JSON.stringify({ x: v }); }`),
    ).toContain("TypeError");
  });

  it("循环引用 / 抛错 toJSON 的既有判据不回归（仍是定抛面）", () => {
    const cyc = call(`export function f() { const o = {}; o.self = o; return JSON.stringify(o); }`);
    expect(isNever(cyc.result)).toBe(true);
    expect(throwsError(cyc.throws, "TypeError")).toBe(true);

    const throwing = call(
      `export function f() { return JSON.stringify({ toJSON() { throw new Error("boom"); } }); }`,
    );
    expect(isNever(throwing.result)).toBe(true);
    expect(throwsError(throwing.throws, "Error")).toBe(true);
  });
});


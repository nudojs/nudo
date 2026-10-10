/**
 * $new 宿主构造器分派补 case 回归：TextDecoder / URLSearchParams 此前
 * 落到空 brand 兜底（479-480 行）——构造参数零校验（new TextDecoder("bad-$$")
 * 假成功、new URLSearchParams([["a"]]) 假成功，L2 漏报）。
 * 修复：按 Map/Set/URL 同口径派发——确定非法实参硬抛 NudoThrow、未知
 * ASCII 形 label / 抽象实参保守 recordMayThrow、字面量真构造带槽 brand。
 * ground truth：node 原生实测（native 是 ground truth）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, abs, checkSource } from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

/** 无约束实参（may 档探针——缺省会把 x 绑成 undefined 字面量而走折叠面） */
const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

/** 无约束实参版：f(x) 的 x 绑 any（may 档探针） */
function evalSrcAny(src: string): ReturnType<typeof evalSrc> {
  return evalSrc(src, [anyAbs]);
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

/** resultShape（已是 shape）的 k——definite throw 折 never */
function shapeK(r: { resultShape: unknown }): string {
  return (r.resultShape as { k?: string } | undefined)?.k ?? "?";
}

/** 值 + throws + may-effects 三面（effects 去重 kind）；args 传入 f 的实参 */
function evalSrc(
  src: string,
  args: unknown[] = [],
  fnName = "f",
): { value: unknown; throws: unknown; effects: string[]; resultShape: unknown } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    value: litValue(result.result as never),
    throws: result.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
    resultShape: (result.result as { shape?: unknown } | undefined)?.shape,
  };
}

describe("new TextDecoder(label?)：encoding label 校验", () => {
  it("不可能字符 label → definite RangeError（native：new TextDecoder('bad-$$') 抛）", () => {
    for (const src of [
      `export function f() { return new TextDecoder("bad-$$").encoding; }`,
      `export function f() { return new TextDecoder("bad label!").encoding; }`,
      `export function f() { return new TextDecoder("la bel").encoding; }`,
    ]) {
      const r = evalSrc(src);
      expect(shapeK(r), src).toBe("never");
      expect(throwsError(r.throws, "RangeError"), src).toBe(true);
    }
    // 可捕获（catch 形参面走 throws 通道）
    expect(
      litValue(call(`export function f() { try { new TextDecoder("bad-$$"); } catch (e) { return e instanceof RangeError ? "range" : "other"; } return "missed"; }`).result),
    ).toEqual({ ok: true, value: "range" });
  });

  it("知名 label 正常构造（canonical encoding 槽精确折叠）", () => {
    const cases: [string, string][] = [
      ["utf-8", "utf-8"],
      ["utf8", "utf-8"],
      ["unicode-1-1-utf-8", "utf-8"],
      ["UTF-8", "utf-8"],
      [" utf-8 ", "utf-8"], // WHATWG：strip 首尾 ASCII 空白
      ["utf-16le", "utf-16le"],
      ["utf-16be", "utf-16be"],
      ["iso-8859-1", "windows-1252"],
      ["latin1", "windows-1252"],
      ["windows-1252", "windows-1252"],
      ["ascii", "windows-1252"],
      ["us-ascii", "windows-1252"],
    ];
    for (const [label, encoding] of cases) {
      expect(
        litValue(call(`export function f() { return new TextDecoder("${label}").encoding; }`).result),
        label,
      ).toEqual({ ok: true, value: encoding });
    }
  });

  it("缺省 / undefined 字面量 ≡ 默认 utf-8（WebIDL default，node 实测）", () => {
    expect(litValue(call(`export function f() { return new TextDecoder().encoding; }`).result))
      .toEqual({ ok: true, value: "utf-8" });
    expect(litValue(call(`export function f() { return new TextDecoder(undefined).encoding; }`).result))
      .toEqual({ ok: true, value: "utf-8" });
  });

  it("未知 ASCII 形 label → may RangeError（宿主 label 表有差异，不折 definite）", () => {
    // node 实测 "x-custom-enc"/"utf_8" 抛 RangeError，但 `_` 在 label 字符集内、
    // 表项随宿主 ICU 有差异 → 保守 may（不折 definite）
    for (const label of ["x-custom-enc", "utf_8"]) {
      const r = evalSrc(`export function f() { return new TextDecoder("${label}").encoding; }`);
      expect(r.effects, label).toContain("RangeError");
      expect(shapeK(r), label).not.toBe("never"); // 构造面保持 string 域
    }
    // 非 string 字面量 ToString 折叠后同判：123 → "123"
    const r2 = evalSrc(`export function f() { return new TextDecoder(123).encoding; }`);
    expect(r2.effects).toContain("RangeError");
  });

  it("symbol label → definite TypeError（ToString(symbol)）", () => {
    const r = evalSrc(`export function f() { return new TextDecoder(Symbol()).encoding; }`);
    expect(shapeK(r)).toBe("never");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("抽象 label → may RangeError；check L2 gate 记 entry-may-throw", () => {
    const may = evalSrcAny(`export function f(x) { return new TextDecoder(x).encoding; }`);
    expect(may.effects).toContain("RangeError");
    const rep = checkSource(
      "/t/host-ctor-textdecoder.js",
      `export function f(x) { return new TextDecoder(x).encoding; }`,
    );
    expect(
      rep.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "f"),
    ).toBe(true);
  });
});

describe("new URLSearchParams(init?)：序列实参校验", () => {
  it("非二元组 tuple 元素 → definite TypeError（native：([['a']]) 抛）", () => {
    for (const src of [
      `export function f() { return new URLSearchParams([["a"]]).toString(); }`,
      `export function f() { return new URLSearchParams([["a", "b", "c"]]).toString(); }`,
      `export function f() { return new URLSearchParams(["a"]).toString(); }`,
      `export function f() { return new URLSearchParams([42]).toString(); }`,
      `export function f() { return new URLSearchParams([[]]).toString(); }`,
    ]) {
      const r = evalSrc(src);
      expect(shapeK(r), src).toBe("never");
      expect(throwsError(r.throws, "TypeError"), src).toBe(true);
    }
    expect(
      litValue(call(`export function f() { try { new URLSearchParams([["a"]]); } catch (e) { return e instanceof TypeError ? "type" : "other"; } return "missed"; }`).result),
    ).toEqual({ ok: true, value: "type" });
  });

  it("string 字面量 / 合法二元组 / nullish / ToString 可析字面量正常构造", () => {
    for (const src of [
      `export function f() { return new URLSearchParams("a=1").toString(); }`,
      `export function f() { return new URLSearchParams([["a", "b"], ["c", "d"]]).toString(); }`,
      `export function f() { return new URLSearchParams().toString(); }`,
      `export function f() { return new URLSearchParams(null).toString(); }`,
      `export function f() { return new URLSearchParams(42).toString(); }`, // native: [["42",""]]
      `export function f() { return new URLSearchParams({ a: 1 }).toString(); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.effects, src).toEqual([]); // 恒 total，无误报 may
      expect(shapeK(r), src).not.toBe("never");
    }
  });

  it("二元组 name/value 的 symbol → definite TypeError（ToString）", () => {
    const r = evalSrc(`export function f() { return new URLSearchParams([["a", Symbol()]]).toString(); }`);
    expect(shapeK(r)).toBe("never");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("开放数组 / 抽象元素 / 抽象 init → may TypeError；Map brand 恒合法", () => {
    // tuple 内抽象元素：可能是二元组也可能不是 → may
    expect(evalSrcAny(`export function f(x) { return new URLSearchParams([x]).toString(); }`).effects)
      .toContain("TypeError");
    // Map brand 条目恒二元组 → 不误报
    expect(evalSrc(`export function f() { return new URLSearchParams(new Map([["a", "b"]])).toString(); }`).effects)
      .toEqual([]);
  });

  it("抽象 init → may TypeError；check L2 gate 记 entry-may-throw", () => {
    const may = evalSrcAny(`export function f(x) { return new URLSearchParams(x).toString(); }`);
    expect(may.effects).toContain("TypeError");
    const rep = checkSource(
      "/t/host-ctor-urlsearchparams.js",
      `export function f(x) { return new URLSearchParams(x).toString(); }`,
    );
    expect(
      rep.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "f"),
    ).toBe(true);
  });
});

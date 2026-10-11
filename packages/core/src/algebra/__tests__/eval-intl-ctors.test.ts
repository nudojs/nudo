/**
 * Bug 44 回归：Intl 命名空间完全未建模——`typeof Intl` → engine unknown、
 * `Intl.NumberFormat` 未知成员读 → unknown callee → `$new` unknown 路径
 * （`new Intl.NumberFormat("bad-locale-$$")` 假成功，L2 漏报原生 RangeError）。
 *
 * 修复：Intl 入 NAMESPACE_GLOBALS（身份路由 + env-skip + typeof 折 object），
 * NumberFormat / DateTimeFormat 为带 locale 校验的构造器值
 * （makeIntlCtorAbs / makeIntlFormatAbs）。ground truth：node 原生实测
 * （native 是 ground truth；畸形 tag / null / 数组项形态见各用例注释）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, abs, checkSource } from "@nudojs/core";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

/** 无约束实参（may 档探针——缺省会把 x 绑成 undefined 字面量而走默认面） */
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

/** 构造产物 brand 名（Intl.<Sub> 实例面） */
function brandName(r: { resultShape: unknown }): string {
  return (r.resultShape as { name?: string } | undefined)?.name ?? "?";
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

describe("typeof Intl 面（Bug 44：命名空间此前 engine unknown）", () => {
  it("typeof Intl → exact 'object'（native: object）", () => {
    expect(litValue(call(`export function f() { return typeof Intl; }`).result))
      .toEqual({ ok: true, value: "object" });
  });

  it("typeof Intl.NumberFormat / Intl.DateTimeFormat → exact 'function'", () => {
    expect(litValue(call(`export function f() { return typeof Intl.NumberFormat; }`).result))
      .toEqual({ ok: true, value: "function" });
    expect(litValue(call(`export function f() { return typeof Intl.DateTimeFormat; }`).result))
      .toEqual({ ok: true, value: "function" });
  });
});

describe("new Intl.NumberFormat(locales?)：locale 校验", () => {
  it("畸形 locale 字面量 → definite RangeError（native：bad-locale-$$ 等全抛）", () => {
    for (const tag of [
      "bad-locale-$$", // 不可能字符
      "", // 空串
      "en-", // 尾 '-'
      "en_US", // 下划线
      "123", // 纯数字语言子标签
      "x-private", // 纯私有用（Intl 要 unicode_language_id）
      "en-US-Hans", // region 后再 script（顺序不合）
    ]) {
      const r = evalSrc(`export function f() { return new Intl.NumberFormat("${tag}"); }`);
      expect(shapeK(r), tag).toBe("never");
      expect(throwsError(r.throws, "RangeError"), tag).toBe(true);
    }
    // 可捕获（catch 形参面走 throws 通道）
    expect(
      litValue(call(`export function f() { try { new Intl.NumberFormat("bad-locale-$$"); } catch (e) { return e instanceof RangeError ? "range" : "other"; } return "missed"; }`).result),
    ).toEqual({ ok: true, value: "range" });
    // 构造器值重绑后 $new 仍按名派发（fn name "Intl.NumberFormat"）
    expect(
      litValue(call(`export function f() { const NF = Intl.NumberFormat; try { new NF("bad-locale-$$"); } catch (e) { return e instanceof RangeError ? "range" : "other"; } return "missed"; }`).result),
    ).toEqual({ ok: true, value: "range" });
  });

  it("合形 locale（含未知 tag 'zz'）→ 正常构造 Intl.NumberFormat brand（native 不抛）", () => {
    for (const tag of ["en", "en-US", "zz", "zh-Hans", "en-US-u-nu-latn", "EN-us"]) {
      const r = evalSrc(`export function f() { return new Intl.NumberFormat("${tag}"); }`);
      expect(shapeK(r), tag).toBe("brand");
      expect(brandName(r), tag).toBe("Intl.NumberFormat");
      expect(r.effects, tag).toEqual([]);
    }
    // 缺省 → 默认 locale（native OK）
    const d = evalSrc(`export function f() { return new Intl.NumberFormat(); }`);
    expect(shapeK(d)).toBe("brand");
    expect(brandName(d)).toBe("Intl.NumberFormat");
  });

  it("非 string 字面量：number/bigint/symbol/undefined → array-like 空表默认 locale（node 实测不抛）；null → definite TypeError（ToObject）", () => {
    for (const src of [
      `export function f() { return new Intl.NumberFormat(123); }`,
      `export function f() { return new Intl.NumberFormat(10n); }`,
      `export function f() { return new Intl.NumberFormat(Symbol("x")); }`,
      `export function f() { return new Intl.NumberFormat(undefined); }`,
    ]) {
      const r = evalSrc(src);
      expect(shapeK(r), src).toBe("brand");
      expect(r.effects, src).toEqual([]);
    }
    const n = evalSrc(`export function f() { return new Intl.NumberFormat(null); }`);
    expect(shapeK(n)).toBe("never");
    expect(throwsError(n.throws, "TypeError")).toBe(true);
  });

  it("tuple locale 数组：合法项构造 / 畸形项 RangeError / 非 string/object 项 TypeError（node 实测）", () => {
    const ok = evalSrc(`export function f() { return new Intl.NumberFormat(["en", "zz"]); }`);
    expect(shapeK(ok)).toBe("brand");
    expect(ok.effects).toEqual([]);

    const bad = evalSrc(`export function f() { return new Intl.NumberFormat(["bad-$$"]); }`);
    expect(shapeK(bad)).toBe("never");
    expect(throwsError(bad.throws, "RangeError")).toBe(true);

    // Language ID should be string or object（native TypeError）
    const mixed = evalSrc(`export function f() { return new Intl.NumberFormat(["en", 5]); }`);
    expect(shapeK(mixed)).toBe("never");
    expect(throwsError(mixed.throws, "TypeError")).toBe(true);
  });

  it("调用面（new 省略形）Intl.NumberFormat(locales) 同口径（native：≡ new）", () => {
    const bad = evalSrc(`export function f() { return Intl.NumberFormat("bad-locale-$$"); }`);
    expect(shapeK(bad)).toBe("never");
    expect(throwsError(bad.throws, "RangeError")).toBe(true);
    const ok = evalSrc(`export function f() { return Intl.NumberFormat("en"); }`);
    expect(shapeK(ok)).toBe("brand");
    expect(brandName(ok)).toBe("Intl.NumberFormat");
  });

  it("抽象 locale → may RangeError + 保守构造；check L2 gate 记 entry-may-throw", () => {
    const may = evalSrcAny(`export function f(x) { return new Intl.NumberFormat(x); }`);
    expect(may.effects).toContain("RangeError");
    expect(shapeK(may)).toBe("brand"); // may 臂保守构造（不折 never）
    const rep = checkSource(
      "/t/intl-ctors-numberformat.js",
      `export function f(x) { return new Intl.NumberFormat(x); }`,
    );
    expect(
      rep.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "f"),
    ).toBe(true);
  });
});

describe("new Intl.DateTimeFormat(locales?)：与 NumberFormat 同口径", () => {
  it("畸形 locale 字面量 → definite RangeError（native：bad-locale-$$ 抛）", () => {
    for (const tag of ["bad-locale-$$", "", "en_US", "123", "x-private"]) {
      const r = evalSrc(`export function f() { return new Intl.DateTimeFormat("${tag}"); }`);
      expect(shapeK(r), tag).toBe("never");
      expect(throwsError(r.throws, "RangeError"), tag).toBe(true);
    }
    expect(
      litValue(call(`export function f() { try { new Intl.DateTimeFormat("bad-locale-$$"); } catch (e) { return e instanceof RangeError ? "range" : "other"; } return "missed"; }`).result),
    ).toEqual({ ok: true, value: "range" });
  });

  it("合形 locale → 正常构造 Intl.DateTimeFormat brand", () => {
    for (const tag of ["en", "en-US", "zz", "zh-Hans", "en-US-u-nu-latn"]) {
      const r = evalSrc(`export function f() { return new Intl.DateTimeFormat("${tag}"); }`);
      expect(shapeK(r), tag).toBe("brand");
      expect(brandName(r), tag).toBe("Intl.DateTimeFormat");
      expect(r.effects, tag).toEqual([]);
    }
  });

  it("null → definite TypeError；number 字面量 → 默认 locale 构造（node 实测）", () => {
    const n = evalSrc(`export function f() { return new Intl.DateTimeFormat(null); }`);
    expect(shapeK(n)).toBe("never");
    expect(throwsError(n.throws, "TypeError")).toBe(true);
    const num = evalSrc(`export function f() { return new Intl.DateTimeFormat(123); }`);
    expect(shapeK(num)).toBe("brand");
    expect(num.effects).toEqual([]);
  });

  it("抽象 locale → may RangeError + 保守构造；check L2 gate 记 entry-may-throw", () => {
    const may = evalSrcAny(`export function f(x) { return new Intl.DateTimeFormat(x); }`);
    expect(may.effects).toContain("RangeError");
    expect(shapeK(may)).toBe("brand");
    const rep = checkSource(
      "/t/intl-ctors-datetimeformat.js",
      `export function f(x) { return new Intl.DateTimeFormat(x); }`,
    );
    expect(
      rep.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "f"),
    ).toBe(true);
  });
});

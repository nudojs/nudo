/**
 * Wave 10 回归：String.prototype / RegExp / Date 家族的实参强转 + 值域。
 * 覆盖 bug-report 24/29/42/52/57/62/69/72/75：
 * - new Date(v) ToPrimitive/ToNumber 校验（symbol/bigint 确定抛——node 实测
 * new Date(1n) 抛 TypeError，与 bug 文本一致）；
 * - new RegExp(pattern/flags) ToString 校验（symbol 确定抛；1n pattern 合法）；
 * - RegExp.prototype.test/exec subject ToString 校验（三派发面：evalRegExpMethod /
 * execRegexBrand / $reStateCall）；
 * - String.prototype 搜索/替换/分隔/拼接/填充实参 + 位置实参（ToIntegerOrInfinity）
 * + startsWith/endsWith/includes 的 IsRegExp 守卫；
 * - localeCompare/normalize/substr/toLocaleUpperCase/toLocaleLowerCase/
 * trimStart/trimEnd 值域建模（normalize 非法 form → RangeError；
 * localeCompare 非法 language tag → RangeError、null → TypeError）；
 * - Date.prototype getter/setter/toString 族值域 + setter ToNumber 校验。
 * 基准：node v26 原生语义（native 是 ground truth）。
 * throws 面：definite NudoThrow → result=never + throws=TypeError；
 * may → 值域不变 + effects 含 kind（L2 门在 effects 上）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  abs,
  checkSource,
  formatShape,
  pTrue,
  str,
} from "@nudojs/core";
import { l2Count, sigOf } from "./nudo-constraints.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../diagnostics/may-throw.ts";
import { throwsError } from "./eval-helpers.ts";

/** 无约束实参（may 档探针——缺省会把 x 绑成 undefined 字面量而走折叠面） */
const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

/** 无约束实参版：f(x) 的 x 绑 any（may 档探针） */
function evalSrcAny(src: string): ReturnType<typeof evalSrc> {
  return evalSrc(src, [anyAbs]);
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

describe("new Date(v) argument coercion", () => {
  it("symbol/bigint values definite-throw TypeError (node: new Date(1n) throws)", () => {
    expect(throwsError(evalSrc(`export function f() { return new Date(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return new Date(1n); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return new Date(BigInt(5)); }`).throws, "TypeError")).toBe(true);
  });

  it("multi-arg form validates each argument", () => {
    expect(throwsError(evalSrc(`export function f() { return new Date(2020, Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return new Date(2020, 0, 1n); }`).throws, "TypeError")).toBe(true);
  });

  it("abstract arg may-throw; legal args total", () => {
    const may = evalSrcAny(`export function f(x) { return new Date(x); }`);
    expect(may.effects).toContain("TypeError");
    expect((may.value as { ok: boolean }).ok).toBe(false); // brand 不可折
    for (const src of [
      `export function f() { return new Date(1); }`,
      `export function f() { return new Date(null); }`,
      `export function f() { return new Date("2020-01-01"); }`,
      `export function f() { return new Date(undefined); }`,
      `export function f() { return new Date(new Date(5)); }`,
      `export function f() { return new Date(2020, 0, 1); }`,
    ]) {
      const r = evalSrc(src);
      expect(r.effects, src).toEqual([]);
      // throws 面 = never Abs（而非 undefined）
      expect((r.throws as { shape?: { k?: string; name?: string } } | undefined)?.shape, src).toMatchObject({ k: "never" });
    }
  });
});

describe("new RegExp(pattern, flags) coercion", () => {
  it("symbol pattern/flags definite-throw", () => {
    expect(throwsError(evalSrc(`export function f() { return new RegExp(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return new RegExp("a", Symbol()); }`).throws, "TypeError")).toBe(true);
  });

  it("abstract pattern/flags may-throw TypeError", () => {
    expect(evalSrcAny(`export function f(x) { return new RegExp(x); }`).effects).toContain("TypeError");
    expect(evalSrcAny(`export function f(x) { return new RegExp("a", x); }`).effects).toContain("TypeError");
  });

  it("controls: bigint pattern legal; lit flags validated; valid flags exact", () => {
    expect(evalSrc(`export function f() { return new RegExp(1n); }`).effects).toEqual([]);
    expect(throwsError(evalSrc(`export function f() { return new RegExp("a", "x"); }`).throws, "SyntaxError")).toBe(true);
    expect(evalSrc(`export function f() { return new RegExp("a", "g"); }`).effects).toEqual([]);
    expect(evalSrc(`export function f() { return new RegExp("a", undefined); }`).effects).toEqual([]);
    expect(evalSrc(`export function f() { return new RegExp("a"); }`).effects).toEqual([]);
  });
});

describe("RegExp.prototype.test/exec subject ToString", () => {
  it("symbol subject definite-throws on all faces", () => {
    expect(throwsError(evalSrc(`export function f() { return /a/.test(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return /a/.exec(Symbol()); }`).throws, "TypeError")).toBe(true);
    // 语句级（$reStateCall 写回面）
    expect(throwsError(evalSrc(`export function f() { const re = /a/g; re.test(Symbol()); return re.lastIndex; }`).throws, "TypeError")).toBe(true);
  });

  it("abstract subject may-throw; coercible lits total", () => {
    expect(evalSrcAny(`export function f(x) { return /a/.test(x); }`).effects).toContain("TypeError");
    expect(evalSrcAny(`export function f(x) { return /a/.exec(x); }`).effects).toContain("TypeError");
    for (const src of [
      `export function f() { return /a/.test(1); }`,
      `export function f() { return /a/.test(null); }`,
      `export function f() { return /a/.test(1n); }`,
    ]) {
      expect(evalSrc(src).effects, src).toEqual([]);
    }
  });
});

describe("Date.prototype methods", () => {
  it("setter symbol/bigint args definite-throw; abstract may-throw", () => {
    expect(throwsError(evalSrc(`export function f() { const d = new Date(); return d.setTime(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { const d = new Date(); return d.setTime(1n); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { const d = new Date(); return d.setFullYear(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { const d = new Date(); return d.setMonth(Symbol()); }`).throws, "TypeError")).toBe(true);
    const may = evalSrcAny(`export function f(x) { const d = new Date(); return d.setTime(x); }`);
    expect(may.effects).toContain("TypeError");
    expect((may.value as { ok: boolean }).ok && typeof (may.value as { value: unknown }).value === "number").toBe(false);
  });

  it("getters/toString family value domain; setter returns number; args on getters ignored", () => {
    expect(evalSrc(`export function f() { const d = new Date(); return d.getTime(); }`).effects).toEqual([]);
    expect(evalSrc(`export function f() { const d = new Date(); return d.getFullYear(); }`).value).toEqual({ ok: false });
    expect(evalSrc(`export function f() { const d = new Date(); return d.getTime(Symbol()); }`).effects).toEqual([]);
    expect(evalSrc(`export function f() { const d = new Date(); return d.setTime(5); }`).value).toEqual({ ok: false });
    // toISOString/toJSON → 保守 string prim（具体时间值不可知，不折不假报）
    const iso = evalSrc(`export function f() { const d = new Date(); return d.toISOString(); }`);
    expect((iso.resultShape as { k?: string; type?: string })).toMatchObject({ k: "prim", type: "string" });
    expect(evalSrc(`export function f() { const d = new Date(); return d.toJSON(); }`).effects).toEqual([]);
  });
});

/**
 * 零参 `new Date()` 的 time value 面：**值未知但恒合法**。
 *
 * 规范保证当前时间落在 ±8.64e15 ms 内 ⇒ 零参构造恒不是 Invalid Date ⇒
 * `toISOString()` 恒不抛 `RangeError`、`toJSON()` 恒返回字符串。此前零参
 * 不设 time-value facet、与「可能 Invalid 的抽象 Date」共用 may 档 ⇒
 * 合法且最常见的「取当前时间 ISO 串」被判 L2 假红，同一表达式的返回域
 * 同时被放宽成 `string | null`。
 *
 * 判据是**实参个数**：`new Date(undefined)` / `new Date(NaN)`（Invalid）与
 * `new Date(ms)`（精确）的行为都不得改变。
 */
describe("zero-arg new Date() is a known-valid time value", () => {
  it("零参 new Date()：toISOString/toJSON 都不记 RangeError（值域 string）", () => {
    const iso = evalSrc(`export function f() { return new Date().toISOString(); }`);
    expect(iso.effects).toEqual([]);
    expect(iso.resultShape).toMatchObject({ k: "prim", type: "string" });

    const json = evalSrc(`export function f() { return new Date().toJSON(); }`);
    expect(json.effects).toEqual([]);
    expect(json.resultShape).toMatchObject({ k: "prim", type: "string" });

    // 域收窄的可观察后果：零参 Date 的 toJSON 恒不是 null（原生同）
    expect(evalSrc(`export function f() { const d = new Date(); return d.toJSON() === null; }`).value)
      .toEqual({ ok: true, value: false });
  });

  it("Invalid Date 仍判 RangeError；toJSON 仍是 null 字面量", () => {
    expect(throwsError(evalSrc(`export function f() { return new Date(undefined).toISOString(); }`).throws, "RangeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return new Date(NaN).toISOString(); }`).throws, "RangeError")).toBe(true);
    expect(evalSrc(`export function f() { return new Date(undefined).toJSON(); }`).value).toEqual({ ok: true, value: null });
    expect(evalSrc(`export function f() { return new Date(NaN).toJSON(); }`).value).toEqual({ ok: true, value: null });
  });

  it("对照：new Date(v) 的既有精确行为不变", () => {
    expect(evalSrc(`export function f() { return new Date(0).toISOString(); }`).value)
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.000Z" });
    expect(evalSrc(`export function f() { return new Date(null).toISOString(); }`).value)
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.000Z" });
    expect(evalSrc(`export function f() { return new Date(5).toISOString(); }`).value)
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.005Z" });
    expect(evalSrc(`export function f() { return new Date("2020-01-01").toISOString(); }`).value)
      .toEqual({ ok: true, value: "2020-01-01T00:00:00.000Z" });
  });

  it("setter 之后合法性标记作废（setTime 能造出 Invalid Date ⇒ 回落 may 档）", () => {
    // 起点 tv 未知 ⇒ setter 结果合法性不可判定：不得沿用「恒合法」标记
    const after = evalSrc(`export function f() { const d = new Date(); d.setTime(0); return d.toISOString(); }`);
    expect(after.effects).toContain("RangeError");
    // 对照：tv 已知的 Date 经 setter 仍精确（既有行为）
    expect(evalSrc(`export function f() { const d = new Date(0); d.setTime(5); return d.toISOString(); }`).value)
      .toEqual({ ok: true, value: "1970-01-01T00:00:00.005Z" });
  });

  it("内部标记槽不进用户可观察面（自有键 / 枚举 / JSON 投影不变）", () => {
    expect(evalSrc(`export function f() { return JSON.stringify(Object.keys(new Date())); }`).value)
      .toEqual({ ok: true, value: "[]" });
    expect(evalSrc(`export function f() { return Object.getOwnPropertyNames(new Date()).length; }`).value)
      .toEqual({ ok: true, value: 0 });
    expect(evalSrc(`export function f() { return Object.prototype.hasOwnProperty.call(new Date(), "[[ValidTimeValue]]"); }`).value)
      .toEqual({ ok: true, value: false });
  });
});

describe("String.prototype arg coercion (search/replace/split/concat/pad/repeat)", () => {
  it("symbol args definite-throw TypeError on every surface", () => {
    for (const src of [
      `export function f() { return "a".startsWith(Symbol()); }`,
      `export function f() { return "a".endsWith(Symbol()); }`,
      `export function f() { return "a".includes(Symbol()); }`,
      `export function f() { return "a".indexOf(Symbol()); }`,
      `export function f() { return "a".lastIndexOf(Symbol()); }`,
      `export function f() { return "a".concat(Symbol()); }`,
      `export function f() { return "a".split(Symbol()); }`,
      `export function f() { return "a".replace("a", Symbol()); }`,
      `export function f() { return "a".replace(Symbol(), "b"); }`,
      `export function f() { return "a".padStart(Symbol()); }`,
      `export function f() { return "a".padEnd(Symbol()); }`,
      `export function f() { return "a".repeat(Symbol()); }`,
      `export function f() { return "a".search(Symbol()); }`,
      `export function f() { return "a".match(Symbol()); }`,
      `export function f() { return "a".matchAll(Symbol()); }`,
      `export function f() { return "a".split("a", Symbol()); }`,
      `export function f() { return "a".split("a", 1n); }`,
    ]) {
      expect(throwsError(evalSrc(src).throws, "TypeError"), src).toBe(true);
    }
  });

  it("abstract args may-throw TypeError, value domain unchanged", () => {
    for (const src of [
      `export function f(x) { return "a".startsWith(x); }`,
      `export function f(x) { return "a".split(x); }`,
      `export function f(x) { return "a".replace("a", x); }`,
      `export function f(x) { return "a".padStart(x); }`,
      `export function f(x) { return "a".repeat(x); }`,
    ] as const) {
      const r = evalSrcAny(src);
      expect(r.effects, src).toContain("TypeError");
      // may 档：值域不折 never（throws 面仍为 never Abs，无 error brand）
      expect((r.throws as { shape?: { k?: string; name?: string } } | undefined)?.shape, src).toMatchObject({ k: "never" });
    }
  });

  it("controls: bigint concat folds; extra replace args ignored; undefined separator special case", () => {
    expect(evalSrc(`export function f() { return "a".concat(1n); }`).value).toEqual({ ok: true, value: "a1" });
    expect(evalSrc(`export function f() { return "a".replace("a", "b", 1); }`).value).toEqual({ ok: true, value: "b" });
    expect(evalSrc(`export function f() { return "hello".split(); }`).effects).toEqual([]);
  });
});

describe("startsWith/endsWith/includes IsRegExp guard", () => {
  it("RegExp argument definite-throws before ToString", () => {
    expect(throwsError(evalSrc(`export function f() { return "a".startsWith(/x/); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "a".endsWith(/x/); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "a".includes(/x/); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "a".startsWith(new RegExp("x")); }`).throws, "TypeError")).toBe(true);
  });

  it("control: string arg folds true", () => {
    expect(evalSrc(`export function f() { return "a".startsWith("a"); }`).value).toEqual({ ok: true, value: true });
    expect(evalSrc(`export function f() { return "a".startsWith("b"); }`).value).toEqual({ ok: true, value: false });
  });
});

describe("localeCompare/normalize/substr/toLocale*/trim* value domain", () => {
  it("literal calls fold via host", () => {
    expect(evalSrc(`export function f() { return "abc".substr(-2); }`).value).toEqual({ ok: true, value: "bc" });
    expect(evalSrc(`export function f() { return "abc".substr(1); }`).value).toEqual({ ok: true, value: "bc" });
    expect(evalSrc(`export function f() { return "abc".substr(1, null); }`).value).toEqual({ ok: true, value: "" });
    expect(evalSrc(`export function f() { return "abc".normalize(); }`).value).toEqual({ ok: true, value: "abc" });
    expect(evalSrc(`export function f() { return "abc".normalize("NFC"); }`).value).toEqual({ ok: true, value: "abc" });
    expect(evalSrc(`export function f() { return "abc".normalize(undefined); }`).value).toEqual({ ok: true, value: "abc" });
    expect(evalSrc(`export function f() { return " abc ".trimStart(); }`).value).toEqual({ ok: true, value: "abc " });
    expect(evalSrc(`export function f() { return " abc ".trimEnd(); }`).value).toEqual({ ok: true, value: " abc" });
    expect(evalSrc(`export function f() { return "ABC".toLocaleLowerCase(); }`).value).toEqual({ ok: true, value: "abc" });
    expect(evalSrc(`export function f() { return "abc".toLocaleUpperCase(); }`).value).toEqual({ ok: true, value: "ABC" });
    const lc = evalSrc(`export function f() { return "x".localeCompare("y"); }`);
    expect((lc.value as { ok: boolean; value: number }).ok && typeof (lc.value as { value: number }).value === "number").toBe(true);
    expect(lc.effects).toEqual([]);
  });

  it("normalize invalid form definite RangeError; symbol TypeError; abstract may", () => {
    expect(throwsError(evalSrc(`export function f() { return "abc".normalize("badform"); }`).throws, "RangeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "abc".normalize(1n); }`).throws, "RangeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "abc".normalize(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(evalSrcAny(`export function f(x) { return "abc".normalize(x); }`).effects).toEqual(
      expect.arrayContaining(["TypeError", "RangeError"]),
    );
  });

  it("localeCompare arg coercion + locales validation", () => {
    expect(throwsError(evalSrc(`export function f() { return "x".localeCompare(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "x".localeCompare("a", "b"); }`).throws, "RangeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "x".localeCompare("a", null); }`).throws, "TypeError")).toBe(true);
    expect(evalSrc(`export function f() { return "x".localeCompare("y", "en"); }`).effects).toEqual([]);
    expect(evalSrc(`export function f() { return "x".localeCompare("y", Symbol()); }`).effects).toEqual([]);
  });

  it("substr position args validated; toLocale* args ignored (node: Symbol() OK)", () => {
    expect(throwsError(evalSrc(`export function f() { return "abc".substr(Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(throwsError(evalSrc(`export function f() { return "abc".substr(1, Symbol()); }`).throws, "TypeError")).toBe(true);
    expect(evalSrc(`export function f() { return "ABC".toLocaleUpperCase(Symbol()); }`).value).toEqual({ ok: true, value: "ABC" });
    expect(evalSrc(`export function f() { return "ABC".toLocaleLowerCase(Symbol()); }`).value).toEqual({ ok: true, value: "abc" });
  });

  it("template receivers stay conservative string/number", () => {
    expect(evalSrcAny(`export function f(x) { return \`\${x}\`.trimStart(); }`).value).toEqual({ ok: false });
    expect(evalSrcAny(`export function f(x) { return \`\${x}\`.localeCompare("y"); }`).value).toEqual({ ok: false });
  });
});

describe("position args ToIntegerOrInfinity validation", () => {
  it("symbol/bigint position args definite-throw on every surface", () => {
    for (const src of [
      `export function f() { return "a".charAt(Symbol()); }`,
      `export function f() { return "a".charAt(1n); }`,
      `export function f() { return "a".charCodeAt(Symbol()); }`,
      `export function f() { return "a".charCodeAt(1n); }`,
      `export function f() { return "abc".codePointAt(Symbol()); }`,
      `export function f() { return "abc".codePointAt(1n); }`,
      `export function f() { return "a".slice(Symbol()); }`,
      `export function f() { return "abc".slice(1n); }`,
      `export function f() { return "a".substring(Symbol()); }`,
      `export function f() { return "a".at(Symbol()); }`,
      `export function f() { return "abc".at(1n); }`,
      `export function f() { return "a".includes("a", Symbol()); }`,
      `export function f() { return "a".includes("a", 1n); }`,
      `export function f() { return "a".startsWith("a", Symbol()); }`,
      `export function f() { return "a".endsWith("a", Symbol()); }`,
      `export function f() { return "a".indexOf("a", Symbol()); }`,
      `export function f() { return "a".lastIndexOf("a", 1n); }`,
    ]) {
      expect(throwsError(evalSrc(src).throws, "TypeError"), src).toBe(true);
    }
  });

  it("abstract position args may-throw, values stay conservative", () => {
    for (const src of [
      `export function f(x) { return "a".charAt(x); }`,
      `export function f(x) { return "a".slice(x); }`,
      `export function f(x) { return "a".includes("a", x); }`,
      `export function f(x) { return "a".indexOf("a", x); }`,
    ]) {
      const r = evalSrcAny(src);
      expect(r.effects, src).toContain("TypeError");
      expect((r.throws as { shape?: { k?: string; name?: string } } | undefined)?.shape, src).toMatchObject({ k: "never" });
    }
  });

  it("codePointAt value domain (previously unknown): literal fold + OOB undefined", () => {
    expect(evalSrc(`export function f() { return "abc".codePointAt(1); }`).value).toEqual({ ok: true, value: 98 });
    expect(evalSrc(`export function f() { return "abc".codePointAt(9); }`).value).toEqual({ ok: true, value: undefined });
    const abs = evalSrcAny(`export function f(x) { return "abc".codePointAt(x); }`);
    expect(abs.value).toEqual({ ok: false }); // number | undefined 并集
  });

  it("controls: coercible literals total and fold (NaN→0, '2', null, negative at)", () => {
    expect(evalSrc(`export function f() { return "a".charAt("x"); }`).value).toEqual({ ok: true, value: "a" });
    expect(evalSrc(`export function f() { return "a".charAt(null); }`).value).toEqual({ ok: true, value: "a" });
    expect(evalSrc(`export function f() { return "a".indexOf("a", "2"); }`).value).toEqual({ ok: true, value: -1 });
    expect(evalSrc(`export function f() { return "abc".at(-1); }`).value).toEqual({ ok: true, value: "c" });
    expect(evalSrc(`export function f() { return "abc".at(true); }`).value).toEqual({ ok: true, value: "b" });
  });
});

// ---------------------------------------------------------------------------
// BUG-341：String.prototype.match 的抽象接收者结果域（global vs 非 global）
// ---------------------------------------------------------------------------
describe("BUG-341：String.match 抽象接收者的结果域", () => {
  function check(src: string) {
    return checkSource("/t/b341.js", src, pTrue, {});
  }
  const SRC = `
export function matchFull(s: string) { const m = s.match(/a(b)/); return m ? m[0].length : 0; }
export function matchGlobal(s: string) { const m = s.match(/a/g); return m ? m[0].length : 0; }
export function matchCap(s: string) { const m = s.match(/a(b)/); return m ? m[1] : ""; }
export function matchIdx(s: string) { const m = s.match(/a(b)/); return m ? m.index : -1; }
`;

  it("非 global / global 的 m[0].length 都不记假 TypeError（m[0] 恒 string）", () => {
    const r = check(SRC);
    expect(l2Count(r, "matchFull")).toBe(0);
    expect(l2Count(r, "matchGlobal")).toBe(0);
    expect(sigOf(r, "matchFull")).toMatch(/^(number \| 0|0 \| number)$/);
    expect(sigOf(r, "matchGlobal")).toMatch(/^(number \| 0|0 \| number)$/);
  });

  it("捕获组 m[1] 仍是 string | undefined（只有整匹配被排除）", () => {
    const r = check(SRC);
    expect(sigOf(r, "matchCap")).toMatch(/undefined/);
    expect(sigOf(r, "matchCap")).toMatch(/string/);
  });

  it("Abs probe：非 global 是 per-index 槽（\"0\": string），global 是 string[]", () => {
    const sAbs = str();
    const resultOf = (src: string) => {
      const run = runTranspiled(src, { mode: "analyze" });
      return (callTranspiledExportFull(run, "f", [sAbs] as never) as { result: unknown }).result;
    };
    const full = formatShape(resultOf(`export function f(s) { return s.match(/a(b)/); }`) as never);
    expect(full).toContain('"0": string');
    expect(full).not.toContain('"0": string | undefined');
    expect(full).toContain('"1": string | undefined');
    const global = formatShape(resultOf(`export function f(s) { return s.match(/a/g); }`) as never);
    expect(global).toContain("string[]");
    expect(global).not.toContain('"0"');
  });
});

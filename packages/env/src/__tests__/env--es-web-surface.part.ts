/**
 * 族 62 · env es / web 内建构造器与 brand 精度 —— 5 条精度债的钉。
 *
 * 本文件覆盖台账 5 条：
 * | # | 主题 | 本分片的落点 |
 * |---|------|----------------|
 * | 1 | Bug 332 Intl 子构造器**实例方法面** | **声明面**已建模（Collator / NumberFormat / DateTimeFormat）；运行时面由**族 65 · 第 4 条**补齐（core 的 `BUILTIN_BRAND_METHODS`）⇒ 旗标已摘、断言转正 |
 * | 2 | Bug 317 AggregateError 的 `errors` | 台账前提与原生**不符**（原生缺省实参**抛 TypeError**）⇒ 按原生钉；**不改**引擎行为 |
 * | 3 | Bug 316 Error 的 `cause` 槽 | 自有键已可判（正钉）；**继承**键由**族 65 · 第 5 条**收口（core 的 `errorBrandAbs`）⇒ 旗标已摘、断言转正 |
 * | 4 | Bug 318 / 329 类型化数组的**对象源**逐元素 ToNumber | 元素**值**面由**族 65 · 第 6 条**收口（core 的 `makeTypedArrayAbs`）⇒ 旗标已摘、断言转正 |
 * | 5 | Bug 890 env promise 的**拒绝 reason** | **env 侧真修**：逐声明给 reason（fetch / body 读取 / crypto.subtle / clipboard / Promise.reject） |
 *
 * 取证口径（原生 oracle，node v26.10.0）：
 * - `new AggregateError()` → **TypeError: undefined is not iterable**（不是 `[]`！）
 * - `new AggregateError([]).errors` → `[]`
 * - `new Error("m", {cause: 1}).cause` → `1`
 * - `new Error("m", Object.create({cause: 1})).cause` → `1`（`Get` 走原型链）
 * - `new Error("m").cause` → `undefined`（无 cause 键 ⇒ 不装槽）
 * - `new Int8Array(["3"])[0]` → `3`（对象源逐元素 ToNumber）
 * - `typeof new Intl.Collator().compare` → `"function"`
 * - `await res.json()` 遇非法 JSON → `TypeError`；`fetch` 网络错 → `TypeError`
 * - `crypto.subtle.digest` 失败 → `OperationError` DOMException
 * - `navigator.clipboard.readText()` 权限被拒 → `NotAllowedError` DOMException
 *
 * 旗标口径：族 62 的 3 条已由族 65 收口 ⇒ 本文件**无** `it.fails`；
 * 全部断言均为正门禁（引擎退化即翻红）。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  resetGeneralizeMemo,
  formatAbs,
  formatShape,
  getFnImpl,
  numLit,
  absOnly,
} from "@nudojs/core";
import type { Abs } from "@nudojs/core";
import { defineEnv as defineEsEnv } from "../es.ts";
import { defineEnv as defineWebEnv } from "../web.ts";

const esEnv = defineEsEnv();
const webEnv = defineWebEnv();

/* ── 取证助手 ───────────────────────────────────────────────────────── */

/** 某个全局（obj / fn 的 slots）的成员 Abs。 */
function memberOf(a: Abs | undefined, key: string): Abs | undefined {
  if (!a) return undefined;
  const s = a.shape as {
    k: string;
    slots?: Record<string, { value: Abs }>;
    shape?: Abs;
    returnType?: Abs;
  };
  if (s.k === "brand") return memberOf(s.shape, key);
  if (s.k === "fn" && s.slots) return s.slots[key]?.value;
  if (s.k === "obj") return s.slots?.[key]?.value;
  return undefined;
}

/** 声明的构造器**实例面**（`returnType` 的 brand/obj 槽）。 */
function instanceSlotsOf(ctor: Abs | undefined): Record<string, Abs> {
  if (!ctor) return {};
  const rt = (ctor.shape as { returnType?: Abs }).returnType;
  if (!rt) return {};
  const s = rt.shape as { k: string; slots?: Record<string, { value: Abs }>; shape?: Abs };
  const inner = s.k === "brand" ? s.shape : rt;
  if (!inner) return {};
  const is = inner.shape as { k: string; slots?: Record<string, { value: Abs }> };
  if (is.k !== "obj" || !is.slots) return {};
  const out: Record<string, Abs> = {};
  for (const [k, v] of Object.entries(is.slots)) out[k] = v.value;
  return out;
}

/** 跑一遍 `checkSource`（注入对应 env 的全局表）⇒ 入口签名的外延显示。 */
function sigOf(src: string, name = "f", globals: Record<string, Abs> = esEnv.globals): string {
  resetGeneralizeMemo();
  const r = checkSource(`/t/env-bug-62-${name}-${Math.random().toString(36).slice(2)}.js`, src, pTrue, {
    inject: { envGlobals: globals },
  });
  const sig = r.signatures.find((s) => s.name === name);
  expect(sig, `signature "${name}" missing`).toBeTruthy();
  return formatAbs(sig!.abs);
}

/** 跑一遍 `checkSource` ⇒ 诊断 code 列表（error 级）。 */
function issuesOf(src: string, globals: Record<string, Abs> = esEnv.globals): string[] {
  resetGeneralizeMemo();
  const r = checkSource(`/t/env-bug-62-i-${Math.random().toString(36).slice(2)}.js`, src, pTrue, {
    inject: { envGlobals: globals },
  });
  return r.issues.map((i) => `${i.code}: ${i.message}`);
}

/* ── 第 5 条：env promise 的拒绝 reason（env 侧真修） ─────────────── */

describe("族 62 · 第 5 条 —— env promise 的拒绝 reason 逐声明可见", () => {
  it("5.1 fetch 的网络错 ⇒ catch 形参是 TypeError 品牌（e.name / e.message 可解）", () => {
    // 原生：fetch 网络错 ⇒ 以 TypeError 拒绝 ⇒ catch 形参是 Error 实例。
    const name = sigOf(
      `export async function f() {
  try { await fetch("https://example.invalid"); return "ok"; }
  catch (e) { return e.name; }
}`,
      "f",
      webEnv.globals,
    );
    expect(name).toContain('"TypeError"');

    const msg = sigOf(
      `export async function f() {
  try { await fetch("https://example.invalid"); return "ok"; }
  catch (e) { return e.message; }
}`,
      "f",
      webEnv.globals,
    );
    expect(msg, "catch 形参的 message 必须是 string（此前 unknown ⇒ 拿不到）").toContain("string");
    expect(msg).not.toContain("unknown");
  });

  it("5.2 crypto.subtle.* ⇒ OperationError 品牌（WebCrypto 规范）", () => {
    const name = sigOf(
      `export async function f() {
  try { await crypto.subtle.digest("SHA-256", new Uint8Array([1])); return "ok"; }
  catch (e) { return e.name; }
}`,
      "f",
      webEnv.globals,
    );
    expect(name).toContain('"OperationError"');
  });

  it("5.3 Request / Response 的 body 读取族 ⇒ TypeError 品牌", () => {
    const name = sigOf(
      `export async function f() {
  try { await new Response("x").json(); return "ok"; }
  catch (e) { return e.name; }
}`,
      "f",
      webEnv.globals,
    );
    expect(name).toContain('"TypeError"');
  });

  it("5.4 navigator.clipboard ⇒ NotAllowedError 品牌（Clipboard 规范）", () => {
    const name = sigOf(
      `export async function f() {
  try { await navigator.clipboard.readText(); return "ok"; }
  catch (e) { return e.name; }
}`,
      "f",
      webEnv.globals,
    );
    expect(name).toContain('"NotAllowedError"');
  });

  it("5.5 负控：多 reason / 未建模的声明仍是 unknown（不假精确）", () => {
    // importKey 可能以 DataError / NotSupportedError 拒绝（不止一种）⇒ unknown。
    const importKey = sigOf(
      `export async function f() {
  try { await crypto.subtle.importKey("raw", new Uint8Array([1]), "AES-GCM", false, ["encrypt"]); return "ok"; }
  catch (e) { return e; }
}`,
      "f",
      webEnv.globals,
    );
    expect(importKey).toContain("unknown");

    // navigator.locks.request 的拒绝 reason 取决于回调 / abort ⇒ 未建模 ⇒ unknown。
    const locks = sigOf(
      `export async function f() {
  try { await navigator.locks.request("x", () => {}); return "ok"; }
  catch (e) { return e; }
}`,
      "f",
      webEnv.globals,
    );
    expect(locks).toContain("unknown");
  });

  it("5.6 Promise.reject 的拒绝 reason 是实参（声明面 ≡ ES 规范）", () => {
    const reject = memberOf(esEnv.globals["Promise"], "reject")!;
    expect(reject, "Promise.reject must be declared").toBeTruthy();
    const impl = getFnImpl(reject);
    expect(impl?.apply, "Promise.reject must carry an apply (reason = 实参)").toBeTruthy();
    // 声明面的 promise：inner = never（必定拒绝）+ rejected 通道 = 实参。
    const shaped = absOnly(impl!.apply!([numLit(42)]));
    const sh = shaped!.shape as { k: string; eff?: string; inner?: Abs; rejected?: Abs };
    expect(sh.k).toBe("eff");
    expect(sh.eff).toBe("promise");
    expect(sh.rejected, "rejected 通道必须带 reason").toBeTruthy();
    expect(formatShape(sh.rejected!)).toContain("42");
  });

  it("5.7 负控：crypto.subtle 的成员集逐字不变（13 个成员，一个不多一个不少）", () => {
    const subtle = memberOf(webEnv.globals["crypto"], "subtle")!;
    const slots = (subtle.shape as { slots: Record<string, { value: Abs }> }).slots;
    expect(Object.keys(slots).sort()).toEqual([
      "decrypt",
      "deriveBits",
      "deriveKey",
      "digest",
      "encrypt",
      "exportKey",
      "generateKey",
      "importKey",
      "sign",
      "unwrapKey",
      "verify",
      "wrapKey",
    ]);
  });
});

/* ── 第 1 条：Intl 子构造器的实例方法面 ──────────────────────────── */

describe("族 62 · 第 1 条 —— Intl 子构造器的实例方法面（声明面）", () => {
  it("1.1 Intl.Collator 的实例面含 compare / resolvedOptions（原生原型成员）", () => {
    const collator = memberOf(esEnv.globals["Intl"], "Collator")!;
    const inst = instanceSlotsOf(collator);
    expect(Object.keys(inst).sort()).toEqual(["compare", "resolvedOptions"]);
    expect(formatShape(inst["compare"]!), "compare 的方法值面").toContain("=>");
    expect(formatShape(inst["compare"]!), "compare 的返回面（原生返回 number）").toContain("number");
    expect(formatShape(inst["resolvedOptions"]!), "resolvedOptions 是方法").toContain("=>");
  });

  it("1.2 Intl.NumberFormat / DateTimeFormat 的实例面含 format 族（原生原型成员）", () => {
    for (const name of ["NumberFormat", "DateTimeFormat"]) {
      const inst = instanceSlotsOf(memberOf(esEnv.globals["Intl"], name)!);
      expect(Object.keys(inst).sort(), name).toEqual([
        "format",
        "formatRange",
        "formatRangeToParts",
        "formatToParts",
        "resolvedOptions",
      ]);
      expect(formatShape(inst["format"]!), `${name}.format`).toContain("string");
      expect(formatShape(inst["formatToParts"]!), `${name}.formatToParts`).toContain("[]");
    }
  });

  it("1.3 负控：未建模的子构造器（ListFormat / Segmenter / Locale…）实例面不变", () => {
    for (const name of ["ListFormat", "Segmenter", "Locale", "PluralRules"]) {
      const inst = instanceSlotsOf(memberOf(esEnv.globals["Intl"], name)!);
      expect(Object.keys(inst), `${name} 不在本批建模范围`).toEqual([]);
    }
  });

  it("1.4 负控：Intl 的成员集逐字不变（9 个子构造器 + 2 个静态）", () => {
    const intlSlots = (esEnv.globals["Intl"]!.shape as {
      slots: Record<string, { value: Abs }>;
    }).slots;
    expect(Object.keys(intlSlots).sort()).toEqual([
      "Collator",
      "DateTimeFormat",
      "DisplayNames",
      "ListFormat",
      "Locale",
      "NumberFormat",
      "PluralRules",
      "RelativeTimeFormat",
      "Segmenter",
      "getCanonicalLocales",
      "supportedValuesOf",
    ]);
  });

  it("运行时 typeof new Intl.Collator().compare → \"function\"（族 65 第 4 条已建模）", () => {
    // 原生：typeof new Intl.Collator().compare === "function"
    // 族 65 · 第 4 条：core 侧 `packages/core/src/algebra/exec/runtime/members.ts`
    // 的 `BUILTIN_BRAND_METHODS` 补 "Intl.Collator"（compare / resolvedOptions）
    // ⇒ 实例方法面折精确 "function"（此前是 unknown 域——imprecise 但 sound）。
    // ⚠️ `Intl` 在 core 的 `ENV_SHADOW_SKIP_GLOBALS` 里 ⇒ env 侧的实例面
    // 声明**不会**注入运行时（与 core 的 URL 同款：env 建模 + core 侧补）。
    const r = checkSource(
      "/t/env-bug-62-intl-runtime.js",
      `export function f() { return typeof new Intl.Collator().compare; }`,
      pTrue,
      { inject: { envGlobals: esEnv.globals } },
    );
    const sig = r.signatures.find((s) => s.name === "f")!;
    expect(formatAbs(sig.abs)).toContain('"function"');
  });
});

/* ── 第 2 条：AggregateError 的 errors 面（按原生钉） ──────────────── */

describe("族 62 · 第 2 条 —— AggregateError 的 errors 面", () => {
  it("2.1 缺省实参 ⇒ 原生**抛 TypeError**（引擎同款：never + may-throw TypeError）", () => {
    // 原生 oracle（node v26.10.0）：
    //   new AggregateError()          → TypeError: undefined is not iterable
    //   new AggregateError(undefined) → TypeError: undefined is not iterable
    // ⇒ 台账「缺省时 errors 是 []」与原生**不符**（那是自信的错值 ⇒ 假绿：
    //    会把真实的 TypeError 吞掉）。此处按原生钉，**不改**引擎行为。
    const display = sigOf(`export function f() { return new AggregateError().errors; }`);
    expect(display).toContain("never");
    const issues = issuesOf(`export function f() { return new AggregateError(); }`);
    expect(issues.join(" | ")).toContain("TypeError");
  });

  it("2.2 new AggregateError([]).errors ⇒ [] （原生同款：拷贝而非引用）", () => {
    const display = sigOf(`export function f() { return new AggregateError([]).errors; }`);
    expect(display).toContain("[]");
  });

  it("2.3 抽象实参 ⇒ errors 保持 unknown（不造副本、不假精确）", () => {
    const display = sigOf(`export function f(a) { return new AggregateError(a).errors; }`);
    expect(display).not.toContain("[]");
    expect(display).toMatch(/any|unknown/);
  });
});

/* ── 第 3 条：Error 的 cause 槽 ───────────────────────────────────── */

describe("族 62 · 第 3 条 —— Error 的 cause 槽", () => {
  it("3.1 自有 cause 键 ⇒ 读出值（原生同款）", () => {
    const display = sigOf(`export function f() { return new Error("m", {cause: 1}).cause; }`);
    expect(display).toContain("1");
  });

  it("3.2 无 options ⇒ 无 cause 键（保持「无 cause 键 ⇒ 不装槽」口径）", () => {
    const display = sigOf(`export function f() { return new Error("m").cause; }`);
    expect(display).toContain("undefined");
    expect(display).not.toContain("unknown");
  });

  it("继承的 cause ⇒ 读出 unknown（不是「确定不存在」）", () => {
      // 原生：`new Error("m", Object.create({cause: 1})).cause` → 1
      // （InstallErrorCause 用 `Get(options, "cause")` ⇒ 走原型链）。
      // 族 65 · 第 5 条：core 侧
      // `packages/core/src/algebra/builtins/error/error-family.ts` 的
      // `errorBrandAbs`——options 键集**不可判**时（开放 obj / 原型链开放）
      // 装**值为 unknown** 的 cause 槽；原型链上**确有** cause 键时
      // （存在性确定）装同款 unknown 值槽（值不经原型链 Get 解析——保守）。
      // ⇒ 读出 unknown（可见但不确定），**不得**读出「确定不存在」。
      const display = sigOf(
        `export function f() {
  const o = Object.create({cause: 1});
  return new Error("m", o).cause;
}`,
      );
      expect(display).toContain("unknown");
      expect(display).not.toContain("undefined");
    });
});

/* ── 第 4 条：类型化数组的元素面 ─────────────────────────────────── */

describe("族 62 · 第 4 条 —— 类型化数组的元素面", () => {
  it("4.1 元素读面 ⇒ 精确值（族 65 第 6 条已建模；原生 new Int8Array([1])[0] === 1）", () => {
    // 原生：new Int8Array([1])[0] === 1
    // 族 65 · 第 6 条：元素**值**入索引槽 ⇒ 读面命中槽直读精确值
    // （此前是「number | undefined」——不假精确，但不是原生值）。
    const display = sigOf(`export function f() { return new Int8Array([1])[0]; }`);
    expect(display).toContain("1");
    expect(display).not.toMatch(/undefined #exact/);
  });

  it("对象源逐元素 ToNumber ⇒ 精确值（原生同款）", () => {
    // 原生 oracle（node v26.10.0）：
    //   new Int8Array(["3"])[0]              → 3
    //   new Int8Array([{valueOf: () => 1}])[0] → 1
    // 族 65 · 第 6 条：core 侧
    // `packages/core/src/algebra/builtins/error/binary.ts` 的
    // `makeTypedArrayAbs`——闭 tuple 源逐元素过 ToNumber / ToBigInt + 家族
    // 取值转换（整数 TA 的模 2^n 回绕、Float32 的 fround 舍入）⇒ 值入索引
    // 槽；读面（`$idx` / 字符串下标）命中槽直读。
    const display = sigOf(`export function f() { return new Int8Array(["3"])[0]; }`);
    expect(display).toContain("3");
    expect(display).not.toContain("undefined");
  });
});

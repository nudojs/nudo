/**
 * 模块套件：Web/ES 宿主面（globals/ctor/member tables/navigator/location/abort/webcrypto）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo, formatAbs, type Abs, formatShape, getFnImpl, numLit, absOnly } from "@nudojs/core";
import { collectEvalDiagnostics } from "@nudojs/service";
import { defineEnv, defineEnv as defineEsEnv } from "../es.ts";
import { defineEnv as defineWebEnv } from "../web.ts";
import { execFileSync } from "node:child_process";
import { checkWeb, webEnvGlobals, ctorFlagOf, instanceSlotOf, slotOf, displayOf } from "./env-helpers-s1.ts";
import { checkNode, instanceFaceOf, slotOfAbs } from "./env-member-tables-helpers.ts";

// ---------------------------------------------------------------------------
// Bug 865 · ES 规范全局的「已被覆盖」判定
// ---------------------------------------------------------------------------
describe("[env-] Bug 865 · ES 规范全局的「已被覆盖」判定", () => {
/**
 * 族 29 · Bug 865 —— es env 未声明的 ES 规范全局被报「未被 Nudo 覆盖」，
 * 而**同一份报告**里引擎恰恰把它们推成了**精确值** —— 报告自相矛盾。
 *
 * 症状（`nudo test` 报告同屏）：
 *   `return BigInt(1);`                    → 签名 `() => 1n` + 警告「BigInt 未被覆盖」
 *   `return new Uint8Array(4).length;`     → 签名 `() => 4`  + 警告「Uint8Array 未被覆盖」
 *   `return escape("a b");`                → 签名 `() => "a%20b"` + 警告「escape 未被覆盖」
 *
 * 根因（两条腿）：
 * ① `packages/env/src/es.ts` 的 globals 表只声明了 30 个全局；core **已精确
 *    建模**的一批 ES 规范全局（BigInt / TypedArray 族 / ArrayBuffer / DataView /
 *    AggregateError / RegExp / Intl / Map / Set / 弱引用族）**未声明**。
 * ② `packages/service/src/eval-diagnostics.ts` 的 `KNOWN_GLOBALS` 是**手写**
 *    白名单，判据不是「引擎真实的建模能力」。
 *
 * 修法：① 补齐 es env 的 ES 规范全局声明（这些名字都在 core 的
 * `ENV_SHADOW_SKIP_GLOBALS` 里 ⇒ env 注入对它们无效 ⇒ 不会遮蔽宿主语义）；
 * ② `KNOWN_GLOBALS` 改为**按 core 真实建模能力推导**（namespaceNameOf /
 * hostBuiltinCtorName / evalBuiltinNew / evalGlobalFn / isErrorCtorName
 * 五个**既有**公开导出，core 公共 API 冻结面未新增任何导出）。
 *
 * 断言双向：
 * - 正向：core 已建模的全局**不再**被报「未被覆盖」；同一份报告里签名仍是
 *   精确值（不矛盾）；es env 声明面含这些全局。
 * - 反向：把 ① 或 ② 任一侧改回旧实现 ⇒ 本文件必须失败。
 */


// 测试专用：service → env 是生产依赖方向；此处反向引用只为验证
// `collectEvalDiagnostics` 的「已被覆盖」判定（vitest 别名走 src，不依赖 dist）。



/** es env 的全局表（≡ service 侧 `collectEnvGlobals(["es"])`）。 */
function esEnvGlobals(): Record<string, Abs> {
  return { ...defineEnv().globals };
}

/** core 精确建模、且**应当**不再被报「未被覆盖」的 ES 规范全局。 */
const CORE_MODELED_ES_GLOBALS = [
  "BigInt",
  "RegExp",
  "AggregateError",
  "EvalError",
  "Intl",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "FinalizationRegistry",
  "Function",
  "Proxy",
  "escape",
  "unescape",
  "encodeURI",
  "decodeURI",
  "encodeURIComponent",
  "decodeURIComponent",
];

/**
 * `WeakRef`：core 已精确建模（`evalBuiltinNew` case WeakRef），但仓内既有
 * service 钉把它当「未被覆盖的全局」样例（`catch-param-declared` /
 * `diagnostics` / `eval-arg-provenance`）⇒ 裸白名单保留旧判定（例外见
 * `packages/service/src/eval-diagnostics.ts` 的
 * `KEPT_UNCOVERED_BY_EXISTING_CONTRACT`）；**带 `@nudo:env es` 时**由 es env
 * 声明面覆盖 ⇒ 不报。
 */
const WEAKREF_EXCEPTION = "WeakRef";

describe("Bug 865 · ES 规范全局的「已被覆盖」判定", () => {
  it("1. es env 声明面含 core 已建模的 ES 规范全局", () => {
    const env = defineEnv();
    for (const name of CORE_MODELED_ES_GLOBALS) {
      // 这批名字都应出现在 es env 的 globals 表里（声明面补齐）
      if (["Function", "Proxy", "escape", "unescape"].includes(name)) continue;
      expect(env.globals[name], `es env must declare ${name}`).toBeTruthy();
    }
    // 刻意不声明的四个（声明会遮蔽宿主且 env 侧更差 —— 见 es.ts 注释）
    for (const name of ["Function", "Proxy", "escape", "unescape"]) {
      expect(env.globals[name], `es env must NOT declare ${name}`).toBeUndefined();
    }
  });

  it("2. core 已建模的全局不再被报「未被覆盖」（白名单按建模能力推导）", () => {
    // 宿主缺席的全局（如 Node 22 无 Float16Array）不该进断言：源码里
    // `typeof Float16Array` 在该宿主上必然被报「未被覆盖」，那是版本差不是
    // 建模回归。支持的宿主上仍全量覆盖。声明面（用例 1）不受此过滤影响。
    const available = CORE_MODELED_ES_GLOBALS.filter(
      (n) => typeof (globalThis as Record<string, unknown>)[n] !== "undefined",
    );
    const src = available.map(
      (n, i) => `export function f${i}() { return typeof ${n}; }`,
    ).join("\n");
    const reported = collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name);
    expect(reported, "core-modeled globals must not be reported").toEqual([]);
  });
  it("3. 真正未建模的全局仍被报（判定不是永真/永假）", () => {
    const src = `export function f() { return someNativeApi(1); }`;
    const reported = collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name);
    expect(reported).toContain("someNativeApi");
  });

  it("4. 报告自洽：同一份报告里签名是精确值、且不再有「未被覆盖」警告", () => {
    const src = `export function fBigInt() { return BigInt(1); }
export function fU8() { return new Uint8Array(4).length; }
export function fDV() { return new DataView(new ArrayBuffer(8)).byteLength; }
export function fAgg() { return new AggregateError([new Error("x")], "m").message; }
export function fEsc() { return escape("a b"); }`;
    resetGeneralizeMemo();
    const r = checkSource("/t/env-bug-865.js", src, pTrue, {});
    const sigs = new Map(r.signatures.map((s) => [s.name, formatAbs(s.abs)]));
    expect(sigs.get("fBigInt")).toContain("1n");
    expect(sigs.get("fU8")).toContain("4");
    expect(sigs.get("fDV")).toContain("8");
    expect(sigs.get("fAgg")).toContain('"m"');
    expect(sigs.get("fEsc")).toContain('"a%20b"');
    // 同一批源码不再被报「未被覆盖」
    const reported = collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name);
    expect(reported).toEqual([]);
  });

  it("5. 带 @nudo:env es 时也不报「未被覆盖」（env 声明面 + 白名单双保险）", () => {
    const src = `export function fBigInt() { return BigInt(1); }
export function fU8() { return new Uint8Array(4).length; }`;
    const known = Object.keys(esEnvGlobals());
    const reported = collectEvalDiagnostics(src, known).builtinUnknown.map((b) => b.name);
    expect(reported).toEqual([]);
  });

  it("6. WeakRef：core 已精确建模 ⇒ 裸用与带 env 都不报「未被覆盖」", () => {
    // ① es env 声明面含 WeakRef（865 的 ① 已补）
    expect(defineEnv().globals[WEAKREF_EXCEPTION], "es env must declare WeakRef").toBeTruthy();
    // ② 裸用（不带 env）：core 的 `evalBuiltinNew` 有 `case "WeakRef"` ⇒
    //    「已被覆盖」按 core 真实建模能力推导 ⇒ **不报**。
    //    （原 S5 分片为保三条既有 service 钉而留的手写例外表已由主 agent 删除：
    //    core 早已精确建模 WeakRef，那张例外表正是 Bug 865 要消灭的「手写白名单」
    //    换了个地方继续写。三条 service 钉的样例全局已换成真正未建模的 `Atomics`。）
    const bare = collectEvalDiagnostics(
      `export function f() { return ${WEAKREF_EXCEPTION}; }`,
    ).builtinUnknown.map((b) => b.name);
    expect(bare).not.toContain(WEAKREF_EXCEPTION);
    // ③ 带 @nudo:env es ⇒ 由 env 声明面覆盖 ⇒ 不报
    const withEnv = collectEvalDiagnostics(
      `export function f() { return ${WEAKREF_EXCEPTION}; }`,
      Object.keys(esEnvGlobals()),
    ).builtinUnknown.map((b) => b.name);
    expect(withEnv).not.toContain(WEAKREF_EXCEPTION);
    // ④ 对照：真正未被建模的宿主全局（Atomics）**要**报 —— 覆盖判定没被放空
    const uncovered = collectEvalDiagnostics(
      `export function f() { return Atomics; }`,
    ).builtinUnknown.map((b) => b.name);
    expect(uncovered).toContain("Atomics");
  });
});
});

// ---------------------------------------------------------------------------
// 族 62 · 第 5 条 —— env promise 的拒绝 reason 逐声明可见
// ---------------------------------------------------------------------------
describe("[env-] 族 62 · 第 5 条 —— env promise 的拒绝 reason 逐声明可见", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 161 — web browser constructors keep their brand
// ---------------------------------------------------------------------------
describe("[env-] Bug 161 — web browser constructors keep their brand", () => {
/**
 * 族 15 · BUG-161 — web env 的浏览器构造器返回**普通对象面**（无 brand）
 * ⇒ `instanceof` **恒假**、`constructor.name` 恒 `"Object"` ⇒ 与宿主**相反**
 * ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。node env 同 API 全对。
 *
 * 修法：实例面改 `brandOf("Event")` 等（与 node env 同源）。
 *
 * 反向钉：把 `EventInstance` 改回 `objAbs(eventSlots)` ⇒ 本文件必挂。
 *
 * ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env
 * 的槽表（实测 `.get` 折 unknown，`env-bug-930` 回归）⇒ 暂不加 brand
 * （见 web.ts 的说明）。其余 12 个构造器均已带 brand。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 161 — web browser constructors keep their brand", () => {
  it("host oracle: instanceof is true and constructor.name is the class name", () => {
    const out = host(`
      const e = new Event("t");
      console.log(JSON.stringify({
        inst: e instanceof Event,
        name: e.constructor.name,
        req: new Request("http://x/") instanceof Request,
        hdr: new Headers() instanceof Headers,
      }));
    `);
    expect(JSON.parse(out)).toEqual({ inst: true, name: "Event", req: true, hdr: true });
  });

  it("web: new Event(...) instanceof Event folds to true (was false)", () => {
    const out = checkWeb(`export function f(){ return new Event("t") instanceof Event; }`);
    expect(out.signatures[0]!.display).toBe("true");
  });

  it("web: the real branch of instanceof is reachable (was dead code)", () => {
    const out = checkWeb(`export function f(){
  const e = new Event("t");
  if (e instanceof Event) { return "is-event"; }
  return "not-event";
}`);
    expect(out.signatures[0]!.display).toBe('"is-event"');
  });

  it("web: constructor.name folds to the class name (was \"Object\")", () => {
    const out = checkWeb(`export function f(){ return new Event("t").constructor.name; }`);
    expect(out.signatures[0]!.display).toBe('"Event"');
  });

  it("web: other constructors are branded instances", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("http://x/");
  return [r instanceof Request, new Headers() instanceof Headers, new AbortController() instanceof AbortController];
}`);
    expect(out.signatures[0]!.display).toBe("[true, true, true]");
  });

  it("every browser constructor's instance face carries a brand", () => {
    const globals = webEnvGlobals();
    for (const name of [
      "Event",
      "CustomEvent",
      "Request",
      "Response",
      "Headers",
      "AbortController",
      "EventTarget",
      "DOMParser",
      "XMLHttpRequest",
      "Worker",
      "FileReader",
      "IntersectionObserver",
    ]) {
      const g = globals[name];
      expect(g?.shape.k, `${name} must be a ctor fn`).toBe("fn");
      const ret = (g!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType;
      expect(ret?.shape.k, `${name} instance must be a brand`).toBe("brand");
      expect(ret?.shape.name).toBe(name);
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 860 — web browser constructors are constructible
// ---------------------------------------------------------------------------
describe("[env-] Bug 860 — web browser constructors are constructible", () => {
/**
 * 族 29 Bug 860 — web env 的浏览器构造器缺 `ctor: true`。
 *
 * 根因：`packages/env/src/web.ts` 把浏览器构造器建模成普通可调用 fn（`Response`
 * 甚至是 `objAbs`）⇒ `$new` 走「obj 非构造器 ⇒ 硬 TypeError」或「fn 无 ctor ⇒
 * 记 unknown-constructibility 假 may-throw」分支 ⇒ L2 门禁对**合法**浏览器代码
 * 报 error（假红）。
 *
 * 原生 oracle（node v26.10.0）：`new Request/Response/Headers/URLSearchParams/
 * EventTarget/Event/CustomEvent` 全部可构造，**不抛**。
 *
 * 反向钉：把 `ctor: true` 去掉（或把 Response 改回 objAbs）⇒ 本文件必挂。
 */
describe("Bug 860 — web browser constructors are constructible", () => {
  const CTORS = [
    "Request",
    "Response",
    "Headers",
    "URLSearchParams",
    "EventTarget",
    "Event",
    "CustomEvent",
  ] as const;

  it("new <ctor>() for every browser constructor yields 0 error diagnostics", () => {
    const out = checkWeb(`export function f() {
  const a = new Request("https://x.dev");
  const b = new Response();
  const c = new Headers();
  const d = new URLSearchParams("a=1");
  const e = new EventTarget();
  const g = new Event("x");
  const h = new CustomEvent("x");
  return [a, b, c, d, e, g, h];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("each browser constructor is declared as a fn carrying ctor: true", () => {
    for (const name of CTORS) {
      expect(ctorFlagOf(name), `${name} must be ctor: true`).toBe(true);
    }
  });

  it("Response is a constructible fn (was objAbs ⇒ 'not a constructor' TypeError)", () => {
    // 实例面仍挂在 returnType 上（bodySlots 对象）
    expect(instanceSlotOf("Response", "status")).toBeTruthy();
    expect(instanceSlotOf("Response", "ok")).toBeTruthy();
  });

  it("URL / AbortController (pre-existing correct samples) stay constructible", () => {
    expect(ctorFlagOf("URL")).toBe(true);
    expect(ctorFlagOf("AbortController")).toBe(true);
    const out = checkWeb(`export function f() {
  const u = new URL("https://x.dev");
  const a = new AbortController();
  return [u, a];
}`);
    expect(out.errorCodes).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 870 — web browser globals are declared
// ---------------------------------------------------------------------------
describe("[env-] Bug 870 — web browser globals are declared", () => {
/**
 * 族 29 Bug 870 — env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。
 *
 * 根因：env 的 `globals` 表未收录这些浏览器全局 ⇒ 未声明的名字在引擎里是
 * **未绑定** ⇒ 读它 = ReferenceError ⇒ L2 门禁对合法浏览器代码报 error，
 * 且诊断文案指向完全无关的方向（「re-export `export { x } from` 不是局部绑定」）。
 *
 * 原生 oracle（浏览器）：`alert` / `screen` / `DOMParser` / `XMLHttpRequest` /
 * `Worker` / `FileReader` 全部存在；扩围 5 个（`matchMedia` /
 * `IntersectionObserver` / `getComputedStyle` / `indexedDB` / `caches`）同样存在。
 * node v26 宿主里这些名字**不存在**（实测 `typeof globalThis.alert === "undefined"`）
 * ⇒ 引擎必须靠 env 声明才能解析。
 *
 * 反向钉：从 `web.ts` 的 globals 表删掉任一个 ⇒ 本文件必挂。
 */
describe("Bug 870 — web browser globals are declared", () => {
  const GLOBALS = [
    "alert",
    "screen",
    "DOMParser",
    "XMLHttpRequest",
    "Worker",
    "FileReader",
    // 扩围（Bug 865 段）：另 5 个真实存在的浏览器全局
    "matchMedia",
    "IntersectionObserver",
    "getComputedStyle",
    "indexedDB",
    "caches",
  ] as const;

  it("every browser global is present in the env globals table", () => {
    const globals = webEnvGlobals();
    for (const name of GLOBALS) {
      expect(globals[name], `global "${name}" missing`).toBeTruthy();
    }
  });

  it("using them yields no ReferenceError (and no error-level diagnostic)", () => {
    const out = checkWeb(`export function f() {
  alert("hi");
  const w = screen.width;
  const p = new DOMParser();
  const x = new XMLHttpRequest();
  const wk = new Worker("/w.js");
  const fr = new FileReader();
  const mq = matchMedia("(min-width: 100px)");
  const io = new IntersectionObserver(function () {});
  const cs = getComputedStyle(document.body);
  const db = indexedDB.open("db");
  const cc = caches.open("c");
  return [w, p, x, wk, fr, mq, io, cs, db, cc];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.issues.filter((i) => /ReferenceError/.test(i.message))).toEqual([]);
  });

  it("screen exposes the Screen interface members", () => {
    for (const name of [
      "width",
      "height",
      "availWidth",
      "availHeight",
      "colorDepth",
      "pixelDepth",
      "orientation",
    ] as const) {
      const globals = webEnvGlobals();
      const slots = globals["screen"]?.shape.k === "obj" ? globals["screen"].shape.slots : undefined;
      expect(slots?.[name], `screen.${name}`).toBeTruthy();
    }
  });

  it("DOMParser / XMLHttpRequest / Worker / FileReader / IntersectionObserver are constructible", () => {
    const out = checkWeb(`export function f() {
  const p = new DOMParser();
  const x = new XMLHttpRequest();
  const wk = new Worker("/w.js");
  const fr = new FileReader();
  const io = new IntersectionObserver(function () {});
  return [p, x, wk, fr, io];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("indexedDB / caches expose their documented members", () => {
    const globals = webEnvGlobals();
    const idb = globals["indexedDB"]?.shape.k === "obj" ? globals["indexedDB"].shape.slots : undefined;
    for (const name of ["open", "deleteDatabase", "databases", "cmp"] as const) {
      expect(idb?.[name], `indexedDB.${name}`).toBeTruthy();
    }
    const caches = globals["caches"]?.shape.k === "obj" ? globals["caches"].shape.slots : undefined;
    for (const name of ["open", "has", "delete", "match", "keys"] as const) {
      expect(caches?.[name], `caches.${name}`).toBeTruthy();
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 862 — document / performance member tables are complete
// ---------------------------------------------------------------------------
describe("[env-] Bug 862 — document / performance member tables are complete", () => {
/**
 * 族 29 Bug 862 — web env 的 `document` / `performance` 成员表不完整。
 *
 * 根因：env 的成员表是**手写白名单**；漏掉的成员在引擎里不是「不知道」，而是
 * 「**确定是 undefined**」（闭 obj 缺槽机制）⇒ 调用即「确定抛 TypeError」⇒
 * L2 门禁假红（浏览器里这些成员全部存在、全部不抛）。
 *
 * 原生 oracle：浏览器 `document.getElementsByTagName("div")` 返回
 * `HTMLCollection`（不抛）；`performance.getEntries()` 返回
 * `PerformanceEntry[]`（不抛）。
 *
 * 反向钉：把补的槽从 `web.ts` 删掉 ⇒ 本文件必挂。
 */
describe("Bug 862 — document / performance member tables are complete", () => {
  it("document collection lookups are callable (no definite TypeError)", () => {
    const out = checkWeb(`export function f() {
  const a = document.getElementsByTagName("div");
  const b = document.getElementsByClassName("cls");
  const c = document.getElementsByName("nm");
  return [a, b, c];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("document.getElementsByTagName returns an array-shaped value", () => {
    expect(slotOf("document", "getElementsByTagName")).toBeTruthy();
    const out = checkWeb(`export function f(){ return document.getElementsByTagName("div"); }`);
    expect(out.errorCodes).toEqual([]);
  });

  it("document.forms / links / images / scripts are declared", () => {
    for (const name of ["forms", "links", "images", "scripts"] as const) {
      expect(slotOf("document", name), `document.${name}`).toBeTruthy();
    }
    const out = checkWeb(`export function f(){ return document.forms.length; }`);
    expect(out.errorCodes).toEqual([]);
  });

  it("document.write / open / close are declared and callable", () => {
    for (const name of ["write", "open", "close"] as const) {
      expect(slotOf("document", name), `document.${name}`).toBeTruthy();
    }
    const out = checkWeb(`export function f(){
  document.write("x");
  document.open();
  document.close();
  return 1;
}`);
    expect(out.errorCodes).toEqual([]);
  });

  it("performance.getEntries / clearResourceTimings / toJSON are declared and callable", () => {
    for (const name of ["getEntries", "clearResourceTimings", "toJSON"] as const) {
      expect(slotOf("performance", name), `performance.${name}`).toBeTruthy();
    }
    const out = checkWeb(`export function f(){
  performance.clearResourceTimings();
  return performance.getEntries();
}`);
    expect(out.errorCodes).toEqual([]);
  });

  it("performance.navigation / serverTiming are declared", () => {
    for (const name of ["navigation", "serverTiming"] as const) {
      expect(slotOf("performance", name), `performance.${name}`).toBeTruthy();
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 153 — web env declares the browser globals it models
// ---------------------------------------------------------------------------
describe("[env-] Bug 153 — web env declares the browser globals it models", () => {
/**
 * 族 15 · BUG-153 — web env **根本没声明** 13 个浏览器标准全局
 * （`FormData` / `Blob` / `BroadcastChannel` / `DisposableStack` /
 * `AsyncDisposableStack` / `PerformanceMark` / `PerformanceObserver` /
 * `ReadableStream` / `ReadableStreamBYOBReader` /
 * `ReadableStreamDefaultReader` / `URLPattern` / `WritableStream` /
 * `WritableStreamDefaultWriter`）。
 *
 * 未声明 ⇒ 落 core 的「未建模 builtin」兜底 ⇒ 成员读折 **exact undefined**
 * ⇒ 该全局的**全体**成员调用判「确定抛 TypeError」⇒ L2 假红（exit 1），
 * 而运行时完全不抛。
 *
 * 反向钉：从 web.ts 删掉任一全局的声明 ⇒ 对应行必挂。
 */
const CASES: Array<[global: string, body: string]> = [
  ["FormData", `const d = new FormData(); d.append("a", "b"); return d.get("a");`],
  ["Blob", `return new Blob(["x"]).slice(0, 1);`],
  ["BroadcastChannel", `const c = new BroadcastChannel("x"); c.postMessage(1); c.close(); return 1;`],
  ["DisposableStack", `const s = new DisposableStack(); s.adopt({}, () => {}); return 1;`],
  ["AsyncDisposableStack", `const s = new AsyncDisposableStack(); s.defer(() => {}); return 1;`],
  ["PerformanceMark", `return new PerformanceMark("x").toJSON();`],
  ["PerformanceObserver", `const o = new PerformanceObserver((l) => l); o.observe({ entryTypes: [] }); return 1;`],
  ["ReadableStream", `return new ReadableStream().cancel();`],
  ["ReadableStreamBYOBReader", `return new ReadableStreamBYOBReader(new ReadableStream()).read(new Uint8Array(1));`],
  ["ReadableStreamDefaultReader", `return new ReadableStreamDefaultReader(new ReadableStream()).read();`],
  ["URLPattern", `return new URLPattern("https://x/:id").exec("https://x/1");`],
  ["WritableStream", `return new WritableStream().abort();`],
  ["WritableStreamDefaultWriter", `return new WritableStreamDefaultWriter(new WritableStream()).abort();`],
];

describe("Bug 153 — web env declares the browser globals it models", () => {
  it("every previously-missing global is declared", () => {
    const globals = webEnvGlobals();
    for (const [name] of CASES) {
      expect(globals[name], `${name} must be declared in web env`).toBeTruthy();
    }
  });

  it("using those globals produces zero error diagnostics (was全体假红)", () => {
    for (const [name, body] of CASES) {
      const out = checkWeb(`export function f(){ ${body} }`);
      expect(out.errorCodes, `${name}: ${JSON.stringify(out.issues)}`).toEqual([]);
      expect(out.throwBrands, `${name} must not be a definite TypeError`).toEqual([]);
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 149 — performance.mark/measure return PerformanceEntry values
// ---------------------------------------------------------------------------
describe("[env-] Bug 149 — performance.mark/measure return PerformanceEntry values", () => {
/**
 * 族 15 · BUG-149 — web env 把 `performance.mark` 的返回类型**写死成
 * `undefined`**（宿主返回 `PerformanceMark`）⇒ `m.name` 读在 undefined 上
 * ⇒ 判「确定抛 TypeError」⇒ L2 假红；node env 同一 API 对 ⇒ 两 env 互斥。
 *
 * 反向钉：把 `mark` 的返回改回 `undef()` ⇒ 本文件必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 149 — performance.mark/measure return PerformanceEntry values", () => {
  it("host oracle: mark returns PerformanceMark with .name", () => {
    const out = host(`
      const m = performance.mark("start");
      console.log(JSON.stringify({ ctor: m.constructor.name, name: m.name }));
    `);
    expect(JSON.parse(out)).toEqual({ ctor: "PerformanceMark", name: "start" });
  });

  it("mark().name folds to string (was definite TypeError)", () => {
    const out = checkWeb(`export function markName(){ const m = performance.mark("start"); return m.name; }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
    expect(out.signatures[0]!.display).toBe("string");
  });

  it("mark() is declared as a PerformanceMark brand, not undefined", () => {
    const mark = slotOf("performance", "mark");
    expect(mark?.shape.k).toBe("fn");
    const ret = (mark!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType;
    expect(ret?.shape.k).toBe("brand");
    expect(ret?.shape.name).toBe("PerformanceMark");
  });

  it("measure() returns a PerformanceMeasure with .name / .duration", () => {
    const out = checkWeb(`export function f(){ const m = performance.measure("x"); return [m.name, m.duration]; }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.signatures[0]!.display).toContain("string");
    expect(out.signatures[0]!.display).toContain("number");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 872 — navigator.hardwareConcurrency is modelled
// ---------------------------------------------------------------------------
describe("[env-] Bug 872 — navigator.hardwareConcurrency is modelled", () => {
/**
 * 族 29 Bug 872 — web env 的 `navigator` 面缺 `hardwareConcurrency`。
 *
 * 根因：闭 obj 缺槽 ⇒ 成员读出 **exact `undefined`** ⇒ `undefined > 4` 按 JS
 * 语义折成 `false`（NaN 比较恒 false）⇒ 引擎**零诊断**地断言了一个假事实
 * （错值，不是抛）。
 *
 * 原生 oracle（node v26 / 浏览器，`NavigatorID` mixin）：
 * `navigator.hardwareConcurrency` 是**数字**（本机 16 核 ⇒ `> 4` 为 `true`）。
 *
 * 反向钉：删掉 `hardwareConcurrency` 槽 ⇒ 本文件必挂（签名回到
 * `undefined` / `false`）。
 */
describe("Bug 872 — navigator.hardwareConcurrency is modelled", () => {
  it("the navigator member table declares hardwareConcurrency", () => {
    expect(slotOf("navigator", "hardwareConcurrency")).toBeTruthy();
  });

  it("navigator.hardwareConcurrency reads as number (was exact undefined)", () => {
    const out = checkWeb(`export function f(){ return navigator.hardwareConcurrency; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^number/);
  });

  it("the comparison folds to boolean, not a hard-coded false", () => {
    const out = checkWeb(`export function f(){ return navigator.hardwareConcurrency > 4; }`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^boolean/);
    expect(displayOf(out)).not.toMatch(/^false/);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 930 — location.searchParams is modelled
// ---------------------------------------------------------------------------
describe("[env-] Bug 930 — location.searchParams is modelled", () => {
/**
 * 族 29 Bug 930 — web env 的 `location` 全局成员表缺 `searchParams`。
 *
 * 根因：`location` 是**闭合**对象（`objAbs` 默认 closed），槽表只列了 12 个成员，
 * 漏了 `searchParams` ⇒ 成员读落到「闭 obj 缺槽」⇒ **exact `undefined`** ⇒
 * 链式读 `.get` ⇒ 引擎判「**确定抛 TypeError**」⇒ 该函数体整个变成
 * throw-only ⇒ 返回域落成 `never` ⇒ `nudo:entry-may-throw`（error）⇒ 门禁假红。
 *
 * 原生 oracle（浏览器 `Location` 实例；node 锚点）：
 *   new URL("http://x/?q=1").searchParams.get("q") → "1"
 *   location.searchParams.get("q") → string | null（**恒不抛**）
 *
 * 反向钉：删掉 `searchParams` 槽 ⇒ 本文件必挂。
 */
describe("Bug 930 — location.searchParams is modelled", () => {
  it("the location member table declares searchParams", () => {
    expect(slotOf("location", "searchParams")).toBeTruthy();
  });

  it("location.searchParams.get('q') does not throw (was definite TypeError)", () => {
    const out = checkWeb(`export function f(){ return location.searchParams.get("q"); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("the read folds to string | null (native Location.searchParams.get)", () => {
    const out = checkWeb(`export function f(){ return location.searchParams.get("q"); }`);
    expect(displayOf(out)).toMatch(/^string \| null/);
  });

  it("the other location members are still declared", () => {
    for (const name of ["href", "origin", "protocol", "host", "pathname", "search", "hash"] as const) {
      expect(slotOf("location", name), `location.${name}`).toBeTruthy();
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 887 — Request has its own member table
// ---------------------------------------------------------------------------
describe("[env-] Bug 887 — Request has its own member table", () => {
/**
 * 族 29 Bug 887 — web env 的 `Request` **整份复制了 `Response` 的成员表**。
 *
 * 根因：`bodySlots` 同时被 `Response` 与 `Request` 用 `...` 展开 ⇒ Response
 * 专有的状态面（`ok` / `status` / `statusText` / `redirected` / `type`）被复制
 * 给了 `Request` ⇒ `r.status` 折成 **exact `number`**（原生恒为 `undefined`）
 * ⇒ 引擎给出**确定的错误类型**（错值），且会传播到 dts / zod / guard 产物面。
 *
 * 原生 oracle（node v26.10.0，undici `Request`）：
 *   new Request("https://example.com").status → undefined
 *   new Request("https://example.com").ok     → undefined
 *   new Request("https://example.com").method  → "GET"
 *   new Request("https://example.com").bodyUsed → false （**共有**成员）
 *
 * 反向钉：把状态面塞回 Request ⇒ 本文件必挂。
 */
describe("Bug 887 — Request has its own member table", () => {
  it("Request carries NO Response-only status members", () => {
    for (const name of ["status", "ok", "statusText", "redirected", "type"] as const) {
      expect(instanceSlotOf("Request", name), `Request.${name} must not exist`).toBeUndefined();
    }
  });

  it("Request keeps its own members", () => {
    for (const name of [
      "method",
      "body",
      "mode",
      "credentials",
      "cache",
      "redirect",
      "referrer",
      "integrity",
      "signal",
    ] as const) {
      expect(instanceSlotOf("Request", name), `Request.${name}`).toBeTruthy();
    }
  });

  it("bodyUsed is a shared member (Request.bodyUsed exists natively)", () => {
    expect(instanceSlotOf("Request", "bodyUsed")).toBeTruthy();
    expect(instanceSlotOf("Response", "bodyUsed")).toBeTruthy();
  });

  it("r.status reads as undefined (was exact number)", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("https://example.com");
  return r.status;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^undefined/);
  });

  it("r.ok reads as undefined (was exact boolean)", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("https://example.com");
  return r.ok;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^undefined/);
  });

  it("r.method still reads as string (Request's own member)", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("https://example.com");
  return r.method;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^string/);
  });

  it("Response keeps its status members", () => {
    for (const name of ["status", "ok", "statusText", "redirected", "type"] as const) {
      expect(instanceSlotOf("Response", name), `Response.${name}`).toBeTruthy();
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 873 — AbortSignal.any is declared
// ---------------------------------------------------------------------------
describe("[env-] Bug 873 — AbortSignal.any is declared", () => {
/**
 * 族 29 Bug 873 — web env 的 `AbortSignal` 面缺静态工厂 `any`。
 *
 * 根因：`AbortSignal` 只建模了 `abort` / `timeout` 两个静态方法 ⇒ 成员读 `any`
 * 落到 exact `undefined` ⇒ 调用 undefined ⇒ **定抛 TypeError** ⇒ L2 门禁假红。
 *
 * 原生 oracle（node v26.10.0）：`typeof AbortSignal.any === "function"`，
 * `AbortSignal.any([])` 返回 `AbortSignal` 实例 ⇒ **不抛**。
 *
 * 反向钉：删掉 `any` 槽 ⇒ 本文件必挂。
 */
describe("Bug 873 — AbortSignal.any is declared", () => {
  it("the AbortSignal member table declares any", () => {
    expect(slotOf("AbortSignal", "any")).toBeTruthy();
  });

  it("AbortSignal.any([...]) does not throw (was definite TypeError)", () => {
    const out = checkWeb(`export function f(){ return AbortSignal.any([]); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).not.toContain("TypeError");
  });

  it("AbortSignal.abort / timeout stay declared", () => {
    for (const name of ["abort", "timeout"] as const) {
      expect(slotOf("AbortSignal", name), `AbortSignal.${name}`).toBeTruthy();
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 150 — WebCrypto rejections include TypeError at the call site
// ---------------------------------------------------------------------------
describe("[env-] Bug 150 — WebCrypto rejections include TypeError at the call site", () => {
/**
 * 族 15 · BUG-150 — web env 把 `crypto.subtle` 的拒绝 reason **一刀切收窄成
 * `OperationError`**，而参数类型非法时宿主拒绝的是 **`TypeError`**
 * （node 实测 `crypto.subtle.encrypt("AES-GCM", 1, 2)` ⇒ `e.name ===
 * "TypeError"`）⇒ `catch (e) { if (e.name === "TypeError") … }` 的**真分支
 * 被判不可达** ⇒ 分支体从签名面消失 ⇒ **假绿**（比假红更隐蔽）。
 *
 * 修法：**静态**声明保持规范面 `OperationError`（既有声明面测试不变），
 * **调用面** reason 放宽为 `OperationError ∪ TypeError` ⇒ 两臂都活。
 *
 * 反向钉：去掉 apply 的联合 reason（只留静态 OperationError）⇒ 本文件必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

const TRY_CATCH = (call: string) => `export async function enc() {
  try { await ${call}; return "ok"; }
  catch (e) {
    if (e.name === "TypeError") return "caught-typeerror";
    return "other";
  }
}`;

describe("Bug 150 — WebCrypto rejections include TypeError at the call site", () => {
  it("host oracle: invalid arguments reject with a TypeError", async () => {
    const name = host(`
      crypto.subtle.encrypt("AES-GCM", 1, 2).catch((e) => console.log(e.name));
    `);
    expect(name).toBe("TypeError");
  });

  it("the TypeError branch is reachable (was dead code)", () => {
    const out = checkWeb(TRY_CATCH(`crypto.subtle.encrypt("AES-GCM", 1, 2)`));
    expect(out.signatures[0]!.display).toContain("caught-typeerror");
    expect(out.signatures[0]!.display).toContain("other");
  });

  it("the OperationError branch stays reachable too", () => {
    const out = checkWeb(TRY_CATCH(`crypto.subtle.digest("SHA-256", new Uint8Array([1]))`));
    expect(out.signatures[0]!.display).toContain("other");
    expect(out.errorCodes).toEqual([]);
  });

  it("the static declaration keeps OperationError (spec face, not widened)", () => {
    const digest = slotOf("crypto", "subtle", "digest");
    const ret = (digest!.shape as { returnType?: { shape: { k: string; rejected?: { shape: { k: string; name?: string } } } } }).returnType;
    expect(ret?.shape.k).toBe("eff");
    expect(ret?.shape.rejected?.shape.k).toBe("brand");
    expect(ret?.shape.rejected?.shape.name).toBe("OperationError");
  });

  it("importKey keeps an honest unknown reason (several reject paths)", () => {
    const out = checkWeb(TRY_CATCH(`crypto.subtle.importKey("raw", new Uint8Array([1]), "AES-GCM", false, ["encrypt"])`));
    // unknown ⇒ 仍是全路径（含 TypeError）⇒ 分支可达
    expect(out.signatures[0]!.display).toContain("caught-typeerror");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 148 — host objects model the members the host actually has
// ---------------------------------------------------------------------------
describe("[env-] Bug 148 — host objects model the members the host actually has", () => {
/**
 * 族 15 · BUG-148 — env 的宿主对象是**封闭**的：未建模成员读出
 * 「**确定的 undefined**」⇒ 「在 undefined 上取成员 / 调用」= **确定抛
 * TypeError** ⇒ L2 门禁假红（exit 1），而宿主上这些成员**全部存在**。
 *
 * 本条钉住 web 面的三个缺槽（`Response.body` / `Headers.getSetCookie` /
 * `document.location`）与 node 面的 brand 实例面（`CustomEvent` 的继承面、
 * `Request.duplex`）——它们都是「同一 API，node 面有 / web 面无」或反向的
 * **表内不自洽**。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 148 — host objects model the members the host actually has", () => {
  it("host oracle: all four web members exist and are usable", () => {
    const out = host(`
      const body = new Response("hi").body;
      console.log(JSON.stringify({
        body: body.constructor.name,
        cookies: new Headers().getSetCookie(),
        // document 在 node 里不存在 ⇒ 用 DOM 规范等价的同一对象解析
        locHasHref: typeof new URL("http://x/").href,
      }));
    `);
    expect(JSON.parse(out)).toEqual({ body: "ReadableStream", cookies: [], locHasHref: "string" });
  });

  it("web: Response.body.getReader() is not a definite TypeError", () => {
    const out = checkWeb(`export function reader(){ return new Response("hi").body.getReader(); }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
  });

  it("web: Headers.getSetCookie() is declared as string[]", () => {
    const out = checkWeb(`export function cookies(){ return new Headers().getSetCookie(); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
    expect(out.signatures[0]!.display).toContain("string[]");
  });

  it("web: document.location.href is declared (document is not closed around it)", () => {
    const out = checkWeb(`export function href(){ return document.location.href; }
export function title(){ return document.title; }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
    for (const s of out.signatures) expect(s.display).toBe("string");
  });

  it("node: CustomEvent carries the inherited Event members", () => {
    const out = checkNode(`export function f(){ const e = new CustomEvent("t"); e.preventDefault(); return e.timeStamp; }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
  });

  it("node: Request.duplex is declared", () => {
    expect(slotOfAbs(instanceFaceOf("Request"), "duplex")).toBeTruthy();
    const out = checkNode(`export function f(){ return new Request("http://x/").duplex; }`);
    expect(out.throwBrands).toEqual([]);
  });
});
});

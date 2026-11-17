/**
 * 模块套件：Web/ES 宿主面（globals/ctor/member tables/navigator/location/abort/webcrypto）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo, formatAbs, type Abs, formatShape, getFnImpl, numLit, absOnly } from "@nudojs/core";
import { collectEvalDiagnostics } from "@nudojs/service";
import { defineEnv } from "../es.ts";
import { defineEnv as defineWebEnv } from "../web.ts";
import { execFileSync } from "node:child_process";
import { checkWeb, webEnvGlobals, ctorFlagOf, instanceSlotOf, slotOf, displayOf } from "./env-helpers-globals.ts";
import { checkNode, instanceFaceOf, slotOfAbs } from "./env-member-tables-helpers.ts";

// ---------------------------------------------------------------------------
// ES 规范全局的「已被覆盖」判定
// ---------------------------------------------------------------------------
describe("ES 规范全局的「已被覆盖」判定", () => {
/**
 * 族 29 · es env 未声明的 ES 规范全局被报「未被 Nudo 覆盖」，
 * 而**同一份报告**里引擎恰恰把它们推成了**精确值** —— 报告自相矛盾。
 *
 * 症状（`nudo test` 报告同屏）：
 * `return BigInt(1);` → 签名 `() => 1n` + 警告「BigInt 未被覆盖」
 * `return new Uint8Array(4).length;` → 签名 `() => 4` + 警告「Uint8Array 未被覆盖」
 * `return escape("a b");` → 签名 `() => "a%20b"` + 警告「escape 未被覆盖」
 *
 * 根因（两条腿）：
 * ① `packages/env/src/es.ts` 的 globals 表只声明了 30 个全局；core **已精确
 * 建模**的一批 ES 规范全局（BigInt / TypedArray 族 / ArrayBuffer / DataView /
 * AggregateError / RegExp / Intl / Map / Set / 弱引用族）**未声明**。
 * ② `packages/service/src/eval-diagnostics.ts` 的 `KNOWN_GLOBALS` 是**手写**
 * 白名单，判据不是「引擎真实的建模能力」。
 *
 * 修法：① 补齐 es env 的 ES 规范全局声明（这些名字都在 core 的
 * `ENV_SHADOW_SKIP_GLOBALS` 里 ⇒ env 注入对它们无效 ⇒ 不会遮蔽宿主语义）；
 * ② `KNOWN_GLOBALS` 改为**按 core 真实建模能力推导**（namespaceNameOf /
 * hostBuiltinCtorName / evalBuiltinNew / evalGlobalFn / isErrorCtorName
 * 五个**既有**公开导出，core 公共 API 冻结面未新增任何导出）。
 *
 * 断言双向：
 * - 正向：core 已建模的全局**不再**被报「未被覆盖」；同一份报告里签名仍是
 * 精确值（不矛盾）；es env 声明面含这些全局。
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


  it("声明面 + 白名单按建模能力推导；未建模仍报；报告自洽；WeakRef/Atomics 对照", () => {
    const env = defineEnv();
    for (const name of CORE_MODELED_ES_GLOBALS) {
      if (["Function", "Proxy", "escape", "unescape"].includes(name)) continue;
      expect(env.globals[name], name).toBeTruthy();
    }
    for (const name of ["Function", "Proxy", "escape", "unescape"]) expect(env.globals[name], name).toBeUndefined();
    expect(env.globals[WEAKREF_EXCEPTION]).toBeTruthy();

    const available = CORE_MODELED_ES_GLOBALS.filter((n) => typeof (globalThis as Record<string, unknown>)[n] !== "undefined");
    const src = available.map((n, i) => `export function f${i}() { return typeof ${n}; }`).join("\n");
    expect(collectEvalDiagnostics(src).builtinUnknown.map((b) => b.name)).toEqual([]);
    expect(collectEvalDiagnostics("export function f() { return someNativeApi(1); }").builtinUnknown.map((b) => b.name)).toContain("someNativeApi");

    const reportSrc = `export function fBigInt() { return BigInt(1); }
export function fU8() { return new Uint8Array(4).length; }
export function fDV() { return new DataView(new ArrayBuffer(8)).byteLength; }
export function fAgg() { return new AggregateError([new Error("x")], "m").message; }
export function fEsc() { return escape("a b"); }`;
    resetGeneralizeMemo();
    const r = checkSource("/t/env-bug-865.js", reportSrc, pTrue, {});
    const sigs = new Map(r.signatures.map((s) => [s.name, formatAbs(s.abs)]));
    expect(sigs.get("fBigInt")).toContain("1n");
    expect(sigs.get("fU8")).toContain("4");
    expect(sigs.get("fDV")).toContain("8");
    expect(sigs.get("fAgg")).toContain('"m"');
    expect(sigs.get("fEsc")).toContain('"a%20b"');
    expect(collectEvalDiagnostics(reportSrc).builtinUnknown.map((b) => b.name)).toEqual([]);

    const known = Object.keys(esEnvGlobals());
    expect(collectEvalDiagnostics("export function f(){ return BigInt(1); }", known).builtinUnknown.map((b) => b.name)).toEqual([]);
    expect(collectEvalDiagnostics("export function f(){ return WeakRef; }").builtinUnknown.map((b) => b.name)).not.toContain("WeakRef");
    expect(collectEvalDiagnostics("export function f(){ return WeakRef; }", known).builtinUnknown.map((b) => b.name)).not.toContain("WeakRef");
    expect(collectEvalDiagnostics("export function f(){ return Atomics; }").builtinUnknown.map((b) => b.name)).toContain("Atomics");
  });

});

// ---------------------------------------------------------------------------
// 族 62 · 第 5 条 —— env promise 的拒绝 reason 逐声明可见
// ---------------------------------------------------------------------------
describe("— env promise 的拒绝 reason 逐声明可见", () => {
/**
 * 族 62 · env es / web 内建构造器与 brand 精度 —— 5 条精度债的钉。
 *
 * 本文件覆盖台账 5 条：
 * | # | 主题 | 本分片的落点 |
 * |---|------|----------------|
 * | 1 | Intl 子构造器**实例方法面** | **声明面**已建模（Collator / NumberFormat / DateTimeFormat）；运行时面由**族 65 · 第 4 条**补齐（core 的 `BUILTIN_BRAND_METHODS`）⇒ 旗标已摘、断言转正 |
 * | 2 | AggregateError 的 `errors` | 台账前提与原生**不符**（原生缺省实参**抛 TypeError**）⇒ 按原生钉；**不改**引擎行为 |
 * | 3 | Error 的 `cause` 槽 | 自有键已可判（正钉）；**继承**键由**族 65 · 第 5 条**收口（core 的 `errorBrandAbs`）⇒ 旗标已摘、断言转正 |
 * | 4 | 类型化数组的**对象源**逐元素 ToNumber | 元素**值**面由**族 65 · 第 6 条**收口（core 的 `makeTypedArrayAbs`）⇒ 旗标已摘、断言转正 |
 * | 5 | env promise 的**拒绝 reason** | **env 侧真修**：逐声明给 reason（fetch / body 读取 / crypto.subtle / clipboard / Promise.reject） |
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






const esEnv = defineEnv();
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


  it("fetch / subtle / body / clipboard 品牌；多 reason 保持 unknown；Promise.reject 实参；成员集不变", () => {
    const nameOf = (src: string) => sigOf(src, "f", webEnv.globals);
    expect(nameOf(`export async function f() { try { await fetch("https://example.invalid"); return "ok"; } catch (e) { return e.name; } }`)).toContain('"TypeError"');
    expect(nameOf(`export async function f() { try { await fetch("https://example.invalid"); return "ok"; } catch (e) { return e.message; } }`)).toContain("string");
    expect(nameOf(`export async function f() { try { await crypto.subtle.digest("SHA-256", new Uint8Array([1])); return "ok"; } catch (e) { return e.name; } }`)).toContain('"OperationError"');
    expect(nameOf(`export async function f() { try { await new Response("x").json(); return "ok"; } catch (e) { return e.name; } }`)).toContain('"TypeError"');
    expect(nameOf(`export async function f() { try { await navigator.clipboard.readText(); return "ok"; } catch (e) { return e.name; } }`)).toContain('"NotAllowedError"');
    expect(nameOf(`export async function f() { try { await crypto.subtle.importKey("raw", new Uint8Array([1]), "AES-GCM", false, ["encrypt"]); return "ok"; } catch (e) { return e; } }`)).toContain("unknown");
    expect(nameOf(`export async function f() { try { await navigator.locks.request("x", () => {}); return "ok"; } catch (e) { return e; } }`)).toContain("unknown");

    const reject = memberOf(esEnv.globals["Promise"], "reject")!;
    const shaped = absOnly(getFnImpl(reject)!.apply!([numLit(42)]))!;
    const sh = shaped.shape as { k: string; eff?: string; rejected?: Abs };
    expect(sh.k).toBe("eff");
    expect(sh.eff).toBe("promise");
    expect(formatShape(sh.rejected!)).toContain("42");

    const subtle = memberOf(webEnv.globals["crypto"], "subtle")!;
    expect(Object.keys((subtle.shape as { slots: Record<string, { value: Abs }> }).slots).sort()).toEqual([
      "decrypt","deriveBits","deriveKey","digest","encrypt","exportKey","generateKey","importKey","sign","unwrapKey","verify","wrapKey",
    ]);
  });


/* ── 第 1 条：Intl 子构造器的实例方法面 ──────────────────────────── */

describe("— Intl 子构造器的实例方法面（声明面）", () => {
  it("Collator / NumberFormat / DateTimeFormat 实例面；未建模子构造器空；Intl 成员集；运行时 typeof", () => {
    const collator = instanceSlotsOf(memberOf(esEnv.globals["Intl"], "Collator")!);
    expect(Object.keys(collator).sort()).toEqual(["compare", "resolvedOptions"]);
    expect(formatShape(collator["compare"]!)).toContain("=>");
    expect(formatShape(collator["compare"]!)).toContain("number");
    expect(formatShape(collator["resolvedOptions"]!)).toContain("=>");

    for (const name of ["NumberFormat", "DateTimeFormat"]) {
      const inst = instanceSlotsOf(memberOf(esEnv.globals["Intl"], name)!);
      expect(Object.keys(inst).sort(), name).toEqual(["format","formatRange","formatRangeToParts","formatToParts","resolvedOptions"]);
      expect(formatShape(inst["format"]!), name).toContain("string");
      expect(formatShape(inst["formatToParts"]!), name).toContain("[]");
    }

    for (const name of ["ListFormat", "Segmenter", "Locale", "PluralRules"]) {
      expect(Object.keys(instanceSlotsOf(memberOf(esEnv.globals["Intl"], name)!)), name).toEqual([]);
    }
    const intlSlots = (esEnv.globals["Intl"]!.shape as { slots: Record<string, { value: Abs }> }).slots;
    expect(Object.keys(intlSlots).sort()).toEqual(["Collator","DateTimeFormat","DisplayNames","ListFormat","Locale","NumberFormat","PluralRules","RelativeTimeFormat","Segmenter","getCanonicalLocales","supportedValuesOf"]);

    const r = checkSource("/t/env-bug-62-intl-runtime.js", "export function f() { return typeof new Intl.Collator().compare; }", pTrue, { inject: { envGlobals: esEnv.globals } });
    expect(formatAbs(r.signatures.find((s) => s.name === "f")!.abs)).toContain('"function"');
  });
});

/* ── 第 2 条：AggregateError 的 errors 面（按原生钉） ──────────────── */

describe("— AggregateError 的 errors 面", () => {
  it("缺省抛 TypeError；⇒ []；抽象实参 unknown", () => {
    expect(sigOf("export function f() { return new AggregateError().errors; }")).toContain("never");
    expect(issuesOf("export function f() { return new AggregateError(); }").join(" | ")).toContain("TypeError");
    expect(sigOf("export function f() { return new AggregateError([]).errors; }")).toContain("[]");
    const abstract = sigOf("export function f(a) { return new AggregateError(a).errors; }");
    expect(abstract).not.toContain("[]");
    expect(abstract).toMatch(/any|unknown/);
  });
});

/* ── 第 3 条：Error 的 cause 槽 ───────────────────────────────────── */

describe("— Error 的 cause 槽", () => {
  it("自有 cause 读出值；无 options 为 undefined；继承 cause 为 unknown 非 undefined", () => {
    expect(sigOf('export function f() { return new Error("m", {cause: 1}).cause; }')).toContain("1");
    const none = sigOf('export function f() { return new Error("m").cause; }');
    expect(none).toContain("undefined");
    expect(none).not.toContain("unknown");
    const inherited = sigOf('export function f() { const o = Object.create({cause: 1}); return new Error("m", o).cause; }');
    expect(inherited).toContain("unknown");
    expect(inherited).not.toContain("undefined");
  });
});

/* ── 第 4 条：类型化数组的元素面 ─────────────────────────────────── */

describe("— 类型化数组的元素面", () => {
  it("数组元素与对象源 ToNumber 都折精确值", () => {
    const direct = sigOf("export function f() { return new Int8Array([1])[0]; }");
    expect(direct).toContain("1");
    expect(direct).not.toMatch(/undefined #exact/);
    const objectSource = sigOf('export function f() { return new Int8Array(["3"])[0]; }');
    expect(objectSource).toContain("3");
    expect(objectSource).not.toContain("undefined");
  });
});
});

// ---------------------------------------------------------------------------
// web browser constructors keep their brand
// ---------------------------------------------------------------------------
describe("web browser constructors keep their brand", () => {
/**
 * 族 15 · web env 的浏览器构造器返回**普通对象面**（无 brand）
 * ⇒ `instanceof` **恒假**、`constructor.name` 恒 `"Object"` ⇒ 与宿主**相反**
 * ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。node env 同 API 全对。
 *
 * 修法：实例面改 `brandOf("Event")` 等（与 node env 同源）。
 *
 * 反向钉：把 `EventInstance` 改回 `objAbs(eventSlots)` ⇒ 本文件必挂。
 *
 * ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env
 * 的槽表（实测 `.get` 折 unknown，`env-` 回归）⇒ 暂不加 brand
 * （见 web.ts 的说明）。其余 12 个构造器均已带 brand。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}


  it("instanceof/constructor.name 与宿主一致；12 个构造器实例面都带 brand", () => {
    const out = host(`const e = new Event("t"); console.log(JSON.stringify({ inst: e instanceof Event, name: e.constructor.name, req: new Request("http://x/") instanceof Request, hdr: new Headers() instanceof Headers }));`);
    expect(JSON.parse(out)).toEqual({ inst: true, name: "Event", req: true, hdr: true });
    expect(checkWeb('export function f(){ return new Event("t") instanceof Event; }').signatures[0]!.display).toBe("true");
    expect(checkWeb('export function f(){ const e = new Event("t"); if (e instanceof Event) { return "is-event"; } return "not-event"; }').signatures[0]!.display).toBe('"is-event"');
    expect(checkWeb('export function f(){ return new Event("t").constructor.name; }').signatures[0]!.display).toBe('"Event"');
    expect(checkWeb('export function f(){ const r = new Request("http://x/"); return [r instanceof Request, new Headers() instanceof Headers, new AbortController() instanceof AbortController]; }').signatures[0]!.display).toBe("[true, true, true]");

    const globals = webEnvGlobals();
    for (const name of ["Event","CustomEvent","Request","Response","Headers","AbortController","EventTarget","DOMParser","XMLHttpRequest","Worker","FileReader","IntersectionObserver"]) {
      const g = globals[name];
      expect(g?.shape.k, name).toBe("fn");
      const ret = (g!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType;
      expect(ret?.shape.k, name).toBe("brand");
      expect(ret?.shape.name, name).toBe(name);
    }
  });

});

// ---------------------------------------------------------------------------
// web browser constructors are constructible
// ---------------------------------------------------------------------------
describe("web browser constructors are constructible", () => {
/**
 * 族 29 web env 的浏览器构造器缺 `ctor: true`。
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

  it("全部可 new 零错误；ctor:true；Response 实例面；URL/AbortController 保持", () => {
    const out = checkWeb(`export function f() { const a = new Request("https://x.dev"); const b = new Response(); const c = new Headers(); const d = new URLSearchParams("a=1"); const e = new EventTarget(); const g = new Event("x"); const h = new CustomEvent("x"); return [a, b, c, d, e, g, h]; }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
    for (const name of ["Request","Response","Headers","URLSearchParams","EventTarget","Event","CustomEvent"] as const) expect(ctorFlagOf(name), name).toBe(true);
    expect(instanceSlotOf("Response", "status")).toBeTruthy();
    expect(instanceSlotOf("Response", "ok")).toBeTruthy();
    expect(ctorFlagOf("URL")).toBe(true);
    expect(ctorFlagOf("AbortController")).toBe(true);
    expect(checkWeb('export function f() { const u = new URL("https://x.dev"); const a = new AbortController(); return [u, a]; }').errorCodes).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// web browser globals are declared
// ---------------------------------------------------------------------------
describe("web browser globals are declared", () => {
/**
 * 族 29 env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。
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

  it("11 个全局声明；使用时零 ReferenceError；screen/构造器/indexedDB/caches 成员", () => {
    const globals = webEnvGlobals();
    for (const name of ["alert","screen","DOMParser","XMLHttpRequest","Worker","FileReader","matchMedia","IntersectionObserver","getComputedStyle","indexedDB","caches"] as const) expect(globals[name], name).toBeTruthy();
    const out = checkWeb(`export function f() { alert("hi"); const w = screen.width; const p = new DOMParser(); const x = new XMLHttpRequest(); const wk = new Worker("/w.js"); const fr = new FileReader(); const mq = matchMedia("(min-width: 100px)"); const io = new IntersectionObserver(function () {}); const cs = getComputedStyle(document.body); const db = indexedDB.open("db"); const cc = caches.open("c"); return [w, p, x, wk, fr, mq, io, cs, db, cc]; }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.issues.filter((i) => /ReferenceError/.test(i.message))).toEqual([]);
    for (const name of ["width","height","availWidth","availHeight","colorDepth","pixelDepth","orientation"] as const) {
      const slots = globals["screen"]?.shape.k === "obj" ? globals["screen"].shape.slots : undefined;
      expect(slots?.[name], name).toBeTruthy();
    }
    const ctorOut = checkWeb(`export function f() { const p = new DOMParser(); const x = new XMLHttpRequest(); const wk = new Worker("/w.js"); const fr = new FileReader(); const io = new IntersectionObserver(function () {}); return [p, x, wk, fr, io]; }`);
    expect(ctorOut.errorCodes).toEqual([]);
    expect(ctorOut.throwBrands).toEqual([]);
    const idb = globals["indexedDB"]?.shape.k === "obj" ? globals["indexedDB"].shape.slots : undefined;
    for (const name of ["open","deleteDatabase","databases","cmp"] as const) expect(idb?.[name], name).toBeTruthy();
    const caches = globals["caches"]?.shape.k === "obj" ? globals["caches"].shape.slots : undefined;
    for (const name of ["open","has","delete","match","keys"] as const) expect(caches?.[name], name).toBeTruthy();
  });

});

// ---------------------------------------------------------------------------
// document / performance member tables are complete
// ---------------------------------------------------------------------------
describe("document / performance member tables are complete", () => {
/**
 * 族 29 web env 的 `document` / `performance` 成员表不完整。
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

  it("collection 查询/静态集合/write/open/close/performance 成员全部声明且调用零错", () => {
    const collections = checkWeb('export function f() { const a = document.getElementsByTagName("div"); const b = document.getElementsByClassName("cls"); const c = document.getElementsByName("nm"); return [a, b, c]; }');
    expect(collections.errorCodes).toEqual([]);
    expect(collections.throwBrands).toEqual([]);
    expect(slotOf("document", "getElementsByTagName")).toBeTruthy();
    expect(checkWeb('export function f(){ return document.getElementsByTagName("div"); }').errorCodes).toEqual([]);
    for (const name of ["forms","links","images","scripts"] as const) expect(slotOf("document", name), name).toBeTruthy();
    expect(checkWeb("export function f(){ return document.forms.length; }").errorCodes).toEqual([]);
    for (const name of ["write","open","close"] as const) expect(slotOf("document", name), name).toBeTruthy();
    const writes = checkWeb('export function f(){ document.write("x"); document.open(); document.close(); return 1; }');
    expect(writes.errorCodes).toEqual([]);
    for (const name of ["getEntries","clearResourceTimings","toJSON"] as const) expect(slotOf("performance", name), name).toBeTruthy();
    expect(checkWeb("export function f(){ performance.clearResourceTimings(); return performance.getEntries(); }").errorCodes).toEqual([]);
    for (const name of ["navigation","serverTiming"] as const) expect(slotOf("performance", name), name).toBeTruthy();
  });

});

// ---------------------------------------------------------------------------
// web env declares the browser globals it models
// ---------------------------------------------------------------------------
describe("web env declares the browser globals it models", () => {
/**
 * 族 15 · web env **根本没声明** 13 个浏览器标准全局
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


  it("13 个全局已声明；使用它们零 error/零 throw", () => {
    const globals = webEnvGlobals();
    for (const [name] of CASES) expect(globals[name], name).toBeTruthy();
    for (const [name, body] of CASES) {
      const out = checkWeb(`export function f(){ ${body} }`);
      expect(out.errorCodes, name).toEqual([]);
      expect(out.throwBrands, name).toEqual([]);
    }
  });

});

// ---------------------------------------------------------------------------
// performance.mark/measure return PerformanceEntry values
// ---------------------------------------------------------------------------
describe("performance.mark/measure return PerformanceEntry values", () => {
/**
 * 族 15 · web env 把 `performance.mark` 的返回类型**写死成
 * `undefined`**（宿主返回 `PerformanceMark`）⇒ `m.name` 读在 undefined 上
 * ⇒ 判「确定抛 TypeError」⇒ L2 假红；node env 同一 API 对 ⇒ 两 env 互斥。
 *
 * 反向钉：把 `mark` 的返回改回 `undef()` ⇒ 本文件必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}


  it("mark 返回 PerformanceMark 品牌；.name string；measure 有 name/duration", () => {
    const out = host(`const m = performance.mark("start"); console.log(JSON.stringify({ ctor: m.constructor.name, name: m.name }));`);
    expect(JSON.parse(out)).toEqual({ ctor: "PerformanceMark", name: "start" });

    const markName = checkWeb('export function markName(){ const m = performance.mark("start"); return m.name; }');
    expect(markName.throwBrands).toEqual([]);
    expect(markName.errorCodes).toEqual([]);
    expect(markName.signatures[0]!.display).toBe("string");

    const mark = slotOf("performance", "mark");
    expect(mark?.shape.k).toBe("fn");
    const ret = (mark!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType;
    expect(ret?.shape.k).toBe("brand");
    expect(ret?.shape.name).toBe("PerformanceMark");

    const measure = checkWeb('export function f(){ const m = performance.measure("x"); return [m.name, m.duration]; }');
    expect(measure.throwBrands).toEqual([]);
    expect(measure.signatures[0]!.display).toContain("string");
    expect(measure.signatures[0]!.display).toContain("number");
  });

});

// ---------------------------------------------------------------------------
// navigator.hardwareConcurrency is modelled
// ---------------------------------------------------------------------------
describe("navigator.hardwareConcurrency is modelled", () => {
/**
 * 族 29 web env 的 `navigator` 面缺 `hardwareConcurrency`。
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

  it("声明 number；读面 number；比较折 boolean 而非硬编码 false", () => {
    expect(slotOf("navigator", "hardwareConcurrency")).toBeTruthy();
    const read = checkWeb("export function f(){ return navigator.hardwareConcurrency; }");
    expect(read.errorCodes).toEqual([]);
    expect(displayOf(read)).toMatch(/^number/);
    const cmp = checkWeb("export function f(){ return navigator.hardwareConcurrency > 4; }");
    expect(cmp.errorCodes).toEqual([]);
    expect(displayOf(cmp)).toMatch(/^boolean/);
    expect(displayOf(cmp)).not.toMatch(/^false/);
  });

});

// ---------------------------------------------------------------------------
// location.searchParams is modelled
// ---------------------------------------------------------------------------
describe("location.searchParams is modelled", () => {
/**
 * 族 29 web env 的 `location` 全局成员表缺 `searchParams`。
 *
 * 根因：`location` 是**闭合**对象（`objAbs` 默认 closed），槽表只列了 12 个成员，
 * 漏了 `searchParams` ⇒ 成员读落到「闭 obj 缺槽」⇒ **exact `undefined`** ⇒
 * 链式读 `.get` ⇒ 引擎判「**确定抛 TypeError**」⇒ 该函数体整个变成
 * throw-only ⇒ 返回域落成 `never` ⇒ `nudo:entry-may-throw`（error）⇒ 门禁假红。
 *
 * 原生 oracle（浏览器 `Location` 实例；node 锚点）：
 * new URL("http://x/?q=1").searchParams.get("q") → "1"
 * location.searchParams.get("q") → string | null（**恒不抛**）
 *
 * 反向钉：删掉 `searchParams` 槽 ⇒ 本文件必挂。
 */

  it("searchParams 已声明；get 零抛且折 string | null；其余成员仍在", () => {
    expect(slotOf("location", "searchParams")).toBeTruthy();
    const out = checkWeb('export function f(){ return location.searchParams.get("q"); }');
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
    expect(displayOf(out)).toMatch(/^string \| null/);
    for (const name of ["href","origin","protocol","host","pathname","search","hash"] as const) expect(slotOf("location", name), name).toBeTruthy();
  });

});

// ---------------------------------------------------------------------------
// Request has its own member table
// ---------------------------------------------------------------------------
describe("Request has its own member table", () => {
/**
 * 族 29 web env 的 `Request` **整份复制了 `Response` 的成员表**。
 *
 * 根因：`bodySlots` 同时被 `Response` 与 `Request` 用 `...` 展开 ⇒ Response
 * 专有的状态面（`ok` / `status` / `statusText` / `redirected` / `type`）被复制
 * 给了 `Request` ⇒ `r.status` 折成 **exact `number`**（原生恒为 `undefined`）
 * ⇒ 引擎给出**确定的错误类型**（错值），且会传播到 dts / zod / guard 产物面。
 *
 * 原生 oracle（node v26.10.0，undici `Request`）：
 * new Request("https://example.com").status → undefined
 * new Request("https://example.com").ok → undefined
 * new Request("https://example.com").method → "GET"
 * new Request("https://example.com").bodyUsed → false （**共有**成员）
 *
 * 反向钉：把状态面塞回 Request ⇒ 本文件必挂。
 */

  it("无 Response 状态面；保留自身成员；bodyUsed 共有；status/ok undefined、method string", () => {
    for (const name of ["status","ok","statusText","redirected","type"] as const) expect(instanceSlotOf("Request", name), name).toBeUndefined();
    for (const name of ["method","body","mode","credentials","cache","redirect","referrer","integrity","signal"] as const) expect(instanceSlotOf("Request", name), name).toBeTruthy();
    expect(instanceSlotOf("Request", "bodyUsed")).toBeTruthy();
    expect(instanceSlotOf("Response", "bodyUsed")).toBeTruthy();
    for (const name of ["status","ok","statusText","redirected","type"] as const) expect(instanceSlotOf("Response", name), name).toBeTruthy();

    const status = checkWeb('export function f(){ const r = new Request("https://example.com"); return r.status; }');
    expect(displayOf(status)).toMatch(/^undefined/);
    const ok = checkWeb('export function f(){ const r = new Request("https://example.com"); return r.ok; }');
    expect(displayOf(ok)).toMatch(/^undefined/);
    const method = checkWeb('export function f(){ const r = new Request("https://example.com"); return r.method; }');
    expect(displayOf(method)).toMatch(/^string/);
  });

});

// ---------------------------------------------------------------------------
// AbortSignal.any is declared
// ---------------------------------------------------------------------------
describe("AbortSignal.any is declared", () => {
/**
 * 族 29 web env 的 `AbortSignal` 面缺静态工厂 `any`。
 *
 * 根因：`AbortSignal` 只建模了 `abort` / `timeout` 两个静态方法 ⇒ 成员读 `any`
 * 落到 exact `undefined` ⇒ 调用 undefined ⇒ **定抛 TypeError** ⇒ L2 门禁假红。
 *
 * 原生 oracle（node v26.10.0）：`typeof AbortSignal.any === "function"`，
 * `AbortSignal.any([])` 返回 `AbortSignal` 实例 ⇒ **不抛**。
 *
 * 反向钉：删掉 `any` 槽 ⇒ 本文件必挂。
 */

  it("any/abort/timeout 均在；any([]) 零抛", () => {
    for (const name of ["any","abort","timeout"] as const) expect(slotOf("AbortSignal", name), name).toBeTruthy();
    const out = checkWeb("export function f(){ return AbortSignal.any([]); }");
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).not.toContain("TypeError");
  });

});

// ---------------------------------------------------------------------------
// WebCrypto rejections include TypeError at the call site
// ---------------------------------------------------------------------------
describe("WebCrypto rejections include TypeError at the call site", () => {
/**
 * 族 15 · web env 把 `crypto.subtle` 的拒绝 reason **一刀切收窄成
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


  it("宿主 TypeError；TypeError/OperationError 两臂可达；静态声明仍 OperationError；importKey unknown", () => {
    expect(host('crypto.subtle.encrypt("AES-GCM", 1, 2).catch((e) => console.log(e.name));')).toBe("TypeError");
    const enc = checkWeb(TRY_CATCH('crypto.subtle.encrypt("AES-GCM", 1, 2)'));
    expect(enc.signatures[0]!.display).toContain("caught-typeerror");
    expect(enc.signatures[0]!.display).toContain("other");
    const digest = checkWeb(TRY_CATCH('crypto.subtle.digest("SHA-256", new Uint8Array([1]))'));
    expect(digest.signatures[0]!.display).toContain("other");
    expect(digest.errorCodes).toEqual([]);

    const ret = (slotOf("crypto", "subtle", "digest")!.shape as { returnType?: { shape: { k: string; rejected?: { shape: { k: string; name?: string } } } } }).returnType;
    expect(ret?.shape.k).toBe("eff");
    expect(ret?.shape.rejected?.shape.k).toBe("brand");
    expect(ret?.shape.rejected?.shape.name).toBe("OperationError");
    expect(checkWeb(TRY_CATCH('crypto.subtle.importKey("raw", new Uint8Array([1]), "AES-GCM", false, ["encrypt"])')).signatures[0]!.display).toContain("caught-typeerror");
  });

});

// ---------------------------------------------------------------------------
// host objects model the members the host actually has
// ---------------------------------------------------------------------------
describe("host objects model the members the host actually has", () => {
/**
 * 族 15 · env 的宿主对象是**封闭**的：未建模成员读出
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


  it("Response.body / Headers.getSetCookie / document.location / CustomEvent / Request.duplex", () => {
    const out = host(`const body = new Response("hi").body;
      console.log(JSON.stringify({ body: body.constructor.name, cookies: new Headers().getSetCookie(), locHasHref: typeof new URL("http://x/").href }));`);
    expect(JSON.parse(out)).toEqual({ body: "ReadableStream", cookies: [], locHasHref: "string" });

    const reader = checkWeb('export function reader(){ return new Response("hi").body.getReader(); }');
    expect(reader.throwBrands).toEqual([]);
    expect(reader.errorCodes).toEqual([]);
    const cookies = checkWeb("export function cookies(){ return new Headers().getSetCookie(); }");
    expect(cookies.errorCodes).toEqual([]);
    expect(cookies.throwBrands).toEqual([]);
    expect(cookies.signatures[0]!.display).toContain("string[]");
    const doc = checkWeb('export function href(){ return document.location.href; }\nexport function title(){ return document.title; }');
    expect(doc.errorCodes).toEqual([]);
    expect(doc.throwBrands).toEqual([]);
    for (const s of doc.signatures) expect(s.display).toBe("string");

    const custom = checkNode('export function f(){ const e = new CustomEvent("t"); e.preventDefault(); return e.timeStamp; }');
    expect(custom.throwBrands).toEqual([]);
    expect(custom.errorCodes).toEqual([]);
    expect(slotOfAbs(instanceFaceOf("Request"), "duplex")).toBeTruthy();
    expect(checkNode('export function f(){ return new Request("http://x/").duplex; }').throwBrands).toEqual([]);
  });

});

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
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo, formatAbs, type Abs } from "@nudojs/core";
// 测试专用：service → env 是生产依赖方向；此处反向引用只为验证
// `collectEvalDiagnostics` 的「已被覆盖」判定（vitest 别名走 src，不依赖 dist）。
import { collectEvalDiagnostics } from "@nudojs/service";
import { defineEnv } from "../es.ts";

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
    const src = CORE_MODELED_ES_GLOBALS.map(
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

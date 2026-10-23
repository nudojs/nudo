/**
 * Bug 1058 / Bug 1059 回归：引擎**内部临时名**必须与用户标识符**避让**。
 *
 * 同根因（Bug 181 的修复只装在了解构临时名族上 ⇒ 这里只装了一半）：
 * 引擎为转译生成的内部绑定（`arguments` 槽 `__nudoArgs` / try 标记
 * `__nudoTm_{n}` / catch 载体 `__nudoE_{n}` / try 内 return 载体
 * `__nudoRet` / 写回载体 `__mutRet` / 函数体 catch 载体 `__nudoFnRet` …）
 * 一律用**固定名**发射 ⇒ 用户源码里写了同名标识符时两种失效形态都成立：
 *
 * - **同作用域重复词法声明**（Bug 1058）⇒ 产物不是合法 JS ⇒ `new Function`
 *   编译期 SyntaxError ⇒ 求值器 fail-closed ⇒ **整模块**导出退化 unknown +
 *   **假** `nudo:opaque-result`（「path not covered, or native」——误导诊断）
 *   ⇒ 门禁 exit 0 **假绿**；连**无关**的导出也失去签名。
 * - **内层遮蔽**用户同名外层绑定（Bug 1059）⇒ 引擎的 `const __nudoRet =
 *   <用户表达式>` 在**自己的初始化器**里读 `__nudoRet` ⇒ TDZ
 *   ReferenceError ⇒ 被用户自己的 `catch` 吞掉 ⇒ 原生 `15` 被算成 `0`
 *   （wrong-exact）⇒ 签名面写成 `=> 0` ⇒ 门禁假绿。
 *
 * 修法（`transpile/helpers.ts` 的 `internalTmpName`）：生成内部名时用
 * `userIdentInfo(source).names`（源文本里出现过的**全部标识符词形**，保守
 * 超集）做避让——撞名则加 `_k` 后缀（跳过已占用名）。避让在**整个转译单元**
 * 生效（不做作用域分析：内层声明的用户名也会遮蔽外层生成的临时名）⇒ 生成名
 * 与用户标识符词形永不相撞；**无碰撞时原名返回** ⇒ 产物逐字不变；同一源文本
 * ⇒ 同一名 ⇒ 产物**确定性**（缓存键 / 差分语料依赖它）。
 *
 * 锚定值均为 node 原生实测：
 * - `f(5)`：原生 `15`（`const __nudoRet = 10; try { return __nudoRet + x; }
 *   catch (e) { return 0; }`）
 * - `f(1)`：原生 `8`（`const __nudoTm_0 = 7; try { throw … } catch (e) {
 *   return __nudoTm_0 + x; }`）
 * - `f()`：原生 `0`（`const __nudoArgs = 1; return arguments.length;`）
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { transpileSource, checkSource, pTrue } from "../index.ts";
import { callLit } from "./eval-helpers.ts";

/** 引擎求值结果字面量值 */
function v(src: string, ...args: unknown[]) {
  return litValue(callLit(src, "f", ...args).result);
}

/** check 门禁的签名面（函数名 → display） */
function sigOf(src: string, name = "f"): string | undefined {
  const r = checkSource("/t/collide.js", src, pTrue, {});
  return r.signatures.find((s) => s.name === name)?.display;
}

/** check 门禁的诊断码集 */
function issueCodes(src: string): string[] {
  const r = checkSource("/t/collide.js", src, pTrue, {});
  return r.issues.map((i) => i.code);
}

// --- 1059：try 内 return 载体 `__nudoRet` 遮蔽用户同名外层绑定 ---
const SRC_RET = `export function f(x) {
  const __nudoRet = 10;
  try { return __nudoRet + x; } catch (e) { return 0; }
}`;
/** 对照：用户标识符不同名 ⇒ 不遮蔽（原生同值） */
const SRC_RET_CTRL = `export function f(x) {
  const __nudoRetX = 10;
  try { return __nudoRetX + x; } catch (e) { return 0; }
}`;
/** 字面量版：签名面可精确到 15（`x: any` 时只能给 `number | string`） */
const SRC_RET_LIT = `export function f() {
  const __nudoRet = 10;
  try { return __nudoRet + 5; } catch (e) { return 0; }
}`;

// --- 1058：try 标记 / catch 载体 / arguments 槽 与用户同名 ---
const SRC_TM = `export function f(x) {
  const __nudoTm_0 = 7;
  try { throw new Error("x"); } catch (e) { return __nudoTm_0 + x; }
}
export function g(x) { return x * 2; }`;
/** 对照：用户标识符不同名（行为基线——含 try 内 throw 的 may-throw 面） */
const SRC_TM_CTRL = `export function f(x) {
  const __nudoTm_0x = 7;
  try { throw new Error("x"); } catch (e) { return __nudoTm_0x + x; }
}
export function g(x) { return x * 2; }`;
const SRC_E = `export function f(x) {
  const __nudoE_0 = 7;
  try { throw new Error("x"); } catch (e) { return __nudoE_0 + x; }
}
export function g(x) { return x * 2; }`;
const SRC_E_CTRL = `export function f(x) {
  const __nudoE_0x = 7;
  try { throw new Error("x"); } catch (e) { return __nudoE_0x + x; }
}
export function g(x) { return x * 2; }`;
const SRC_ARGS = `export function f() {
  const __nudoArgs = 1;
  return arguments.length;
}
export function g() { return 7; }`;

describe("Bug 1059 — try 内 return 载体 __nudoRet 不遮蔽用户同名绑定", () => {
  it("引擎结果 = 原生 15（修前：TDZ ReferenceError 被用户 catch 吞掉 ⇒ 0）", () => {
    expect(v(SRC_RET, 5)).toEqual({ ok: true, value: 15 });
  });

  it("签名面写 15（不是 => 0）", () => {
    expect(sigOf(SRC_RET_LIT)).toBe("15");
  });

  it("参数版签名面与无碰撞对照逐字一致（修前：=> 0）", () => {
    expect(sigOf(SRC_RET)).toBe("number | string");
    expect(sigOf(SRC_RET)).toBe(sigOf(SRC_RET_CTRL));
  });

  it("无假 nudo:opaque-result（修前：模块 fail-closed ⇒ unknown + 假 opaque）", () => {
    expect(issueCodes(SRC_RET)).not.toContain("nudo:opaque-result");
  });
});

describe("Bug 1058 — 内部临时名（__nudoTm_ / __nudoE_ / __nudoArgs）与用户标识符避让", () => {
  it("用户写 __nudoTm_0：模块不退化 unknown（结果 = 原生 8）", () => {
    expect(v(SRC_TM, 1)).toEqual({ ok: true, value: 8 });
  });

  it("用户写 __nudoE_0：catch 载体不遮蔽用户绑定（结果 = 原生 8）", () => {
    expect(v(SRC_E, 1)).toEqual({ ok: true, value: 8 });
  });

  it("用户写 __nudoArgs：arguments 槽不重复声明（结果 = 原生 0）", () => {
    expect(v(SRC_ARGS)).toEqual({ ok: true, value: 0 });
  });

  it("整模块不再 fail-closed：无关导出 g 仍拿到签名（与无碰撞对照逐字一致）", () => {
    expect(sigOf(SRC_TM, "g")).toBe(sigOf(SRC_TM_CTRL, "g"));
    expect(sigOf(SRC_E, "g")).toBe(sigOf(SRC_E_CTRL, "g"));
    expect(sigOf(SRC_ARGS, "g")).toBe("7");
  });

  it("无假 nudo:opaque-result（修前：整模块 unknown + 2 条假 opaque）", () => {
    expect(issueCodes(SRC_TM)).not.toContain("nudo:opaque-result");
    expect(issueCodes(SRC_E)).not.toContain("nudo:opaque-result");
    expect(issueCodes(SRC_ARGS)).not.toContain("nudo:opaque-result");
  });

  it("不退化 unknown（修前：f/g 全 unknown）", () => {
    expect(sigOf(SRC_TM, "f")).not.toBe("unknown");
    expect(sigOf(SRC_E, "f")).not.toBe("unknown");
    expect(sigOf(SRC_ARGS, "f")).not.toBe("unknown");
  });
});

describe("负控 / 确定性 — 用户标识符不撞名时行为逐字不变", () => {
  const CTRL = `export function f(x) {
  const a = 10;
  try { return a + x; } catch (e) { return 0; }
}
export function g() { return arguments.length; }`;

  it("内部临时名逐字保持原形（__nudoTm_0 / __nudoRet / __nudoArgs，无后缀改名）", () => {
    const js = transpileSource(CTRL, { source: CTRL });
    expect(js).toContain("const __nudoTm_0 = $tryMark();");
    expect(js).toContain("const __nudoRet = $add(a, x);");
    expect(js).toContain("let __nudoArgs = $arguments(arguments);");
    // 无避让后缀（撞名时才改名）
    expect(js).not.toMatch(/__nudo[A-Za-z0-9_]*_1\b/);
  });

  it("同一源码转译两次 ⇒ 产物逐字相同（确定性：缓存键 / 差分语料依赖它）", () => {
    const a = transpileSource(CTRL, { source: CTRL });
    const b = transpileSource(CTRL, { source: CTRL });
    expect(a).toBe(b);
  });

  it("撞名时改名后仍确定（同源两次转译逐字相同）", () => {
    const a = transpileSource(SRC_RET, { source: SRC_RET });
    const b = transpileSource(SRC_RET, { source: SRC_RET });
    expect(a).toBe(b);
    expect(a).toContain("const __nudoRet_1 = $add(__nudoRet, x);");
  });
});

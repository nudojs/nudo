/**
 * Bug 1073 回归：for 循环变量捕获槽 `__nudoLv{N}` 必须**避开用户标识符**。
 *
 * 背景（Bug 228 的捕获槽）：`for (let i = …)` 的循环变量在体里是形参槽，
 * 体退出瞬间的最新写经 try/finally 写回**共享槽**（`__nudoLv{N}`），`$for`
 * 的 continue 臂经 `loopVar` 回调取用。槽名此前用**固定名**发射
 * （`__nudoLv${seq}`）⇒ 用户源码里声明了同名绑定时：
 *
 * ```js
 * export function f(){ const __nudoLv0 = 1; let s=0; for (let i=0;i<3;i++){ s+=i; } return s + __nudoLv0; }
 * ```
 *
 * 转译产物在**同一作用域**出现两个 `let __nudoLv0`（用户的绑定 + 生成的
 * 槽 `let`）⇒ `new Function` 抛 SyntaxError（Identifier '__nudoLv0' has
 * already been declared）⇒ 产物不是合法 JS ⇒ **整模块** fail-closed：
 * - **求值面**（`runTranspiled` / 库 API 直调）：整模块求值失败 ⇒ 全部导出
 *   退化 unknown；
 * - **check 面**：受损导出退 unknown + **假** `nudo:opaque-result`（"conf=opaque
 *   (path not covered, or native)"——误导诊断）⇒ 该导出的门禁结论失真。
 *
 * 修法（`transpile/stmt/statement.ts`）：槽名经 `internalTmpName` 生成
 * （与 Bug 1058/1059 同款）——撞名则加 `_k` 后缀；**无碰撞时原名返回**
 * ⇒ 产物逐字不变；同源文本 ⇒ 同名 ⇒ 确定性（缓存键 / 差分语料依赖它）。
 *
 * 复现口径：槽名里的 `{N}` 取自**模块级全局计数器**（`forLoopVarSeq`）⇒
 * 只有计数器命中用户同名绑定时才撞 ⇒ 回归用 `vi.resetModules()` 取
 * **全新模块实例**（计数器归零 ⇒ 首个 for 循环 ⇒ `__nudoLv0`），复现与
 * 修复都可钉死（不受同文件其它用例的转译次数影响）。
 */
import { describe, it, expect, vi } from "vitest";

/** 模块图重新求值（首个用例最慢——冷缓存 + 并行负载）⇒ 超时放宽 */
const TIMEOUT = 60_000;

/**
 * 全新模块实例（`forLoopVarSeq` 计数器归零）——转译 / 求值 / check 全部
 * 走同一份新实例（口径一致）。
 */
async function freshCore() {
  vi.resetModules();
  const core = await import("../index.ts");
  const helpers = await import("./eval-helpers.ts");
  const abs = await import("../abs.ts");
  return { ...core, ...helpers, ...abs };
}

/** 用户声明了 `__nudoLv0`（与生成槽同名）+ 另一个必抛导出（L2 门禁探针） */
const SRC = `export function f(){ const __nudoLv0 = 1; let s = 0; for (let i = 0; i < 3; i++){ s += i; } return s + __nudoLv0; }
export function risky(){ throw new Error("boom"); }`;

/** 负控制：用户不同名 ⇒ 槽名保持原形（产物逐字不变） */
const SRC_CTRL = `export function f(){ let s = 0; for (let i = 0; i < 3; i++){ s += i; } return s; }`;

/** 产物里生成的循环变量捕获槽名（`let __nudoLv…;` 声明） */
function slotNames(js: string): string[] {
  return [...js.matchAll(/\blet (__nudoLv\w*);/g)].map((m) => m[1]);
}

describe("Bug 1073 — for 循环变量槽 __nudoLv{N} 避开用户标识符", () => {
  it(
    "产物里不再有重复词法声明（修前：同作用域两个 `let __nudoLv0`）",
    async () => {
      const { transpileSource } = await freshCore();
      const js = transpileSource(SRC, { source: SRC });
      const slots = slotNames(js);
      expect(slots.length).toBe(1);
      // 槽名不得与用户同名绑定相同（否则重复词法声明 ⇒ 非法 JS）
      expect(slots[0]).not.toBe("__nudoLv0");
      // 用户的绑定原样保留
      expect(js).toContain("__nudoLv0 = $lit(1);");
    },
    TIMEOUT,
  );

  it(
    "整模块不再 fail-closed：f() 结果 = 原生 4（修前：SyntaxError ⇒ unknown）",
    async () => {
      const { call, litValue } = await freshCore();
      expect(litValue(call(SRC, "f").result)).toEqual({ ok: true, value: 4 });
    },
    TIMEOUT,
  );

  it(
    "check 面：受损导出拿到签名 + 无假 nudo:opaque-result（修前：f 退 unknown + 假 opaque）",
    async () => {
      const { checkSource, pTrue } = await freshCore();
      const r = checkSource("/t/loopvar-slot.js", SRC, pTrue, {});
      expect(r.signatures.find((s) => s.name === "f")?.display).not.toBe("unknown");
      expect(r.issues.map((i) => i.code)).not.toContain("nudo:opaque-result");
      // 无关导出的 L2 门禁仍在（不变量：门禁面不被本缺陷吞掉）
      const mayThrow = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
      expect(mayThrow.length).toBe(1);
      expect(mayThrow[0].fn).toBe("risky");
      expect(mayThrow[0].severity).toBe("error");
    },
    TIMEOUT,
  );

  it(
    "负控制：用户不同名时槽名保持原形 `__nudoLv0`（产物逐字不变）",
    async () => {
      const { transpileSource } = await freshCore();
      const js = transpileSource(SRC_CTRL, { source: SRC_CTRL });
      expect(slotNames(js)).toEqual(["__nudoLv0"]);
    },
    TIMEOUT,
  );
});

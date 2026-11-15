/**
 * Bug 890（族 29 · S6）—— **env promise 的 rejected 通道**回归钉。
 *
 * 现象：env 造的 promise **没有 rejected 通道** ⇒ core 读成「**确定
 * fulfilled**」⇒ `catch` 臂被当成**死代码** ⇒ 引擎给出**确定的错值**
 * （原生：fs/promises.readFile / fetch / crypto.subtle.digest 都可能拒绝，
 * catch 臂是活代码）。
 *
 * 根因：core 的 promise 形状有两个**可选**通道（`packages/core/src/algebra/abs.ts`）：
 * `rejected?: Abs` 与 `unsettled?: boolean`；「无该标记且无 rejected 通道
 * = 确定 fulfilled」。判定点 `packages/core/src/algebra/builtins/promise.ts`
 * 的 `settledFulfilledOf`。env 的 `promiseOf()`（`packages/env/src/abs-helpers.ts`）
 * 造出的 promise 既无 `rejected` 也无 `unsettled` ⇒ core 读成「确定 fulfilled」。
 *
 * **core 侧核对结论（本分片已核）：core 零改动。**
 * `settledFulfilledOf` / `then` / `catch` / `$await` 对**带 `rejected` 通道**
 * 的 promise 处理已经正确：
 * - `settledFulfilledOf`：`rejected !== undefined` ⇒ 不判「确定 fulfilled」；
 * - `catch`：走「拒绝通道在场但 settle 未定」分支 ⇒ 两臂 join（catch 臂活）；
 * - `then`：两臂 join；
 * - `$await`：拒绝臂进 throw 通道 ⇒ `try/catch` 可吸收 ⇒ catch 臂可达。
 * （见本文件「core 对照组」三钉——它们现在就绿。）
 *
 * **env 侧修法（`packages/env/src/abs-helpers.ts` 的 `promiseOf()`）**：给
 * promise 形状补上 `rejected` 通道 ⇒ 两臂均可能 ⇒ catch 臂保持活：
 *
 * ```ts
 * export function promiseOf(inner: Abs): Abs {
 *   return makeAbs(
 *     { k: "eff", eff: "promise", inner, rejected: unknown },
 *     undefined,
 *     undefined,
 *     "exact",
 *   );
 * }
 * ```
 *
 * （`unknown` = env 侧已有的 unknown Abs——拒绝 reason 不可知 ⇒ 两臂均可能。
 * `rejected` 是**态信息**，不进 leq / 指纹 / check 等价。）
 *
 * 📌 **状态**：本文件写完后 env 侧 `promiseOf` 已按上述改法接线 ⇒
 * 「env 侧」三条钉**已转绿**。接线前它们是红的（catch 臂是死代码 ⇒
 * 签名里没有 `"boom"`）——即本钉就是那次接线的验收门。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo } from "@nudojs/core";
import type { Abs, AbsModuleExports } from "@nudojs/core";
import { defineEnv as defineNodeEnv } from "../node.ts";
import { defineEnv as defineWebEnv } from "../web.ts";

const nodeEnv = defineNodeEnv();
const webEnv = defineWebEnv();

/** env 模块表 → core 的模块导出表（与 service 的 `collectEnvModules` 同口径） */
function modulesOf(def: {
  modules?: Record<string, Record<string, Abs>>;
}): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};
  for (const [spec, named] of Object.entries(def.modules ?? {})) {
    out[spec] = { named: { ...named } };
  }
  return out;
}

const NODE_MODULES = modulesOf(nodeEnv);
const WEB_MODULES = modulesOf(webEnv);

function check(
  src: string,
  def: { modules?: Record<string, Record<string, Abs>>; globals: Record<string, Abs> },
) {
  resetGeneralizeMemo();
  const modules = modulesOf(def);
  return checkSource("/t/x.js", src, pTrue, {
    modules,
    inject: { envGlobals: def.globals, modules },
  });
}

function sigOf(
  src: string,
  name: string,
  def: { modules?: Record<string, Record<string, Abs>>; globals: Record<string, Abs> },
): string {
  const sig = check(src, def).signatures.find((s) => s.name === name);
  expect(sig, `signature "${name}" missing`).toBeTruthy();
  return sig!.display;
}

/** try/catch 模板：catch 臂的返回值 "boom" 是「catch 臂活」的探针 */
const TRY_CATCH_BODY = (expr: string) => `try { ${expr} return "ok"; } catch (e) { return "boom"; }`;

describe("Bug 890 · env promise 必须带 rejected 通道（catch 臂是活代码）", () => {
  describe("core 对照组（现在就绿——证明 core 侧无需改动）", () => {
    it("带 rejected 通道的 promise（executor fork）⇒ catch 臂活", () => {
      const src = `export async function use(c) {
        ${TRY_CATCH_BODY(`await new Promise((res, rej) => { if (c) { res(1); } else { rej(2); } });`)}
      }`;
      const display = sigOf(src, "use", nodeEnv);
      expect(display, "catch 臂必须是活代码（值域含 catch 分支的 \"boom\"）").toContain(
        '"boom"',
      );
    });

    it("确定 fulfilled 的 promise（Promise.resolve）⇒ catch 臂死（原生同款）", () => {
      const src = `export async function use(c) {
        ${TRY_CATCH_BODY("await Promise.resolve(1);")}
      }`;
      const display = sigOf(src, "use", nodeEnv);
      expect(display, "确定 fulfilled ⇒ catch 臂是死代码").not.toContain('"boom"');
    });

    it("反向对照：把「带 rejected 通道」换成「确定 fulfilled」⇒ 断言必须失败", () => {
      // 同一断言（display 含 "boom"）作用在确定 fulfilled 的 promise 上必须不成立
      const src = `export async function use(c) {
        ${TRY_CATCH_BODY("await Promise.resolve(1);")}
      }`;
      const display = sigOf(src, "use", nodeEnv);
      expect(display).not.toContain('"boom"');
    });
  });

  describe("env 侧（promiseOf 补 rejected 通道 ⇒ catch 臂活）", () => {
    it("fs/promises.readFile ⇒ catch 臂是活代码", () => {
      const src = `/// @nudo:env node
import { readFile } from "node:fs/promises";
export async function use() {
  ${TRY_CATCH_BODY(`const b = await readFile("x.txt", "utf8");`)}
}
`;
      const display = sigOf(src, "use", nodeEnv);
      expect(
        display,
        'catch 臂是死代码 ⇒ env promise 缺 rejected 通道（promiseOf 接线后应含 "boom"）',
      ).toContain('"boom"');
    });

    it("fetch（web）⇒ catch 臂是活代码", () => {
      const src = `/// @nudo:env web
export async function use() {
  ${TRY_CATCH_BODY(`const r = await fetch("https://example.com");`)}
}
`;
      const display = sigOf(src, "use", webEnv);
      expect(
        display,
        'catch 臂是死代码 ⇒ env promise 缺 rejected 通道（promiseOf 接线后应含 "boom"）',
      ).toContain('"boom"');
    });

    it("crypto.subtle.digest（node 全局 crypto）⇒ catch 臂是活代码", () => {
      // 用**全局** `crypto`（node env 的 `crypto` 全局带完整的
      // `subtle.digest` 声明 ⇒ 返回 env 造的 promise）。
      // ⚠️ 不要用 `import { webcrypto } from "node:crypto"`——node env 的
      // `node:crypto` 模块**未声明** `webcrypto`（越界发现）⇒ 那是缺失绑定，
      // 根本不是 env promise，接线 `promiseOf` 也不会转绿。
      const src = `/// @nudo:env node
export async function use() {
  ${TRY_CATCH_BODY(`const d = await crypto.subtle.digest("SHA-256", new Uint8Array([1]));`)}
}
`;
      const display = sigOf(src, "use", nodeEnv);
      expect(
        display,
        'catch 臂是死代码 ⇒ env promise 缺 rejected 通道（promiseOf 接线后应含 "boom"）',
      ).toContain('"boom"');
    });
  });
});

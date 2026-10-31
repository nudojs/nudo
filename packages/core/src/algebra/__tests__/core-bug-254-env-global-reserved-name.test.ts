/**
 * Bug 254：core 把 env 全局注入成裸 `let <名字>` 绑定 ⇒ 名字是
 * **strict-mode 保留字**（`default` / `static` / `implements` …）时
 * `new Function` 抛 `SyntaxError: Unexpected strict mode reserved word`
 * ⇒ **整个模块 fail-closed**（导出全退 unknown）⇒ `nudo:internal` + exit 1。
 *
 * 注入点是 `exec/run.ts` 的 env 注入：查表键 `JSON.stringify(k)` 加了引号，
 * **绑定名** `${k}` 没有。而 harvester 的 `emitEnvModule` 对**任何**带 default
 * 导出的包必产一个 `default` 全局（`@types/lodash` 的 `export = _` 即命中）
 * ⇒ 那份 env 模块让**引用它的每个工程**整模块求值失败。
 *
 * 修法（与 Bug 273「模块级绑定优先」同族、同一个拼接点）：注入前校验
 * **绑定名合法性**（合法标识符 ∧ 非关键字 ∧ 非 strict-mode 保留字 ∧ 非
 * `eval`/`arguments`/`await`）；非法名**不注入**——该 env 全局当不存在，
 * 绝不让一个 env 文件里的名字把用户的整个文件打挂。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { abs, type Abs } from "../abs.ts";

/** 一个普通的 number Abs（env 全局值不重要——被检验的是**名字**） */
const NUM: Abs = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");

const MODULE = `export function use() { return 1; }`;

describe("Bug 254：env 全局名是 strict-mode 保留字时不得打挂整个模块", () => {
  it("globals { default } ⇒ 模块仍可求值（改前：new Function SyntaxError / 整模块失败）", () => {
    const out = runTranspiled(MODULE, { envGlobals: { default: NUM } });
    expect(Object.keys(out)).toContain("use");
    expect(callTranspiledExportFull(out, "use", []).result.shape.k).toBe("prim");
  });

  it("globals { static, implements, package } ⇒ 模块仍可求值", () => {
    const out = runTranspiled(MODULE, {
      envGlobals: { static: NUM, implements: NUM, package: NUM },
    });
    expect(Object.keys(out)).toContain("use");
  });

  it("非标识符名（`a-b` / 空串）⇒ 跳过注入，模块仍可求值", () => {
    const out = runTranspiled(MODULE, { envGlobals: { "a-b": NUM, "": NUM } });
    expect(Object.keys(out)).toContain("use");
  });

  it("负控：**合法** env 名照旧注入并生效（守卫不得把 env 面整体关掉）", () => {
    const out = runTranspiled(`export function use() { return probeName; }`, {
      envGlobals: { probeName: NUM },
    });
    const r = callTranspiledExportFull(out, "use", []);
    expect(r.result.shape.k).toBe("prim");
    expect(r.throws.shape.k).toBe("never");
  });
});

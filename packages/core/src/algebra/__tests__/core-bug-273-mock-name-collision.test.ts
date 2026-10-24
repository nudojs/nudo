/**
 * Bug 273 —— `@nudo:mock <名>` 与**模块级绑定同名**时整份文件求值静默失败。
 *
 * 改前：env/mock 注入面把 mock 与 env **合进同一张表**并**无条件前置注入**
 * `let <name> = …`；而 `rewriteUserImports` 也生成 `let <name> = …`
 * ⇒ 同名 `let` 重复声明 ⇒ `new Function` SyntaxError ⇒ 整文件求值失败
 * ⇒ fail-closed `unknown` ⇒ 门禁绿灯 exit 0（假绿）。
 *
 * 改后：撞名的注入**跳过**（模块级绑定优先）；import 绑定的 mock 由
 * `rewriteUserImports` 直接改写为读 mock 值（mock 覆盖 import）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { absFunction } from "../abs-fn.ts";
import { abs, litValue } from "../abs.ts";
import { pTrue } from "../pred.ts";

const num = (v: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue, "exact");

/** mock 值本身是一个 Abs（函数）——与 service 侧 mock 种子同形 */
const mockFn = (v: number) =>
  absFunction(["x"], { apply: () => num(v) });

describe("Bug 273：mock 名与模块级绑定同名 ⇒ 不撞名（文件不再 fail-closed）", () => {
  it("mock 名与 import 绑定同名：mock 覆盖 import，文件正常求值", () => {
    const src = `import { getPort } from "./v-port.js";
/** @nudo:mock getPort = stub().returns(8080) */
export function readPort() { return getPort(); }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./v-port.js": { named: { getPort: num(1234) } } },
      mocks: { getPort: mockFn(8080) },
    });
    expect(Object.keys(exports)).toContain("readPort");
    const full = callTranspiledExportFull(exports, "readPort", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: 8080 });
  });

  it("mock 名与用户顶层声明同名：模块级绑定胜出，文件照常求值（不抛）", () => {
    const src = `/** @nudo:mock getPort = stub().returns(8080) */
export function getPort() { return 1234; }
export function readPort() { return getPort(); }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      mocks: { getPort: mockFn(8080) },
    });
    expect(Object.keys(exports).sort()).toEqual(["getPort", "readPort"]);
    const full = callTranspiledExportFull(exports, "readPort", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: 1234 });
  });

  it("env 全局名与模块级绑定同名：同样不撞名（env 注入被跳过）", () => {
    const src = `export const helper = 1;
export function readHelper() { return helper; }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      envGlobals: { helper: num(7) },
    });
    expect(Object.keys(exports).sort()).toEqual(["helper", "readHelper"]);
    const full = callTranspiledExportFull(exports, "readHelper", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: 1 });
  });
});

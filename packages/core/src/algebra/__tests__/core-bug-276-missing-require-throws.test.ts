/**
 * Bug 276 —— `require()` 一个**不存在的模块不抛**（假 no-throw）→ L2 门禁少报。
 *
 * 改前：`requireFromModules` 对解析不到的 spec 返回 `unknown`（**普通值**）
 * ⇒ 用户 try/catch 的 **catch 臂成死代码** ⇒ 引擎宣称「不抛」⇒
 * `nudo:entry-may-throw` 门禁少报（诊断面说「模块缺失」、运行期说「不抛」，
 * 两者自相矛盾）。
 *
 * 改后：**调用期**的缺失 require 抛 NudoThrow（Error brand，与原生
 * MODULE_NOT_FOUND 同类）⇒ catch 臂是活代码；未被吸收 ⇒ 如实计入
 * throws 面。**装载期**（模块体求值中）的缺失 require 保持既有降级
 * （折 unknown）——原生语义是「模块装载失败」，若也抛则整文件退化 unknown
 * ⇒ 门禁假绿（且顶层绑定未记录 ⇒ 跨文件契约检查失效）；缺模块由诊断面
 * `nudo:module-missing`（error）报。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

describe("Bug 276：require 缺失模块按原生抛（catch 臂是活代码）", () => {
  it("try/catch 包裹的缺失 require：进 catch 臂", () => {
    const src = `export function f() {
  try { require("./nope.js"); return "no-throw"; } catch (e) { return "threw"; }
}`;
    const exports = runTranspiled(src, { mode: "exec" });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: "threw" });
  });

  it("未被 catch 吸收的缺失 require：throws 面如实非 never（L2 不再少报）", () => {
    const src = `export function f() { return require("./nope.js"); }`;
    const exports = runTranspiled(src, { mode: "exec" });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(throwsError(full.throws, "Error")).toBe(true);
  });

  it("存在模块的 require：不抛（对照组）", () => {
    const src = `export function f() {
  try { require("./ok.js"); return "no-throw"; } catch (e) { return "threw"; }
}`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./ok.js": { named: { v: 1 } } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: "no-throw" });
    expect(full.throws?.shape?.k ?? "never").toBe("never");
  });
});

/**
 * Bug 275 —— 可选 `require`（try/catch 双侧）**返回命名空间**而不是
 * `module.exports`。
 *
 * 改前：`requireOptionalFromModules` **漏了 `cjsMain` 分支**——普通
 * `requireFromModules` 有（`module.exports = X` ⇒ 返回 X 本身），可选
 * require 没有 ⇒ 同一个模块经两条路径拿到**不同形状**（命名空间 vs X）。
 *
 * 改后：两条路径共用 `requireValueOf`（cjsMain ⇒ default 本体）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { objSlots } from "./eval-helpers.ts";
import { abs } from "../abs.ts";
import { pTrue } from "../pred.ts";

const num = (v: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue, "exact");
const obj = (slots: Record<string, unknown>) =>
  abs(
    {
      k: "obj",
      slots: Object.fromEntries(
        Object.entries(slots).map(([k, v]) => [k, { value: v as never }]),
      ),
      open: false,
    },
    undefined,
    undefined,
    "exact",
  );

describe("Bug 275：可选 require 走 cjsMain 分支（返回 module.exports 本身）", () => {
  it("try/catch 双侧 require：拿到 module.exports 本身（非命名空间）", () => {
    const src = `export function f() {
  let d;
  try { d = require("./b.js"); } catch (e) { d = require("./c.js"); }
  return d;
}`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./b.js": { named: {}, default: obj({ v: num(2) }), cjsMain: true } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    // module.exports 本身 ⇒ 槽面是 { v: 2 }（改前是命名空间 { default: { v: 2 } }）
    expect(objSlots(full.result)).toEqual({ v: 2 });
  });

  it("普通 require 与可选 require 同口径（cjsMain ⇒ default 本体）", () => {
    const src = `export function f() { return require("./b.js"); }`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./b.js": { named: {}, default: obj({ v: num(2) }), cjsMain: true } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(objSlots(full.result)).toEqual({ v: 2 });
  });

  it("ESM 模块经可选 require 仍是命名空间（口径不变）", () => {
    const src = `export function f() {
  let d;
  try { d = require("./b.js"); } catch (e) { d = require("./c.js"); }
  return d;
}`;
    const exports = runTranspiled(src, {
      mode: "exec",
      modules: { "./b.js": { named: { v: num(2) } } },
    });
    const full = callTranspiledExportFull(exports, "f", []);
    expect(objSlots(full.result)).toEqual({ v: 2 });
  });
});

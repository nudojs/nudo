/**
 * Bug ③ 回归：跨模块调用的实参容器变异必须写回 caller 绑定。
 *
 * 真实 JS 语义：entry 调 util.setIt(h, 8)，setIt 对 holder 的变异对
 * caller 帧可见——h.n === 8、back === h 折 true。同文件闭包调用（直达
 * transpiled 闭包）一直正确；跨模块桥（bindImport → $call → apply →
 * callTranspiledExportApply）曾与宿主重放共用 D1 防御副本（$copy），
 * 变异打在副本上 → caller 读 stale 假 exact 0（unsound）。
 *
 * 修复：桥路径 shareArgs（传引用），宿主重放保持 D1 副本（case/记录
 * 不得被 mutator 污染）——两种调用方语义在本文件同时钉住。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runTranspiled,
  callTranspiledExportFull,
  formatAbs,
  formatShape,
  litValue,
} from "@nudojs/core";
import { evalAbsModuleGraph } from "../abs-modules-graph.ts";
import { tmpProject } from "./tmp-project.ts";

const FILES = {
  "util3.js": `export function setIt(holder, v) { holder.n = v; return holder; }\n`,
  "entry4.js": `import { setIt } from "./util3.js";
export function sameFile() {
  const g = (h, v) => { h.n = v; return h; };
  const h = { n: 0 };
  g(h, 7);
  return h.n;
}
export function crossMod() {
  const h = { n: 0 };
  const back = setIt(h, 8);
  return [h.n, back.n, back === h];
}
const g = { n: 0 };
export function bump() { setIt(g, 5); return g.n; }
`,
};

function makeRun() {
  const dir = tmpProject("nudo-crossmut-", FILES);
  const src = readFileSync(join(dir, "entry4.js"), "utf-8");
  const graph = evalAbsModuleGraph(src, join(dir, "entry4.js"), {});
  return runTranspiled(src, { mode: "analyze", modules: graph.modules });
}

describe("cross-module arg mutation writeback (bug ③)", () => {
  it("same-file closure mutation keeps writing back (no regression)", () => {
    const r = callTranspiledExportFull(makeRun(), "sameFile", []).result;
    expect(litValue(r)).toEqual({ ok: true, value: 7 });
    expect(formatAbs(r)).toContain("7");
  });

  it("imported mutator writes back to caller binding: [h.n, back.n, back === h] = [8, 8, true]", () => {
    const run = makeRun();
    const r = callTranspiledExportFull(run, "crossMod", []).result;
    // 真实 JS 地面真值 [8, 8, true]；修复前引擎给 [0, 8, boolean]（假 exact）
    expect(formatAbs(r)).toContain("[8, 8, true]");
  });

  it("imported mutator on module-level container persists across host replays", () => {
    const run = makeRun();
    // 模块级 g 与真实 JS 同：模块求值一次，状态跨导出调用存活
    const first = callTranspiledExportFull(run, "bump", []).result;
    expect(litValue(first)).toEqual({ ok: true, value: 5 });
    const second = callTranspiledExportFull(run, "bump", []).result;
    expect(litValue(second)).toEqual({ ok: true, value: 5 });
  });

  it("host replay keeps D1 defensive copy (case/record args not polluted by mutator)", () => {
    // 宿主直接调导出（case 重放/LSP 面板）：同一实参 Abs 两次重放，
    // mutator 不得累计污染入参（第二次仍从 undefined 起算，不读第一次的残值）
    const exports = runTranspiled(
      `export function mut(o) { o.k = (o.k ?? 0) + 1; return o.k; }\n`,
      { mode: "analyze" },
    );
    const holder = runTranspiled(`export const mk = () => ({ j: 1 });\n`, {
      mode: "analyze",
    });
    const obj = callTranspiledExportFull(holder, "mk", []).result;
    const a = callTranspiledExportFull(exports, "mut", [obj]);
    const b = callTranspiledExportFull(exports, "mut", [obj]);
    expect(formatShape(a.result)).toBe("1");
    expect(formatShape(b.result)).toBe("1");
  });
});

/**
 * B-path 导出面回归：runTranspiled 此前只收 export function/const/let
 * （正则扫描）——export default 全形态 new Function 抛 SyntaxError、
 * export { a, b as c } / export { x } from "mod" / export * from "mod"
 * 被 transpile 注释跳过，导出表静默缺失。
 * 修复：transpile 保留合法 ESM 形态（真实 .mjs import 消费者不受影响）；
 * run.ts 后处理把 specifier/re-export/star/default 改写为 __nudoExport
 * 调用（modules 表注入绑定），导出表 = 动态表 + 静态声明名（显式导出
 * 压过 export *，与 ESM/collectAbsExports 语义一致）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, transpile, numLit } from "@nudojs/core";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { abs, num } from "../abs.ts";
import { v } from "../term.ts";
import type { AbsModuleExports } from "../abs-modules.ts";

const dirs: string[] = [];
function mktmp(): string {
  const d = mkdtempSync(join(tmpdir(), "nudo-expsurf-"));
  dirs.push(d);
  return d;
}

function run(src: string, modules: Record<string, AbsModuleExports> = {}) {
  return runTranspiled(src, { mode: "analyze", modules });
}

/** 真实 ESM 消费路径（execTranspiled 同款）：transpile 输出必须仍可 import */
async function importTranspiled(source: string): Promise<Record<string, unknown>> {
  const dir = mktmp();
  const runtimeUrl = pathToFileURL(
    join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts"),
  ).href;
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  return (await import(pathToFileURL(modPath).href)) as Record<string, unknown>;
}

describe("B-path export surface: default forms", () => {
  it("export default function folds and is callable", () => {
    const r = run(`export default function f() { return 1; }`);
    expect(Object.keys(r)).toContain("default");
    expect(litValue(callTranspiledExportFull(r, "default", []).result)).toBe(1);
  });

  it("export default <identifier/literal/arrow> folds", () => {
    expect(litValue(run(`const a = 5; export default a;`).default as never)).toBe(5);
    expect(litValue(run(`export default 42;`).default as never)).toBe(42);
    const arrow = run(`export default (x) => x + 1;`);
    expect(litValue(callTranspiledExportFull(arrow, "default", [numLit(5)]).result)).toBe(6);
  });

  it("anonymous default function/class get synthesized names", () => {
    const fn = run(`export default function() { return 7; }`);
    expect(litValue(callTranspiledExportFull(fn, "default", []).result)).toBe(7);
    const cls = run(`export default class { m() { return 3; } }`);
    expect(Object.keys(cls)).toContain("default");
  });

  it("transpile output still imports as real ESM (default + named)", async () => {
    const mod = await importTranspiled(`export default function main() { return 1; } export const k = 2;`);
    expect((mod as { k: { shape?: { k: string } } }).k).toBeDefined();
    expect(mod.default).toBeDefined();
  });
});

describe("B-path export surface: specifiers and re-exports", () => {
  it("bare specifiers collect renamed bindings", () => {
    const r = run(`const a = 1; const b = 2; export { a, b as c };`);
    expect(litValue(r.a as never)).toBe(1);
    expect(litValue(r.c as never)).toBe(2);
    expect(r.b).toBeUndefined();
  });

  it("re-export from injected module binds through modules table", () => {
    const mod: AbsModuleExports = { named: { x: abs(num().shape, undefined, undefined, "exact") } };
    const r = run(`export { x as y } from "./m.js";`, { "./m.js": mod });
    expect(r.y).toBe(mod.named.x);
    expect(r.x).toBeUndefined();
  });

  it("export * merges named (excludes default, explicit wins)", () => {
    const mA: AbsModuleExports = {
      named: {
        a: abs(num().shape, undefined, undefined, "exact"),
        b: abs(num().shape, undefined, undefined, "exact"),
      },
      default: abs(num().shape, undefined, undefined, "exact"),
    };
    const r = run(`export * from "./m.js"; export const b = 42;`, { "./m.js": mA });
    expect(r.a).toBe(mA.named.a);
    expect(r.b).not.toBe(mA.named.b); // 显式导出压过 star（ESM 语义）
    expect(r.default).toBeUndefined(); // star 不含 default
    expect(litValue(r.b as never)).toBe(42);
  });

  it("star vs star last wins (collectAbsExports 顺序口径)", () => {
    const m1: AbsModuleExports = { named: { k: abs(num().shape, undefined, undefined, "exact") } };
    const m2: AbsModuleExports = { named: { k: abs(num().shape, v("z"), undefined, "path") } };
    const r = run(`export * from "./m1.js"; export * from "./m2.js";`, { "./m1.js": m1, "./m2.js": m2 });
    expect(r.k).toBe(m2.named.k);
  });

  it("export default from re-export specifier", () => {
    const mod: AbsModuleExports = {
      named: { d: abs(num().shape, undefined, undefined, "exact") },
    };
    const r = run(`export { d as default } from "./m.js";`, { "./m.js": mod });
    expect(r.default).toBe(mod.named.d);
  });
});

describe("B-path export surface: real ESM consumer unchanged", () => {
  it("specifiers + star remain importable", async () => {
    const mod = await importTranspiled(`const a = 1; export { a as b };`);
    expect((mod as { b?: { shape?: { k: string } } }).b).toBeDefined();
  });
});

/**
 * Bug 820 回归（harvester 收割面）：`export { X }` 的「是不是值」判定发生在 **Phase 1**
 * ⇒ 模块导出表随 **`.d.ts` 遍历顺序**变（同一份声明，换个文件顺序就少一个导出）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `declare module "pkg-a" { export { Widget }; }` + `export interface Widget { size: number; }`
 *   ⇒ 两种遍历顺序下模块 "pkg-a" 的导出面**逐项相同**（都是 `["Widget"]`）。
 *
 * 契约：同一组 `.d.ts` 换遍历顺序 ⇒ 导出表**逐项相同**（模块键、导出名、导出值都一致）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug820-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 导出表的「逐项」快照：模块键 → 导出名 → 展示串 */
function snapshot(files: string[]): Record<string, Record<string, string>> {
  const env = harvestDts(files);
  const out: Record<string, Record<string, string>> = {};
  for (const key of Object.keys(env.modules).sort()) {
    const rec = env.modules[key]!;
    const names = Object.keys(rec).sort();
    const item: Record<string, string> = {};
    for (const n of names) item[n] = formatShape(rec[n]!);
    out[key] = item;
  }
  return out;
}

describe("Bug 820 —— 导出表与 .d.ts 遍历顺序无关", () => {
  it("再导出在前 / 声明在后 ⇒ 两种顺序逐项相同", () => {
    const reexport = writeTemp(
      "a-reexport.d.ts",
      `declare module "pkg-a" {\n  export { Widget };\n}\n`,
    );
    const decl = writeTemp("b-decl.d.ts", `export interface Widget { size: number; }\n`);
    const orderA = snapshot([reexport, decl]);
    const orderB = snapshot([decl, reexport]);
    expect(orderA).toEqual(orderB);
    // 两种顺序下导出都还在（改前：顺序 A 是空的）
    expect(Object.keys(orderA["pkg-a"] ?? {})).toEqual(["Widget"]);
  });

  it("函数再导出：声明在另一个文件里 ⇒ 两种顺序逐项相同", () => {
    const reexport = writeTemp(
      "a-reexport.d.ts",
      `declare module "pkg-b" {\n  export { helper as renamed };\n}\n`,
    );
    const decl = writeTemp("b-decl.d.ts", `export declare function helper(): number;\n`);
    const orderA = snapshot([reexport, decl]);
    const orderB = snapshot([decl, reexport]);
    expect(orderA).toEqual(orderB);
    expect(formatShape(harvestDts([reexport, decl]).modules["pkg-b"]!["renamed"]!)).toBe(
      "() => number",
    );
  });

  it("class 再导出：两种顺序逐项相同，且拿到的是构造签名", () => {
    const reexport = writeTemp(
      "a-reexport.d.ts",
      `declare module "pkg-c" {\n  export { Widget };\n}\n`,
    );
    const decl = writeTemp("b-decl.d.ts", `export declare class Widget { size: number; }\n`);
    expect(snapshot([reexport, decl])).toEqual(snapshot([decl, reexport]));
  });
});

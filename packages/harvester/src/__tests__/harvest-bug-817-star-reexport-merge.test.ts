/**
 * Bug 817 回归（harvester 收割面）：`export * from` 的别名应用是**整记录替换**
 * （`!ctx.modules[alias]` 守卫）⇒ **有自有声明的模块**把星号再导出的名字**整批丢掉**。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `declare module "fs" { export * from "node:fs"; export function extra(): number; }`
 *   ⇒ 模块 "fs" 的导出面 = 星号再导出的名字 **加上** `extra`（两者都在）。
 *
 * 契约：别名模块的导出表 = 星号再导出的名字 ∪ 模块自己的声明（自己的优先）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug817-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("Bug 817 —— `export * from` 与模块自有声明合并", () => {
  it("有自有声明的模块不再丢掉星号再导出的名字", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare module "node:fs" {
  export function readFileSync(p: string): string;
  export function statSync(p: string): number;
}
declare module "fs" {
  export * from "node:fs";
  export function extra(): number;
}
`,
    );
    const env = harvestDts([p]);
    const fs = env.modules["fs"]!;
    // 星号再导出的名字：改前整批丢失
    expect(fs["readFileSync"]).toBeDefined();
    expect(fs["statSync"]).toBeDefined();
    // 模块自己的声明：改前保留
    expect(fs["extra"]).toBeDefined();
    expect(formatShape(fs["readFileSync"]!)).toBe("(string) => string");
    expect(formatShape(fs["extra"]!)).toBe("() => number");
    expect(env.stats.skipped).toBe(0);
  });

  it("纯别名（没有自有声明）仍然与目标共用同一条记录", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare module "node:fs" {
  export function readFileSync(p: string): string;
}
declare module "fs" {
  export * from "node:fs";
}
`,
    );
    const env = harvestDts([p]);
    expect(env.modules["fs"]!["readFileSync"]).toBeDefined();
    // 落盘面靠「同一条记录」去重 ⇒ 别名仍共用
    expect(env.modules["fs"]).toBe(env.modules["node:fs"]);
  });

  it("多目标星号再导出 ⇒ 名字全都进来", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare module "a" { export function fromA(): number; }
declare module "b" { export function fromB(): string; }
declare module "c" {
  export * from "a";
  export * from "b";
}
`,
    );
    const env = harvestDts([p]);
    expect(env.modules["c"]!["fromA"]).toBeDefined();
    expect(env.modules["c"]!["fromB"]).toBeDefined();
  });
});

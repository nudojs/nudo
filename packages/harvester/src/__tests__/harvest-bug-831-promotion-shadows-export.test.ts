/**
 * Bug 831 回归（harvester 收割面）：「**接口成员提升**」把**非导出实体**写进模块导出表
 * ⇒ **真实导出整条被丢弃**（先到先得）⇒ L2 假红；且提升出的「幽灵导出」让
 * **不存在的导入**被当成真实导出。
 *
 * 根因：提升出来的成员被当成**模块级导出**（`ctx.pending` 的 fn/var），排在真实声明
 * **之前** ⇒ 物化时「同名先到先得」⇒ 真实导出被挤掉。
 *
 * 夹具（tmp/probe/fix-r27/h3/e2e/realLast/）：
 *   export interface Point { x: number; y: number; }
 *   export declare const origin: Point;
 *   export declare function x(): string;     ← 与接口成员 x 同名
 *
 * 改前（产品面）：`nudo check` FAILED（`use() => never throws TypeError`）——
 *   真实导出 `x(): string` 被接口成员 `x: number` 顶掉 ⇒ 调用被判「对 number 调用」。
 *   只把两行换个顺序（realFirst）就翻成 OK ⇒ **同一份声明，顺序决定门禁**。
 * 改后：两种顺序都 OK，`use() => string`。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h3/oracle/o831.ts）：exit=0
 *   ⇒ TS 侧 `x` 就是那个函数导出；接口成员 `size` 从未被导出 ⇒ `import { size }`
 *   在 TS 侧是 TS2305（模块没有该导出）⇒ 收割面不得把它当成导出。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";
import { harvestToAbsModules } from "../harvest-to-abs.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug831-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** 造一个可解析的假包（node_modules/<pkg>） */
function writePkg(dts: string): { pkg: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-h3-831-"));
  dirs.push(dir);
  // 包名取临时目录名（每次运行唯一 ⇒ 磁盘收割缓存键唯一 ⇒ 不会读到旧缓存）
  const pkg = basename(dir).toLowerCase();
  const pkgDir = join(dir, "node_modules", pkg);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: pkg, version: "1.0.0", types: "index.d.ts" }),
    "utf-8",
  );
  writeFileSync(join(pkgDir, "index.d.ts"), dts, "utf-8");
  return { pkg, dir };
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "pkg";
}

const REAL_LAST = `export interface Point { x: number; y: number; }
export declare const origin: Point;
export declare function x(): string;
`;

const REAL_FIRST = `export interface Point { x: number; y: number; }
export declare function x(): string;
export declare const origin: Point;
`;

describe("Bug 831 —— 接口成员提升不得抢真实导出的名字", () => {
  it("同名真实导出存活（不被接口成员顶掉）", () => {
    const p = writeTemp("last.d.ts", REAL_LAST);
    const env = harvestDts([p]);
    const x = env.globals.x!;
    expect(x).toBeDefined();
    expect(x.shape.k).toBe("fn");
    expect(formatShape(x)).toContain("string");
  });

  it("声明顺序不影响结果（realFirst / realLast 同形）", () => {
    const a = harvestDts([writeTemp("a.d.ts", REAL_LAST)]);
    const b = harvestDts([writeTemp("b.d.ts", REAL_FIRST)]);
    expect(formatShape(a.globals.x!)).toBe(formatShape(b.globals.x!));
    expect(a.globals.x!.shape.k).toBe("fn");
    expect(b.globals.x!.shape.k).toBe("fn");
  });

  it("包的导出表里没有「幽灵导出」（接口成员不是模块导出）", () => {
    const { pkg, dir } = writePkg(
      `export interface Point { size: number; }
export declare const origin: Point;
`,
    );
    const mods = harvestToAbsModules(pkg, dir);
    const named = mods[pkg]?.named ?? {};
    expect(Object.hasOwn(named, "origin")).toBe(true);
    // `size` 只是接口成员 ⇒ TS 侧 import { size } 是 TS2305 ⇒ 不得出现在导出表
    expect(Object.hasOwn(named, "size")).toBe(false);
  });

  it("包的导出表里真实导出不被挤掉（同名接口成员 + 同名函数导出）", () => {
    const { pkg, dir } = writePkg(REAL_LAST);
    const mods = harvestToAbsModules(pkg, dir);
    const named = mods[pkg]?.named ?? {};
    expect(Object.hasOwn(named, "x")).toBe(true);
    const x = named.x as Abs | undefined;
    expect(x?.shape.k).toBe("fn");
  });

  it("对照：没有同名冲突时，真实导出照常在导出表里", () => {
    const { pkg, dir } = writePkg(
      `export interface Point { x: number; }
export declare const origin: Point;
export declare function other(): string;
`,
    );
    const mods = harvestToAbsModules(pkg, dir);
    const named = mods[pkg]?.named ?? {};
    expect(Object.hasOwn(named, "other")).toBe(true);
    expect(Object.hasOwn(named, "origin")).toBe(true);
  });
});

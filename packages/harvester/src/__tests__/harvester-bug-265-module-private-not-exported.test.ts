/**
 * BUG-265 回归：包里只要有一条解析不了的 `export * from "<外部包>"`，
 * 「公开面不可知」回落就退成整个 globals 袋（只扣 ambient）⇒ **模块私有**
 * 顶层声明被提升成包导出 ⇒ nudo 接受 TS 拒绝的 import（TS2459）并给出自信值。
 *
 * 契约：回落必须扣掉**模块私有**（module 模式里从未 `export` 的顶层声明）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestToAbsModules } from "../harvest-to-abs.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writePkg(dts: string): { pkg: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug265-"));
  dirs.push(dir);
  const pkg = "privatepkg";
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

const UNRESOLVED_STAR = `export declare function real(n: number): number;
declare function helper(s: string): number;
export * from "some-external-pkg";
`;

const NO_STAR = `export declare function real(n: number): number;
declare function helper(s: string): number;
`;

const HELPER_EXPORTED = `export declare function real(n: number): number;
export declare function helper(s: string): number;
export * from "some-external-pkg";
`;

function namedOf(dts: string): string[] {
  const { pkg, dir } = writePkg(dts);
  return Object.keys(harvestToAbsModules(pkg, dir)[pkg]!.named).sort();
}

describe("BUG-265 —— 「公开面不可知」回落不得把模块私有声明当导出", () => {
  it("存在未解析的 export *：helper（模块私有）不得出现在包导出集", () => {
    expect(namedOf(UNRESOLVED_STAR)).toEqual(["real"]);
  });

  it("对照组：没有 export * 时同样只导出 real（口径一致）", () => {
    expect(namedOf(NO_STAR)).toEqual(["real"]);
  });

  it("对照：helper 真的导出时照常在导出集里", () => {
    expect(namedOf(HELPER_EXPORTED)).toEqual(["helper", "real"]);
  });
});

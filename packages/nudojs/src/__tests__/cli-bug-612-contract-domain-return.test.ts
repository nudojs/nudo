/**
 * Bug 612 —— 有**参数契约、无返回契约**时，返回面回退到**无约束**的 `entry@`
 * 观测（缺 dts 面的种子重算）⇒ 返回位毫无信息，且与 dts / check 面矛盾。
 *
 * 症状（改前）：`@nudo:contract x num`（无返回契约）的函数，zod 面的
 *   `<fn>Output` = `z.union([z.number()…, z.string()])`（**无约束入口**观测）
 * 而 dts 面（做了契约种子重算）是 `g(x: number): number` ⇒ 两个产物面矛盾，
 * 运行时校验器还会拒掉合法返回值。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面在无返回契约时直接
 * 取 `fn.combinedAbs`（无约束入口观测），没有走 dts 面的**契约域种子重算**。
 *
 * 修法（族 17 · S1）：无返回契约但**有参数契约**时，先用契约参数作种子重算
 * 一次返回位（与 dts 面 / check 面同一条路径），重算失败才回落观测面。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-612-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：number 的纯数据形态 */
const NUM = `export const num = { __nudoConstraint: true, prim: "number", preds: [] };\n`;

describe("export — 有参数契约无返回契约的返回面（族 17 · S1 · Bug 612）", () => {
  it("zod 返回面不再是「无约束入口」观测（不再是 number | string）", () => {
    const dir = fixture({
      "c612.nudo.js": NUM,
      "paronly612.js": [
        `/// @nudo:import { num } from "./c612.nudo.js"`,
        `/** @nudo:contract x num */`,
        `export function g(x) { return x + 1; }`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "paronly612.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gOutput");
    // 契约域种子重算 ⇒ 返回位是 number（改前是无约束入口观测 number | string）
    expect(r.stdout).not.toContain("z.string()");
    expect(r.stdout).toContain("z.number()");
  }, 30000);

  it("dts 面与 zod 面同口径（返回位都是契约域的 number）", () => {
    const dir = fixture({
      "c612b.nudo.js": NUM,
      "paronly612b.js": [
        `/// @nudo:import { num } from "./c612b.nudo.js"`,
        `/** @nudo:contract x num */`,
        `export function g(x) { return x + 1; }`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "paronly612b.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function g(x: number): number;");
  }, 30000);
});

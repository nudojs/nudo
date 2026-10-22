/**
 * Bug 618 —— async 函数的**返回约束被当成整个返回类型** ⇒ `Promise<…>` 包装丢失。
 *
 * 症状（改前）：`@nudo:contract return num` 的 async 函数，zod 面产出
 *   `fOutput = z.number()…`（**不是** Promise）、dts 面产出
 *   `export declare function f(x: number): number;`
 * ⇒ 产物说「返回 number」，实现返回的是 `Promise<number>` ⇒ 校验器会把合法
 * 返回值判非法（运行时校验器拿到的是 Promise）。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面直接投影契约返回
 * Abs，没有按观测返回的 `eff/promise` 形态保形。
 *
 * 修法（族 17 · S1）：观测返回是 `promise<…>` 时，契约返回描述的是 **await 后**
 * 的值 ⇒ 返回面用 `wrapPromise` 包住契约返回（三个产物面同口径）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-618-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：number 的纯数据形态 */
const NUM = `export const num = { __nudoConstraint: true, prim: "number", preds: [] };\n`;

describe("export — async 返回约束的 Promise 保形（族 17 · S1 · Bug 618）", () => {
  it("zod 返回面保留 promise 包装", () => {
    const dir = fixture({
      "c618.nudo.js": NUM,
      "async618.js": [
        `/// @nudo:import { num } from "./c618.nudo.js"`,
        `/** @nudo:contract return num */`,
        `export async function f(x) { return x + 1; }`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "async618.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("z.promise(");
  }, 30000);

  it("dts 面返回类型是 Promise<number>（不是 number）", () => {
    const dir = fixture({
      "c618b.nudo.js": NUM,
      "async618b.js": [
        `/// @nudo:import { num } from "./c618b.nudo.js"`,
        `/** @nudo:contract return num */`,
        `export async function f(x) { return x + 1; }`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "async618b.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(x: number): Promise<number>;");
  }, 30000);
});

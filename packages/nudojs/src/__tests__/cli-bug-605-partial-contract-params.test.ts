/**
 * Bug 605 —— **部分契约**（契约只覆盖部分形参）时，未被契约覆盖的形参位在
 * 产物面里被**静默丢掉**：契约面与观测面二选一，不是合流。
 *
 * 症状（改前）：`@nudo:contract n pos` 只声明了 `n`，函数签名是 `f(n, other)`
 * ⇒ zod 面产出 `z.object({ n: z.number().gt(0) })` —— `other` 位**消失**；
 * 同一函数的 dts 面却是 `f(n: number, other: number)` ⇒ 两个产物面自相矛盾。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面在有契约时**直接
 * 返回契约参数表**（`contractParams`），观测面完全不参与 ⇒ 未覆盖的形参位无来源。
 *
 * 修法（族 17 · S1）：契约面与观测面**按形参合流**——契约覆盖的位取契约 Abs，
 * 未覆盖的位取声明形参表 + 观测证据（**不丢位**）。
 *
 * 夹具注：侧车里的约束写成 `NudoConstraint` 的**纯数据形态**（不引
 * `@nudojs/core` 的 builder DSL）⇒ 夹具目录不需要 tsconfig paths 也能加载。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-605-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：number 的纯数据形态 */
const NUM = `export const num = { __nudoConstraint: true, prim: "number", preds: [] };\n`;

describe("export — 部分契约的形参合流（族 17 · S1 · Bug 605）", () => {
  it("zod 入参面：契约覆盖的位 + 未覆盖的形参位都在（不丢位）", () => {
    const dir = fixture({
      "c605.nudo.js": NUM,
      "partial605.js": [
        `/// @nudo:import { num } from "./c605.nudo.js"`,
        `/** @nudo:contract n num */`,
        `export function f(n, other) { return n + other; }`,
        `f(1, 2);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "partial605.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    // 契约覆盖的位：契约 Abs
    expect(r.stdout).toContain("n: z.number()");
    // 未被契约覆盖的形参位：**不丢**（改前整个 `other` 位消失）
    expect(r.stdout).toContain("other:");
  }, 30000);

  it("dts 面与 zod 面同口径：未覆盖的形参位在 dts 里也在", () => {
    const dir = fixture({
      "c605b.nudo.js": NUM,
      "partial605b.js": [
        `/// @nudo:import { num } from "./c605b.nudo.js"`,
        `/** @nudo:contract n num */`,
        `export function f(n, other) { return n + other; }`,
        `f(1, 2);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "partial605b.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(n: number, other: number)");
  }, 30000);
});

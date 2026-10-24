/**
 * Bug 611 —— 声明级默认值（`b = 2`）在产物面里**不参与槽位可选性** ⇒ 带默认值的
 * 形参被渲染成必填槽。
 *
 * 症状（改前）：`export function f(a, b = 2)` 的 zod 入参面产出
 *   `z.object({ a: z.literal(1), b: z.literal(2) })`
 * 而同一函数的 dts 面是 `f(a: number, b?: number)` ⇒ 两个产物面自相矛盾
 * （dts 的可选性三来源口径是对的：契约级 → 声明级默认值 → 观测级最短元数）。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一参数面在**观测回退分支**
 * 不产 `optional`（只有契约级的 `isOptional` 会带过来）⇒ 声明级默认值从未参与。
 *
 * 修法（族 17 · S1）：可选性按**三来源口径**（与 dts 面逐位同）产出：契约覆盖
 * 该位 ⇒ 契约级 `isOptional`；否则 ⇒ 声明级默认值 / 观测级最短元数。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-611-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

describe("export — 声明级默认值的可选性（族 17 · S1 · Bug 611）", () => {
  it("zod 入参面：带默认值的形参位是可选槽（与 dts 面同口径）", () => {
    const dir = fixture({
      "d611.js": [
        `export function f(a, b = 2) { return a + b; }`,
        `f(1, 2);`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "d611.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("b: z.literal(2).optional()");
  }, 30000);

  it("dts 面仍声明可选位 `b?`（两面的可选性口径一致）", () => {
    const dir = fixture({
      "d611b.js": [
        `export function f(a, b = 2) { return a + b; }`,
        `f(1, 2);`,
        `f(1);`,
        ``,
      ].join("\n"),
    });
    const r = runCliTsx(["export", join(dir, "d611b.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(a: number, b?: number): number;");
  }, 30000);
});

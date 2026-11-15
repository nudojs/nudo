/**
 * Bug 626 —— 导出面把**契约返回约束**当「已证成的事实」直接投影：投影前没有
 * 复核实现 ⇒ 产物声明一个实现**可被证否**的返回类型。
 *
 * 症状（改前）：`@nudo:contract return txt`（string）而实现返回入参（number）
 * ⇒ zod 面产出 `fOutput = z.string()`、dts 面产出
 *   `export declare function f(x: number): string;`
 * —— 与实现矛盾（运行时校验器会把合法返回值判非法）。而 check 面在同一份源码
 * 上报 `nudo:constraint-violated`（返回位 ⊭ 契约）⇒ 门禁与产物面自相矛盾。
 *
 * 根因（族 17 · S1）：`export/contract-face.ts` 的统一返回面在有返回契约时直接
 * 返回契约 Abs，**不复核实现**。
 *
 * 修法（族 17 · S1）：投影前复核实现（契约域种子重算 / 观测返回 vs 契约约束的
 * 决定性比较）⇒ 实现违约时**不投影契约**，回落实现实际的返回形态。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-626-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

/** 侧车约束：string 的纯数据形态 */
const TXT = `export const txt = { __nudoConstraint: true, prim: "string", preds: [] };\n`;

const SOURCE = [
  `/// @nudo:import { txt } from "./c626.nudo.js"`,
  `/** @nudo:contract return txt */`,
  `export function f(x) { return x; }`,
  `f(1);`,
  ``,
].join("\n");

describe("export — 返回契约投影前复核实现（族 17 · S1 · Bug 626）", () => {
  it("zod 返回面：违约的契约不投影（回落实现实际返回）", () => {
    const dir = fixture({ "c626.nudo.js": TXT, "violate626.js": SOURCE });
    const r = runCliTsx(["export", join(dir, "violate626.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("fOutput = z.string()");
    expect(r.stdout).toContain("fOutput = z.literal(1)");
  }, 30000);

  it("dts 返回类型与实现一致（不是被证否的契约）", () => {
    const dir = fixture({ "c626.nudo.js": TXT, "violate626.js": SOURCE });
    const r = runCliTsx(["export", join(dir, "violate626.js"), "--format", "dts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function f(x: number): number;");
  }, 30000);
});

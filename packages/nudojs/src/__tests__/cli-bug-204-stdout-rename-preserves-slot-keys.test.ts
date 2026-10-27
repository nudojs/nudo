/**
 * BUG-204 —— `export --format all`（stdout）的跨段改名是**裸文本替换** ⇒ 把
 * standard 段 `{"key":"<形参名>"}` 这个**数据**一并改名 ⇒ 导出的 standard
 * schema 要求一个根本不存在的形参名，与同一产物里的 zod 段 / dts 段结论相反。
 *
 * 根因：`renameIdentifier` 只做标识符边界判断，不区分「绑定名」与「字符串
 * 字面量里的数据」。
 *
 * 修法：改名走**词法感知**的实现（跳过字符串 / 模板 / 注释 / 属性访问 /
 * 对象字面量的键），只改绑定与引用。
 *
 * 钉（形参名与函数名同形的夹具）：standard 段的槽键**仍是原形参名**，导出名
 * 让位为 `<原名>Standard`；zod 段 / dts 段仍用原形参名。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function f1(f1Input) {\n  return f1Input;\n}\n";

describe("BUG-204 — stdout 跨段改名不碰 schema 里的槽键数据", () => {
  it("standard 段的槽键是原形参名（导出名让位，数据不动）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b204-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const r = runCliTsx(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(r.status).toBe(0);

    // 数据（槽键）保持原形参名 ⇒ 与 zod 段 / dts 段判同一个对象
    expect(r.stdout).toContain('{"key":"f1Input","node"');
    expect(r.stdout).not.toContain('"key":"f1InputStandard"');
    // 导出名照常去重（仍是 `<fn>Input` 让位）
    expect(r.stdout).toContain("export const f1InputStandard");
    // zod 段仍用原形参名
    expect(r.stdout).toContain("export const f1Input = z.object({ f1Input:");
    // dts 段的形参名不变
    expect(r.stdout).toContain("export declare function f1(f1Input: any): any;");
  }, 60000);

  it("负控制：--out 落盘的 standard 产物槽键同样是原形参名（两条投递路径同结论）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b204-out-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const out = join(dir, "out");
    const r = runCliTsx(["export", join(dir, "collide.js"), "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const name = readdirSync(out).find((f) => f.endsWith(".nudo.standard.ts"));
    expect(name).toBeDefined();
    const artifact = readFileSync(join(out, name!), "utf-8");
    expect(artifact).toContain('{"key":"f1Input","node"');
  }, 60000);
});

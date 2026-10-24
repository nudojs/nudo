/**
 * Bug 609 — `nudo export --out` 的 standard 产物按**函数名**命名 ⇒ 两个不同
 * 模块里的同名函数落到同一路径 ⇒ 后写覆盖先写（先导出的那份静默丢失）。
 *
 * 钉：两个不同源文件、同名导出函数 ⇒ out 目录里**两份产物都在**（规范名 +
 * 带模块键后缀的唯一名），先导出的那份内容不被覆盖。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

describe("nudo export --out · Bug 609 · standard 产物名不撞名", () => {
  it("同名函数在两个模块里 ⇒ 两份 standard 产物都在（先导出的不被覆盖）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-609-"));
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "export function handler(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(b, "export function handler(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");

    const r1 = runCli(["export", a, "--format", "standard", "--out", out]);
    expect(r1.status).toBe(0);
    const first = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    expect(first).toHaveLength(1);
    const firstBody = readFileSync(join(out, first[0]!), "utf-8");

    const r2 = runCli(["export", b, "--format", "standard", "--out", out]);
    expect(r2.status).toBe(0);
    const all = readdirSync(out).filter((f) => f.endsWith(".nudo.standard.ts"));
    // 两份都在 ⇒ 没有互相覆盖
    expect(all).toHaveLength(2);
    // 先导出的那份内容不变（仍带第一次的产物标记）
    expect(readFileSync(join(out, first[0]!), "utf-8")).toBe(firstBody);
    // 第二份落在**另一个**文件里
    const second = all.find((f) => f !== first[0]!)!;
    expect(readFileSync(join(out, second), "utf-8")).not.toBe(firstBody);
  }, 60000); // 2 个顺序 CLI 子进程（tsx 冷启动）

  it("同名函数的第二份产物名带模块键后缀（不是同一个路径）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-609b-"));
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "export function handler(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(b, "export function handler(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    const r1 = runCli(["export", a, "--format", "standard", "--out", out]);
    expect(r1.status).toBe(0);
    const firstPath = r1.stdout.split("\n").find((l) => l.startsWith("wrote "))!;
    const r2 = runCli(["export", b, "--format", "standard", "--out", out]);
    expect(r2.status).toBe(0);
    const secondPath = r2.stdout.split("\n").find((l) => l.startsWith("wrote "))!;
    // 第二次导出落到**另一个**路径（不是覆盖同一个文件）
    expect(secondPath).not.toBe(firstPath);
    expect(secondPath).toContain("handler.");
  }, 60000);
});

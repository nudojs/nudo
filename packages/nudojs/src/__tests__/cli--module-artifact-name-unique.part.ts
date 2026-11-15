/**
 * Bug 622 — `nudo export --out` 的 dts / zod / guard 三面按源文件 **stem** 命名
 * ⇒ 不同目录下的同名模块映射到同一批产物路径 ⇒ 后写覆盖先写（先导出的那份
 * 无声丢失）⇒ 消费方拿到别的模块的声明。
 *
 * 钉：两个不同目录下的同名模块导出到同一个 out 目录 ⇒ 两份产物都在，
 * 先导出的那份内容不被覆盖。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

describe("nudo export --out · Bug 622 · 同 stem 模块产物不互相覆盖", () => {
  it("两个目录下的同名模块 ⇒ 两份 .d.ts 都在（先导出的不被覆盖）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-622-"));
    const a = join(dir, "a");
    const b = join(dir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const aFile = join(a, "lib.js");
    const bFile = join(b, "lib.js");
    writeFileSync(aFile, "export function alphaOnly(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(bFile, "export function betaOnly(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    const r1 = runCli(["export", aFile, "--format", "all", "--out", out]);
    expect(r1.status).toBe(0);
    const dtsFiles = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    expect(dtsFiles).toHaveLength(1);
    const firstBody = readFileSync(join(out, dtsFiles[0]!), "utf-8");
    expect(firstBody).toContain("alphaOnly");

    const r2 = runCli(["export", bFile, "--format", "all", "--out", out]);
    expect(r2.status).toBe(0);
    const dtsAfter = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 两份都在 ⇒ 没有互相覆盖
    expect(dtsAfter).toHaveLength(2);
    // 先导出的那份内容不变（仍是 a 模块的声明）
    expect(readFileSync(join(out, dtsFiles[0]!), "utf-8")).toBe(firstBody);
    // 另一份是 b 模块的声明
    const other = dtsAfter.find((f) => f !== dtsFiles[0]!)!;
    expect(readFileSync(join(out, other), "utf-8")).toContain("betaOnly");
  }, 90000); // 2 个顺序 CLI 子进程（tsx 冷启动）

  it("同 stem 模块 ⇒ zod / guard 面同样不互相覆盖", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-622b-"));
    const a = join(dir, "a");
    const b = join(dir, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const aFile = join(a, "lib.js");
    const bFile = join(b, "lib.js");
    writeFileSync(aFile, "export function alphaOnly(x) {\n  return x + 1;\n}\n", "utf-8");
    writeFileSync(bFile, "export function betaOnly(x) {\n  return x + 2;\n}\n", "utf-8");
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });

    runCli(["export", aFile, "--format", "all", "--out", out]);
    const guardFirst = readdirSync(out).filter((f) => f.endsWith(".nudo.guard.ts"));
    expect(guardFirst).toHaveLength(1);
    const body = readFileSync(join(out, guardFirst[0]!), "utf-8");

    runCli(["export", bFile, "--format", "all", "--out", out]);
    const guardAfter = readdirSync(out).filter((f) => f.endsWith(".nudo.guard.ts"));
    expect(guardAfter).toHaveLength(2);
    expect(readFileSync(join(out, guardFirst[0]!), "utf-8")).toBe(body);
  }, 90000); // 2 个顺序 CLI 子进程
});

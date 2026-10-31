/**
 * BUG-231 —— `nudo export --out` 的「唯一名兜底」分支**不查「同一模块」** ⇒
 * 同一模块重导落盘产生**内容互斥**的陈旧副本并逐次累积。
 *
 * 症状：两个同名模块（`a/lib.js` / `b/lib.js`）导出到同一 `--out` 目录后再改
 * `b` 的源码重导 ⇒ 每次新增 `.2` / `.3` 编号副本，旧的保留 ⇒ 同一目录里两份
 * 文件自称同一模块的投影却给出互斥的返回形态（`=> 3` vs `=> 201`）。
 *
 * 根因：唯一名兜底循环只判「内容一致」与「是本工具产物」，从不调
 * `isSameModule`（规范名分支**有**这一步）。
 *
 * 钉：同一模块重导**原地覆盖**（产物数不增长、无编号副本、内容是最新一次导出）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("BUG-231 — 唯一名兜底分支按「同一模块」覆盖更新", () => {
  it("同名两个模块 + 同模块重导 ⇒ 无编号副本、无陈旧内容", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b231-"));
    dirs.push(dir);
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    const out = join(dir, "out");
    writeFileSync(join(dir, "a", "lib.js"), "export function alpha(x) {\n  return x + 1;\n}\nalpha(1);\n", "utf-8");
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) {\n  return x + 2;\n}\nbeta(1);\n", "utf-8");

    const exportDts = (file: string) =>
      runCliTsx(["export", file, "--format", "dts", "--out", out]);

    expect(exportDts(join(dir, "a", "lib.js")).status).toBe(0);
    expect(exportDts(join(dir, "b", "lib.js")).status).toBe(0);
    // 改 b 的返回形态后重导（同一模块）
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) {\n  return x + 200;\n}\nbeta(1);\n", "utf-8");
    expect(exportDts(join(dir, "b", "lib.js")).status).toBe(0);

    const files = readdirSync(out).filter((f) => f.endsWith(".d.ts"));
    // 两个**不同**模块各一份；没有 `.2` / `.3` 编号副本
    expect(files).toHaveLength(2);
    expect(files.filter((f) => /\.\d+\.d\.ts$/.test(f))).toEqual([]);

    // 同一模块只留**最新**一份投影
    const bFiles = files.filter((f) => readFileSync(join(out, f), "utf-8").includes("beta"));
    expect(bFiles).toHaveLength(1);
    const body = readFileSync(join(out, bFiles[0]!), "utf-8");
    expect(body).toContain("=> 201");
    expect(body).not.toContain("=> 3");
  }, 90000);

  it("幂等重导：内容不变时仍是一份产物", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b231-idem-"));
    dirs.push(dir);
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    const out = join(dir, "out");
    writeFileSync(join(dir, "a", "lib.js"), "export function alpha(x) { return x + 1; }\nalpha(1);\n", "utf-8");
    writeFileSync(join(dir, "b", "lib.js"), "export function beta(x) { return x + 2; }\nbeta(1);\n", "utf-8");
    for (const f of ["a", "b", "b", "a"]) {
      expect(runCliTsx(["export", join(dir, f, "lib.js"), "--format", "dts", "--out", out]).status).toBe(0);
    }
    expect(readdirSync(out).filter((f) => f.endsWith(".d.ts"))).toHaveLength(2);
  }, 90000);
});

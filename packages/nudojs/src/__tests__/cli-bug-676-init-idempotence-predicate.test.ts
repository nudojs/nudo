/**
 * Bug 676 — `nudo init` 的**幂等判据**必须与**配置加载器的真值判据**一致。
 *
 * 真源：packages/service/src/evaluator/config.ts 的 readNudoKey ——
 * `nudo` 键存在（自有属性）**且**值是「非 null 的非数组对象」才算**有效配置**；
 * 键存在但形状非法（null / 标量 / 数组）⇒ 该包**没有**配置（加载器按
 * 「无配置」处理并**不继承**祖先）。
 *
 * 改前：init 用「键存在」判「已配置」⇒ `"nudo": null` 的包**永远**拿不到
 * 基线（加载器却在提示「去跑 nudo init」⇒ 死循环）。
 * 改后：只有**有效**配置才算「已配置」；形状非法的值被替换成 adoption 基线。
 *
 * 反向闸（断言非永真）：把 init.ts 换回 HEAD 只读副本 ⇒ 本文件两条
 * 「null / 标量 ⇒ 写入基线」断言**必红**（HEAD 打印「already has a nudo
 * config」且一个字节不写）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../commands/init.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function pkgDir(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-676-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), content, "utf-8");
  return dir;
}

const io = { out: () => {}, err: () => {} };

describe("Bug 676 — init 的幂等判据 = 配置加载器的真值判据", () => {
  it("nudo 值为 null（形状非法 ⇒ 加载器按「无配置」处理）⇒ init 写入基线", () => {
    const dir = pkgDir('{ "name": "x", "nudo": null }\n');
    expect(runInit(dir, io)).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  });

  it("nudo 值为标量（形状非法）⇒ init 写入基线", () => {
    const dir = pkgDir('{ "name": "x", "nudo": 42 }\n');
    expect(runInit(dir, io)).toBe(0);
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(parsed.nudo).toEqual({ check: { profile: "adoption" } });
  });

  it("nudo 值为有效对象 ⇒ 幂等：只打印、不写盘（与加载器「配置在场」一致）", () => {
    const before = '{ "name": "x", "nudo": { "check": { "profile": "strict" } } }\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  });

  it("nudo 值为空对象 {} ⇒ 仍是**有效配置**（加载器据此截断祖先继承）⇒ 幂等不写", () => {
    const before = '{ "name": "x", "nudo": {} }\n';
    const dir = pkgDir(before);
    expect(runInit(dir, io)).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
  });
});

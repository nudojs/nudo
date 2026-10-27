/**
 * BUG-028 —— `export --format all` 的 stdout 会**劫持用户自己的导出名**，且与
 * `--out` 产物不一致。
 *
 * 症状：用户模块里有 `fooInput` / `fooOutput`（极常见的命名）时，zod 段生成的
 * `<fn>Input` / `<fn>Output` 先占了去重表 ⇒ dts 段（承载**用户 API**）被改名成
 * `fooInputDts` / `fooOutputDts`，而 `--out` 落盘（各段各占一个文件）不改名 ⇒
 * 同一命令两条投递路径给出**两份不同的公开 API**。
 *
 * 修法：用户 API 名（dts 段 = 模块面）**先预留**；撞名时**工具让位**
 * （zod 段 → `fooInputZod`、standard 段 → `fooInputStandard`）。
 *
 * 钉：stdout 的 dts 段与 `--out` 的 `.d.ts` **逐字相同**（用户 API 不被改名）。
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

const SRC = [
  "export function foo(x) { return x; }",
  "export function fooInput(y) { return y; }",
  "export function fooOutput(z) { return z; }",
  "",
].join("\n");

const DTS_DECL = /^export declare function .*$/gm;

describe("BUG-028 — stdout 不劫持用户导出名", () => {
  it("用户导出名在 stdout 的 dts 段保持原名（不出现 *Dts 后缀）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b028-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const r = runCliTsx(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export declare function fooInput(y: any): any;");
    expect(r.stdout).toContain("export declare function fooOutput(z: any): any;");
    expect(r.stdout).not.toContain("fooInputDts");
    expect(r.stdout).not.toContain("fooOutputDts");
    // 生成的校验器名让位（不是抢占用户导出名）
    expect(r.stdout).toContain("export const fooInputZod");
    expect(r.stdout).toContain("export const fooInputStandard");
  }, 60000);

  it("stdout 的 dts 段与 --out 落盘的 .d.ts 逐字相同（两条投递路径同一公开 API）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b028-parity-"));
    dirs.push(dir);
    writeFileSync(join(dir, "collide.js"), SRC, "utf-8");
    const out = join(dir, "out");

    const stdout = runCliTsx(["export", join(dir, "collide.js"), "--format", "all"]);
    expect(stdout.status).toBe(0);
    const written = runCliTsx(["export", join(dir, "collide.js"), "--format", "all", "--out", out]);
    expect(written.status).toBe(0);

    const dtsName = readdirSync(out).find((f) => f.endsWith(".d.ts"));
    expect(dtsName).toBeDefined();
    const dts = readFileSync(join(out, dtsName!), "utf-8");

    const fromStdout = stdout.stdout.match(DTS_DECL) ?? [];
    const fromFile = dts.match(DTS_DECL) ?? [];
    expect(fromFile).toHaveLength(3);
    expect([...fromStdout].sort()).toEqual([...fromFile].sort());
  }, 60000);
});

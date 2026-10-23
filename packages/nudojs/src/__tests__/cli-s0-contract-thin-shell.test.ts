/**
 * 族 20 · S0（串行前置重构）—— **薄壳钉**（只经由**公共面**断言）。
 *
 * 本片**不吸收任何 bug** ⇒ 本钉锁的是**「重构前后行为不变」**，不是
 * 「某个 bug 被修好了」。
 *
 * 本文件**只 import `../commands/contract.ts`（公共面）+ 跑 CLI**
 * ⇒ 在 **HEAD（重构前）**上**原样跑通** ⇒ **反向闸（闸④）在本文件上必须通过**
 * （本片唯一的闸④例外面：钉的是「等价」而不是「修好的行为」）。
 * 三个新内部模块的**签名契约**在 `cli-s0-contract-module-contracts.test.ts`
 * （那三个模块在 HEAD 上**不存在** ⇒ 那一面是**前向锁**，参与反向闸）。
 *
 * 锁住：
 * 1. **薄壳的导出面**：`commands/contract.ts` 的运行时导出**有且只有**
 *    `registerContractCommand`（`packages/nudojs/src/index.ts` 仍零导出 ⇒
 *    零新增公开导出）。
 * 2. **可观测行为逐字不变**：`nudo contract` 的 print / `--json` /
 *    `--draft` / `--emit --dry-run` / `--from-dts` 五个形态的输出面
 *    （行文本、JSON 载荷键、草稿正文、汇总行）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as contractModule from "../commands/contract.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-s0-contract-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("族 20 S0 —— 薄壳的导出面（零新增公共导出）", () => {
  it("commands/contract.ts 的运行时导出有且只有 registerContractCommand", () => {
    expect(Object.keys(contractModule).sort()).toEqual(["registerContractCommand"]);
    expect(typeof contractModule.registerContractCommand).toBe("function");
  });

  it("packages/nudojs/src/index.ts 仍然零 export", () => {
    const src = readFileSync(join(repoRoot, "packages/nudojs/src/index.ts"), "utf-8");
    expect(src).not.toMatch(/^export\s/m);
  });
});

describe("族 20 S0 —— 可观测行为逐字不变", () => {
  it("print 形态：路径行 + 签名行不变", () => {
    const file = join(dir, "getName.js");
    writeFileSync(file, `export function getName(user) { return user.name; }\n`);
    const r = runCliTsx(["contract", file]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain(file);
    expect(r.stdout).toContain("getName  [implicit]  (user: any) → any");
  });

  it("--json 形态：stdout 是合法 JSON，载荷键不变（file / entries[].fn / entries[].signature）", () => {
    const file = join(dir, "getName.js");
    writeFileSync(file, `export function getName(user) { return user.name; }\n`);
    const r = runCliTsx(["contract", "--json", file]);
    expect(r.status).toBe(0);
    // ⚠ 族 20 · 片 A（Bug 658）起：**顶层恒为数组**（单文件 = 单元素数组）——
    //   跨文件聚合层修掉了「目录形态 stdout 是 N 份 JSON 拼接」的缺陷，
    //   单文件载荷形状随之**破坏性变更**（见 .changeset/fix-nudojs-contract-A.md）。
    //   元素内部的键（file / entries[].fn / entries[].signature）**未变**。
    const docs = JSON.parse(r.stdout) as {
      file: string;
      entries: { fn: string; signature: string }[];
    }[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    const body = docs[0];
    // `file` 是**相对 CLI cwd** 的展示路径（tmpdir 在仓外 ⇒ 带 `../` 前缀）
    expect(body.file.endsWith("getName.js")).toBe(true);
    expect(body.entries.map((e) => e.fn)).toEqual(["getName"]);
    expect(body.entries[0].signature).toContain("getName");
  });

  it("--draft 形态：草稿正文（@nudo:draft 头 + 建议行）不变", () => {
    const file = join(dir, "calc.js");
    writeFileSync(file, `export function calc(x) { return x + 1; }\n`);
    const r = runCliTsx(["contract", "--draft", file]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("export const calc = fn({});");
  });

  it("--emit --dry-run 形态：「no interface changes」提示行不变", () => {
    const file = join(dir, "getName.js");
    writeFileSync(file, `export function getName(user) { return user.name; }\n`);
    const r = runCliTsx(["contract", "--emit", "--dry-run", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(": no interface changes");
    expect(r.stdout).toContain("--fn <name>");
  });

  it("--from-dts 形态：逆向草稿正文 + 汇总行不变", () => {
    const dts = join(dir, "types.d.ts");
    writeFileSync(dts, `export declare function mul(a: number, b: number): number;\n`);
    const r = runCliTsx(["contract", "--from-dts", dts]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("// @nudo:draft");
    expect(r.stdout).toContain("export const mul = fn({ a: number(), b: number() }, number());");
    expect(r.stdout).toContain("1 projectable exports · 0 skipped · 1 d.ts");
  });

  it("用法错误面不变：--emit 与 --draft 互斥", () => {
    const file = join(dir, "getName.js");
    writeFileSync(file, `export function getName(user) { return user.name; }\n`);
    const r = runCliTsx(["contract", "--emit", "--draft", file]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage error: --emit and --draft are mutually exclusive");
  });
});

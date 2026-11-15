/**
 * Bug 664 —— `nudo contract --draft --json` 遇**语法错文件**：
 * 单文件 ⇒ stdout **0 字节** + exit 1（违反同文件里自己写下的「绝不空 stdout +
 * exit 1」不变量）；多文件 ⇒ stdout 是一份**只含好文件**的合法 JSON，
 * **失败文件在载荷里彻底消失** ⇒ 机器消费者无法从 JSON 知道哪个文件失败。
 *
 * 修法（族 20 · 片 A）：per-root `catch` 在 `--json` 形态下**必须产 JSON body**
 * ⇒ 失败 root 进聚合结果的 `errors[]`（聚合层见 Bug 658）⇒ stdout 永不为空、
 * 载荷不缺项。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

let dir: string;
let good: string;
let broken: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-664-"));
  good = join(dir, "good.js");
  broken = join(dir, "syn.js");
  writeFileSync(good, "export function good() { return 1; }\n", "utf-8");
  writeFileSync(broken, "export function bad( {\n  return 1;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonDoc = {
  file?: string;
  draftSource?: string;
  errors?: { code: string; message: string }[];
};

describe("Bug 664 —— contract --json 遇语法错文件：失败 root 必须进载荷", () => {
  it("单文件（语法错）+ --draft --json：stdout 非空 + 合法 JSON + errors[] + exit 1", () => {
    const r = runCli(["contract", broken, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("syn.js");
    expect(docs[0].errors).toHaveLength(1);
    expect(docs[0].errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
    expect(docs[0].errors?.[0]?.message.length).toBeGreaterThan(0);
  });

  it("目录（好文件 + 坏文件）+ --draft --json：坏文件**不再消失**（载荷不缺项）", () => {
    const r = runCli(["contract", ".", "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(docs.length).toBeGreaterThanOrEqual(2);
    // 好文件的文档在
    expect(docs.some((d) => d.file === "good.js" && typeof d.draftSource === "string")).toBe(true);
    // 坏文件的失败条目也在
    const failed = docs.find((d) => d.file === "syn.js");
    expect(failed).toBeDefined();
    expect(failed?.errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
  });

  it("print 形态（--json）+ 语法错：同样有 errors 条目（机器面统一）", () => {
    const r = runCli(["contract", broken, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(docs[0].file).toBe("syn.js");
    expect(docs[0].errors?.[0]?.code).toBe("nudo:contract-analysis-failed");
  });

  it("人类面不变：stderr 仍点名失败文件 + exit 1", () => {
    const r = runCli(["contract", broken, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Error analyzing");
    expect(r.stderr).toContain("syn.js");
  });
});

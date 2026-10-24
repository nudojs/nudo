/**
 * Bug 661 —— `nudo contract --json`（**非** `--draft` 形态）把**路径错误整个吞掉**
 * ⇒ exit 1 但 stdout 的 JSON 里**没有** `pathErrors`、stderr 0 字节
 * ⇒ 「置红的那个原因没有任何地方说得出来」。
 *
 * 修法（族 20 · 片 A）：`--json` 形态下**路径错误必须进 JSON body**
 * （`pathErrors[]`）⇒ print / emit / draft **三形态统一**。
 *
 * ⚠ 勘误（族 21 Bug 670 已修 print 分支 ⇒ stdout **现在就是**合法 JSON）：
 * 验收用例**不**断言「stdout 不是 JSON」，只断言「JSON 里有 `pathErrors[]`」
 * +「stderr **可**为空」+「exit **仍** 1」。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

let dir: string;
let lib: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-661-"));
  lib = join(dir, "lib.js");
  writeFileSync(lib, "export function alpha(x) { return x; }\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonDoc = {
  file?: string;
  entries?: { fn: string }[];
  pathErrors?: { path: string; code: string; message: string; suggestion?: string }[];
};

describe("Bug 661 —— contract --json 的路径错误必须进 JSON body", () => {
  it("print 形态 + 缺失路径：stdout 是合法 JSON 且带 pathErrors[] + exit 1", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    // stdout 是**一份**合法 JSON（恒定数组外壳）
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    // 路径错误独立成一项（命令级事实，不是某个 root 的）
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors).toHaveLength(1);
    expect(errDocs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
    expect(errDocs[0].pathErrors?.[0]?.path).toContain("nope.js");
    expect(errDocs[0].pathErrors?.[0]?.message).toContain("Not found");
    // 好文件的文档仍在载荷里（不被路径错误挤掉）
    expect(docs.some((d) => d.file === "lib.js")).toBe(true);
  });

  it("draft 形态 + 缺失路径：同一套 pathErrors[]（三形态统一）", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing, "--draft", "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    const errDocs = docs.filter((d) => d.pathErrors);
    expect(errDocs).toHaveLength(1);
    expect(errDocs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
  });

  it("全部路径都缺失（无 root）：stdout 仍是**非空**合法 JSON + pathErrors[] + exit 1", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", missing, "--json"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const docs = JSON.parse(r.stdout) as JsonDoc[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs[0].pathErrors?.[0]?.code).toBe("nudo:path-not-found");
  });

  it("对照面：非 --json 的人类面仍在 stderr（不因 --json 消失）", () => {
    const missing = join(dir, "nope.js");
    const r = runCli(["contract", lib, missing], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not found:");
    expect(r.stderr).toContain("fix:");
  });
});

/**
 * Bug 663 —— `nudo contract --draft --json --write`：`--write` 被**静默丢弃**
 * ⇒ 草稿**根本没落盘**、**exit 0**、**零提示**（stdout 是合法 JSON、无
 * 「Draft written」）⇒ agent / CI 据此认为「契约已落盘」，磁盘上**没有**
 * 侧车草稿 ⇒ **假绿 + 静默数据丢失**。
 *
 * 根因：`--json` 分支以 `return` 早退 ⇒ 后面的 `--write` 分支**不可达**；
 * 而 `--json` 与 `--write` 都是 `--draft` 的合法搭配，**没有**互斥拒绝。
 *
 * 修法（族 20 · 片 B · 裁决 = **显式拒绝**）：`--json` 与 `--write` 互斥
 * ⇒ `error: --write cannot be combined with --json` + **exit 1**
 * ⇒ 「给了不生效且不报错」不再可能。
 *
 * ⚠ 机器面（`--json`）：stdout 仍是**一份合法 JSON 文档**（命令层的跨文件
 *   聚合层会把它收进恒定数组外壳）⇒ 载荷形状与命令层的 per-root 失败条目
 *   同款（`{file, errors:[{code, message}]}`）。
 *
 * ⚠ 本钉的夹具**全部写在临时目录**里（cwd = 临时目录）⇒ 绝不往仓里写文件。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-663-"));
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "b663", "private": true, "type": "module" }\n',
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), "export function f(o) {\n  return o.v;\n}\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type JsonEntry = {
  file?: string;
  draftSource?: string;
  errors?: { code: string; message: string; suggestion?: string }[];
};

/**
 * 取「第一个 root 的机器文档」。
 *
 * 命令层的跨文件聚合层（族 20 · 片 A）让顶层**恒为数组**（单文件 = 单元素
 * 数组）；聚合层落地前的旧形态是**单文档**（顶层就是对象）⇒ 这里两种都吃，
 * 免得负控制用例被聚合层的形态变化误伤。
 */
function firstDoc(stdout: string): JsonEntry {
  const parsed = JSON.parse(stdout) as JsonEntry | JsonEntry[];
  return Array.isArray(parsed) ? (parsed[0] as JsonEntry) : parsed;
}

describe("Bug 663 —— contract --draft --json --write 必须**显式拒绝**", () => {
  it("--json + --write：exit 1 + 机器面给出理由 + 草稿**没有**落盘", () => {
    const r = runCli(["contract", "--draft", "--json", "--write", "lib.js"], { cwd: dir });

    // 改前：exit 0、stdout 是合法 JSON、**草稿文件不存在**、零提示
    expect(r.status).toBe(1);
    // stdout 仍是**一份**合法 JSON（聚合层的外壳：恒为数组）
    const docs = JSON.parse(r.stdout) as JsonEntry[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe("lib.js");
    expect(docs[0].errors?.[0]?.code).toBe("nudo:usage-error");
    expect(docs[0].errors?.[0]?.message).toContain("--write cannot be combined with --json");
    // 假绿 / 静默数据丢失已消：草稿**没有**被写出来
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
    expect(r.stdout).not.toContain("Draft written");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("负控制：`--draft --json`（无 --write）仍然照常出审阅载荷（不误伤）", () => {
    const r = runCli(["contract", "--draft", "--json", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    const doc = firstDoc(r.stdout);
    expect(doc.draftSource).toContain("// @nudo:draft");
    expect(doc.errors).toBeUndefined();
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("负控制：`--draft --write`（无 --json）仍然照常写盘（不误伤）", () => {
    const r = runCli(["contract", "--draft", "--write", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Draft written → lib.nudo.draft.js");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});

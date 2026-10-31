/**
 * BUG-042 —— `nudo contract --draft --fn <写错的名字>` 是**静默 no-op**（空草稿 + exit 0）。
 *
 * 改前（`contract-draft.ts`）：`fnNames` 原样传进 `draftInterface`，
 * **没有「一个都没命中」的门禁** ⇒ 发射器把全部条目丢弃 ⇒ 落盘一份只有头部的
 * 空草稿、exit 0 ⇒ 名字拼错在 CI / agent 流程里**不可见**；而同一个 `--fn`
 * 名单在 `--emit` 面是**用法错误 + 列出可用导出名**（`contract-emit.ts`）
 * ⇒ 同一命令族两套语义。
 *
 * 钉：`--draft` 面复用 `--emit` 面的规则 —— 名单一处都没命中 ⇒
 * 用法错误（exit 1）、列出可用导出名、**不落盘**；`--json` 面同样是
 * 一份合法 JSON 文档 + exit 1。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

const LIB = `function helper(x) {
  return x + 1;
}
export function handwritten(a) {
  return helper(a);
}
export function caller(b) {
  return handwritten(b);
}
caller(2);
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-042-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(join(dir, "lib.js"), LIB, "utf-8");
  return dir;
}

describe("nudo contract --draft --fn 未命中 · BUG-042 · 不许静默空草稿", () => {
  it("名字写错 ⇒ 用法错误（exit 1）+ 列出可用导出名 + **不落盘**", () => {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--draft", "--write", "--fn", "totallyMissing", "--", "lib.js"],
      { cwd: dir },
    );

    // 与 `--emit` 面同款：说清哪个名字没命中 + 列出本地导出名候选
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("matched no export");
    expect(r.stderr).toContain("totallyMissing");
    expect(r.stderr).toContain("available exports");
    expect(r.stderr).toContain("handwritten");
    // 没有谎报成功，也没有落下一份空草稿
    expect(r.stdout).not.toContain("// @nudo:draft");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("--json 面：stdout 仍是**一份合法 JSON 文档**（usage-error 有条目）+ exit 1", () => {
    const dir = makeFixture();

    const r = runCli(
      ["contract", "--draft", "--json", "--fn", "totallyMissing", "--", "lib.js"],
      { cwd: dir },
    );

    expect(r.status).toBe(1);
    const doc = JSON.parse(r.stdout) as Array<{
      file?: string;
      errors?: Array<{ code?: string; message?: string }>;
    }>;
    expect(Array.isArray(doc)).toBe(true);
    expect(doc[0]?.errors?.[0]?.code).toBe("nudo:usage-error");
    expect(doc[0]?.errors?.[0]?.message).toContain("totallyMissing");
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);
  }, 60000); // 1 个 CLI 子进程

  it("对照组：名字正确 ⇒ exit 0 且草稿点名该导出", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--draft", "--fn", "handwritten", "--", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const handwritten = fn(");
    // 未点名的导出不出现在草稿里（过滤仍然生效）
    expect(r.stdout).not.toContain("export const caller = fn(");
  }, 60000); // 1 个 CLI 子进程

  it("非导出的本地函数名 ⇒ 仍走**可见**的 not-an-export 条目（门禁不误伤）", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--draft", "--fn", "helper", "--", "lib.js"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not-an-export");
    expect(r.stderr).not.toContain("matched no export");
  }, 60000); // 1 个 CLI 子进程
});

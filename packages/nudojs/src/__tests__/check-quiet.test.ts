/**
 * `nudo check --quiet`（DX P2）：signatures 永远全打是产品决定，但大仓
 * CI 日志噪音大——--quiet 压 signatures 段：
 * - issues + summary + 门禁 exit 语义不变；
 * - 成功且零 issue 时只打一行摘要（文件 + OK + 计数）；
 * - 默认面（无 --quiet）signatures 照打（对照断言）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { basename } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "nudo-cli-quiet-"));

function write(name: string, src: string): string {
  const p = join(dir, name);
  writeFileSync(p, src, "utf-8");
  return p;
}

const CLEAN_SRC = "export function id(x) { return x; }\n";
/** 零 issue 样本：有契约根（侧车）⇒ 无 entry-only info（Bug 461 起普通 check 也报它） */
const CLEAN_WITH_CONTRACT_SRC = "export function id(x) { return x; }\n";
const CLEAN_WITH_CONTRACT_SIDECAR = `import { fn, number } from "@nudojs/core";

export const id = fn({ x: number() }, number());
`;
/** L2-only：export 上未消化 may-throw（默认 error 档红） */
const L2_SRC = "export function getName(user){ return user.name; }\n";

describe("check --quiet", () => {
  it("成功且零 issue：只打一行摘要（无 signatures / 无 (no issues)）；exit 0", () => {
    const file = write("clean.js", CLEAN_WITH_CONTRACT_SRC);
    writeFileSync(join(dir, "clean.nudo.js"), CLEAN_WITH_CONTRACT_SIDECAR, "utf-8");
    const r = runCliTsx(["check", file, "--quiet"], { cwd: dir });
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      `nudo check  ${basename(file)}  OK  0 error · 0 warning · 0 info · 1 fn`,
    );
  });

  it("失败：issues + summary 保留、signatures 压掉；exit 1 不变", () => {
    const file = write("l2.js", L2_SRC);
    const r = runCliTsx(["check", file, "--quiet"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("signatures");
    // issues 段 + 摘要行不丢（actual 行含签名形态文本属 issues 产品面）
    expect(r.stdout).toContain("FAILED");
    expect(r.stdout).toContain("1 error · 0 warning · 1 info · 1 fn");
    expect(r.stdout).toContain("issues");
    expect(r.stdout).toContain("nudo:entry-may-throw");
  });

  it("对照组：默认面 signatures 照打（--quiet 不改默认行为）", () => {
    const file = write("l2-default.js", L2_SRC);
    const r = runCliTsx(["check", file], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("signatures");
    expect(r.stdout).toContain("getName(user: any)");
  });

  it("成功但带 warning（ok:true + issues 非空）：issues 上屏、signatures 压掉", () => {
    // adoption 档把 L2 降为 warning：ok:true、issues 非空
    const file = write("l2-warn.js", L2_SRC);
    const r = runCliTsx(["check", file, "--quiet", "--profile", "adoption"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("signatures");
    expect(r.stdout).toContain("issues");
    expect(r.stdout).toContain("0 error · 1 warning · 1 info · 1 fn");
  });

  it("--json 机器契约不受 --quiet 影响（signatures 照常序列化）", () => {
    const file = write("json.js", CLEAN_SRC);
    const r = runCliTsx(["check", file, "--json", "--quiet"], { cwd: dir });
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(true);
    expect(json.signatures).toHaveLength(1);
    expect(json.signatures[0].name).toBe("id");
  });

  it("help：--quiet 在 Common 组列出", () => {
    const r = runCliTsx(["check", "--help"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--quiet");
  });
});

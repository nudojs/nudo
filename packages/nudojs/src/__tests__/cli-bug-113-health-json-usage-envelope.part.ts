/**
 * BUG-113：`nudo health --json --from <file>`（**无位置路径**）⇒ usage 错误只写
 * stderr、stdout **0 字节** ⇒ 机器消费方 `JSON.parse("")` 直接抛
 * （违反 `--json` 契约：stdout 永不为空 / 绝不「空 stdout + 非零 exit」）。
 *
 * 修复：该分支在 `--json` 下也打印合法信封（`{ ok:false, error, suggestion }`）
 * + exit 1。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string): string => join(dir, f);

const LIB = `export function add(a, b) {
  return a + b;
}
add(1, 2);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-113-"));
  writeFileSync(p("lib.js"), LIB);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BUG-113: health --json 的用法错误也必须产出 JSON 信封", () => {
  it("--json --from <file>（无位置路径）⇒ stdout 可解析 + ok:false + exit 1", () => {
    const r = runCliTsx(["health", "--json", "--from", p("lib.js")], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout.length, "stdout 不得为空（机器面 JSON.parse 会抛）").toBeGreaterThan(0);
    const json = JSON.parse(r.stdout) as { ok: boolean; error?: string; suggestion?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain("requires explicit paths");
    expect(json.suggestion).toContain("--from");
  }, 60_000);

  it("对照：位置路径在场时 --json --from 正常产出健康文档（不回归）", () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("lib.js")], { cwd: dir });
    const json = JSON.parse(r.stdout) as { ok: boolean; summary: { files: number } };
    expect(json.summary.files).toBe(1);
    expect(typeof json.ok).toBe("boolean");
  }, 60_000);
});

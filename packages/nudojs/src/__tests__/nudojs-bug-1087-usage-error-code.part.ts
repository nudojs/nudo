/**
 * Bug 1087：用法错误的机器码在三个动词间**分叉** ⇒ 同一类错误产出**不同的
 * `pathErrors[].code`** ⇒ 机器消费者必须为 `test` 单独维护一张码表。
 *
 * 实测（改前）：`nudo check --json`（无路径）⇒ `"nudo:usage-error"`；
 * `nudo contract --json`（无路径）⇒ `"nudo:usage-error"`；
 * `nudo test --json`（无路径）⇒ **`"usage-error"`**。
 *
 * 修复：`test` 面的用法错误码改成 `"nudo:usage-error"`（与 check / contract
 * 对齐）；`"syntax-error"` 保持不变（与 check 面同码）。
 *
 * 负控：非 `--json` 面的人读文案与 exit 码不变。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

type PathError = { path: string; code: string; message: string };
type Doc = { ok?: boolean; pathErrors?: PathError[] };

/** 各动词的 `--json` 文档形状不同（check/test = 单文档；contract = 文档数组） */
function firstPathError(stdout: string): PathError | undefined {
  const parsed = JSON.parse(stdout) as Doc | Doc[];
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  for (const d of docs) {
    if (d.pathErrors && d.pathErrors.length > 0) return d.pathErrors[0];
  }
  return undefined;
}

describe("Bug 1087 — 用法错误的机器码三动词统一（nudo:usage-error）", () => {
  const verbs = ["check", "contract", "test"] as const;

  for (const verb of verbs) {
    it(`CLI：${verb} --json（无路径）⇒ pathErrors[0].code === "nudo:usage-error"`, () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1087-"));
      try {
        const r = runCliTsx([verb, "--json"], { cwd: dir });
        expect(r.status).toBe(1);
        // stdout 永不为空（机器面契约）
        expect(r.stdout.trim().length).toBeGreaterThan(0);
        const err = firstPathError(r.stdout);
        expect(err, `stdout:\n${r.stdout}`).toBeDefined();
        expect(err!.code).toBe("nudo:usage-error");
        expect(err!.message.length).toBeGreaterThan(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("负控：非 --json 面仍是 stderr 文案 + exit 1（人读面不回归）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1087-human-"));
    try {
      for (const verb of verbs) {
        const r = runCliTsx([verb], { cwd: dir });
        expect(r.status, `${verb}: ${r.stderr}`).toBe(1);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain("Usage error");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

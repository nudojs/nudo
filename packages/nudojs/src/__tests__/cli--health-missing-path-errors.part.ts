/**
 * BUG-038：`nudo health --json <缺失路径>` 的缺失路径**不进** `pathErrors[]` /
 * `targetErrors[]` ⇒ 机器面只有 `ok:false` + 一句没有机器码的自然语言
 * （`check --json` 对同一路径给了码 + 修复建议）。
 *
 * 根因：缺失路径分支在 `resolveTargetsCollect` **之前**就 `continue`。
 * 修复：同一分支产出同款 PathError（`nudo:path-not-found`）⇒ 三个动词的路径级
 * 错误口径一致；文件条目（「File not found」）保留，但**不重复计数**。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

describe("BUG-038: health --json 的缺失路径必须进 pathErrors[] / targetErrors[]", () => {
  it("--json 面：机器码 nudo:path-not-found + errors 只计 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-038-"));
    const missing = join(dir, "nope.js");
    try {
      const r = runCliTsx(["health", "--json", missing], { cwd: dir });
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        ok: boolean;
        pathErrors?: Array<{ path: string; code: string; message: string; suggestion?: string }>;
        targetErrors?: Array<{ path: string; code: string }>;
        files: Array<{ file: string; error?: string }>;
        summary: { errors: number };
      };
      expect(json.ok).toBe(false);
      // 旧行为：pathErrors / targetErrors 都不存在（机器面拿不到原因）
      expect(json.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
      expect(json.pathErrors?.[0]?.path).toBe(missing);
      expect(json.pathErrors?.[0]?.message).toContain("Not found");
      expect(json.pathErrors?.[0]?.suggestion).toBeTruthy();
      expect(json.targetErrors?.[0]?.code).toBe("nudo:path-not-found");
      // 同一个缺失路径只计 1 个错（不是「文件条目 + 路径错误」各计一次）
      expect(json.summary.errors).toBe(1);
      // 文件条目保留（既有 stdout 面「File not found」的事实源）
      expect(json.files[0]?.error).toContain("File not found");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("文本面：仍打「File not found」+「1 error(s)」+ 路径错误修复建议", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug-038b-"));
    const missing = join(dir, "nope.js");
    try {
      const r = runCliTsx(["health", missing], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("File not found");
      expect(r.stdout).toContain("1 error(s)");
      expect(r.stdout).toContain("Result: FAIL");
      expect(r.stderr).toContain("Not found");
      expect(r.stderr).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * Bug 460 回归（CLI 面）：`nudo:mock-invalid` 的严重度在 **CLI 映射面**被
 * 无条件提到 error —— 与文档（reference/diagnostics.md#nudo-mock-invalid
 * 「**Warning**」、guides/check.md「nudo:mock-invalid | engine | warning」）
 * 和 service 侧（analyzer-orchestrate-uncached.ts 的 `isExpr ? "warning" : "error"`）
 * 都相反。
 *
 * 本文件锁三件事：
 *  ① `@nudo:mock` **表达式**解析失败 ⇒ warning（不再红门禁）；
 *  ② `@nudo:mock` **文件**缺失/加载失败仍是 error（不引入假绿）；
 *  ③ 负控制：同一文件里两条通道严重度一致（不再一 warning 一 error）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** mock 表达式不是已知形态 ⇒ 指令被忽略（mock 不生效） */
const MOCK_EXPR = `// @nudo:mock fs = foo(1)
export function useFs() {
  return 1;
}
`;

/** mock 文件缺失 ⇒ 依赖不可用 ⇒ error */
const MOCK_MISSING_FILE = `// @nudo:mock fs from "./definitely-missing-mock-file.js"
export function useFs() {
  return 1;
}
`;

function fixture(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-460-cli-"));
  writeFileSync(join(dir, "probe.js"), src, "utf-8");
  return dir;
}

type Json = {
  ok: boolean;
  summary: { errors: number; warnings: number };
  issues: { code: string; severity: string }[];
};

describe("Bug 460 CLI：nudo:mock-invalid 严重度对齐文档（warning）", () => {
  it("mock 表达式解析失败 ⇒ warning（不红门禁）", () => {
    const dir = fixture(MOCK_EXPR);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as Json;
      const mockInvalid = json.issues.filter((i) => i.code === "nudo:mock-invalid");
      expect(mockInvalid.length).toBeGreaterThan(0);
      for (const i of mockInvalid) expect(i.severity).toBe("warning");
      // warning 不挡门禁：exit 0、ok:true
      expect(json.summary.errors).toBe(0);
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mock 文件缺失仍是 error（不引入假绿）", () => {
    const dir = fixture(MOCK_MISSING_FILE);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as Json;
      expect(json.summary.errors).toBeGreaterThan(0);
      expect(json.ok).toBe(false);
      expect(r.status).toBe(1);
      const missing = json.issues.filter((i) => i.code === "nudo:module-missing");
      expect(missing.length).toBeGreaterThan(0);
      for (const i of missing) expect(i.severity).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：文件面只出现一条 mock-invalid（无重复报告）", () => {
    const dir = fixture(MOCK_EXPR);
    try {
      const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
      const json = JSON.parse(r.stdout) as Json;
      const mockInvalid = json.issues.filter((i) => i.code === "nudo:mock-invalid");
      expect(mockInvalid).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

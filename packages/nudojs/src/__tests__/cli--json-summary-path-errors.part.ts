/**
 * BUG-115 —— `check --json` 的信封里 `summary.errors` **不含** `pathErrors`
 * （695 口径），而设计文档写的是「并计入」⇒ 只读 `summary.errors` 的机器
 * 消费方把「路径失败」读成「0 错」（`ok` 才是 false）。
 *
 * 现在信封给出**不含歧义**的字段 `summary.pathErrors`（路径错误 / 文件级
 * 硬错误条数），`summary.errors` 仍是分析诊断数（= Σ reports[]，core 契约），
 * 绿运行不加该字段（JSON 逐字节不变）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

type Envelope = {
  ok: boolean;
  summary: { errors: number; pathErrors?: number };
  pathErrors?: Array<{ code: string }>;
  reports: unknown[];
};

const CLEAN = `export function ok() {
  return 1;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug115-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b115", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "ok.js"), CLEAN, "utf-8");
  return cwd;
}

describe("BUG-115 — --json 信封的 summary.pathErrors", () => {
  it("路径不存在 ⇒ ok:false + summary.pathErrors = 1（summary.errors 仍只数诊断）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--json", "nope.js"], { cwd });
      expect(r.status).toBe(1);
      const env = JSON.parse(r.stdout) as Envelope;
      expect(env.ok).toBe(false);
      // 695 口径保留：分析诊断数不含路径错误（= Σ reports[]）
      expect(env.summary.errors).toBe(0);
      // 新增的不歧义字段：机器消费方不必再数 pathErrors[]
      expect(env.summary.pathErrors).toBe(1);
      expect(env.pathErrors?.[0]?.code).toBe("nudo:path-not-found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("绿运行 ⇒ 不带 pathErrors 字段（JSON 形态不漂移）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--json", "ok.js"], { cwd });
      expect(r.status).toBe(0);
      const env = JSON.parse(r.stdout) as Envelope;
      expect(env.ok).toBe(true);
      expect("pathErrors" in env.summary).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

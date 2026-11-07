/**
 * Bug 641 — `nudo:dual-entry` 在**磁盘缓存命中轮**被**重复**上屏
 * （冷缓存 1 条 → 热缓存 2 条同文案）⇒ 机器可读面逐轮漂移
 * （诊断条数随缓存状态变化）。
 *
 * 根因（packages/nudojs/src/commands/check-report.ts）：该 issue 在**缓存
 * 之后**注入（保证命中轮也上屏），但**上一轮的注入结果被写进了磁盘缓存**
 * ⇒ 命中轮拿到的 report / cachedJson 已经含这条 issue，再把 live 的那一条
 * merge 上去 ⇒ 同文案重复两条（mergeCheckIssues / mergeJsonIssues 只追加、
 * 不去重）。
 *
 * 修法：与 env-unresolved / 配置形状诊断同一口径 —— **写盘前剥除 +
 * 读回后剥除**，由本轮 live 注入单一来源上屏 ⇒ miss 轮与命中轮的 issues
 * 数组逐条相同（不引入"热轮无该条"的反向漂移）。
 *
 * 本文件钉住：
 *  - `--json` 面：冷 / 热 / 热三轮的 issues 数组与 summary 逐条相同，
 *    dual-entry 各**恰好 1 条**；
 *  - 人类面：热轮的 issues 段只有**一行** dual-entry；
 *  - 写盘口径：磁盘缓存条目里**不含** nudo:dual-entry。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 双入口包：browser / node 两个面解析到不同文件 */
const PKG = JSON.stringify({
  name: "dualp",
  version: "1.0.0",
  type: "module",
  exports: { ".": { browser: "./browser.js", default: "./node.js" } },
});

const BROWSER_JS = `export function browserOnly() {
  return 1;
}
`;
const NODE_JS = `export function nodeOnly() {
  return 2;
}
`;

type Issue = { code: string };
type CheckJsonLike = { ok: boolean; issues: Issue[]; summary: Record<string, number> };

/** 递归收集缓存目录下的所有文件（缓存条目按 <ns>/<xx>/<hash>.json 分层） */
function cacheFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

describe("Bug 641 — nudo:dual-entry 缓存命中轮不重复上屏", () => {
  it("--json 面：冷/热/热三轮 issues 逐条相同（dual-entry 各 1 条）", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-json-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      const r1 = runCliTsx(["check", file, "--json"], { env });
      const r2 = runCliTsx(["check", file, "--json"], { env });
      const r3 = runCliTsx(["check", file, "--json"], { env });
      const j1 = JSON.parse(r1.stdout) as CheckJsonLike;
      const j2 = JSON.parse(r2.stdout) as CheckJsonLike;
      const j3 = JSON.parse(r3.stdout) as CheckJsonLike;
      const dual = (j: CheckJsonLike): Issue[] =>
        j.issues.filter((i) => i.code === "nudo:dual-entry");
      // 冷轮 1 条；热轮（旧实现 2 条）必须仍是 1 条
      expect(dual(j1).length).toBe(1);
      expect(dual(j2).length).toBe(1);
      expect(dual(j3).length).toBe(1);
      // 逐条相同（不只是条数）：机器面不得随缓存状态漂移
      expect(j2.issues).toEqual(j1.issues);
      expect(j3.issues).toEqual(j1.issues);
      expect(j2.summary).toEqual(j1.summary);
      expect(j3.summary).toEqual(j1.summary);
      expect(r2.stdout).toBe(r1.stdout);
      expect(r3.stdout).toBe(r1.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("人类面：热轮的 issues 段只有一行 dual-entry", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-human-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      runCliTsx(["check", file], { env });
      const hot = runCliTsx(["check", file], { env });
      const issueLines = hot.stdout
        .split("\n")
        .filter((l) => l.includes("(nudo:dual-entry)"));
      expect(issueLines.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("写盘口径：磁盘缓存条目里不含 nudo:dual-entry", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b641-cache-"));
    const file = join(dir, "browser.js");
    const cache = join(dir, "cache");
    writeFileSync(join(dir, "package.json"), PKG, "utf8");
    writeFileSync(file, BROWSER_JS, "utf8");
    writeFileSync(join(dir, "node.js"), NODE_JS, "utf8");
    try {
      const env = { NUDO_CACHE_DIR: cache };
      runCliTsx(["check", file, "--json"], { env });
      const files = cacheFiles(cache);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(readFileSync(f, "utf8")).not.toContain("nudo:dual-entry");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

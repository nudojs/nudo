/**
 * findProjectConfig 目录链 memo（P-IDE3）：
 * - 同 startDir 重复查找只读盘一次（stat 比对命中）；
 * - 链上 package.json 内容/mtime 变化 → miss 重算（新配置可见）；
 * - 显式 evictProjectConfigMemo → 下次重读；
 * - 链上目录从无 package.json 变为有（absent → present 翻转）→ miss。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findProjectConfig,
  evictProjectConfigMemo,
  projectConfigMemoStats,
  interfaceConfig,
} from "../evaluator/config.ts";

const dirs: string[] = [];

beforeEach(() => {
  evictProjectConfigMemo();
});

afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

describe("findProjectConfig directory-chain memo (P-IDE3)", () => {
  it("memoizes the upward walk: repeated lookups hit without disk reads", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cfgmemo-hit-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "m", nudo: { contract: { autoBind: false } } }),
    );
    const deep = join(root, "a", "b", "c");
    mkdirSync(deep, { recursive: true });

    const first = findProjectConfig(deep);
    expect(first?.projectDir).toBe(root);
    expect(interfaceConfig(first?.config).autoBind).toBe(false);
    const readsAfterFirst = projectConfigMemoStats().diskReads;

    // 命中：只做链上 stat 比对，不再 readFileSync+JSON.parse
    for (let i = 0; i < 3; i++) {
      const again = findProjectConfig(deep);
      expect(again?.projectDir).toBe(root);
    }
    expect(projectConfigMemoStats().diskReads).toBe(readsAfterFirst);
  });

  it("package.json rewrite (mtime flip) invalidates and serves the new config", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cfgmemo-rew-"));
    dirs.push(root);
    const pkg = join(root, "package.json");
    writeFileSync(pkg, JSON.stringify({ name: "m", nudo: { contract: { autoBind: false } } }));
    const t0 = new Date(Date.now() - 60_000);
    utimesSync(pkg, t0, t0);
    const src = join(root, "src");
    mkdirSync(src);

    expect(interfaceConfig(findProjectConfig(src)?.config).autoBind).toBe(false);

    writeFileSync(pkg, JSON.stringify({ name: "m", nudo: { contract: { autoBind: true } } }));
    const t1 = new Date(Date.now() - 30_000);
    utimesSync(pkg, t1, t1);

    const readsBefore = projectConfigMemoStats().diskReads;
    expect(interfaceConfig(findProjectConfig(src)?.config).autoBind).toBe(true);
    expect(projectConfigMemoStats().diskReads).toBe(readsBefore + 1);
  });

  it("explicit eviction (clearAnalysisSessionCaches channel) forces a re-read", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cfgmemo-ev-"));
    dirs.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "m", nudo: {} }));
    const src = join(root, "src");
    mkdirSync(src);

    findProjectConfig(src);
    const reads = projectConfigMemoStats().diskReads;
    findProjectConfig(src);
    expect(projectConfigMemoStats().diskReads).toBe(reads);

    evictProjectConfigMemo();
    expect(projectConfigMemoStats().entries).toBe(0);
    findProjectConfig(src);
    expect(projectConfigMemoStats().diskReads).toBe(reads + 1);
  });

  it("a package.json appearing in a previously-absent chain dir flips the memo (absent → present)", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cfgmemo-abs-"));
    dirs.push(root);
    const mid = join(root, "packages", "lib");
    const deep = join(mid, "src");
    mkdirSync(deep, { recursive: true });

    // 链上无任何 package.json
    expect(findProjectConfig(deep)).toBeNull();

    // 中间目录新建 package.json（watcher 的 isProjectConfigPath 通道之外，
    // memo 的 absent 记录必须翻转）
    writeFileSync(join(mid, "package.json"), JSON.stringify({ name: "lib", nudo: {} }));
    const t = new Date();
    utimesSync(join(mid, "package.json"), t, t);

    const found = findProjectConfig(deep);
    expect(found?.projectDir).toBe(mid);
  });

  it("null results are memoized too (no package.json anywhere)", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cfgmemo-null-"));
    dirs.push(root);
    const deep = join(root, "x", "y");
    mkdirSync(deep, { recursive: true });

    expect(findProjectConfig(deep)).toBeNull();
    const reads = projectConfigMemoStats().diskReads;
    expect(findProjectConfig(deep)).toBeNull();
    expect(projectConfigMemoStats().diskReads).toBe(reads);
  });
});

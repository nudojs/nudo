/**
 * findProjectConfig 目录链 memo（P-IDE3）：
 * - 同 startDir 重复查找只读盘一次（stat 比对命中）；
 * - 链上 package.json 内容/mtime 变化 → miss 重算（新配置可见）；
 * - 显式 evictProjectConfigMemo → 下次重读；
 * - 链上目录从无 package.json 变为有（absent → present 翻转）→ miss。
 * stat 错误分类（#135）：
 * - ENOENT = 真缺席，继续向上；
 * - 非 ENOENT（EACCES/…）= fail-closed：告警 + null（不猜根配置），
 *   memo 校验抛错按「已变化」回落重走，瞬态故障恢复后自愈。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, chmodSync } from "node:fs";
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

describe("findProjectConfig stat-error taxonomy (#135)", () => {
  it("ENOENT is true absence: the walk continues upward and finds the parent config", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-cfgstat-enoent-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "m", nudo: { contract: { autoBind: false } } }),
    );
    const mid = join(root, "packages", "lib");
    mkdirSync(mid, { recursive: true });

    // mid 无 package.json（ENOENT = 真缺席）→ 不得中断，继续向上命中 root
    const found = findProjectConfig(mid);
    expect(found?.projectDir).toBe(root);
    expect(interfaceConfig(found?.config).autoBind).toBe(false);
  });
});

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

/**
 * 非 ENOENT stat 错误用真实权限夹具：chmod 000 的祖先目录使其下任何
 * package.json 的 stat 均为 EACCES。root 下 chmod 000 仍可读，跳过
 * （GitHub Actions runner / 开发机均非 root，同 check-fix-read-error 先例）。
 */
describe.skipIf(isRoot)("findProjectConfig non-ENOENT stat failure (EACCES)", () => {
  function makeTree(): { root: string; locked: string; src: string } {
    const root = mkdtempSync(join(tmpdir(), "nudo-cfgstat-eacces-"));
    dirs.push(root);
    // 根有 nudo 配置：旧实现把 EACCES 吞成「缺席」继续向上 → 静默继承
    // 根配置（假绿）。新语义必须 fail-closed 返回 null，不猜根配置。
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "m", nudo: { contract: { autoBind: false } } }),
    );
    const locked = join(root, "pkgdir");
    const src = join(locked, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(locked, "package.json"), JSON.stringify({ name: "sub", nudo: {} }));
    return { root, locked, src };
  }

  function stderrText(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.map((c) => String(c[0])).join("");
  }

  it("EACCES on the chain fails closed: null result + stderr warning (no root-config inheritance)", () => {
    const { locked, src } = makeTree();
    chmodSync(locked, 0o000);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(findProjectConfig(src)).toBeNull();
      const out = stderrText(spy);
      expect(out).toContain("stat failed");
      expect(out).toContain("project config disabled for this subtree");
      expect(out).toContain(join(locked, "src", "package.json"));
    } finally {
      spy.mockRestore();
      chmodSync(locked, 0o755); // 恢复，让 afterEach 的 rmSync 可清理
    }
  });

  it("persistent stat error: memo validation falls back to a re-walk (no crash) and stays loud", () => {
    const { locked, src } = makeTree();
    chmodSync(locked, 0o000);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(findProjectConfig(src)).toBeNull();
      const warned = () =>
        spy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("stat failed")).length;
      expect(warned()).toBe(1);

      // 第二次：memoHit 内 stat 抛错 → 按「已变化」miss → 重走主循环 →
      // 再告警。不得让异常炸穿校验入口。
      expect(findProjectConfig(src)).toBeNull();
      expect(warned()).toBe(2);
    } finally {
      spy.mockRestore();
      chmodSync(locked, 0o755);
    }
  });

  it("transient stat error self-heals once the fault clears (null is not pinned)", () => {
    const { locked, src } = makeTree();
    chmodSync(locked, 0o000);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(findProjectConfig(src)).toBeNull();
      expect(stderrText(spy)).toContain("stat failed");

      // 故障恢复：链上失败目录记的是 STAT_ERROR_FP 哨兵（pkgStatFp 永不
      // 产出该值）→ memo 必 miss → 重走 → 命中 pkgdir 自有的 nudo 配置。
      // 若记 absent（undefined），恢复后真实 ENOENT 会匹配 → 静默复用
      // memoized null（#135 同型钉死）。
      chmodSync(locked, 0o755);
      const found = findProjectConfig(src);
      expect(found?.projectDir).toBe(locked);
    } finally {
      spy.mockRestore();
      chmodSync(locked, 0o755);
    }
  });
});

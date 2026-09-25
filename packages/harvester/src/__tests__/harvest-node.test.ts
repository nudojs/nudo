import { describe, it, expect, beforeEach } from "vitest";
import {
  harvestNodeTypes,
  summarizeNodeEnv,
  clearNodeHarvestCache,
  getNodeHarvestCacheSize,
  isHarvestNodeDisabled,
  HARVEST_NODE_DEFAULT_MAX_FILES,
  HARVEST_NODE_DEFAULT_MAX_MS,
} from "../harvest-node.ts";
import { resolvePackageRoot } from "../harvest-package.ts";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * B2 / B7 — @types/node harvest productization + performance guardrails.
 *
 * Both paths are documented intentionally:
 * - HARD: when @types/node is resolvable in this worktree, harvest must
 *   succeed with stats and respect maxFiles budget.
 * - SKIP: when absent (or NUDO_HARVEST_NODE=off), tests soft-skip with an
 *   explicit message — still allowed, never a silent green on a wrong env.
 */

// packages/service/src/__tests__/ → monorepo root (vitest cwd may already be root)
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const searchFroms = [monorepoRoot, process.cwd()];
const typesNodeRoot =
  searchFroms.map((d) => resolvePackageRoot("@types/node", d)).find(Boolean) ??
  undefined;
const hasTypesNode = !!typesNodeRoot && existsSync(typesNodeRoot);
const harvestDisabled = isHarvestNodeDisabled();

beforeEach(() => {
  clearNodeHarvestCache();
});

describe("harvest @types/node productization (B2)", () => {
  it("documents defaults stay IDE-budgeted", () => {
    expect(HARVEST_NODE_DEFAULT_MAX_FILES).toBe(12);
    expect(HARVEST_NODE_DEFAULT_MAX_MS).toBe(2500);
  });

  it("isHarvestNodeDisabled respects NUDO_HARVEST_NODE=off", () => {
    expect(isHarvestNodeDisabled({})).toBe(false);
    expect(isHarvestNodeDisabled({ NUDO_HARVEST_NODE: "off" })).toBe(true);
    expect(isHarvestNodeDisabled({ NUDO_HARVEST_NODE: "on" })).toBe(false);
  });

  it("returns ok+stats when @types/node is installed (HARD path)", () => {
    if (!hasTypesNode) {
      // Graceful skip path — @types/node not on this machine/CI image.
      const r = harvestNodeTypes(monorepoRoot);
      // B2：缺失时降级手写 env，不再 ok:false
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.degraded).toBe(true);
      console.info(
        "[harvest-node] SKIP hard path: @types/node not resolvable from worktree",
      );
      return;
    }
    if (harvestDisabled) {
      const r = harvestNodeTypes(monorepoRoot);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("disabled");
      console.info("[harvest-node] SKIP hard path: NUDO_HARVEST_NODE=off");
      return;
    }

    const r = harvestNodeTypes(monorepoRoot);
    expect(r.ok, r.ok ? "" : `harvest failed: ${r.error}`).toBe(true);
    if (!r.ok) return;
    expect(r.files).toBeGreaterThan(0);
    expect(r.files).toBeLessThanOrEqual(HARVEST_NODE_DEFAULT_MAX_FILES);
    expect(r.stats.files).toBe(r.files);
    expect(r.stats.symbols).toBeGreaterThan(0);
    expect(r.stats.skipped).toBeGreaterThanOrEqual(0);
    // B2：首调可命中磁盘缓存（跨进程）；只要不是 degraded 手写回落即可
    expect(r.degraded).toBeFalsy();

    const s = summarizeNodeEnv(r.env);
    expect(s.symbolCount).toBeGreaterThan(0);
    const hasUseful =
      s.globals.some((g) => /process|Buffer|console/i.test(g)) ||
      s.modules.length > 0;
    expect(hasUseful).toBe(true);

    // Second call hits in-process cache
    const r2 = harvestNodeTypes(monorepoRoot);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.cached).toBe(true);
    expect(getNodeHarvestCacheSize()).toBeGreaterThan(0);

    clearNodeHarvestCache();
    expect(getNodeHarvestCacheSize()).toBe(0);
  });

  it("NUDO_HARVEST_NODE=off disables harvest with explicit reason", () => {
    // Simulate disable via direct helper contract (env may already be set).
    expect(isHarvestNodeDisabled({ NUDO_HARVEST_NODE: "off" })).toBe(true);
    if (harvestDisabled) {
      const r = harvestNodeTypes(monorepoRoot);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("disabled");
        expect(r.error).toContain("NUDO_HARVEST_NODE");
      }
    }
  });
});

describe("harvest @types/node performance guardrails (B7)", () => {
  it("respects maxFiles budget when @types/node is present", () => {
    if (!hasTypesNode || harvestDisabled) {
      console.info("[harvest-node] SKIP maxFiles guard: @types/node unavailable or disabled");
      return;
    }
    const maxFiles = 3;
    const r = harvestNodeTypes(monorepoRoot, maxFiles, HARVEST_NODE_DEFAULT_MAX_MS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files).toBeLessThanOrEqual(maxFiles);
    expect(r.files).toBeGreaterThan(0);
  });

  it("tiny maxMs still returns (truncated ok) rather than throwing", () => {
    if (!hasTypesNode || harvestDisabled) {
      console.info("[harvest-node] SKIP maxMs guard: @types/node unavailable or disabled");
      return;
    }
    // 0ms budget: harvestDts must not throw; may skip remaining files.
    const r = harvestNodeTypes(monorepoRoot, 4, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.files).toBeGreaterThanOrEqual(0);
    expect(r.files).toBeLessThanOrEqual(4);
  });

  it("missing @types/node degrades to handwritten env and caches (B2)", () => {
    const missDir = "/tmp/nudo-harvest-missing-xyz";
    const r = harvestNodeTypes(missDir);
    // B2 降级链：harvest 未命中 → 手写 node env（degraded）
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.degraded).toBe(true);
      expect(r.root).toBe("@nudojs/env");
      expect(r.cached).toBeFalsy();
    }
    const r2 = harvestNodeTypes(missDir);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.degraded).toBe(true);
      expect(r2.cached).toBe(true);
    }
  });
});

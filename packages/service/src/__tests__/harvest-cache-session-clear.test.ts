/**
 * clearAnalysisSessionCaches 必须清空 harvester 进程内缓存（此前
 * clearHarvestCache / clearNodeHarvestCache 全仓只有测试调用，从未接线：
 * not-found 条目钉死整个进程，中途安装 @types/node 不可见）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  harvestPackageCached,
  harvestNodeTypes,
  clearHarvestCache,
  clearNodeHarvestCache,
  getHarvestCacheSize,
  getNodeHarvestCacheSize,
} from "@nudojs/harvester";
import { clearAnalysisSessionCaches } from "../session-cache.ts";
import { tmpProject } from "./tmp-project.ts";

beforeEach(() => {
  clearHarvestCache();
  clearNodeHarvestCache();
});

describe("clearAnalysisSessionCaches 接线 harvest 进程内缓存", () => {
  it("harvest-auto pkg 缓存：命中一次后 clear → 清空，再取重新 harvest", () => {
    const dir = tmpProject("nudo-harvest-session-");
    const pkg = "nudo-definitely-missing-pkg";
    expect(harvestPackageCached(pkg, dir)).toBeNull();
    expect(getHarvestCacheSize()).toBe(1); // null 占位也被缓存

    harvestPackageCached(pkg, dir); // 二次调用命中缓存（不重新 walk）
    expect(getHarvestCacheSize()).toBe(1);

    clearAnalysisSessionCaches();
    expect(getHarvestCacheSize()).toBe(0);

    harvestPackageCached(pkg, dir); // 重新 walk → 条目重建
    expect(getHarvestCacheSize()).toBe(1);
  });

  it("harvest-node not-found 钉死条目：clear 后重新探测 @types/node", () => {
    const missDir = "/nonexistent-root-for-nudo-test";
    const first = harvestNodeTypes(missDir);
    // B2 降级链：@types/node 缺失 → 手写 @nudojs/env node 面（ok + degraded）
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.degraded).toBe(true);
      expect(first.root).toBe("@nudojs/env");
      expect(first.cached).toBe(false);
    }
    expect(getNodeHarvestCacheSize()).toBe(1);

    const second = harvestNodeTypes(missDir);
    if (second.ok) expect(second.cached).toBe(true); // 症状：not-found 进程内回放
    expect(getNodeHarvestCacheSize()).toBe(1);

    clearAnalysisSessionCaches();
    expect(getNodeHarvestCacheSize()).toBe(0);

    const third = harvestNodeTypes(missDir);
    if (third.ok) {
      expect(third.cached).toBe(false); // 重新探测，非缓存回放
      expect(third.degraded).toBe(true);
    }
    expect(getNodeHarvestCacheSize()).toBe(1);
  });
});

/**
 * harvest-auto 缓存 fail-closed 回归：
 * harvestPackageWithDisk 抛异常（瞬态故障）时**不得**把 null 钉死进进程内缓存
 * （与 eval-run「宁冷勿陈旧」同口径）——下次调用要能重试；
 * 确定 miss（resolved null）仍是合法缓存占位。
 *
 * vi.mock 部分透传（importOriginal spread + 覆写单函数）是注入瞬态故障的
 * 唯一稳定路径（真实 fs 抖动不可复现）。注意被测函数是**同步**的，
 * 注入必须用同步 throw（mockImplementationOnce），不能用 mockRejectedValue
 * （那是 rejected promise，同步 try/catch 接不住）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../harvest-disk.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../harvest-disk.ts")>();
  return { ...orig, harvestPackageWithDisk: vi.fn() };
});

import { harvestPackageCached, clearHarvestCache, getHarvestCacheSize } from "../harvest-auto.ts";
import { harvestPackageWithDisk } from "../harvest-disk.ts";
import type { PackageHarvest } from "../harvest-package.ts";

const okHarvest: PackageHarvest = {
  pkg: "pkg-t",
  root: "/proj/node_modules/pkg-t",
  dtsFiles: ["/proj/node_modules/pkg-t/index.d.ts"],
  env: { globals: {}, modules: {}, stats: { files: 1, symbols: 0, skipped: 0 } },
};

beforeEach(() => {
  clearHarvestCache();
  vi.mocked(harvestPackageWithDisk).mockReset();
});

describe("harvestPackageCached — 瞬态故障不钉死缓存", () => {
  it("异常路径不写缓存：返回 null 但 cache 空，下次调用重试拿到真实结果", () => {
    const m = vi.mocked(harvestPackageWithDisk);
    m.mockImplementationOnce(() => {
      throw Object.assign(new Error("read EACCES: transient"), { code: "EACCES" });
    });
    expect(harvestPackageCached("pkg-t", "/proj")).toBeNull();
    expect(getHarvestCacheSize()).toBe(0); // 旧口径：null 被 set 钉死整个进程

    m.mockImplementationOnce(() => okHarvest);
    expect(harvestPackageCached("pkg-t", "/proj")).toBe(okHarvest);
    expect(getHarvestCacheSize()).toBe(1); // 成功终态才进缓存
  });

  it("确定 miss（返回 null）仍是合法缓存占位：二次调用命中缓存不再重跑", () => {
    const m = vi.mocked(harvestPackageWithDisk);
    m.mockImplementation(() => null);
    expect(harvestPackageCached("pkg-m", "/proj")).toBeNull();
    expect(getHarvestCacheSize()).toBe(1);
    expect(harvestPackageCached("pkg-m", "/proj")).toBeNull();
    expect(m).toHaveBeenCalledTimes(1);
  });
});

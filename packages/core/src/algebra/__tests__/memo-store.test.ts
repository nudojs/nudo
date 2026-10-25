/**
 * 依赖感知 LRU memo 的通用契约（check 整文件报告 / generalize L0 共用）。
 *
 * 重点：命中刷新队尾、set 时满即逐最旧、`undefined` 值命中不等于 miss、
 * 定向逐出只删依赖目标路径的条目（路径归一 stablePathKey）。
 */
import { describe, it, expect } from "vitest";
import { DependencyMemo } from "../memo-store.ts";
import { loadModuleId, moduleMapId } from "../memo-identity.ts";

describe("DependencyMemo：有界 LRU", () => {
  it("超过上限逐出最旧条目", () => {
    const m = new DependencyMemo<number>(2);
    m.set("a", 1, []);
    m.set("b", 2, []);
    m.set("c", 3, []);
    expect(m.size).toBe(2);
    expect(m.lookup("a").hit).toBe(false);
    expect(m.lookup("b")).toEqual({ hit: true, value: 2 });
    expect(m.lookup("c")).toEqual({ hit: true, value: 3 });
  });

  it("lookup 命中后移到队尾（下一次逐出的是真正最旧者）", () => {
    const m = new DependencyMemo<number>(2);
    m.set("a", 1, []);
    m.set("b", 2, []);
    expect(m.lookup("a")).toEqual({ hit: true, value: 1 });
    m.set("c", 3, []);
    expect(m.lookup("b").hit).toBe(false);
    expect(m.lookup("a")).toEqual({ hit: true, value: 1 });
    expect(m.lookup("c")).toEqual({ hit: true, value: 3 });
  });

  it("set 时满即逐最旧（即使 key 已存在，与两处原实现一致）", () => {
    const m = new DependencyMemo<number>(2);
    m.set("a", 1, []);
    m.set("b", 2, []);
    m.set("b", 20, []);
    // 原实现先删最旧，再 set 已存在的 key（不移动其插入位）
    expect(m.lookup("a").hit).toBe(false);
    expect(m.lookup("b")).toEqual({ hit: true, value: 20 });
  });
});

describe("DependencyMemo：undefined 值", () => {
  it("存了 undefined 是命中，未存是 miss", () => {
    const m = new DependencyMemo<number | undefined>(2);
    m.set("miss", undefined, []);
    expect(m.lookup("never-set").hit).toBe(false);
    const hit = m.lookup("miss");
    expect(hit.hit).toBe(true);
    if (hit.hit) expect(hit.value).toBeUndefined();
  });
});

describe("DependencyMemo：依赖索引与定向逐出", () => {
  it("只逐出依赖目标路径的 key，且路径归一（file:// 与裸路径同键）", () => {
    const m = new DependencyMemo<number>(8);
    m.set("k1", 1, ["/proj/shapes.nudo.js"]);
    m.set("k2", 2, ["/proj/other.nudo.js"]);
    m.set("k3", 3, []);
    expect(m.evictForPaths(["file:///proj/shapes.nudo.js"])).toBe(1);
    expect(m.lookup("k1").hit).toBe(false);
    expect(m.lookup("k2")).toEqual({ hit: true, value: 2 });
    expect(m.lookup("k3")).toEqual({ hit: true, value: 3 });
  });

  it("同一路径的多个依赖者全部逐出；未知路径是 no-op", () => {
    const m = new DependencyMemo<number>(8);
    m.set("k1", 1, ["/proj/dep.nudo.js"]);
    m.set("k2", 2, ["/proj/dep.nudo.js"]);
    m.set("k3", 3, []);
    expect(m.evictForPaths(["/proj/dep.nudo.js"])).toBe(2);
    expect(m.size).toBe(1);
    expect(m.lookup("k3").hit).toBe(true);
    expect(m.evictForPaths(["/nope/missing.nudo.js"])).toBe(0);
  });

  it("reset 清空值表与依赖索引", () => {
    const m = new DependencyMemo<number>(8);
    m.set("k1", 1, ["/proj/dep.nudo.js"]);
    m.reset();
    expect(m.size).toBe(0);
    expect(m.lookup("k1").hit).toBe(false);
    // 索引也已清空：逐出不再计数
    expect(m.evictForPaths(["/proj/dep.nudo.js"])).toBe(0);
    // reset 后仍可复用
    m.set("k1", 2, []);
    expect(m.lookup("k1")).toEqual({ hit: true, value: 2 });
  });
});

describe("memo 身份注册表（check / generalize 共用）", () => {
  it("loader 身份按对象稳定；缺省 = 0；不同对象不同 id", () => {
    const a = () => undefined;
    const b = () => undefined;
    expect(loadModuleId(undefined)).toBe(0);
    expect(loadModuleId(a)).toBe(loadModuleId(a));
    expect(loadModuleId(b)).toBe(loadModuleId(b));
    expect(loadModuleId(a)).not.toBe(loadModuleId(b));
  });

  it("模块表身份按对象稳定；缺省 = \"-\"", () => {
    const m1 = {};
    const m2 = {};
    expect(moduleMapId(undefined)).toBe("-");
    expect(moduleMapId(m1)).toBe(moduleMapId(m1));
    expect(moduleMapId(m2)).toBe(moduleMapId(m2));
    expect(moduleMapId(m1)).not.toBe(moduleMapId(m2));
  });
});

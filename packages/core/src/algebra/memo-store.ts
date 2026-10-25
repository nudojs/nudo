/**
 * 依赖感知的有界 LRU memo（check 整文件报告 / generalize L0 共用）。
 *
 * 从 `check-memo.ts` 与 `generalize.ts` 的重复基建抽出：
 * - 值表（命中后移到队尾；set 时满即逐最旧——两处原口径一致）；
 * - `key -> string[]` 依赖表 + `path -> Set<key>` 反向索引；
 * - 按路径定向逐出（`*.nudo.js` 变更后只失效依赖它的条目）。
 *
 * 值域允许 `undefined`（generalize 缓存 `PolyFn | undefined`）⇒ 查询用
 * {@link DependencyMemo.lookup} 的 `hit` 区分「存了 undefined」与 miss
 * （普通 `get` 的 undefined 无法二义）。
 *
 * 路径归一（`stablePathKey`）在 set / evict 两端同口径：依赖路径与逐出
 * 路径的形态由 `fromFile` 决定，混形态会跨形态 miss。
 */

import { stablePathKey } from "./load-deps-fp.ts";

/** 查询结局：`hit:false` = miss；`hit:true` 的 value 可以是 undefined */
export type MemoLookup<V> = { hit: true; value: V } | { hit: false };

export class DependencyMemo<V> {
  private readonly values = new Map<string, V>();
  private readonly keyDeps = new Map<string, string[]>();
  private readonly depIndex = new Map<string, Set<string>>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.values.size;
  }

  /** 命中 ⇒ 移到队尾（LRU 刷新）；`hit` 区分存了 undefined 与 miss */
  lookup(key: string): MemoLookup<V> {
    if (!this.values.has(key)) return { hit: false };
    const value = this.values.get(key) as V;
    this.values.delete(key);
    this.values.set(key, value);
    return { hit: true, value };
  }

  set(key: string, value: V, depPaths: readonly string[]): void {
    // set-time 逐出：满即删最旧（与两处原实现一致——即使 key 已存在）
    if (this.values.size >= this.max) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) {
        this.values.delete(oldest);
        this.unindex(oldest);
      }
    }
    this.values.set(key, value);
    if (depPaths.length > 0) {
      const normDeps = [...new Set(depPaths.map(stablePathKey))];
      this.keyDeps.set(key, normDeps);
      for (const p of normDeps) {
        let set = this.depIndex.get(p);
        if (!set) {
          set = new Set();
          this.depIndex.set(p, set);
        }
        set.add(key);
      }
    }
  }

  /** 定向逐出依赖这些路径的条目；返回删除数。查找与索引同走 stablePathKey */
  evictForPaths(paths: readonly string[]): number {
    let n = 0;
    for (const raw of paths) {
      const p = stablePathKey(raw);
      const keys = this.depIndex.get(p);
      if (!keys) continue;
      for (const key of [...keys]) {
        this.values.delete(key);
        this.unindex(key);
        n++;
      }
    }
    return n;
  }

  reset(): void {
    this.values.clear();
    this.keyDeps.clear();
    this.depIndex.clear();
  }

  private unindex(key: string): void {
    const deps = this.keyDeps.get(key);
    if (!deps) return;
    for (const p of deps) {
      const set = this.depIndex.get(p);
      if (!set) continue;
      set.delete(key);
      if (set.size === 0) this.depIndex.delete(p);
    }
    this.keyDeps.delete(key);
  }
}

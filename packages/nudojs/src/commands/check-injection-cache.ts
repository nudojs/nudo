/**
 * ABS-18 · watch 增量轮的 `runCheck` **注入对象复用**。
 *
 * 为什么需要：`checkMemoKey` 含 `moduleMapId(identityOpts.modules)`（身份键；
 * `memo-identity.ts` 的信任模型是「调用方同表对象跨调用」），而 watch 每轮对
 * 每个文件都 `buildCheckInjection` 新建模块表 ⇒ **check memo 永不命中**
 * （实测 `checkSource` ~500ms/文件，占增量轮 90%+）。
 *
 * 做法：把 `buildCheckInjection` 的产物按「分析输入身份」缓存，命中时复用**同一个**
 * 注入对象（模块表对象身份因此稳定）。键由调用方构造（`check.ts` 用
 * `analysisFileCacheKey`：稳定源码 × 依赖内容指纹 × env 名 × env 内容 × 预载
 * 状态 × autoBind × analysis 配置）。任一维变化 ⇒ 新键 ⇒ 重建；指纹截断 /
 * 读错误时调用方不查不写（fail-closed）。
 *
 * 生命周期：watch 会话内一份；LRU 上限（默认 256，与同类 memo 对齐）防大仓
 * 常驻膨胀。命中时把装配期产生的指令文法诊断（`dirDiags`）与 mock 错误原样
 * 重放——报告面不能因复用而少诊断。
 */
import type { RunTranspiledOptions } from "@nudojs/core";
import type { MockFromError } from "@nudojs/service";
import type { DirectiveDiag } from "@nudojs/parser";

export type CachedCheckInjection = {
  inject: RunTranspiledOptions;
  mockFromErrors: MockFromError[];
  /** 装配期产生的指令文法诊断（命中时必须重放） */
  dirDiags: DirectiveDiag[];
};

export type CheckInjectionCacheStats = {
  hits: number;
  misses: number;
  size: number;
  max: number;
};

export type CheckInjectionCache = {
  get(key: string): CachedCheckInjection | undefined;
  set(key: string, value: CachedCheckInjection): void;
  clear(): void;
  /** 测试 / `[check-profile]` 观测面 */
  stats(): CheckInjectionCacheStats;
};

export const DEFAULT_CHECK_INJECTION_CACHE_MAX = 256;

export function createCheckInjectionCache(
  max: number = DEFAULT_CHECK_INJECTION_CACHE_MAX,
): CheckInjectionCache {
  const limit = Math.max(1, Math.floor(max));
  /** Map 的插入序即 LRU 序：命中/写入移到队尾，超限删队首。 */
  const store = new Map<string, CachedCheckInjection>();
  let hits = 0;
  let misses = 0;

  const trim = (): void => {
    while (store.size > limit) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) return;
      store.delete(oldest);
    }
  };

  return {
    get(key: string): CachedCheckInjection | undefined {
      const hit = store.get(key);
      if (hit === undefined) {
        misses++;
        return undefined;
      }
      hits++;
      store.delete(key);
      store.set(key, hit);
      return hit;
    },
    set(key: string, value: CachedCheckInjection): void {
      store.delete(key);
      store.set(key, value);
      trim();
    },
    clear(): void {
      store.clear();
    },
    stats(): CheckInjectionCacheStats {
      return { hits, misses, size: store.size, max: limit };
    },
  };
}

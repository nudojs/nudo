/**
 * @nudo:pure 记忆化（值基键，Bug 281）。
 *
 * 求值引擎有两条 pure 调用路径，各持一个实例：
 * - `$call` 的 Abs fn 路径（exec/call.ts）；
 * - `$callNamed` 宿主路径（exec/calls.ts）。
 *
 * 实现（WeakMap<fn, LRU> + 值基键）单一；实例隔离保持既有命中面不变
 * （两条路径命中后的呈现不同：`$callNamed` 还要按契约面 present）。
 * 清理 API（clearPureMemo / clearPureCallMemo）必须清**全部**实例——
 * 任一入口都不得留下另一条路径的陈旧缓存。
 */
import type { Abs } from "../abs.ts";
import type { AbsApplyResult } from "../abs-fn.ts";
import { pureValueKey } from "../call-budget.ts";
import { BoundedLruMap } from "../lru-map.ts";

/** 内层 Map 上界（防 LSP 长会话无界膨胀；与 session-cache-limits 口径对齐） */
const PURE_MEMO_MAX = 256;

/** 一次可缓存调用的身份：fn 对象 + 值基键（键只算一次，get/set 复用） */
export type PureMemoEntry = {
  fn: object;
  key: string;
};

export type PureMemo = {
  /** 值基键（不可比较的实参 / 非对象 callee ⇒ undefined ⇒ 调用方**不缓存**） */
  keyOf(fn: unknown, args: Abs[]): PureMemoEntry | undefined;
  get(entry: PureMemoEntry): AbsApplyResult | undefined;
  set(entry: PureMemoEntry, result: AbsApplyResult): void;
  clear(): void;
};

/** 全部 memo 实例（清理 API 统一清空，避免一条路径留下陈旧缓存）。
 *
 * 持 `WeakRef` 而非强引用：两条既有路径的实例由模块级绑定强持有，语义不变；
 * 未来按会话创建的实例在无人引用后可被 GC，`clearAllPureMemos` 遍历时顺带
 * 摘除已解引用的条目——注册表不会只增不减，也不会让无关的清理长期持有它们。 */
const instances = new Set<WeakRef<PureMemo>>();

function fnObjectOf(fn: unknown): object | undefined {
  if (typeof fn === "object" && fn !== null) return fn;
  if (typeof fn === "function") return fn;
  return undefined;
}

export function createPureMemo(maxEntries = PURE_MEMO_MAX): PureMemo {
  let memo = new WeakMap<object, BoundedLruMap<AbsApplyResult>>();
  const instance: PureMemo = {
    keyOf(fn, args) {
      const fnObj = fnObjectOf(fn);
      if (!fnObj) return undefined;
      const key = pureValueKey(args);
      // 不可比较的实参 ⇒ 不缓存：宁可不算命中，也不能算出错误的命中
      //（错误的命中 = 陈旧值 = Bug 281 的根因）
      return key === undefined ? undefined : { fn: fnObj, key };
    },
    get(entry) {
      return memo.get(entry.fn)?.get(entry.key);
    },
    set(entry, result) {
      let m = memo.get(entry.fn);
      if (!m) {
        m = new BoundedLruMap<AbsApplyResult>(maxEntries);
        memo.set(entry.fn, m);
      }
      m.set(entry.key, result);
    },
    clear() {
      memo = new WeakMap();
    },
  };
  instances.add(new WeakRef(instance));
  return instance;
}

/** 清空全部存活 memo 实例（clearPureMemo / clearPureCallMemo 共用实现）；
 *  遍历时摘除已解引用的注册项（Set 迭代中 delete 当前项安全）。 */
export function clearAllPureMemos(): void {
  for (const ref of instances) {
    const instance = ref.deref();
    if (instance === undefined) {
      instances.delete(ref);
      continue;
    }
    instance.clear();
  }
}

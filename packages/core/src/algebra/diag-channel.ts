/**
 * 诊断 side-channel 共享原语（leaf 模块：零依赖）。
 *
 * refine（RefineDiag）/ interface（InterfaceDiag）各持一份同构实现
 * （collector + seq + 定容环形缓冲 + takeSince 增量排干）——历史上多份
 * 拷贝各自漂移过，收敛到本文件单一定义。
 *
 * seq 语义（消费方以此为 since 锚，不得改动）：
 * - emit 时 `++seq` 入队（首条 seq=1）；
 * - count() 返回当前累计序号——探测方先 count 取锚；
 * - takeSince(since) 只排走 seq > since 的增量（清空仅限增量），
 *   更早的在途条目保留给其真正消费方（全量 take 曾在 await 窗口
 *   偷走在途诊断——两轮事故的根因）。
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** 诊断通道：一个具名 side-channel 的全部操作 */
export type DiagChannel<T> = {
  /** 设置诊断观察者（null 清除）；缓冲照常累积，take 取走 */
  setCollector(fn: ((d: T) => void) | null): void;
  /** 当前观察者（作用域继承用；null = 无） */
  getCollector(): ((d: T) => void) | null;
  /** 当前诊断累计序号（since 锚） */
  count(): number;
  /** 取走已收集的诊断（收集即清空） */
  take(): T[];
  /** 只取走 seq > since 的增量（清空仅限增量；更早在途条目保留） */
  takeSince(since: number): T[];
  /** 入队一条诊断（缓冲满 cap 挤出最旧条目）并通知观察者 */
  emit(d: T): void;
};

/**
 * 创建定容诊断通道：缓冲达 cap 后挤出最旧条目（防长会话无界增长，
 * 消费方 take/takeSince 按批取走）。
 */
export function createDiagChannel<T>(cap: number): DiagChannel<T> {
  let collector: ((d: T) => void) | null = null;
  let seq = 0;
  const buf: Array<{ seq: number; d: T }> = [];
  return {
    setCollector(fn) {
      collector = fn;
    },
    getCollector() {
      return collector;
    },
    count() {
      return seq;
    },
    take() {
      const out = buf.map((e) => e.d);
      buf.length = 0;
      return out;
    },
    takeSince(since) {
      const out: T[] = [];
      let kept = 0;
      for (const e of buf) {
        if (e.seq > since) out.push(e.d);
        else buf[kept++] = e;
      }
      buf.length = kept;
      return out;
    },
    emit(d) {
      if (buf.length >= cap) buf.shift();
      buf.push({ seq: ++seq, d });
      collector?.(d);
    },
  };
}

/**
 * 可作用域隔离的诊断通道（collector-scope 配套）。
 *
 * - 无作用域：所有操作落到模块级 fallback 通道（行为 = 今日）。
 * - `runScoped` 开新通道：**空缓冲、seq 归零**（锚/buffer 是消费方私有的，
 *   不得跨分析携带——交错分析的条目混进同一缓冲正是「偷诊断」形态），
 *   观察者**继承**进入时的当前观察者（宿主在分析外装的观察器继续可见，
 *   但只收到本作用域内发出的条目）。
 */
export type ScopedDiagChannel<T> = DiagChannel<T> & {
  runScoped<R>(body: () => R): R;
};

export function createScopedDiagChannel<T>(cap: number): ScopedDiagChannel<T> {
  const als = new AsyncLocalStorage<DiagChannel<T>>();
  const fallback = createDiagChannel<T>(cap);
  const chan = (): DiagChannel<T> => als.getStore() ?? fallback;
  return {
    setCollector: (fn) => chan().setCollector(fn),
    getCollector: () => chan().getCollector(),
    count: () => chan().count(),
    take: () => chan().take(),
    takeSince: (since) => chan().takeSince(since),
    emit: (d) => chan().emit(d),
    runScoped: <R>(body: () => R) => {
      const fresh = createDiagChannel<T>(cap);
      fresh.setCollector(chan().getCollector());
      return als.run(fresh, body);
    },
  };
}

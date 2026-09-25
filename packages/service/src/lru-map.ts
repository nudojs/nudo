/**
 * 有界 LRU Map（插入序 = 最近使用序）。
 *
 * 上限与淘汰：超过 `max` 时删掉最旧（最久未命中/写入）的键；命中会把键移到队尾。
 * `max <= 0` 表示关闭缓存（get 恒 miss、set 丢弃），与 session-cache-limits 口径一致。
 *
 * 用途：service 层进程内驻留结构的硬内存上界，让大仓分析后的 retained 内存可预测。
 */
export class BoundedLruMap<V> {
  private readonly map = new Map<string, V>();
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  get size(): number {
    return this.map.size;
  }

  /** 当前上限（可动态收紧；收紧时立刻按 LRU 压到新上限） */
  getMax(): number {
    return this.max;
  }

  setMax(max: number): void {
    this.max = max;
    this.trim();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    // LRU：命中移到队尾
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  /** 命中不改变 LRU 序（只读探测） */
  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  set(key: string, value: V): void {
    if (this.max <= 0) return;
    // 覆盖已有键不涨 size，也不挤掉别人
    while (this.map.size >= this.max && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.map.delete(key);
    this.map.set(key, value);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  entries(): IterableIterator<[string, V]> {
    return this.map.entries();
  }

  /** 压到当前 max（调低上限时收内存） */
  trim(): void {
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

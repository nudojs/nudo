/**
 * 有界 LRU Map（core 层，与 service BoundedLruMap 同语义）。
 * 用途：pure memo 内层 Map 等进程内驻留结构的硬内存上界。
 * 超过 max 时淘汰最旧；命中移到队尾。max <= 0 关闭缓存。
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
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, value: V): void {
    if (this.max <= 0) return;
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

  trim(): void {
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

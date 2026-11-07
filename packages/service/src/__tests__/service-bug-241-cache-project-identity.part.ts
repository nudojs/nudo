/**
 * BUG-241 回归：`check` 磁盘缓存键的路径维必须带**项目身份**。
 *
 * 改前树内文件只取相对项目根的路径 ⇒ 共享 `NUDO_CACHE_DIR` 下两个 checkout
 * 的 `src/a.js` 得到同一个键 ⇒ 互相污染（命中另一份 checkout 的报告，
 * `file` 字段指向那边的文件；`--gitlab` 的 location.path / fingerprint 同样错位）。
 */
import { describe, it, expect } from "vitest";
import { checkCacheKey, ifaceCacheKey } from "../disk-cache.ts";

const SOURCE = "export function f(a) { return a + 1; }\n";

describe("BUG-241 — 缓存键路径维含项目身份", () => {
  it("同相对路径 + 同内容 + 不同项目根 ⇒ 不同键（check）", () => {
    const a = checkCacheKey("/checkout1/src/a.js", SOURCE, {
      autoBind: false,
      projectDir: "/checkout1",
    });
    const b = checkCacheKey("/checkout2/src/a.js", SOURCE, {
      autoBind: false,
      projectDir: "/checkout2",
    });
    expect(a).not.toBe(b);
  });

  it("同相对路径 + 同内容 + 不同项目根 ⇒ 不同键（iface）", () => {
    const a = ifaceCacheKey("/checkout1/src/a.js", SOURCE, {
      autoBind: false,
      projectDir: "/checkout1",
    });
    const b = ifaceCacheKey("/checkout2/src/a.js", SOURCE, {
      autoBind: false,
      projectDir: "/checkout2",
    });
    expect(a).not.toBe(b);
  });

  it("同一项目根下重复计算 ⇒ 同键（可复用性不受影响）", () => {
    const a = checkCacheKey("/checkout1/src/a.js", SOURCE, {
      autoBind: false,
      projectDir: "/checkout1",
    });
    const b = checkCacheKey("/checkout1/src/a.js", SOURCE, {
      autoBind: false,
      projectDir: "/checkout1",
    });
    expect(a).toBe(b);
  });

  it("键里不出现项目根的绝对路径明文", () => {
    const key = checkCacheKey("/checkout1/src/a.js", SOURCE, {
      autoBind: false,
      projectDir: "/checkout1",
    });
    expect(key).not.toContain("checkout1");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
});

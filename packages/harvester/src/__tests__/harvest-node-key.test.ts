import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeHarvestCacheKey } from "../harvest-node.ts";

/**
 * nodeHarvestCacheKey 指纹敏感性：mtimeMs 必须保留浮点精度入键
 * （全仓 mtimeMs+size 严格相等口径）。此前 `Math.floor(st.mtimeMs)` 折整秒
 * →「同秒重写 + 同 size」的 package.json 沿用陈旧 harvest。
 */
describe("nodeHarvestCacheKey 指纹（mtimeMs+size）", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-harvest-key-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("同秒同 size 不同 mtimeMs → 不同键", () => {
    const pkg = join(dir, "package.json");
    // 等长内容保证 size 完全一致，只有 mtime 变化可区分
    writeFileSync(pkg, '{"v":1}', "utf-8");
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000); // 秒边界
    const t1 = new Date(t0.getTime() + 500); // 同一秒内 +500ms
    expect(Math.floor(t0.getTime() / 1000)).toBe(Math.floor(t1.getTime() / 1000));

    utimesSync(pkg, t0, t0);
    const key1 = nodeHarvestCacheKey(dir, 12, 2500);
    const size = statSync(pkg).size;
    writeFileSync(pkg, '{"v":2}', "utf-8"); // 同 size 重写
    expect(statSync(pkg).size).toBe(size);
    utimesSync(pkg, t1, t1);

    const key2 = nodeHarvestCacheKey(dir, 12, 2500);
    expect(key1).not.toBe(key2); // 折整秒时两者相等（陈旧命中）
  });

  it("键内嵌原始浮点 mtimeMs（非折秒整数）", () => {
    const pkg = join(dir, "package.json");
    const t = new Date("2024-05-05T00:00:00.250Z");
    writeFileSync(pkg, '{"v":1}', "utf-8");
    utimesSync(pkg, t, t);
    const key = nodeHarvestCacheKey(dir, 12, 2500);
    const st = statSync(pkg);
    expect(key).toContain(`${st.size}:${st.mtimeMs}`);
  });

  it("stat 不变 → 键稳定；package.json 缺失 → nostat 占位", () => {
    const missing1 = nodeHarvestCacheKey(dir, 12, 2500);
    const missing2 = nodeHarvestCacheKey(dir, 12, 2500);
    expect(missing1).toBe(missing2);
    expect(missing1.endsWith("|nostat")).toBe(true);

    writeFileSync(join(dir, "package.json"), '{"v":1}', "utf-8");
    const present = nodeHarvestCacheKey(dir, 12, 2500);
    expect(present).not.toBe(missing1);
    expect(nodeHarvestCacheKey(dir, 12, 2500)).toBe(present);
  });
});

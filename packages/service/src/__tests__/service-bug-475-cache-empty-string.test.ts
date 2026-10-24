/**
 * Bug 475 —— `nudo.cache: ""`（**显式**空串）不压过 `NUDO_CACHE_DIR`
 * → 缓存目录仍被创建 → 违反 config.md 明文优先级
 * 「any explicit `nudo.cache` value (including `false`) wins over
 * `NUDO_CACHE_DIR`; the env var is only consulted when `nudo.cache` is unset」。
 *
 * 根因（config.ts diskCacheRoot）：用「**值的形状**」而不是「**键是否被设置**」
 * 判断优先级 —— `false` 有专门早退分支，`""` 没有 ⇒ 空串被当作「未设置」。
 *
 * 修法：先判键是否存在（`cache !== undefined`），再按值分派。
 */
import { describe, it, expect, afterEach } from "vitest";
import { diskCacheRoot } from "../evaluator/config.ts";

const ENV_KEY = "NUDO_CACHE_DIR";
let saved: string | undefined;

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

function withEnv(value: string | undefined, fn: () => void): void {
  saved = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  fn();
}

describe("Bug 475 — 显式 nudo.cache 值一律压过 NUDO_CACHE_DIR", () => {
  it("显式空串（\"\"）压过 env：缓存关闭（不返回 env 目录）", () => {
    let root: string | undefined;
    withEnv("/tmp/nudo-cache-env", () => {
      root = diskCacheRoot({ cache: "" }, "/proj");
    });
    // 旧实现：空串落到 env 分支 → 返回 "/tmp/nudo-cache-env"
    expect(root).toBeUndefined();
  });

  it("显式 false 压过 env（既有行为不得回退）", () => {
    let root: string | undefined;
    withEnv("/tmp/nudo-cache-env", () => {
      root = diskCacheRoot({ cache: false }, "/proj");
    });
    expect(root).toBeUndefined();
  });

  // ── 负控制：其余取值语义不得被波及 ──────────────────────────────
  it("true → <projectDir>/.nudo/cache（压过 env）", () => {
    let root: string | undefined;
    withEnv("/tmp/nudo-cache-env", () => {
      root = diskCacheRoot({ cache: true }, "/proj");
    });
    expect(root).toBe("/proj/.nudo/cache");
  });

  it("非空字符串 → 相对 projectDir 解析（压过 env）", () => {
    let root: string | undefined;
    withEnv("/tmp/nudo-cache-env", () => {
      root = diskCacheRoot({ cache: "custom/dir" }, "/proj");
    });
    expect(root).toBe("/proj/custom/dir");
  });

  it("键未设置（undefined）→ 才读 env", () => {
    let root: string | undefined;
    withEnv("/tmp/nudo-cache-env", () => {
      root = diskCacheRoot({}, "/proj");
    });
    expect(root).toBe("/tmp/nudo-cache-env");
  });

  it("键未设置 + 无 env → 关闭（默认）", () => {
    let root: string | undefined;
    withEnv(undefined, () => {
      root = diskCacheRoot(undefined, "/proj");
    });
    expect(root).toBeUndefined();
  });

  it("env 为 off / 0 → 关闭（键未设置时）", () => {
    let root: string | undefined;
    withEnv("off", () => {
      root = diskCacheRoot({}, "/proj");
    });
    expect(root).toBeUndefined();
    withEnv("0", () => {
      root = diskCacheRoot({}, "/proj");
    });
    expect(root).toBeUndefined();
  });
});

/**
 * ABS-18 · watch 注入对象复用（`check-injection-cache.ts` + `runCheck` 接线）。
 *
 * 背景：`checkMemoKey` 含 `moduleMapId(modules)` 身份键，watch 每轮重建模块表 ⇒
 * check memo 永不命中。复用同一注入对象后，**分析输入不变**的轮次必须命中，
 * **语义编辑**必须换键重建（否则就是陈旧报告）。
 *
 * 门禁：
 * - 同一文件重复 check ⇒ hit；
 * - 依赖的 inert 编辑（尾部注释）⇒ 仍 hit，报告不变；
 * - 依赖的语义编辑 ⇒ miss，且报告反映新值（复用不陈旧）；
 * - `noCache`（指纹截断/读错误）⇒ 不查不写（由 core 侧指纹夹具覆盖 fail-closed
 *   口径，本文件用「不同输入 ⇒ 不同键」间接钉住）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../commands/check.ts";
import {
  createCheckInjectionCache,
  type CheckInjectionCache,
} from "../commands/check-injection-cache.ts";

let dir: string;
let a: string;
let b: string;
let cache: CheckInjectionCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-abs18-inj-"));
  a = join(dir, "a.js");
  b = join(dir, "b.js");
  writeFileSync(b, "export function b() {\n  return 1;\n}\n", "utf-8");
  writeFileSync(
    a,
    'import { b } from "./b.js";\n/** @nudo:case "one" () */\nexport function a() {\n  return b();\n}\n',
    "utf-8",
  );
  cache = createCheckInjectionCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** 捕获 runCheck 的人类面输出（同时避免测试日志噪音）。 */
async function checkA(): Promise<string> {
  const out: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  try {
    await runCheck(a, { injectionCache: cache });
  } finally {
    spy.mockRestore();
  }
  process.exitCode = undefined;
  return out.join("\n");
}

describe("ABS-18 · check 注入对象复用", () => {
  it("同一输入重复 check ⇒ 命中；依赖 inert 编辑仍命中且报告不变", async () => {
    const first = await checkA();
    expect(first).toContain("a() => 1");
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 1, size: 1 });

    const second = await checkA();
    expect(second).toContain("a() => 1");
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, size: 1 });

    // 依赖只加尾部注释（inert）⇒ 分析输入身份不变 ⇒ 命中
    writeFileSync(b, "export function b() {\n  return 1;\n}\n// trailing note\n", "utf-8");
    const third = await checkA();
    expect(third).toContain("a() => 1");
    expect(cache.stats()).toMatchObject({ hits: 2, misses: 1 });
  });

  it("依赖语义编辑 ⇒ 换键重建，报告反映新值（复用不陈旧）", async () => {
    expect(await checkA()).toContain("a() => 1");
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 1 });

    writeFileSync(b, "export function b() {\n  return 2;\n}\n", "utf-8");
    const out = await checkA();
    expect(out).toContain("a() => 2");
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 2, size: 2 });

    // 回到旧内容：旧键仍在 LRU 里 ⇒ 命中旧注入，结论与旧输入一致
    writeFileSync(b, "export function b() {\n  return 1;\n}\n", "utf-8");
    expect(await checkA()).toContain("a() => 1");
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 2 });
  });
});

describe("ABS-18 · 注入缓存容器", () => {
  it("LRU 上限：超限淘汰最旧，命中刷新顺序", () => {
    const c = createCheckInjectionCache(2);
    const v = (n: number) => ({
      inject: {},
      mockFromErrors: [],
      dirDiags: [],
    });
    c.set("a", v(1));
    c.set("b", v(2));
    expect(c.get("a")).toBeDefined(); // a 变新
    c.set("c", v(3)); // 淘汰 b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBeDefined();
    expect(c.get("c")).toBeDefined();
    expect(c.stats()).toMatchObject({ size: 2, max: 2, hits: 3, misses: 1 });
  });

  it("clear 清空条目但保留计数", () => {
    const c = createCheckInjectionCache();
    c.set("a", { inject: {}, mockFromErrors: [], dirDiags: [] });
    expect(c.get("a")).toBeDefined();
    c.clear();
    expect(c.stats()).toMatchObject({ size: 0, hits: 1 });
  });
});

/**
 * path env 注册表（加载错误表 + 缓存指纹内容）按 preload baseDir 归属（PR #93）：
 * 批量 check 时 a 项目的 env 加载失败不得泄进 b 项目报告，b 的磁盘缓存键
 * 不得折入 a 的 env 内容；无参 getter 仍返回全量（兼容既有消费面）。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  preloadPathEnvs,
  getPathEnvLoadErrors,
  getPathEnvDepContents,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";

const dirs: string[] = [];
function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), "nudo-env-basedir-"));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// 失败形态：不可解析的 @nudojs 子路径（无 fallback 可重写 → 上报 import 失败）
const FAILING_ENV = `import "@nudojs/env/does-not-exist";
export function defineEnv() {
  return { globals: {} };
}
`;
const OK_ENV = `export function defineEnv() {
  return { globals: {} };
}
`;

beforeEach(() => {
  clearPathEnvCaches();
});

describe("path env 注册表按 baseDir 隔离", () => {
  it("错误表：失败项目恰 1 条（携带 baseDir），另一项目 0 条", async () => {
    const r1 = makeDir();
    const r2 = makeDir();
    const bad = join(r1, "env.mjs");
    writeFileSync(bad, FAILING_ENV, "utf-8");
    writeFileSync(join(r2, "env.mjs"), OK_ENV, "utf-8");

    await preloadPathEnvs(["./env.mjs"], r1);
    await preloadPathEnvs(["./env.mjs"], r2);

    const e1 = getPathEnvLoadErrors(r1);
    expect(e1).toHaveLength(1);
    expect(e1[0].path).toBe(bad);
    expect(e1[0].baseDir).toBe(r1);
    expect(e1[0].error.length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(r2)).toHaveLength(0);
  });

  it("错误表：反向 preload 顺序同样不泄漏", async () => {
    const r1 = makeDir();
    const r2 = makeDir();
    writeFileSync(join(r1, "env.mjs"), FAILING_ENV, "utf-8");
    writeFileSync(join(r2, "env.mjs"), OK_ENV, "utf-8");

    await preloadPathEnvs(["./env.mjs"], r2);
    await preloadPathEnvs(["./env.mjs"], r1);

    expect(getPathEnvLoadErrors(r2)).toHaveLength(0);
    expect(getPathEnvLoadErrors(r1)).toHaveLength(1);
  });

  it("dep 内容按 baseDir 过滤；无参 getter 返回全量", async () => {
    const r1 = makeDir();
    const r2 = makeDir();
    writeFileSync(join(r1, "env.mjs"), FAILING_ENV, "utf-8");
    const good = join(r2, "env.mjs");
    writeFileSync(good, OK_ENV, "utf-8");

    await preloadPathEnvs(["./env.mjs"], r1);
    await preloadPathEnvs(["./env.mjs"], r2);

    // 失败文件不进缓存指纹表
    expect(getPathEnvDepContents(r1)).toHaveLength(0);
    // r2 只看到自己的 env 内容
    const d2 = getPathEnvDepContents(r2);
    expect(d2).toHaveLength(1);
    expect(d2[0].path).toBe(good);
    expect(d2[0].content).toBe(OK_ENV);
    // 无参 → 全量（仅成功文件）
    expect(getPathEnvDepContents().map((d) => d.path)).toEqual([good]);
  });

  it("同一 env 文件被两个 baseDir 引用：两侧 getter 都含它（同文件去重单条）", async () => {
    const r2 = makeDir();
    const r3 = makeDir();
    const good = join(r2, "env.mjs");
    writeFileSync(good, OK_ENV, "utf-8");

    await preloadPathEnvs(["./env.mjs"], r2);
    // r3 经 ../ 引用同一文件（mkdtemp 同父目录）：pathEnvCache 命中 →
    // 归属必须补记到 r3，否则 r3 的缓存键漏掉该 env 内容（stale 风险）
    await preloadPathEnvs([`../${basename(r2)}/env.mjs`], r3);

    expect(getPathEnvDepContents(r2).map((x) => x.path)).toEqual([good]);
    expect(getPathEnvDepContents(r3).map((x) => x.path)).toEqual([good]);
    expect(getPathEnvDepContents()).toHaveLength(1);
  });

  it("错误去重：同一 baseDir 重复 preload 同一失败文件只保留 1 条", async () => {
    const r1 = makeDir();
    writeFileSync(join(r1, "env.mjs"), FAILING_ENV, "utf-8");
    await preloadPathEnvs(["./env.mjs"], r1);
    await preloadPathEnvs(["./env.mjs"], r1);
    await preloadPathEnvs(["./env.mjs"], r1);
    expect(getPathEnvLoadErrors(r1)).toHaveLength(1);
    expect(getPathEnvLoadErrors()).toHaveLength(1);
  });

  it("失败→修复（mtime 变更）：成功加载清除该文件历史错误并进入指纹表", async () => {
    const r1 = makeDir();
    const env = join(r1, "env.mjs");
    const t1 = 1700000000000;
    writeFileSync(env, FAILING_ENV, "utf-8");
    utimesSync(env, new Date(t1), new Date(t1));
    await preloadPathEnvs(["./env.mjs"], r1);
    expect(getPathEnvLoadErrors(r1)).toHaveLength(1);

    writeFileSync(env, OK_ENV, "utf-8");
    const t2 = t1 + 5000;
    utimesSync(env, new Date(t2), new Date(t2));
    await preloadPathEnvs(["./env.mjs"], r1);

    expect(getPathEnvLoadErrors(r1)).toHaveLength(0);
    expect(getPathEnvLoadErrors()).toHaveLength(0);
    const deps = getPathEnvDepContents(r1);
    expect(deps).toHaveLength(1);
    expect(deps[0].path).toBe(env);
    expect(deps[0].content).toBe(OK_ENV);
  });

  it("clearPathEnvCaches 全局清空（过滤/无参两口径）", async () => {
    const r1 = makeDir();
    writeFileSync(join(r1, "env.mjs"), FAILING_ENV, "utf-8");
    await preloadPathEnvs(["./env.mjs"], r1);
    expect(getPathEnvLoadErrors(r1)).toHaveLength(1);

    clearPathEnvCaches();
    expect(getPathEnvLoadErrors()).toHaveLength(0);
    expect(getPathEnvLoadErrors(r1)).toHaveLength(0);
    expect(getPathEnvDepContents()).toHaveLength(0);
    expect(getPathEnvDepContents(r1)).toHaveLength(0);
  });
});

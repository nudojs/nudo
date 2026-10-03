import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  preloadPathEnvs,
  getPathEnvLoadErrors,
  getPathEnvDepContents,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";

/**
 * issue #88 后续：path env 文件不存在时此前静默跳过（env-关降级无任何诊断）。
 * 契约：缺失 → 记入错误表（nudo:env-unresolved 消费面），不进缓存指纹表；
 * 文件后补创建 → 重新 preload 后错误清空、进入指纹表（缓存键随之变化）。
 */
const OK_ENV = `export function defineEnv() {
  return { globals: {}, modules: {} };
}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-env-missing-"));
  dirs.push(dir);
  return dir;
}

describe("preloadPathEnvs — 缺失文件（静默跳过 → nudo:env-unresolved）", () => {
  beforeEach(() => {
    clearPathEnvCaches();
  });

  it("缺失文件记恰 1 条含路径错误；不进依赖指纹表", async () => {
    const dir = tmpProject();
    await preloadPathEnvs(["./nope.mjs"], dir);

    const errs = getPathEnvLoadErrors(dir);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.path).toBe(join(dir, "nope.mjs"));
    expect(errs[0]!.baseDir).toBe(dir);
    expect(errs[0]!.error).toContain("path env not found");
    expect(errs[0]!.error).toContain(join(dir, "nope.mjs"));
    // 缺失文件无内容可折——不进缓存指纹表（创建成功加载后才进）
    expect(getPathEnvDepContents(dir)).toHaveLength(0);
  });

  it("文件后补创建：重新 preload 后错误清空、进入指纹表", async () => {
    const dir = tmpProject();
    const env = join(dir, "env.mjs");
    await preloadPathEnvs(["./env.mjs"], dir);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(1);

    writeFileSync(env, OK_ENV, "utf-8");
    await preloadPathEnvs(["./env.mjs"], dir);

    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
    expect(getPathEnvLoadErrors()).toHaveLength(0);
    const deps = getPathEnvDepContents(dir);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.path).toBe(env);
    expect(deps[0]!.content).toBe(OK_ENV);
  });

  it("同一 baseDir 重复 preload 同一缺失文件只保留 1 条；其它 baseDir 不泄漏", async () => {
    const a = tmpProject();
    const b = tmpProject();
    writeFileSync(join(b, "env.mjs"), OK_ENV, "utf-8");
    await preloadPathEnvs(["./nope.mjs"], a);
    await preloadPathEnvs(["./nope.mjs"], a);
    await preloadPathEnvs(["./env.mjs"], b);

    expect(getPathEnvLoadErrors(a)).toHaveLength(1);
    expect(getPathEnvLoadErrors(a)[0]!.path).toBe(join(a, "nope.mjs"));
    expect(getPathEnvLoadErrors(b)).toHaveLength(0);
  });

  it("clearPathEnvCaches 清空错误表（语义不变）", async () => {
    const dir = tmpProject();
    await preloadPathEnvs(["./nope.mjs"], dir);
    expect(getPathEnvLoadErrors()).toHaveLength(1);

    clearPathEnvCaches();
    expect(getPathEnvLoadErrors()).toHaveLength(0);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
  });
});

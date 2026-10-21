/**
 * Bug 935 — `package.json#nudo.env` 的**数组元素**不是字符串（[42] / [null] /
 * [{}] / [[]]）⇒ service 层 `isPathEnvName` 裸崩（name.includes is not a
 * function / Cannot read properties of null）⇒ 影响所有消费者。
 *
 * 契约：元素级校验必须存在——非法元素**丢弃 + 可见告警**，不得裸崩；
 * 合法元素（["node"]）照常生效（负控制）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createEnvironment } from "@nudojs/core";
import { join } from "node:path";
import { tmpProject } from "./tmp-project.ts";
import {
  loadEnvs,
  preloadPathEnvs,
  getPathEnvLoadErrors,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";
import { findProjectConfig } from "../evaluator/config.ts";

beforeEach(() => {
  clearPathEnvCaches();
});

/** 捕获 stderr（项目配置诊断走 stderr，与 config.ts 其余诊断同风格） */
function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

const BAD_ELEMENTS: unknown[] = [42, null, {}, []];

describe("Bug 935 — env 项元素级校验（非字符串元素不得裸崩）", () => {
  it("loadEnvs：四种非法元素都不崩、无全局注入、产出可见告警", () => {
    const dir = tmpProject("nudo-bug-935-load-");
    const env = createEnvironment();
    for (const el of BAD_ELEMENTS) {
      const loaded = loadEnvs([el] as unknown as string[], env, dir);
      expect(Object.keys(loaded.globals)).toHaveLength(0);
    }
    const errs = getPathEnvLoadErrors(dir);
    expect(errs).toHaveLength(BAD_ELEMENTS.length);
    for (const e of errs) expect(e.error).toContain("invalid env entry");
  });

  it("preloadPathEnvs：非法元素不得裸崩（不得冒泡到进程顶层）", async () => {
    const dir = tmpProject("nudo-bug-935-preload-");
    await expect(
      preloadPathEnvs([42] as unknown as string[], dir),
    ).resolves.toBeUndefined();
    const errs = getPathEnvLoadErrors(dir);
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0]!.error).toContain("invalid env entry");
    expect(errs[0]!.error).toContain("expected a string");
  });

  it("负控制：合法元素（node）照常生效且零告警", () => {
    const dir = tmpProject("nudo-bug-935-ok-");
    const loaded = loadEnvs(["node"], createEnvironment(), dir);
    expect(Object.keys(loaded.globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
  });

  it("负控制：字符串 path env 形态不受元素级校验波及", async () => {
    const dir = tmpProject("nudo-bug-935-path-");
    await preloadPathEnvs(["node"], dir);
    expect(getPathEnvLoadErrors(dir)).toHaveLength(0);
  });
});

describe("Bug 935 — 项目级 package.json#nudo.env 的元素级校验", () => {
  it("非字符串元素：丢弃 + 可见诊断（不裸崩、不静默）", () => {
    const dir = tmpProject("nudo-bug-935-proj-", {
      "package.json": JSON.stringify({ name: "p935", nudo: { env: ["node", 42, null] } }),
    });
    let found: ReturnType<typeof findProjectConfig> = null;
    const err = captureStderr(() => {
      found = findProjectConfig(dir);
    });
    expect(found?.config.env).toEqual(["node"]);
    expect(err).toContain("nudo.env");
    expect(err).toContain("non-string");
  });

  it("env 不是数组：整项丢弃 + 可见诊断", () => {
    const dir = tmpProject("nudo-bug-935-proj-shape-", {
      "package.json": JSON.stringify({ name: "p935b", nudo: { env: "node" } }),
    });
    let found: ReturnType<typeof findProjectConfig> = null;
    const err = captureStderr(() => {
      found = findProjectConfig(dir);
    });
    expect(found?.config.env).toEqual([]);
    expect(err).toContain("nudo.env");
  });

  it("负控制：合法 env 列表不受影响（零诊断）", () => {
    const dir = tmpProject("nudo-bug-935-proj-ok-", {
      "package.json": JSON.stringify({ name: "p935c", nudo: { env: ["node", "es"] } }),
    });
    let found: ReturnType<typeof findProjectConfig> = null;
    const err = captureStderr(() => {
      found = findProjectConfig(dir);
    });
    expect(found?.config.env).toEqual(["node", "es"]);
    expect(err).toBe("");
  });
});

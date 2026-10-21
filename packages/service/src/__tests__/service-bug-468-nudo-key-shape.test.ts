/**
 * Bug 468 —— `package.json#nudo` 键**值不是对象**时被静默忽略：
 * 零诊断（用户零线索），且真值型非对象还**抑制 onboarding 提示**
 * （下游 check.ts 的 filesWithConfig++ 以「找到了真值 nudo 键」为判据）。
 *
 * 根因（config.ts findProjectConfig）：配置层对 `nudo` 键**零形状校验**，
 * 非对象值被谎报成 NudoConfig。
 *
 * 修法：形状校验（非数组对象才合法）；非法形状 → 一条 stderr 诊断 +
 * 按「无配置」处理（不继承祖先配置；onboarding 不再被抑制）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findProjectConfig, evictProjectConfigMemo } from "../evaluator/config.ts";
import { tmpProject } from "./tmp-project.ts";

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

/** 根包带 nudo 配置（用于验证「非法 nudo 键不得继承祖先配置」） */
function rootWithConfig(): string {
  const root = tmpProject("nudo-bug468-root-", {
    "package.json": JSON.stringify({
      name: "root",
      nudo: { check: { ignoreThrows: ["SyntaxError"] }, env: ["node"] },
    }),
  });
  return root;
}

describe("Bug 468 — nudo 键形状非法必须可观测且不得谎报成配置", () => {
  beforeEach(() => {
    evictProjectConfigMemo();
  });

  it("真值非对象（字符串 / 布尔 / 数组）：诊断 + 按「无配置」处理", () => {
    for (const [label, raw] of [
      ["string", "adoption"],
      ["bool", true],
      ["array", []],
    ] as const) {
      const root = rootWithConfig();
      const sub = join(root, "sub");
      mkdirSync(sub, { recursive: true });
      writeFileSync(
        join(sub, "package.json"),
        JSON.stringify({ name: "sub", nudo: raw }),
      );

      let found: ReturnType<typeof findProjectConfig> = null;
      const out = captureStderr(() => {
        found = findProjectConfig(sub);
      });

      // 旧实现：把非对象 nudo 值谎报成 NudoConfig 并「存在」→ 配置零效果、
      // 且真值非对象还会抑制 onboarding（下游按「有配置」计数）
      expect(found, label).toBeNull();
      expect(out, label).toContain('invalid "nudo" key');
      expect(out, label).toContain(join(sub, "package.json"));
      expect(out, label).toContain("no nudo config");
    }
  });

  it("非法 nudo 键不得继承祖先包配置（ignoreThrows / env 都不生效）", () => {
    const root = rootWithConfig();
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "package.json"), JSON.stringify({ name: "sub", nudo: "adoption" }));

    let found: ReturnType<typeof findProjectConfig> = null;
    captureStderr(() => {
      found = findProjectConfig(sub);
    });
    expect(found).toBeNull();
    expect(found?.config).toBeUndefined();
  });

  // ── 负控制：合法 nudo 键 / 无 nudo 键的既有语义不得被波及 ──────────
  it("合法 nudo 键（对象）：照旧返回配置", () => {
    const root = tmpProject("nudo-bug468-ok-", {
      "package.json": JSON.stringify({ name: "m", nudo: { contract: { autoBind: false } } }),
    });
    const found = findProjectConfig(root);
    expect(found?.projectDir).toBe(root);
    expect(found?.config.contract?.autoBind).toBe(false);
  });

  it("空对象 nudo 键：照旧算「有配置」（截断祖先搜索）", () => {
    const root = rootWithConfig();
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "package.json"), JSON.stringify({ name: "sub", nudo: {} }));

    let found: ReturnType<typeof findProjectConfig> = null;
    const out = captureStderr(() => {
      found = findProjectConfig(sub);
    });
    expect(found?.projectDir).toBe(sub);
    expect(found?.config).toEqual({});
    expect(out).toBe("");
  });

  it("无 nudo 键：照旧向上找到祖先配置（monorepo 继承，文档承诺）", () => {
    const root = rootWithConfig();
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "package.json"), JSON.stringify({ name: "sub" }));

    const found = findProjectConfig(sub);
    expect(found?.projectDir).toBe(root);
    expect(found?.config.check?.ignoreThrows).toEqual(["SyntaxError"]);
  });
});

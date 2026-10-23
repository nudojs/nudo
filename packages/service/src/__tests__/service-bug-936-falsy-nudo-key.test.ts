/**
 * Bug 936 —— 子包 `package.json` 的 **`"nudo"` 键是假值**
 * （`false` / `null` / `0` / `""`）⇒ **不遮断**祖先包配置 ⇒ 子包**静默继承**
 * 根包的 `check.ignoreThrows`（把 L2 error 吞掉 ⇒ 门禁假绿）与 `nudo.env`
 * （跨包串味）——与文档「uses the **nearest** `package.json` that contains a
 * `nudo` key」直接冲突。
 *
 * 根因（config.ts findProjectConfig）：`if (nudo)` 用**真值**判定代替
 * 「**键是否存在**」⇒ 假值 nudo 键被当成「这个包没有 nudo 键」⇒ 搜索不截断。
 *
 * 修法：存在性判定（hasOwnProperty）—— 键存在即截断搜索；假值 nudo 键 =
 * 「本包显式不配置」⇒ 回落默认（不继承祖先）+ 一条 stderr 提示（不静默）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  findProjectConfig,
  checkConfig,
  evictProjectConfigMemo,
} from "../evaluator/config.ts";
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

/** 根包：ignoreThrows + env（子包若继承 ⇒ L2 被吞 + env 串味） */
function rootWithConfig(): string {
  return tmpProject("nudo-bug936-root-", {
    "package.json": JSON.stringify({
      name: "root",
      type: "module",
      nudo: { check: { ignoreThrows: ["SyntaxError"] }, env: ["node"] },
    }),
  });
}

function subPackage(root: string, nudo: unknown): string {
  const sub = join(root, "sub");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, "package.json"),
    JSON.stringify({ name: "sub", type: "module", ...(nudo === undefined ? {} : { nudo }) }),
  );
  return sub;
}

describe("Bug 936 — 假值 nudo 键遮断祖先配置（存在性 ≠ 真值性）", () => {
  beforeEach(() => {
    evictProjectConfigMemo();
  });

  it("假值 nudo 键（false / null / 0 / \"\"）：不继承祖先配置 + stderr 提示", () => {
    for (const raw of [false, null, 0, ""]) {
      evictProjectConfigMemo();
      const root = rootWithConfig();
      const sub = subPackage(root, raw);

      let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
      const out = captureStderr(() => {
        found = findProjectConfig(sub);
      });

      // 旧实现：if (nudo) 假值 → 不 return → 继续向上 → 用根包配置
      expect(found, JSON.stringify(raw)).toBeNull();
      expect(out, JSON.stringify(raw)).toContain('falsy "nudo" key');
      expect(out, JSON.stringify(raw)).toContain("ancestor configs are not inherited");
    }
  });

  it("假值 nudo 键：根包的 check.ignoreThrows 不得吞掉子包的 L2", () => {
    const root = rootWithConfig();
    const sub = subPackage(root, false);
    let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
    captureStderr(() => {
      found = findProjectConfig(sub);
    });
    // 继承 ⇒ ignoreThrows=["SyntaxError"]（L2 error 被吞 ⇒ 门禁假绿）
    expect(checkConfig(found?.config).ignoreThrows).toEqual([]);
    expect(checkConfig(found?.config).entryThrows).toBe("error");
  });

  it("假值 nudo 键：根包的 nudo.env 不得渗进子包", () => {
    const root = rootWithConfig();
    const sub = subPackage(root, false);
    let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
    captureStderr(() => {
      found = findProjectConfig(sub);
    });
    expect(found?.config.env).toBeUndefined();
  });

  // ── 负控制：三种「有 nudo 键」之外的形态不得被波及 ───────────────
  it("\"nudo\": {}（空对象）：遮断祖先搜索，配置为空", () => {
    const root = rootWithConfig();
    const sub = subPackage(root, {});
    let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
    const out = captureStderr(() => {
      found = findProjectConfig(sub);
    });
    expect(found?.projectDir).toBe(sub);
    expect(found?.config).toEqual({});
    expect(out).toBe("");
  });

  it("无 nudo 键：照旧继承根配置（文档承诺的 monorepo 行为）", () => {
    const root = rootWithConfig();
    const sub = subPackage(root, undefined);
    const found = findProjectConfig(sub);
    expect(found?.projectDir).toBe(root);
    expect(found?.config.check?.ignoreThrows).toEqual(["SyntaxError"]);
    expect(found?.config.env).toEqual(["node"]);
  });

  it("子包无 package.json：照旧继承根配置", () => {
    const root = rootWithConfig();
    const sub = join(root, "no-pkg");
    mkdirSync(sub, { recursive: true });
    const found = findProjectConfig(sub);
    expect(found?.projectDir).toBe(root);
  });
});

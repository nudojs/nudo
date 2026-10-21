/**
 * Bug 461 回归（CLI 面）：`nudo:interface-entry-only` 在 **check** 面不可达
 * （分析器产出 info，但普通 check 路径不跑分析器 ⇒ 诊断被丢弃），而
 * `nudo health` 走另一条统计路径仍报「N entry-only」⇒ 同一事实两 verb
 * 口径分裂。
 *
 * 修法：普通 check 路径也跑分析器（白名单仍只有 interface 家族）⇒ 两个
 * verb 同一口径。**顺序要求**：分析器必须**先于** checkSource 跑（core 的
 * 侧车加载失败去重表按作用域共享；反序会让分析器误报「无契约根」）。
 *
 * 本文件锁：
 *  ① 无契约根 + 无调用点域 ⇒ check 报 entry-only info，条数 == health 的
 *     entry-only 计数（**本次修复的正面**）；
 *  ② 同文件被调用的导出不算 entry-only（调用点域口径一致）；
 *  ③ 有契约根（有侧车）的导出：check 不报「无契约根」info——但 health 的
 *     entry-only 计数仍为 1（**两个口径本就不同的两个事实**，见下）。
 *
 * 关于 ③：health 的「entry-only」计数是**覆盖率**事实（该函数回落到了
 * entry@ 见证 = 没有调用点证据）；check 的 `nudo:interface-entry-only` 诊断是
 * **契约缺口**事实（没有契约根 **且** 没有调用点域，docs:
 * reference/diagnostics.md#nudo-interface-entry-only）。有契约根但无调用点
 * 时两者本就该不同（函数有契约，只是没被调用过）⇒ 不是 bug。真要对齐成
 * 同一个统计口径，需要改 service 的 `fn.entryOnly` 语义（越界，见报告）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 无契约根、无调用点域的导出 ⇒ entry-only */
const SOLO = `export function solo() {
  return 1;
}
`;

/** solo 被 same-file 的 other 调用 ⇒ 有调用点域 ⇒ 不是 entry-only */
const CALLED = `export function solo() {
  return 1;
}
export function other() {
  return solo();
}
`;

/** 有侧车契约根 ⇒ check 不报「无契约根」（health 的覆盖率计数仍为 1） */
const WITH_SIDECAR = `export function solo(x) {
  return x;
}
`;
const SIDECAR = `import { fn, number } from "@nudojs/core";

export const solo = fn({ x: number() }, number());
`;

function fixture(src: string, sidecar?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-461-cli-"));
  writeFileSync(join(dir, "probe.js"), src, "utf-8");
  if (sidecar !== undefined) writeFileSync(join(dir, "probe.nudo.js"), sidecar, "utf-8");
  return dir;
}

function checkEntryOnlyNames(dir: string): string[] {
  const r = runCli(["check", "--json", "probe.js"], { cwd: dir });
  const json = JSON.parse(r.stdout) as {
    issues: { code: string; message: string }[];
  };
  return json.issues
    .filter((i) => i.code === "nudo:interface-entry-only")
    .map((i) => {
      const m = /export '([^']+)'/.exec(i.message);
      return m?.[1] ?? "?";
    });
}

function healthEntryOnly(dir: string): number {
  const r = runCli(["health", "probe.js"], { cwd: dir });
  const m = /(\d+) entry-only/.exec(r.stdout);
  return m ? Number(m[1]) : 0;
}

describe("Bug 461 CLI：check 与 health 的 entry-only 口径一致", () => {
  it("无契约根的导出：check 报 entry-only info，条数 == health 的计数", () => {
    const dir = fixture(SOLO);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual(["solo"]);
      expect(healthEntryOnly(dir)).toBe(1);
      expect(names.length).toBe(healthEntryOnly(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同文件被调用的导出不算 entry-only（两 verb 同口径）", () => {
    const dir = fixture(CALLED);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual(["other"]); // solo 有调用点域
      expect(healthEntryOnly(dir)).toBe(names.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("有侧车契约根 ⇒ check 不报「无契约根」（契约缺口事实不成立）", () => {
    const dir = fixture(WITH_SIDECAR, SIDECAR);
    try {
      const names = checkEntryOnlyNames(dir);
      expect(names).toEqual([]);
      // health 的 entry-only 计数是**覆盖率**事实（回落 entry@ 见证）——
      // 有契约但没被调用过时它仍是 1：两个口径本就不同的两个事实。
      expect(healthEntryOnly(dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("entry-only 是 info：不红门禁（exit 0）", () => {
    const dir = fixture(SOLO);
    try {
      const r = runCli(["check", "probe.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nudo:interface-entry-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

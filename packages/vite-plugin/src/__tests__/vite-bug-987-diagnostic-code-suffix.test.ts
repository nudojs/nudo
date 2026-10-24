/**
 * Bug 987 —— vite-plugin 的 **evaluator 面**诊断**丢掉 `(nudo:code)`** ⇒
 * 同一次构建里两种诊断**两种文本格式**，日志里**无法按码检索**。
 *
 * 根因：两个诊断来源走**两套装配路径** —— check 面自己拼 `parts`（带码），
 * evaluator 面直接用 `diag.message`（`diag.code` **从不读**）⇒ evaluator 面的
 * 码恒丢 ⇒ `grep '(nudo:'` 只能捞到一半的诊断。
 *
 * 修法：消息装配**统一出口**（`report.ts` 的 `renderDiagnostic`）：两个来源
 * 都追加 ` (<code>)`；消息尾部已自带同码时**剥掉再统一追加** ⇒ 分隔符也归一。
 *
 * 钉：evaluator 面诊断带码；同一次构建里两类诊断**同款**结尾；
 * 码**不重复**（不出现 `(nudo:x) … (nudo:x)`）。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";

/** Vite hooks may be fn or ObjectHook{handler}; tests need a direct callable. */
function hookFn(h: unknown): (...args: never[]) => unknown {
  if (typeof h === "function") return h as (...args: never[]) => unknown;
  if (h && typeof h === "object" && "handler" in h && typeof (h as { handler?: unknown }).handler === "function") {
    return (h as { handler: (...args: never[]) => unknown }).handler;
  }
  throw new Error("plugin hook missing");
}

function transformOf(plugin: Plugin) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

/**
 * mock 目标文件不存在 ⇒ evaluator 面产出 `nudo:module-missing`（码在
 * `diag.code` 字段里，此前插件**从不读** ⇒ 码恒丢）；同一文件里 check 面
 * 另有一条 `nudo:entry-may-throw`（码由 check 面自拼）⇒ 两种文本格式并存。
 */
const SRC = `// @nudo:mock dep from "./nope.js"
export function useDep(x) {
  return dep(x);
}
`;

async function reported(id: string): Promise<string[]> {
  const plugin = nudoPlugin();
  const warns: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => {
      throw new Error(m);
    },
    info: (m: string) => warns.push(String(m)),
  };
  await transformOf(plugin).call(ctx, SRC, id);
  return warns;
}

describe("Bug 987 —— 两个诊断来源的文本格式归一（都带 (nudo:code)）", () => {
  it("evaluator 面诊断也带 (nudo:code)（此前恒丢）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-987-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const msgs = await reported(id);
      const mockMsg = msgs.find((m) => m.includes("Mock file not found"));
      expect(mockMsg, JSON.stringify(msgs)).toBeDefined();
      expect(mockMsg).toContain("(nudo:module-missing)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("同一次构建里两类诊断同款结尾（ ·  (code) 分隔符归一）且码不重复", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-987-uniform-"));
    try {
      const id = join(dir, "entry.js");
      writeFileSync(id, SRC, "utf-8");

      const msgs = await reported(id);
      const coded = msgs.filter((m) => /\(nudo:[a-z-]+\)$/.test(m.trim()));
      expect(coded.length, JSON.stringify(msgs)).toBe(msgs.length);
      for (const m of msgs) {
        const codes = m.match(/\(nudo:[a-z-]+\)/g) ?? [];
        expect(codes.length, m).toBe(1);
        // 码与消息之间只有一个空格（不带 ` · ` 分隔）
        expect(m).toMatch(/ \(nudo:[a-z-]+\)$/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

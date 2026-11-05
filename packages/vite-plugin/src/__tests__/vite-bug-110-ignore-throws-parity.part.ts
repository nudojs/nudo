/**
 * BUG-110 回归（vite-plugin 构建期）：`package.json#nudo.check.ignoreThrows`
 * 必须与 **CLI / LSP 同口径**解析 —— 裸字符串 / 逗号分隔都生效。
 *
 * 病灶：`assembleCheckOutcome` 走 service 的 `checkConfig`，其 `ignoreThrows`
 * 是**严格 `string[]` 过滤**（`Array.isArray` + 逐项 `typeof === "string"`）
 * ⇒ 裸字符串 `"TypeError"` 被**静默丢成空表**、`["TypeError,RangeError"]`
 * 不切分（永远匹配不上任何 throw 类）⇒ 插件面该 throw 类照报 ⇒ **构建红**，
 * 而 CLI（`packages/nudojs/src/check-gate-config.ts` 的 `parseIgnoreThrows`）
 * 与 LSP（`packages/lsp/src/gate-config.ts` 的 `configIgnoreThrows`）都认这两种
 * 写法（绿）⇒ 同一份 `package.json` 三面三口径，`failOnError: true` 时直接
 * 中断构建。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts`）：`ignoreThrows` 改走与
 * CLI / LSP 同语义的 `parseIgnoreThrows`（`entryThrows` 仍走 `checkConfig`）。
 *
 * 负控制：**没被忽略**的 throw 类仍须报（门禁不得被整体关掉）。
 */
import { describe, it, expect } from "vitest";
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
  throw new Error("hook not callable");
}

function transformOf(plugin: Plugin) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

/** 读未约束属性的入口 ⇒ L2 判 `TypeError`（`x` 为 any ⇒ 属性链必抛）。 */
const THROWING_SRC = `export function boom(x) {
  return x.missing.deep;
}
`;

type Run = { warns: string[]; errors: string[]; thrown?: string; all: string };

async function run(dir: string, ignoreThrows: unknown): Promise<Run> {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "nudo-vite-bug-110",
      private: true,
      type: "module",
      nudo: { check: { ignoreThrows } },
    }),
    "utf-8",
  );
  const file = join(dir, "a.js");
  writeFileSync(file, THROWING_SRC, "utf-8");

  const plugin = nudoPlugin({ failOnError: true });
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    // 真实 Rollup/Vite 语义：this.error 抛异常
    error: (m: string) => {
      errors.push(String(m));
      throw new Error(String(m));
    },
    info: () => {},
  };
  const out: Run = { warns, errors, all: "" };
  try {
    await transformOf(plugin).call(ctx, THROWING_SRC, file);
  } catch (e) {
    out.thrown = (e as Error).message;
  }
  out.all = [...warns, ...errors].join("\n");
  return out;
}

/**
 * 四种**文档认可**的写法（CLI / LSP 都生效）—— 插件面必须逐项相同。
 * 断言：该 throw 类被忽略 ⇒ 无 `nudo:entry-may-throw`，且构建不中断。
 */
const LEGAL_WRITINGS: Array<[label: string, raw: unknown]> = [
  ["裸字符串", "TypeError"],
  ["逗号分隔字符串", "TypeError,RangeError"],
  ["数组元素内含逗号", ["TypeError,RangeError"]],
  ["字符串数组", ["TypeError"]],
];

describe("BUG-110: vite-plugin 的 ignoreThrows 与 CLI / LSP 同口径", () => {
  for (const [label, raw] of LEGAL_WRITINGS) {
    it(`${label}（${JSON.stringify(raw)}）⇒ 该 throw 类不再报，构建不中断`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-110-"));
      try {
        const r = await run(dir, raw);
        expect(r.all).not.toContain("nudo:entry-may-throw");
        expect(r.errors).toHaveLength(0);
        expect(r.thrown).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it("负控制：忽略的是**别的** throw 类 ⇒ TypeError 仍照报（门禁未被关掉）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-110-neg-"));
    try {
      const r = await run(dir, ["RangeError"]);
      expect(r.all).toContain("nudo:entry-may-throw");
      expect(r.errors.join("\n")).toContain("nudo:entry-may-throw");
      expect(r.thrown).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

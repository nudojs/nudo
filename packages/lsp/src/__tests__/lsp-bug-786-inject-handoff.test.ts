/**
 * Bug 786 —— LSP 签名面（hover / inlayHint）**从不传 `inject`**
 * ⇒ IDE 显示 `unknown`（Nudo 词汇里 = 「推断失败」）而 CLI 门禁显示
 * `number` ⇒ 跨产品面自相矛盾，且违反 lsp.md 的 “check-identical signature”
 * 承诺。
 *
 * 根因：`@nudo:mock` / `@nudo:as` / `@nudo:replace` / env 全局四类注入走
 * core 的 **`inject` 通道**（`RunTranspiledOptions`）；CLI 侧由
 * `buildCheckInjection` 构造并显式传入，**LSP 侧的 hover / inlay 两条
 * `generalizeFromAst` 调用都不传** ⇒ 覆盖表缺席 ⇒ 推导链塌缩 unknown。
 *
 * 修法（片 F / 片 C 协作）：
 * - 片 F：`packages/core/src/algebra/inlay.ts` 的 `CollectAbsInlaysOpts`
 *   加 `inject` 字段并透传给 `generalizeFromAst`（**只改内部函数体**，
 *   零新增 core 导出）；`packages/lsp/src/agent-tools.ts` 新增注入装配器
 *   `buildLspInjection` 并在 agent hover 工具面装配 inject；
 * - 片 C（`hover.ts` 单一 owner）：`HoverInterfaceOpts` 加 `inject` 字段，
 *   传进 hover.ts 的 **3 处** `generalizeFromAst`。
 *
 * 钉（本片能改的一侧）：
 * - 注入装配器 `buildLspInjection` 的产物形状（协议面）；
 * - agent hover 工具的 inlay 载荷：注入生效 ⇒ `: string`（未注入 ⇒ `: unknown`）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLspInjection, hoverTool } from "../agent-tools.ts";

/** `@nudo:replace` ⇒ `raw` 是 number ⇒ `raw.toFixed(2)` 返回 string */
const REPL_SRC = `function makeRaw() {
  return "abc";
}

// @nudo:replace makeRaw() number()
const raw = makeRaw();

export function usesRaw() {
  return raw.toFixed(2);
}
`;

/** `@nudo:as` ⇒ `raw` 覆盖成 number */
const AS_SRC = `// @nudo:as number()
const raw = "abc";

export function usesRaw() {
  return raw.toFixed(2);
}
`;

/** `@nudo:mock` ⇒ 被 mock 的依赖不再是未绑定名 */
const MOCK_SRC = `/**
 * @nudo:mock dep = (x) => x * 2
 */
export function usesDep(v) {
  return dep(v);
}
`;

function fixture(src: string, name: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug786-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `bug786-${name}`, private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, `${name}.js`);
  writeFileSync(file, src, "utf-8");
  return { dir, file };
}

describe("Bug 786 — 注入装配器 + inject 传递协议", () => {
  it("buildLspInjection 采集 @nudo:replace 的覆盖表（replacements + targets）", () => {
    const { dir, file } = fixture(REPL_SRC, "repl");
    try {
      const inject = buildLspInjection(file, REPL_SRC);
      expect(Object.keys(inject).length, "注入包为空 ⇒ 行内指令缺席").toBeGreaterThan(0);
      expect(inject.replacementTargets?.length ?? 0).toBeGreaterThan(0);
      expect(Object.keys(inject.replacements ?? {}).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildLspInjection 采集 @nudo:as 的覆盖表（asOverrides + asOverrideTargets）", () => {
    const { dir, file } = fixture(AS_SRC, "as");
    try {
      const inject = buildLspInjection(file, AS_SRC);
      expect(inject.asOverrideTargets?.length ?? 0).toBeGreaterThan(0);
      expect(Object.keys(inject.asOverrides ?? {}).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildLspInjection 采集 @nudo:mock 的覆盖表（mocks）", () => {
    const { dir, file } = fixture(MOCK_SRC, "mock");
    try {
      const inject = buildLspInjection(file, MOCK_SRC);
      expect(Object.keys(inject.mocks ?? {}).length, "@nudo:mock 未进注入包").toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("agent hover 工具的 inlay 载荷：注入生效 ⇒ `: string`（未注入 ⇒ `: unknown`）", () => {
    const { dir, file } = fixture(REPL_SRC, "repl");
    try {
      const res = hoverTool({
        file,
        line: 8,
        column: 2,
        includeInlays: true,
      });
      const payload = JSON.parse(res.content[0]!.text) as {
        inlays?: Array<{ label: string }>;
      };
      const labels = (payload.inlays ?? []).map((i) => i.label);
      expect(labels.length, "无 inlay 载荷").toBeGreaterThan(0);
      expect(
        labels.some((l) => l.includes(": string")),
        `inlay 仍是 unknown：${JSON.stringify(labels)}`,
      ).toBe(true);
      expect(
        labels.some((l) => l.includes(": unknown")),
        `inlay 仍塌缩成 unknown：${JSON.stringify(labels)}`,
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

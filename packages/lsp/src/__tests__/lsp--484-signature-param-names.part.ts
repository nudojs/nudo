/**
 * Bug 463 / 484：IDE 面（补全 detail + 签名弹窗）的跨模块 fn 形参名——
 * 改前 `export function` 的形参显示成合成假名 `arg0/arg1`（源码里没有的名字），
 * 带默认值的形参整个丢失（`b = 2` → arg1），rest 形参连个数一起被吞。
 *
 * 原生 oracle：声明形参是源码里的名字与个数（`export function f(a, b = 2)` → a / b）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCompletionsAtPosition } from "../lsp-surface/completions.ts";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = `export function withDefault(x, y = 2) { return x + y; }
export function withRest(x, ...rest) { return x; }
export function plain(x, y) { return x + y; }
`;

function tmpFile(src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b463-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src);
  return { dir, file };
}

describe("Bug 463/484 IDE 面：跨模块 fn 形参名（真名，非 argN 假名）", () => {
  it("补全 detail 用源码真名与真个数（改前：(arg0) => ? / (arg0, arg1) => ?）", () => {
    const { dir, file } = tmpFile(SRC);
    try {
      const items = getCompletionsAtPosition(file, SRC, SRC.split("\n").length - 1, 0);
      const detailOf = (label: string): string | undefined =>
        items.find((i) => i.label === label)?.detail;
      // BUG-091：detail 不再用 `?` 占位返回值，改为与 hover / check 同口径的
      // 签名渲染（`<name>(<param>: <T>, …) => <R>`）；本用例仍钉「源码真名与
      // 真个数」（不是 arg0/arg1 假名）。
      expect(detailOf("withDefault")).toBe("withDefault(x: any, y: any) => any");
      expect(detailOf("withRest")).toBe("withRest(x: any, ...rest: any) => any");
      expect(detailOf("plain")).toBe("plain(x: any, y: any) => any");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("签名弹窗 label 用源码真名（改前：(arg0: any) => unknown）", async () => {
    const { dir, file } = tmpFile(`${SRC}export function use() { return withDefault(1, 2); }\n`);
    try {
      const uri = `file://${file}`;
      const mock = createMockConnection();
      createNudoServer(mock as unknown as never);
      const text = `${SRC}export function use() { return withDefault(1, 2); }\n`;
      mock.notifications.get("textDocument/didOpen")!({
        textDocument: { uri, languageId: "javascript", version: 1, text },
      });
      await new Promise((r) => setTimeout(r, 200));
      const sig = mock.requests.get("textDocument/signatureHelp")!;
      const col = "export function use() { return withDefault(".length;
      const res = sig({ textDocument: { uri }, position: { line: 3, character: col } });
      const label = res!.signatures[0]!.label;
      // BUG-104：裸标识符 callee 不再用 evaluator 的 arity-only fn Abs 冒充
      // 签名（返回位是占位 `unknown`）⇒ 落到与 hover 同源的 poly-fn 解析，
      // 返回位是真实推断（`x + y` ⇒ `number | string`）。
      expect(label).toBe("(x: any, y: any) => number | string");
      expect(label).not.toContain("arg0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：本地箭头函数的形参面不变", () => {
    const src = `export const arrow = (m, n) => m + n;\n`;
    const { dir, file } = tmpFile(src);
    try {
      const items = getCompletionsAtPosition(file, src, 1, 0);
      const arrow = items.find((i) => i.label === "arrow");
      // BUG-091：detail 改为完整签名（不再 `?` 占位）；负控制仍钉「形参面
      // 用源码真名 m/n 且个数为 2」（不是 arg0/arg1 假名）。
      expect(arrow?.detail).toBe("arrow(m: any, n: any) => any");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

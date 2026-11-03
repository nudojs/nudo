/**
 * inlay 面的 any / unknown 责任区分。
 *
 * 产品契约（docs/design/cli-semantics.md §2）：`any` = 无约束（**开发者**责任）、
 * `unknown` = 推导失败（**引擎**债），两者永不得混用 ⇒ inlay 面在视觉上分开：
 * - 返回位渲染**恰为 unknown**（含 conf 标注形）⇒ label 挂 `⚠ ` 前缀 +
 *   tooltip 写明「inference failure (engine debt)」与修复通道；
 * - `any`（无约束入口参 / `where any()`）⇒ **不加警示前缀**，tooltip 写
 *   「no contract on this param」的责任说明；
 * - 显示契约不回归：无约束参数不显示 `unknown`；`formatShape` 口径的 label
 *   生成路径不动（只叠加前缀 / tooltip）。
 *
 * 真 unknown 夹具：未 mock 的宿主副作用面（顶层 `fetch(u)`）⇒ B 路径
 * fail-closed，返回位 = `unknown`（Bug 786 同族构造方式）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withLspServer } from "./helpers.ts";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

type Hint = {
  position: { line: number; character: number };
  label: string;
  tooltip?: string;
};

const FETCH_SRC = `const res = fetch("https://example.com/api");
export function status() {
  return res.status;
}
`;

const ID_SRC = `export function id(x) {
  return x;
}
`;

/** 参数 inlay（`nudo.inlayHints.parameters`）开启的会话（Bug 790 同款启动） */
async function paramInlaySession(
  files: Record<string, string>,
): Promise<{
  req: (method: string) => (params: any) => any;
  uri: (name: string) => string;
  cleanup: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-inlay-resp-"));
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text, "utf-8");
  }
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.requests.get("initialize")!({
    processId: null,
    rootUri: null,
    workspaceFolders: [],
    capabilities: {},
    initializationOptions: { inlayHints: { parameters: true } },
  });
  for (const [name, text] of Object.entries(files)) {
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: {
        uri: `file://${join(dir, name)}`,
        languageId: "javascript",
        version: 1,
        text,
      },
    });
  }
  await new Promise((r) => setTimeout(r, 300));
  return {
    req: (method: string) => mock.requests.get(method)!,
    uri: (name: string) => `file://${join(dir, name)}`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("inlay 的 any/unknown 责任区分", () => {
  it("真 unknown 返回位：label 含 ⚠，tooltip 写明 inference failure（引擎债）", async () => {
    await withLspServer({ "f.js": FETCH_SRC }, async ({ req, uri }) => {
      const hints = (req("textDocument/inlayHint")({
        textDocument: { uri: uri("f.js") },
        range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
      }) ?? []) as Hint[];
      const ret = hints.filter((h) => h.label.includes("unknown"));
      expect(ret, `未 mock 宿主副作用 ⇒ 返回位必须是 unknown：${JSON.stringify(hints)}`).toHaveLength(1);
      // ⚠ 前缀（`: ⚠ unknown  · derived  `——`formatShape` 文本本身不动）
      expect(ret[0]!.label).toMatch(/^:\s*⚠\s*unknown/);
      // tooltip：责任区分 + 修复通道（引擎债不是注解）
      expect(ret[0]!.tooltip).toContain("inference failure");
      expect(ret[0]!.tooltip).toContain("engine debt");
      expect(ret[0]!.tooltip).toContain("@nudo:mock");
    });
  });

  it("无约束参数（parameters 开）：不显示 unknown、不挂 ⚠（any = 开发者责任）", async () => {
    const { req, uri, cleanup } = await paramInlaySession({ "id.js": ID_SRC });
    try {
    const hints = (req("textDocument/inlayHint")({
      textDocument: { uri: uri("id.js") },
      range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
    }) ?? []) as Hint[];
    // 无约束参数不产生 where-inlay（没有约束可展示）⇒ 面上零参数 hint
    expect(hints.some((h) => h.label.includes("where"))).toBe(false);
    // 返回位是计算形（x），不是 unknown——无约束 ≠ 推导失败
    expect(hints.some((h) => h.label.includes("unknown"))).toBe(false);
      // 全文件无 ⚠（any 语义不加警示前缀）
      expect(hints.some((h) => h.label.includes("⚠"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("显式无约束 `where any()`：不加 ⚠，tooltip 追加 any 责任说明（不丢既有 pred 展开）", async () => {
    const { req, uri, cleanup } = await paramInlaySession({
      "need.js": ID_SRC,
      "need.nudo.js": `import { fn, any, number } from "@nudojs/core";

export const id = fn({ x: any() }, number());
`,
    });
    const hints = (req("textDocument/inlayHint")({
      textDocument: { uri: uri("need.js") },
      range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
    }) ?? []) as Hint[];
    const param = hints.find((h) => h.label.includes("where"));
    expect(param, `any() 契约应产出参数 inlay：${JSON.stringify(hints)}`).toBeDefined();
    // any（无约束）不挂警示前缀
    expect(param!.label).not.toContain("⚠");
    expect(param!.label).toContain("any()");
    // tooltip：既有 pred 展开在前（不丢失），any 责任说明追加在后
    expect(param!.tooltip).toContain("no contract on this param");
    expect(param!.tooltip).toContain("@nudo:contract");
    cleanup();
  });
});

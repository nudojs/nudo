/**
 * Bug 775 —— hover 的侧车契约面用**声明形态**、`nudo check` 用**推断形态**
 * ⇒ 同一函数两套参数类型文本（IDE 说的是侧车 DSL 原文，CLI 说的是类型）。
 *
 * 改前（协议面 hover 签名块）：
 *   `addc(x: number().gt(0), y: number().gt(0)) => number`
 * 而 `nudo check` 的签名行是：
 *   `addc(x: number, y: number) => number`
 *
 * 修法（hover.ts）：契约形参的展示文本改用 **check 同口径**的推断 shape
 * （core `check-signatures.formatEntryParamShape` 同公式：showLits +
 * nullish 字面量名）——**union（和类型）契约参数除外**：判别联合的
 * `formatShape` 展开可达数万字符且臂的身份只由用户自己的类型名承载 ⇒
 * 保留声明形态（折叠的原始意图，见 PUBLIC_API.md 的 hoverProvider 行）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = `export function addc(x, y) {
  return x + y;
}
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const addc = fn({ x: number().gt(0), y: number().gt(0) }, number().gt(0));
`;

/** union 契约参数 ⇒ 保留声明形态（判别联合的展开不可读） */
const UNION_SRC = `export function addn(p) {
  return p;
}
`;

const UNION_SIDECAR = `import { fn, number, nullable } from "@nudojs/core";
export const addn = fn({ p: nullable(number()) }, number());
`;

describe("Bug 775 —— 契约形参的 hover 文本与 `nudo check` 同口径", () => {
  it("签名块：prim 契约参数用推断 shape（改前是侧车 DSL 原文）", async () => {
    await withLspServer(
      { "hover775.js": SRC, "hover775.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // `addc`（第 1 行，列 16）
        const res = (await hover({
          textDocument: { uri: uri("hover775.js") },
          position: { line: 0, character: 16 },
        })) as { contents: { value: string } } | null;
        const text = res?.contents?.value ?? "";
        expect(text).toContain("addc(x: number, y: number)");
        expect(text).not.toContain("number().gt(0)");
      },
    );
  });

  it("形参位：prim 契约参数用推断 shape（改前是侧车 DSL 原文）", async () => {
    await withLspServer(
      { "hover775.js": SRC, "hover775.nudo.js": SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // `addc(x, y)` 的 `x`（第 1 行，列 20）
        const res = (await hover({
          textDocument: { uri: uri("hover775.js") },
          position: { line: 0, character: 20 },
        })) as { contents: { value: string } } | null;
        const text = res?.contents?.value ?? "";
        expect(text).toContain("x: number");
        expect(text).not.toContain("number().gt(0)");
      },
    );
  });

  it("union 契约参数保留声明形态（判别联合折叠不回归）", async () => {
    await withLspServer(
      { "hover775u.js": UNION_SRC, "hover775u.nudo.js": UNION_SIDECAR },
      async ({ req, uri }) => {
        const hover = req("textDocument/hover");
        // `addn`（第 1 行，列 16）
        const res = (await hover({
          textDocument: { uri: uri("hover775u.js") },
          position: { line: 0, character: 16 },
        })) as { contents: { value: string } } | null;
        expect(res?.contents?.value ?? "").toContain("p: nullable(number())");
      },
    );
  });
});

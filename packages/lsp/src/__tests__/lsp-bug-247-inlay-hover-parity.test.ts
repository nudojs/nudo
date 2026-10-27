/**
 * Bug 247（协议面）—— 同一 IDE 会话里 **hover 签名面** 与 **inlayHint 返回面**
 * 必须对同一份源码给出**同一份类型**。
 *
 * 夹具（`tmp/repro/bug-247/`）：同一函数体，只差 `@nudo:invariant dp[*] >= 0`
 * 那一行。该公理只由 check 的动态域播种（`check.ts` 的 `withAssumePremises` /
 * `withInvariantSpecs`）⇒ 自算 generalize 的 IDE 面会印「没有那条公理的程序」
 * 的类型 ⇒ 同一会话内诊断面（承认公理）与 hover 面（无视公理）互斥。
 *
 * 改前实测（BUG-247 正文）：
 *
 * | 面 | 有公理 | 无公理 |
 * |---|---|---|
 * | CLI `nudo check` | `0 \| number` | `number` |
 * | LSP hover | `number` | `number` ← 逐字相同 |
 * | LSP inlayHint | `: number` | `: number` ← 逐字相同 |
 *
 * 修复后钉（**两个面一起**）：
 * 1. hover 签名返回位与 inlay 返回角标**逐字相同**（同一份 Abs 的两个渲染面）；
 * 2. 两者都随公理那一行变化（`0 | number` ↔ `number`）；
 * 3. 角标里不得出现引擎内部计数器 id（`inv#N` / `len#N`）。
 */
import { describe, expect, it } from "vitest";
import { withLspServer } from "./helpers.ts";

/** 有公理：`tmp/repro/bug-247/inv/m1.js` 逐字内容 */
const INV_SRC = `/**
 * @nudo:invariant dp[*] >= 0
 */
export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

/** 对照组：同一函数体，只删掉 `@nudo:invariant` 那一行 */
const CTRL_SRC = `export function f(n) {
  const dp = [0];
  for (let i = 1; i < n; i++) {
    dp.push(dp[i - 1] + 1);
  }
  const out = dp[n - 1];
  if (out === undefined) return 0;
  return out;
}
`;

type Position = { line: number; character: number };
type Hint = { position: Position; label: string };
type HoverLike = { contents?: { value?: string } | string } | null;

/**
 * 函数**声明名**位置（`export function f` 里的 `f`）。
 * LSP `Position` 是 0 基；注释块（公理行）使两版文件行号不同 ⇒ 必须动态定位。
 */
function declNamePos(source: string): Position {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("export function "));
  if (idx < 0) throw new Error("fixture has no `export function` declaration");
  const character = lines[idx]!.indexOf("f", "export function ".length);
  if (character < 0) throw new Error("fixture declaration has no name");
  return { line: idx, character };
}

/** hover 签名行里的返回位（`=> <ret>`，去掉 ` throws …` 尾缀） */
function hoverReturnOf(hover: HoverLike): string {
  const text =
    typeof hover?.contents === "string"
      ? hover.contents
      : (hover?.contents?.value ?? "");
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /=>/.test(l) && !l.startsWith("`"));
  expect(line, `hover 里没有签名字段：${text}`).toBeDefined();
  return line!
    .slice(line!.indexOf("=>") + 2)
    .replace(/\s+throws\s+.*$/, "")
    .trim();
}

/** inlayHint 的返回角标文本（`: <ret>  · derived` → `<ret>`） */
function inlayReturnOf(hints: Hint[]): string {
  const ret = hints.filter((h) => h.label.startsWith(": "));
  expect(ret, `inlayHint 里没有返回角标：${JSON.stringify(hints)}`).toHaveLength(1);
  return ret[0]!.label
    .replace(/^:\s*/, "")
    .replace(/\s*·\s*derived\s*$/, "")
    .trim();
}

describe("Bug 247 · hover 面 ≡ inlayHint 面（同一份精确类型）", () => {
  it("两面对同一份源码给出同一份返回类型，且随公理变化", async () => {
    await withLspServer(
      { "inv.js": INV_SRC, "ctrl.js": CTRL_SRC },
      async (ctx) => {
        const faceOf = (name: string, src: string): { hover: string; inlay: string } => {
          const uri = ctx.uri(name);
          const pos = declNamePos(src);
          const hover = ctx.req("textDocument/hover")({
            textDocument: { uri },
            position: pos,
          }) as HoverLike;
          const hints = (ctx.req("textDocument/inlayHint")({
            textDocument: { uri },
          }) ?? []) as Hint[];
          return { hover: hoverReturnOf(hover), inlay: inlayReturnOf(hints) };
        };

        const inv = faceOf("inv.js", INV_SRC);
        const ctrl = faceOf("ctrl.js", CTRL_SRC);

        // 1. 逐字同源：hover 签名返回位 == inlay 返回角标
        expect(inv.hover).toBe(inv.inlay);
        expect(ctrl.hover).toBe(ctrl.inlay);

        // 2. 精确面：有公理 ⇒ `0 | number`；无公理 ⇒ `number`
        expect(inv.hover).toBe("0 | number");
        expect(ctrl.hover).toBe("number");
        // 差异**精确地由公理那一行引起**（不是面固有精度差）
        expect(inv.inlay).not.toBe(ctrl.inlay);

        // 3. 内部计数器 id 不上屏
        expect(inv.inlay).not.toMatch(/[a-z]+#\d+/);
        expect(ctrl.inlay).not.toMatch(/[a-z]+#\d+/);
      },
      "nudo-bug247-lsp-",
    );
  }, 30_000);
});

// MERGED (topic-related bug pins): lsp-bug-247-hover-axiom.test.ts + lsp-bug-247-inlay-hover-parity.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHoverAtPosition } from "../lsp-surface/hover.ts";
import { withLspServer } from "./helpers.ts";

describe("[merged] lsp-bug-247-hover-axiom.test.ts", () => {
/**
 * Bug 247 —— LSP hover **不消费用户公理**（`@nudo:invariant`）⇒ IDE 印出
 * 「没有那条公理的程序」的类型。
 *
 * 夹具（`tmp/repro/bug-247/inv/m1.js`）：函数体靠 `@nudo:invariant dp[*] >= 0`
 * 的循环界把返回位证成 `0 | number`；去掉公理那一行（对照组 `ctrl/m1.js`）
 * 同一函数体只能给 `number`。
 *
 * 改前：两版文件的 hover 返回位**逐字相同**（都是 `number`）——hover 自算
 * `generalizeFromAst`，而公理只在 `checkSource` 的动态域里播种；CLI
 * `nudo check` 却随公理那一行变化（`0 | number` ↔ `number`）⇒ 跨面矛盾。
 *
 * 修法：hover 的返回位 + `throws` 尾缀改取 `checkSource` 签名（check-identical），
 * 参数渲染仍由 hover 自己负责。
 *
 * 钉：同一函数体只差那一行公理 ⇒ hover 签名行返回位必须随之变化
 * （有公理 ⇒ `0 | number`；无公理 ⇒ `number`）。
 */






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

/**
 * 函数**声明名**位置（`export function f` 里的 `f`）。
 *
 * `getHoverAtPosition` 的 `line` 是 **1-based**（= LSP line + 1），`column`
 * 是 **0-based**。注释块（公理行）使两版文件的行号不同 ⇒ 必须动态定位。
 */
function declNamePos(source: string): { line: number; column: number } {
  const lines = source.split("\n");
  const idx = lines.findIndex((l) => l.startsWith("export function "));
  if (idx < 0) throw new Error("fixture has no `export function` declaration");
  const column = lines[idx]!.indexOf("f", "export function ".length);
  if (column < 0) throw new Error("fixture declaration has no name");
  return { line: idx + 1, column };
}

function signatureOf(dir: string, name: string, source: string): string {
  const file = join(dir, name);
  writeFileSync(file, source, "utf-8");
  const pos = declNamePos(source);
  const info = getHoverAtPosition(file, source, pos.line, pos.column);
  expect(info, `hover 无结果：${name}`).not.toBeNull();
  const sig = info!.signature;
  expect(sig, `hover 未给 check 同口径签名（BUG-247 的承载位）：${name}`).toBeDefined();
  return sig!;
}

describe("Bug 247 — hover 返回位必须消费 @nudo:invariant（check-identical）", () => {
  it("有公理 ⇒ hover 返回位 `0 | number`；无公理 ⇒ `number`；两者不同", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug247-"));
    try {
      const invSig = signatureOf(dir, "inv.js", INV_SRC);
      const ctrlSig = signatureOf(dir, "ctrl.js", CTRL_SRC);

      // 改前：hover 自算 generalize ⇒ 两版都是 `f(n: any) => number`
      expect(invSig).toContain("=> 0 | number");
      expect(ctrlSig).not.toContain("0 | number");
      expect(ctrlSig).toContain("=> number");
      // 差异**精确地由公理那一行引起**（不是面固有精度差）
      expect(invSig).not.toBe(ctrlSig);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("公理不影响参数渲染：两版形参仍同形（hover 自己的参数面）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug247-param-"));
    try {
      const invSig = signatureOf(dir, "inv.js", INV_SRC);
      const ctrlSig = signatureOf(dir, "ctrl.js", CTRL_SRC);
      const paramsOf = (sig: string): string => sig.slice(sig.indexOf("("), sig.indexOf("=>"));
      expect(paramsOf(invSig)).toBe(paramsOf(ctrlSig));
      expect(paramsOf(invSig)).toBe("(n: any) ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
});

describe("[merged] lsp-bug-247-inlay-hover-parity.test.ts", () => {
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
});

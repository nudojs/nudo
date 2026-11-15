/**
 * BUG-091 —— LSP completion 的函数条目 detail 用 `?` 占位返回值 ⇒ 与同一 LSP 面的
 * hover、以及 `nudo check` 签名给出两种渲染。
 *
 * 症状：同一文件里 `lit` / `obj` 的 detail 是真实类型，而 `ident` 是 `(x) => ?`
 * （`?` 既不是 TS 类型也不是 Nudo 类型）；同一时刻 hover 给
 * `ident(x: any) => any` ⇒ 同一面内部两种口径。
 *
 * 根因：`detail` 整条走 `absDetail`（`formatShape`）—— fn 形态在 `returnType`
 * 槽为空（arity-only fn Abs，未被调用观测过）时回落占位符 `?`
 * （`core/algebra/format.ts` 的 fn 分支），而变量形态走另一条（正确的）路径。
 *
 * 修法：绑定面 detail 的函数形态改走 **check 签名公式**（`fnBindingDetail`）——
 * 形参名 + `formatShape(形参 Abs)`（缺失 = `any`），返回 `formatShape(返回 Abs)`
 * （缺失 = `any`）；非函数形态仍走 `formatShape`。
 *
 * 钉：`ident` 的 detail **逐字**等于 `ident(x: any) => any`（且与 hover 的 check
 * 同口径签名一致），`lit` / `obj` 仍为真实类型。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempDir } from "./helpers.ts";
import { getCompletionsAtPosition } from "../lsp-surface/completions.ts";
import { getHoverAtPosition } from "../lsp-surface/hover.ts";

/** 复现夹具（tmp/repro/bug-091/c.js）：变量 / 函数 / 对象三种形态并排。 */
const SRC = `export const lit = 42;
export function ident(x) { return x; }
export const obj = { a: 1 };
`;

describe("BUG-091 — completion 的函数 detail 与 hover / check 签名同形", () => {
  it("fn 绑定 detail = `ident(x: any) => any`（不是 `(x) => ?`），且与 hover.signature 一致", () => {
    withTempDir("nudo-bug091-", (dir) => {
      const file = join(dir, "c.js");
      writeFileSync(file, SRC, "utf-8");

      // 末行（空行）无成员访问触发点 ⇒ 变量补全面（绑定面）
      const items = getCompletionsAtPosition(file, SRC, 4, 0);
      const detailOf = (label: string): string | undefined =>
        items.find((i) => i.label === label)?.detail;

      // 变量 / 对象形态：仍是真实类型（修复不得改动这两条路径）
      expect(detailOf("lit")).toBe("42");
      expect(detailOf("obj")).toBe("{ a: 1 }");

      // 函数形态：check 同形签名，不是 `(x) => ?`
      const ident = items.find((i) => i.label === "ident");
      expect(ident?.kind).toBe("function");
      expect(detailOf("ident")).toBe("ident(x: any) => any");
      expect(detailOf("ident")).not.toContain("?");

      // 同一面同口径：补全 detail ≡ hover 的 check 签名（BUG-091 的两面矛盾）
      const hover = getHoverAtPosition(file, SRC, 2, 16);
      expect(hover?.signature).toBe("ident(x: any) => any");
    });
  });
});

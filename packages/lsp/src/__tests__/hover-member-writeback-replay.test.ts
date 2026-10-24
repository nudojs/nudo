/**
 * LSP hover 重放面：成员写回的**赋值目标**必须是可赋值绑定回归。
 *
 * 根因：core 的 memberPathOf 在 recordPositions 打开时把路径根包成
 * `$nodoPos(name, l, c)`（位置插桩**读**），写回点却把同一个 rootSrc 当
 * **赋值目标**用 ⇒ 产物 `$nodoPos(o, 2, 24) = …` 是非法 JS ⇒ 整模块
 * new Function 抛 SyntaxError ⇒ fail-closed ⇒ hover 重放拿不到求值态
 * （回落声明形态面）。
 *
 * LSP 重放面（lsp-surface/replay.ts）常开 recordPositions ⇒ 该面整体失效。
 * 修法：MemberPath 拆出 rootTarget（裸绑定名），写回一律用它。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { hoverTool } from "../agent-tools.ts";
import { withTempDir } from "./helpers.ts";

function hoverAbs(src: string, file: string, line: number, column: number): unknown {
  const r = hoverTool({ file, line, column, source: src }, { readFile: () => src });
  const payload = JSON.parse(r.content[0]!.text) as { abs?: unknown };
  return payload.abs;
}

describe("LSP hover 重放：成员写回后仍拿到求值态", () => {
  it("成员赋值后的成员读 → 求值态（修前回落声明形态面）", () => {
    withTempDir("nudo-lsp-wb-", (dir) => {
      const file = join(dir, "lib.js");
      const src = [
        "export function f(o) {",
        "  o.a = 2;",
        "  return o.a;",
        "}",
        "",
      ].join("\n");
      writeFileSync(file, src);
      writeFileSync(
        join(dir, "lib.nudo.js"),
        [
          'import { shape, number } from "@nudojs/core";',
          "export const f = fn({ o: shape({ a: number() }) }, number());",
          "",
        ].join("\n"),
      );
      // 第 3 行 `  return o.a;`——列 10 = `o.a` 的 o
      const abs = hoverAbs(src, file, 3, 10) as string | null;
      expect(abs).not.toBeNull();
      // 求值态：写回后的 o（a: 2）；修前是声明形态（a: number）
      expect(abs).toContain("a: 2");
      expect(abs).not.toContain("a: number");
    });
  });
});

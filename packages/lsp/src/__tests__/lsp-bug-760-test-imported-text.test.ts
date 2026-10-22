/**
 * Bug 760 — LSP agent 工具 `nudo/test` 的**文本面**丢掉 **imported（外部）
 * 函数** ⇒ CLI 文本面有的 `(imported)` 段在 IDE 面整段消失，而头部计数**仍
 * 把外部 case 算进去**（「2 fn · 3 case」却只列出 2 个函数块）。
 *
 * 本钉断言：文本面出现 `(imported)` 段头 + 外部函数名 + 它的 case ⇒ 正文
 * 里印出的 case 数与头部计数一致。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const LIB = `export function helper(x) {
  return x + 1;
}
`;

const MAIN = `import { helper } from "./lib.js";
export function alpha(x) {
  return helper(x);
}
export function beta(x) {
  return x * 2;
}
alpha(1);
beta(2);
`;

describe("Bug 760 — agent nudo/test 文本面渲染 imported 段", () => {
  it("文本面含 (imported) 段头与外部函数", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({ file: `${dir}/main.js` });
        const text = r.content[0].text;
        expect(text).toContain("(imported)");
        expect(text).toContain("helper");
        // 段头带来源模块（lib.js 的绝对路径）
        expect(text).toContain("lib.js (imported)");
      },
    );
  });

  it("头部 case 计数与正文印出的 case 一致（不再「3 case 只印 2 条」）", async () => {
    await withLspServer(
      { "lib.js": LIB, "main.js": MAIN },
      async ({ req, dir }) => {
        const r = await req("nudo/test")({ file: `${dir}/main.js` });
        const text = r.content[0].text;
        const header = text.split("\n").find((l: string) => l.includes(" fn · "));
        expect(header).toBeTruthy();
        const declared = Number(header!.match(/(\d+) case/)?.[1]);
        // 正文里印出的 case 行（`  call@L…: (…) => …`）
        const printed = text.split("\n").filter((l: string) => /^ {2}call@/.test(l)).length;
        expect(printed).toBe(declared);
      },
    );
  });
});

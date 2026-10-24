/**
 * Bug 751 —— 侧车契约文件（`*.nudo.js`）在导航面上的**门禁各写各的**：
 * `definition` 单独挂了 `isSidecarPath` **逃生口**（放行侧车），
 * `workspace/symbol` 干脆**没有门禁**（反而放行侧车），其余四个请求一律
 * `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说
 * 「这个符号存在」，documentSymbol 说「这个文件里没有任何符号」
 * ⇒ **LSP 内部自相矛盾**。
 *
 * 修法（**最小一致修法**，全部落在 `server-navigation.ts`）：
 * ① 去掉 `definition` 的 `|| isSidecarPath(...)` 逃生口 ⇒ 侧车在所有导航
 *    请求上一律为 null；② 给 `workspace/symbol` **补上同一个门禁**
 *    （路径层 `isNudoTargetPath`——`isNudoFile` 的第一层，同样排除侧车）。
 *
 * ⚠ **代价（已裁决：接受）**：丢掉「源码 → 侧车」的 definition 可导航能力。
 * ⚠ `workspace/symbol` 扫的是**文件路径集合**（可能**未打开**）⇒ 不能用
 *   `isNudoFile`（它要求文档已打开 ⇒ 会把未打开的文件整片误杀）⇒ 只用
 *   **路径层**。
 *
 * ⚠ **共担**：族级不变量钉见 `lsp-bug-751-sidecar-gate-family.test.ts`
 *   （片 C 落，本钉与它同口径）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const LIB = `export function getName(user) {
  return user.name;
}
`;

/** 侧车契约文件：引擎消费的契约形态（fn({ … }, …) 导出绑定）。 */
const LIB_SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ u: shape({ name: string() }) }, string());
`;

/** 侧车里 `getName` 的位置（行 2，列 13）。 */
const SIDECAR_POS = { line: 2, character: 13 };

const isEmptyResult = (v: unknown): boolean =>
  v === null || v === undefined || (Array.isArray(v) && v.length === 0);

describe("Bug 751 — 导航面门禁一致：侧车在六个请求上不可见", () => {
  it("同一坐标（侧车里的 getName）⇒ 六个导航请求结论一致（都不可见）", async () => {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const at = { textDocument: { uri: sidecar }, position: SIDECAR_POS };

        expect(
          isEmptyResult(req("textDocument/definition")(at)),
          "definition 仍放行侧车（`|| isSidecarPath(...)` 逃生口未去掉）",
        ).toBe(true);
        expect(
          isEmptyResult(req("textDocument/references")({ ...at, context: { includeDeclaration: true } })),
          "references 仍放行侧车",
        ).toBe(true);
        expect(isEmptyResult(req("textDocument/rename")({ ...at, newName: "renamed" })), "rename 仍放行侧车").toBe(
          true,
        );
        expect(isEmptyResult(req("textDocument/prepareRename")(at)), "prepareRename 仍放行侧车").toBe(true);
        expect(isEmptyResult(req("textDocument/documentSymbol")({ textDocument: { uri: sidecar } })), "documentSymbol 仍放行侧车").toBe(
          true,
        );

        const symbols = req("workspace/symbol")({ query: "getName" }) as Array<{
          name: string;
          location?: { uri?: string };
        }>;
        const sidecarEntries = (symbols ?? []).filter((s) =>
          String(s.location?.uri ?? "").endsWith("lib.nudo.js"),
        );
        expect(sidecarEntries, "workspace/symbol 仍放行侧车条目（无门禁）").toEqual([]);
      },
    );
  });

  it("负控制：源码侧仍可见（门禁不得过度拦截）", async () => {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const src = uri("lib.js");
        const syms = req("textDocument/documentSymbol")({ textDocument: { uri: src } }) as Array<{
          name: string;
        }>;
        expect(syms.map((s) => s.name)).toContain("getName");

        const ws = req("workspace/symbol")({ query: "getName" }) as Array<{
          name: string;
          location?: { uri?: string };
        }>;
        expect(
          (ws ?? []).some((s) => String(s.location?.uri ?? "").endsWith("lib.js")),
          "workspace/symbol 把源码条目也误杀了",
        ).toBe(true);
      },
    );
  });
});

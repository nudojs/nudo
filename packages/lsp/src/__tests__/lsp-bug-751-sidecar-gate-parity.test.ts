/**
 * Bug 751 — 侧车契约文件（`*.nudo.js`）在导航请求族里的**门禁各写各的**：
 * `definition` 单独挂了 `isSidecarPath` 逃生口（放行侧车），`workspace/symbol`
 * 干脆**没有门禁**（反而放行侧车），其余四个导航请求与 6 个 IDE 请求一律
 * `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说「这个符号
 * 存在」，documentSymbol 说「这个文件里没有任何符号」。
 *
 * 根因：门禁谓词**没有单一事实源**——`server-navigation.ts` 的 5 个请求各写
 * 一份、`server-ide.ts` 的 6 个请求各写一份、`workspace/symbol` 干脆不写。
 *
 * 真源 = `server.ts` 的 `isNudoFile`（底层 `isNudoTargetPath`，**明确排除**
 * `*.nudo.js` / `*.nudo.mjs` / `*.nudo.ts` / `*.nudo.draft.*`）⇒ 导航面与
 * IDE 面共用**同一个谓词实例** ⇒ 两侧口径必然一致。
 *
 * 本钉钉住**已统一的那一半**（统一门禁谓词真源 + IDE 侧一致性）：
 * 侧车契约文件在 IDE 面与「走统一门禁的四个导航请求」上完全不可见。
 *
 * ⚠ 导航面剩下的两处调用点（`definition` 的逃生口、`workspace/symbol` 的无
 *   门禁）在 `server-navigation.ts` ⇒ **片 B** 落 ⇒ 族级不变量钉见
 *   `lsp-bug-751-sidecar-gate-family.test.ts`（共担钉：片 B 落地后转绿）。
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
/** 源码里 `getName` 的位置（行 0，列 16）。 */
const SRC_POS = { line: 0, character: 16 };

describe("Bug 751 — 统一门禁谓词：侧车在 IDE 面与统一门禁的导航请求上不可见", () => {
  it("侧车上的六个 IDE 请求结论一致（侧车不可见）", async () => {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const at = { textDocument: { uri: sidecar }, position: SIDECAR_POS };

        expect(req("textDocument/hover")(at)).toBeNull();
        expect(req("textDocument/completion")(at)).toEqual([]);
        expect(req("textDocument/codeLens")({ textDocument: { uri: sidecar } })).toEqual([]);
        expect(req("textDocument/inlayHint")({ textDocument: { uri: sidecar } })).toEqual([]);
        expect(req("textDocument/signatureHelp")(at)).toBeNull();
        expect(req("textDocument/semanticTokens/full")({ textDocument: { uri: sidecar } })).toEqual({
          data: [],
        });
      },
    );
  });

  it("侧车上的四个统一门禁导航请求结论一致（侧车不可见）", async () => {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const at = { textDocument: { uri: sidecar }, position: SIDECAR_POS };

        expect(
          req("textDocument/references")({ ...at, context: { includeDeclaration: true } }),
          "references 仍放行侧车",
        ).toEqual([]);
        expect(req("textDocument/rename")({ ...at, newName: "renamed" })).toBeNull();
        expect(req("textDocument/prepareRename")(at)).toBeNull();
        expect(req("textDocument/documentSymbol")({ textDocument: { uri: sidecar } })).toEqual([]);
      },
    );
  });

  it("负控制：源码侧的符号仍可见（门禁不得过度拦截）", async () => {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const src = uri("lib.js");
        const at = { textDocument: { uri: src }, position: SRC_POS };

        const defs = req("textDocument/definition")(at) as Array<{ uri: string }>;
        expect(defs.length, "源码侧 definition 变空了（门禁过度拦截）").toBeGreaterThan(0);
        expect(defs.some((d) => String(d.uri).endsWith("lib.js"))).toBe(true);

        const syms = req("textDocument/documentSymbol")({ textDocument: { uri: src } }) as Array<{
          name: string;
        }>;
        expect(syms.map((s) => s.name)).toContain("getName");
      },
    );
  });
});

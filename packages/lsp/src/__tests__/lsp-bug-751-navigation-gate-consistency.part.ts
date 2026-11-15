// MERGED (topic-related bug pins): lsp-bug-751-navigation-gate-consistency.test.ts + lsp-bug-751-sidecar-gate-family.test.ts + lsp-bug-751-sidecar-gate-parity.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

describe("[merged] lsp-bug-751-navigation-gate-consistency.test.ts", () => {
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
});

describe("[merged] lsp-bug-751-sidecar-gate-family.test.ts", () => {
/**
 * Bug 751（**共担钉**）—— 族级不变量：侧车契约文件（`*.nudo.js`）在**全部**
 * 导航请求上不可见。
 *
 * ⚠ **共担**：本钉的两条断言落在 `server-navigation.ts` 的两个调用点
 *   （`definition` 的 `|| isSidecarPath(...)` 逃生口、`workspace/symbol` 的
 *   **无门禁**）⇒ **片 B** 落。⇒ 本钉在 HEAD（未修）上**红**（反向闸证据），
 *   片 B 落地后**转绿**。片 C 的那一半（统一门禁谓词真源 + IDE 侧一致性）
 *   见 `lsp-bug-751-sidecar-gate-parity.test.ts`。
 *
 * 症状（HEAD）：同一坐标（侧车里的 `getName`）六种请求三种结论——
 * definition **有**、references/rename/prepareRename/documentSymbol 全空、
 * workspace/symbol **反而列出**侧车条目 ⇒ LSP 内部自相矛盾。
 */



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

describe("Bug 751（族级不变量）— 侧车在全部导航请求上不可见", () => {
  it("definition 不得放行侧车（逃生口已去掉）", async () => {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const sidecar = uri("lib.nudo.js");
        const res = req("textDocument/definition")({
          textDocument: { uri: sidecar },
          position: SIDECAR_POS,
        });
        const empty =
          res === null ||
          res === undefined ||
          (Array.isArray(res) && res.length === 0);
        expect(empty, "definition 仍放行侧车（`|| isSidecarPath(...)` 逃生口未去掉）").toBe(true);
      },
    );
  });

  it("workspace/symbol 不得放行侧车条目（门禁已补）", async () => {
    await withLspServer(
      { "lib.js": LIB, "lib.nudo.js": LIB_SIDECAR },
      async ({ req, uri }) => {
        const symbols = req("workspace/symbol")({ query: "getName" }) as Array<{
          name: string;
          location?: { uri?: string };
        }>;
        const sidecarEntries = (symbols ?? []).filter((s) =>
          String(s.location?.uri ?? "").endsWith("lib.nudo.js"),
        );
        expect(sidecarEntries, "workspace/symbol 仍放行侧车条目（无门禁）").toEqual([]);
        // 负控制：源码条目仍在（不得整片误杀）
        expect(
          (symbols ?? []).some((s) => String(s.location?.uri ?? "").endsWith("lib.js")),
          "workspace/symbol 把源码条目也误杀了",
        ).toBe(true);
      },
    );
  });
});
});

describe("[merged] lsp-bug-751-sidecar-gate-parity.test.ts", () => {
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
});

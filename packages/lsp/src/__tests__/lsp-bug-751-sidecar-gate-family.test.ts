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

/**
 * Bug 1025 —— import 绑定表只以「本地名」为键 ⇒ 别名 import 的 **imported 侧**
 * 标识符在引擎眼里不是 import 绑定 ⇒ ① `references` 返回 `[]`（假绿）
 * ② `definition` 退化到**工作区同名导出**兜底 ⇒ 跳到**无关文件**（假跳转）。
 *
 * 报告说的症状（**假阳性 —— 两个症状都不复现**）：
 *   夹具：`aaa.js` 与 `zzz.js` **同名导出 `helper`**；`plain.js` 走**无别名**
 *   import、`aliased.js` 走**别名** import（两者都从 `./zzz.js` 导入 ⇒
 *   **唯一变量 = 有没有别名**）。
 *   报告实测：别名 import 的 imported 侧 `helper` ⇒ `definition = aaa.js`、
 *   `references = []`。
 *
 * 实测（HEAD `dd22619e` 上逐字，见 `tmp/probe/fix-r91/D/oracle-before-head.txt`）：
 *   · `aliased.js` 的 **imported 侧** `helper`@0:9 ⇒
 *     `definition = ["zzz.js:0:16-0:22"]` ⇒ **跳到正确的模块**（**不是** `aaa.js`）；
 *     `references = ["zzz.js:0:16-0:22","plain.js:0:9-0:15","plain.js:2:17-2:23",
 *     "aliased.js:0:9-0:15"]` ⇒ **不是 `[]`**，且与**无别名形态**（`plain.js`
 *     的 imported 侧）**完全一致**。
 *   · `aliased.js` 的 **local 侧** `p`@0:19 ⇒
 *     `definition = ["zzz.js:0:16-0:22","aliased.js:0:19-0:20"]` ⇒ 正确。
 *
 * ⇒ **症状**已被覆盖：`findEdgeAt`（`symbols.ts`，**位置感知**）先拿到光标处
 *   **那一条具体的 import 说明符** ⇒ imported 侧不再靠「本地名」猜模块；
 *   `resolveDefinitionLocations` 的 `at` 透传让 `workspaceFallback` 只在
 *   `out.length === 0` 时才走 ⇒ **不会**落到无关的同名导出。
 *
 * ⚠ **根因字面仍成立**：`collectImportBindings`（`symbols.ts`）的键**仍只取本地名**
 *   ⇒ 当前之所以没炸，是因为上面那条**位置感知旁路**恰好绕开了它
 *   ⇒ **一旦有人删改那条旁路，1025 的症状会原样复活**
 *   ⇒ 本钉就是「别把旁路改坏」的护栏（**族 24 残留项**，本片不修）。
 *
 * 本文件是**反向守护钉**：钉住「**已修**」的行为 ⇒ **在 HEAD 上必须通过**
 * （闸④ 反向闸）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

/** 无关的**同名导出**（工作区兜底的「猎物」） */
const AAA = `export function helper(x) {
  return "WRONG-FILE-aaa";
}
`;
/** 真正的来源模块 */
const ZZZ = `export function helper(x) {
  return "RIGHT-FILE-zzz";
}
`;
/** 无别名 import（对照组）：imported 侧 `helper` 在 0:9-0:15，用法在 2:17-2:23 */
const PLAIN = `import { helper } from "./zzz.js";

export const a = helper(1);
`;
/** 别名 import：imported 侧 `helper` 在 0:9-0:15，local 侧 `p` 在 0:19-0:20 */
const ALIASED = `import { helper as p } from "./zzz.js";

export const b = p(2);
`;

type Loc = {
  file: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
};

/** Location[] ⇒ 可断言的位点列表（按 file/line/character 排序） */
function locsOf(result: unknown): Loc[] {
  if (!Array.isArray(result)) return [];
  return (result as any[])
    .map((l) => ({
      file: String(l?.uri ?? "").split("/").pop() ?? "",
      line: l?.range?.start?.line ?? -1,
      character: l?.range?.start?.character ?? -1,
      endLine: l?.range?.end?.line ?? -1,
      endCharacter: l?.range?.end?.character ?? -1,
    }))
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.character - b.character,
    );
}

const ZZZ_DECL: Loc = {
  file: "zzz.js",
  line: 0,
  character: 16,
  endLine: 0,
  endCharacter: 22,
};

describe("Bug 1025 — 别名 import 的 imported 侧：definition 落到正确模块、references 不为空", () => {
  it("definition@imported 侧：落到真正被导入的模块，不得落到同名导出的无关文件", async () => {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const defs = locsOf(
          await req("textDocument/definition")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`
          }),
        );
        expect(defs).toContainEqual(ZZZ_DECL);
        expect(
          defs.filter((d) => d.file === "aaa.js"),
          "definition 不得退到工作区里无关的同名导出（aaa.js）",
        ).toEqual([]);
      },
    );
  });

  it("references@imported 侧：不是空数组，且与无别名形态完全一致", async () => {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const aliasedRefs = locsOf(
          await req("textDocument/references")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`
            context: { includeDeclaration: true },
          }),
        );
        const plainRefs = locsOf(
          await req("textDocument/references")({
            textDocument: { uri: uri("plain.js") },
            position: { line: 0, character: 9 }, // imported 侧 `helper`（无别名对照）
            context: { includeDeclaration: true },
          }),
        );
        expect(
          aliasedRefs.length,
          "别名 import 的 imported 侧 references 不得返回空数组（假绿）",
        ).toBeGreaterThan(0);
        expect(aliasedRefs).toContainEqual(ZZZ_DECL);
        expect(
          aliasedRefs.filter((r) => r.file === "aaa.js"),
          "references 不得混进无关的同名导出",
        ).toEqual([]);
        // 唯一变量 = 有没有别名 ⇒ 两侧的引用集必须**完全一致**
        expect(aliasedRefs).toEqual(plainRefs);
      },
    );
  });

  it("definition@local 侧：仍然落到真正被导入的模块", async () => {
    await withLspServer(
      { "aaa.js": AAA, "zzz.js": ZZZ, "plain.js": PLAIN, "aliased.js": ALIASED },
      async ({ req, uri }) => {
        const defs = locsOf(
          await req("textDocument/definition")({
            textDocument: { uri: uri("aliased.js") },
            position: { line: 0, character: 19 }, // local 侧 `p`
          }),
        );
        expect(defs).toContainEqual(ZZZ_DECL);
        expect(defs.filter((d) => d.file === "aaa.js")).toEqual([]);
      },
    );
  });
});

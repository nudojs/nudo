/**
 * Bug 411 —— 行注释（`//`）上下文被**块注释**的转义口径污染
 *
 * 根因：core 的 `sanitizeCommentText`（`core/src/algebra/codegen-escape.ts`）
 * 只有**一种**行为——无条件把块注释闭合序列（星号 + 斜杠）转义成 `*\/`。那是
 * **块注释 / JSDoc** 口径（必要：否则注释体被提前闭合）。但**行注释**到行尾
 * 结束，闭合序列在 `//` 上下文**没有语法含义** ⇒ 转义纯属污染：
 * `nudo contract --draft` 的契约草案注释被写成 `*\/`，而用户要把这段文字
 * **原样抄进侧车**。
 *
 * 修法：service 侧新增**模块私有**的 `emit/line-comment.ts`
 * （`sanitizeLineCommentText`）——行注释里**原样保留**闭合序列，但**换行 /
 * 控制字符仍必须中和**（否则 `//` 注释里的换行会把后续文本注入代码）。
 * 块注释侧（JSDoc，`emit/dts-generator.ts`）**保持 core 口径不变**。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "@nudojs/core";
import { sanitizeCommentText } from "@nudojs/core/internal";
import { sanitizeLineCommentText } from "../line-comment.ts";
import { formatDraftModule } from "../interface-draft.ts";
import { absToZodSchemaModule } from "../schema-generator.ts";
import { absToStandardSchemaModule } from "../standard-schema.ts";
import { generateFunctionDtsLines } from "../dts-generator.ts";
import type { CaseResult, FunctionAnalysis } from "../../analyzer-types.ts";

/** 对象 Abs（键可为任意字符串——含闭合序列） */
function objAbs(slots: Record<string, Abs>): Abs {
  const built: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) built[k] = { value: v };
  return abs({ k: "obj", slots: built as never }, undefined, undefined, "exact");
}

/** 数字收窄（带不可投影 pred，用于制造 dropped 注记） */
function numWithUnprojectable(): Abs {
  return abs(
    { k: "prim", type: "number" },
    { op: "var", id: "x" },
    { op: "gt", a: { op: "var", id: "x" }, b: { op: "var", id: "y" } },
    "exact",
  );
}

function fnAnalysis(cases: CaseResult[]): FunctionAnalysis {
  return {
    name: "f",
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
    paramNames: ["x"],
    cases,
  };
}

describe("Bug 411: 行注释清洗器口径（模块私有）", () => {
  it("行注释里原样保留块注释闭合序列（不转义）", () => {
    expect(sanitizeLineCommentText("/* no evidence — tighten */")).toBe(
      "/* no evidence — tighten */",
    );
    expect(sanitizeLineCommentText("a */ b")).toBe("a */ b");
  });

  it("换行 / 控制字符仍必须中和成空格（`//` 注释被顶出代码的防线）", () => {
    expect(sanitizeLineCommentText("a\nb")).toBe("a b");
    expect(sanitizeLineCommentText("a\r\nb")).toBe("a  b");
    expect(sanitizeLineCommentText("a\u2028b")).toBe("a b");
    expect(sanitizeLineCommentText("a\u2029b")).toBe("a b");
    expect(sanitizeLineCommentText("a\u0007b")).toBe("a b");
  });

  it("块注释侧口径不变（core 的 sanitizeCommentText 仍转义闭合序列）", () => {
    expect(sanitizeCommentText("a */ b")).toBe("a *\\/ b");
  });
});

describe("Bug 411: 契约草案的行注释不得被转义污染", () => {
  const draft = formatDraftModule(
    "/tmp/demo/lib.js",
    [
      {
        fn: "add",
        identity: "add",
        paramEvidence: "none",
        returnEvidence: "symbolic",
        params: [
          { name: "a", display: "/* no evidence — tighten */", projected: false },
          { name: "b", display: "/* no evidence — tighten */", projected: false },
        ],
        returns: {
          display:
            "/* symbolic: number | string — add: (a: A1, b: A2) => number | string = (A1 + A2) */",
          projected: false,
        },
        dsl: "fn({})",
      },
    ],
    "/tmp/demo/lib.nudo.js",
  );

  it("行注释里的闭合序列原样保留（旧实现写成 `*\\/`）", () => {
    expect(draft).toContain("//   a: /* no evidence — tighten */");
    expect(draft).toContain("//   b: /* no evidence — tighten */");
    expect(draft).toContain(
      "//   returns: /* symbolic: number | string — add: (a: A1, b: A2) => number | string = (A1 + A2) */",
    );
    expect(draft).not.toContain("*\\/");
  });
});

describe("Bug 411: dropped 注记的行注释不得被转义污染", () => {
  it("zod: `//   ` 注记行保留闭合序列", () => {
    const a = objAbs({ "a*/b": numWithUnprojectable() });
    const { source, dropped } = absToZodSchemaModule({ out: a });
    expect(dropped.length).toBeGreaterThan(0);
    const noteLines = source.split("\n").filter((l) => l.startsWith("//   "));
    expect(noteLines.length).toBeGreaterThan(0);
    expect(noteLines.join("\n")).toContain("a*/b: pred not projected");
    expect(noteLines.join("\n")).not.toContain("*\\/");
  });

  it("standard-schema: `//   ` 注记行保留闭合序列", () => {
    const a = objAbs({ "a*/b": numWithUnprojectable() });
    const { source, dropped } = absToStandardSchemaModule({ out: a });
    expect(dropped.length).toBeGreaterThan(0);
    const noteLines = source.split("\n").filter((l) => l.includes("pred not projected"));
    expect(noteLines.length).toBeGreaterThan(0);
    expect(noteLines.join("\n")).toContain("a*/b: pred not projected");
    expect(noteLines.join("\n")).not.toContain("*\\/");
  });
});

describe("Bug 411 反向闸: 块注释（JSDoc）侧仍必须转义闭合序列", () => {
  it("dts JSDoc 注释体里的闭合序列仍被转义（未被本片改动波及）", () => {
    const c: CaseResult = {
      name: "x*/ process.exit(1); /*",
      argAbs: [numLit(1)],
      abs: numLit(1),
      throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
    };
    const lines = generateFunctionDtsLines(fnAnalysis([c]));
    const jsdoc = lines[0]!;
    expect(jsdoc).toContain("*\\/");
    const withoutClose = jsdoc.slice(0, jsdoc.lastIndexOf("*/"));
    expect(withoutClose).not.toContain("*/");
  });
});

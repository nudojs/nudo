/**
 * Bug 519 / Bug 989 —— **standard 产物面过不了 `tsc --noEmit --strict`**。
 *
 * 修前：产物是 `.ts` 模块，helper 却是裸 JS（`function __nudoCheck(node, value,
 * path, issues)`、`const local = []`、`validate(value)`）⇒ strict 工程里
 * TS7006 / TS7005 / TS7034 一片红（519 记 24 条、989 记 16 条）⇒ 产物在
 * strict 工程里**不可用**；而同一次导出的 zod 面 exit 0 ⇒ 跨产物面不一致。
 *
 * 修后（产物生成侧，本分片）：helper / 局部量带类型标注 + 产物自带
 * `NudoSchemaNode` / `NudoIssue` 等类型别名 ⇒ 一次生成即消除全部错误。
 *
 * 本用例用**真 TypeScript 编译器**（不是比字符串）检查产物：`strict: true`
 * 下 0 诊断。
 *
 * 负控制：修前形态（裸 JS helper）在本检查器下**必须**报 TS7006 —— 证明这条
 * 门禁不是恒绿。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { abs, num, numLit, obj, str, type Abs } from "@nudojs/core";
import { absToStandardSchemaModule } from "../standard-schema.ts";

/** 真 tsc：把源码当 .ts 模块过一遍 strict 编译，返回诊断（只算本文件）。 */
function strictDiagnostics(source: string): Array<{ code: number; message: string }> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-strict-check-"));
  const file = join(dir, "product.ts");
  writeFileSync(file, source, "utf-8");
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === file)
    .map((d) => ({
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    }));
}

/** 覆盖产物里出现的各节点形态：prim / obj 槽 / union / lit / tuple / arr / refinement。 */
const richAbs = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        n: { value: num() },
        s: { value: str() },
        lit: { value: numLit(42) },
        list: { value: abs({ k: "arr", element: num() }, undefined, undefined, "exact") },
        tup: {
          value: abs(
            { k: "tuple", elements: [numLit(1), num()] },
            undefined,
            undefined,
            "exact",
          ),
        },
        pick: {
          value: abs(
            { k: "sum", members: [num(), str()] },
            undefined,
            undefined,
            "exact",
          ),
        },
      },
    },
    undefined,
    undefined,
    "exact",
  );

describe("Bug 519 / 989: standard 产物必须能过 tsc --noEmit --strict", () => {
  it("生成的 standard 产物在 strict 下 0 诊断", () => {
    const { source } = absToStandardSchemaModule({ rich: richAbs() });
    const diags = strictDiagnostics(source);
    expect(diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  });

  it("负控制：修前形态（裸 JS helper）在同一检查器下报 TS7006", () => {
    // 修前的 helper 签名（无类型标注）——必须被本门禁抓住，否则门禁恒绿。
    const legacy = `function __nudoCheck(node, value, path, issues) {
  function push(msg) {
    issues.push(path.length > 0 ? { message: msg, path: path.slice() } : { message: msg });
  }
  switch (node.k) {
    case "lit": {
      const local = [];
      return local;
    }
    default:
      return;
  }
}
export const rich = {
  "~standard": {
    version: 1,
    vendor: "nudo",
    validate(value) {
      const issues = [];
      __nudoCheck({ k: "lit", value: 42 }, value, [], issues);
      return issues.length ? { issues } : { value };
    },
  },
} as const;
`;
    const codes = strictDiagnostics(legacy).map((d) => d.code);
    expect(codes).toContain(7006); // 隐式 any 形参
    expect(codes).toContain(7005); // 隐式 any[]
  });

  it("产物自带类型别名（消费方拿到 unknown 而非 any 的入参面）", () => {
    const { source } = absToStandardSchemaModule({ rich: richAbs() });
    expect(source).toContain("type NudoSchemaNode =");
    expect(source).toContain("type NudoIssue =");
    expect(source).toContain("function __nudoCheck(node: NudoSchemaNode, value: unknown");
    expect(source).toContain("validate(value: unknown)");
    // 不得残留隐式 any 的局部量
    expect(source).not.toMatch(/const local = \[\]/);
    expect(source).not.toMatch(/const issues = \[\]/);
  });
});

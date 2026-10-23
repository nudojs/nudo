/**
 * Bug 1032（parser 面）：行内指令的**粘连**形态此前对扫描器**完全不可见**
 * ⇒ **零诊断**地蒸发。
 *
 * - `@nudo:replaceFoo <target> <typeExpr>` ⇒ 既不匹配严格正则、也不匹配宽松
 *   正则 ⇒ 整条行内指令消失（连同它本该替换的类型）。
 *
 * 修复：粘连形态**看得见** ⇒ 发既有码 `nudo:directive-syntax`。
 *
 * ⚠ `@nudo:as` 侧**未改**：标签名被延长（`@nudo:asXYZ`）⇒ 不是 `@nudo:as`
 * 指令、且零诊断——族 28（Bug 842）已合入并钉死该行为
 * （`parser-bug-842-as-payload-separator.test.ts` 的「tag boundary」用例）⇒
 * 本片不推翻（越界发现，见交付报告）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractInlineDirectives, type DirectiveDiag } from "../directives.ts";

function extractInlineWithDiags(source: string) {
  const ast = parse(source);
  const stmt = (ast as any).program.body[0];
  const diags: DirectiveDiag[] = [];
  const dirs = extractInlineDirectives(stmt, { diags });
  return { dirs, diags };
}

describe("Bug 1032：行内指令的粘连形态必须发诊断", () => {
  it("@nudo:replaceFoo（粘连）→ nudo:directive-syntax，无指令", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:replaceFoo x number()
 */
const a = 1;`);
    expect(dirs.filter((d) => d.kind === "replace")).toHaveLength(0);
    expect(
      diags.some(
        (d) =>
          d.code === "nudo:directive-syntax" &&
          d.message.includes("Malformed @nudo:replace directive"),
      ),
    ).toBe(true);
  });

  it("@nudo:assume 不是 @nudo:as 的粘连形态（不误伤）", () => {
    const { dirs, diags } = extractInlineWithDiags(`/**
 * @nudo:assume d <= max
 */
const a = 1;`);
    expect(dirs.filter((d) => d.kind === "as")).toHaveLength(0);
    expect(diags).toHaveLength(0);
  });

  it("合法形态不回归（@nudo:as number() / @nudo:replace x number()）", () => {
    const as = extractInlineWithDiags(`/**
 * @nudo:as number()
 */
const a = 1;`);
    expect(as.dirs.filter((d) => d.kind === "as")).toHaveLength(1);
    expect(as.diags).toHaveLength(0);

    const rep = extractInlineWithDiags(`/**
 * @nudo:replace x number()
 */
const a = 1;`);
    expect(rep.dirs.filter((d) => d.kind === "replace")).toHaveLength(1);
    expect(rep.diags).toHaveLength(0);
  });
});

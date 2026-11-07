/**
 * Bug 968 —— 挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿
 * （假绿）。
 *
 * 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；strip
 * 的数组分支只删节点、**不搬运注释**，而 `SKIP_KEYS` 又让 pass 根本不进注释
 * 键 ⇒ 凡是挂在将被删除的语句上的指令都随该语句一起从产物里消失。
 *
 * 修法：在 `transformValue` 的数组分支里剔除 REMOVE 元素时把它的
 * `leadingComments` **转挂**到下一个幸存节点；并加「剥除前后指令条数比对」的
 * 兜底自检（report.directivesBefore / directivesAfter / directivesDropped）。
 */
import { describe, it, expect } from "vitest";
import { parseSource, stripTypes } from "../index.ts";

type Report = {
  directivesBefore?: number;
  directivesAfter?: number;
  directivesDropped?: boolean;
};

/** 剥除（keepTs 解析 ⇒ 自己调 stripTypes ⇒ 能拿到 report） */
const stripped = (src: string) => {
  const ast = parseSource(src, { keepTs: true });
  const report: Report = {};
  stripTypes(ast as never, src, { report });
  return { ast, report };
};

const leadingTexts = (node: unknown): string[] => {
  const rec = node as { leadingComments?: { value?: string }[] };
  return (rec.leadingComments ?? []).map((c) => c.value ?? "");
};

describe("Bug 968: 被删语句上的文件级指令被转挂到幸存节点", () => {
  it("指令挂在被删的 import type 上 ⇒ 转挂给下一个幸存语句", () => {
    const { ast } = stripped(
      `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `import type { Foo } from "./types.js";\n` +
        `export function inc(x) { return x + 1; }`,
    );
    const b = ast.program.body;
    expect(b).toHaveLength(1);
    expect(leadingTexts(b[0]).join("\n")).toContain("@nudo:import");
  });

  it("指令在幸存语句上（对照）⇒ 位置不变", () => {
    const { ast } = stripped(
      `import type { Foo } from "./types.js";\n` +
        `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `export function inc(x) { return x + 1; }`,
    );
    const b = ast.program.body;
    expect(leadingTexts(b[0]).join("\n")).toContain("@nudo:import");
  });

  it("剥除前后指令条数一致（兜底自检：directivesBefore === directivesAfter）", () => {
    const { report } = stripped(
      `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `import type { Foo } from "./types.js";\n` +
        `export function inc(x) { return x + 1; }`,
    );
    expect(report.directivesBefore).toBe(1);
    expect(report.directivesAfter).toBe(1);
    expect(report.directivesDropped).toBeFalsy();
  });

  it("全部文件级指令形态都走同一条转挂路径（@nudo:env / @nudo:mock-module）", () => {
    for (const directive of [
      "@nudo:import { positive } from \"./shapes.nudo.js\"",
      "@nudo:env node",
      "@nudo:mock-module \"./m.js\"",
    ]) {
      const { ast, report } = stripped(
        `/// ${directive}\nimport type { Foo } from "./types.js";\nexport const x = 1;`,
      );
      expect(leadingTexts(ast.program.body[0]).join("\n")).toContain(directive);
      expect(report.directivesBefore).toBe(1);
      expect(report.directivesAfter).toBe(1);
      expect(report.directivesDropped).toBeFalsy();
    }
  });

  it("被删语句在末尾 ⇒ 指令挂到最后一个幸存节点的尾部（不丢）", () => {
    const { ast, report } = stripped(
      `export function inc(x) { return x + 1; }\n` +
        `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `import type { Foo } from "./types.js";`,
    );
    const b = ast.program.body;
    expect(b).toHaveLength(1);
    const rec = b[0] as unknown as { trailingComments?: { value?: string }[] };
    expect((rec.trailingComments ?? []).map((c) => c.value ?? "").join("\n")).toContain(
      "@nudo:import",
    );
    expect(report.directivesAfter).toBe(report.directivesBefore);
  });

  it("无指令的源码 ⇒ 前后条数都是 0", () => {
    const { report } = stripped(`export const x = 1;`);
    expect(report.directivesBefore).toBe(0);
    expect(report.directivesAfter).toBe(0);
    expect(report.directivesDropped).toBeFalsy();
  });
});

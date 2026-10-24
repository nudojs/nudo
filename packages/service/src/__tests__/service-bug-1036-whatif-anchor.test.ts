/**
 * Bug 1036 回归：`injectBindings` 的**声明锚点**必须绑到「声明语句自身」，
 * 不能被上一条语句的**行尾注释**劫持。
 *
 * 病灶（Babel 注释挂载事实）：`const a = 1; // 说明` 的行尾注释**同时**被挂成
 * 下一条声明的 `leadingComments[0]` ⇒ 旧口径
 * `stmt.leadingComments?.[0]?.loc?.start.line` 把 `const b = 2;` 的锚点判成
 * **第 1 行** ⇒ 假设落到**另一个变量**（`alpha`）上，而回显仍说
 * 「Bindings applied: beta: string」⇒ 工具回答的是另一个问题（假成功）。
 *
 * 修法（packages/service/src/what-if.ts）：锚点改用语句自身所在行
 * （`stmt.loc.start.line`），注入点再按「前置注释块整块上移」处理。
 *
 * 负控制：行尾注释**不是**指令时不得被当成行内指令；未声明的名字仍进
 * `unapplied`。
 */
import { describe, it, expect } from "vitest";
import { injectBindings } from "../what-if.ts";

/** 注入的 `// @nudo:as` 所在行号（0 基） */
function asLineIndex(source: string): number {
  const idx = source.split("\n").findIndex((l) => l.includes("@nudo:as"));
  if (idx < 0) throw new Error("no @nudo:as injected");
  return idx;
}

describe("Bug 1036: 声明锚点不被行尾注释劫持", () => {
  const SRC = [
    "const alpha = 1; // alpha is the first",
    "const beta = 2;",
    "const gamma = 3;",
    "export const va = alpha;",
    "export const vb = beta;",
    "export const vg = gamma;",
    "",
  ].join("\n");

  it("假设落在被点名的声明**自己**的那一行（不是上一行）", () => {
    const { source, applied, unapplied } = injectBindings(SRC, [
      { name: "beta", type: "string" },
    ]);
    expect(unapplied).toEqual([]);
    expect(applied).toEqual(["beta: string"]);
    const at = asLineIndex(source);
    // 注入行的**下一行**必须是被点名的声明
    expect(source.split("\n")[at + 1]).toContain("const beta = 2;");
    // 不得落在 alpha 头上（alpha 是被劫持的落点）
    expect(source.split("\n")[at + 1]).not.toContain("const alpha");
  });

  it("负控制：行尾注释不是指令 ⇒ 不得被当成行内指令消费", () => {
    const { source } = injectBindings(SRC, [{ name: "gamma", type: "string" }]);
    const at = asLineIndex(source);
    expect(source.split("\n")[at + 1]).toContain("const gamma = 3;");
    // 注入点不得插到 alpha 那行（行尾注释所在行）
    expect(source.split("\n")[at]).not.toContain("const alpha");
  });

  it("负控制：不是顶层声明的名字仍进 unapplied", () => {
    const { applied, unapplied } = injectBindings(SRC, [
      { name: "nope", type: "string" },
    ]);
    expect(applied).toEqual([]);
    expect(unapplied).toEqual(["nope"]);
  });
});

describe("Bug 1036: 同一行多条声明——各落各的（行号口径会撞车）", () => {
  const SAME_LINE = `const delta = 10; const epsilon = 20;\nexport const ve = epsilon;\n`;

  it("点名的声明落在**自己**的前面（不被同行的前一条声明吃掉）", () => {
    const { source, applied, unapplied } = injectBindings(SAME_LINE, [
      { name: "epsilon", type: "string" },
    ]);
    expect(unapplied).toEqual([]);
    expect(applied).toEqual(["epsilon: string"]);
    // 注入点必须紧挨 epsilon（不是 delta）
    const at = source.indexOf("// @nudo:as");
    expect(source.slice(at)).toContain("const epsilon = 20;");
    const before = source.slice(0, at);
    expect(before).toContain("const delta = 10;");
    // 注入点不得在 delta 之前（那会把假设落到 delta 上）
    expect(before).not.toContain("@nudo:as");
  });

  it("同行两条声明各自被点名 ⇒ 两条都 applied（不再有「丢弃 + 编造理由」）", () => {
    const { applied, unapplied } = injectBindings(SAME_LINE, [
      { name: "delta", type: "number" },
      { name: "epsilon", type: "string" },
    ]);
    expect(unapplied).toEqual([]);
    expect(applied).toEqual(["delta: number", "epsilon: string"]);
  });
});

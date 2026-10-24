// emit-bug-562-bom-fidelity.test.ts — Bug 562（+ Bug 938 的 case-emitter 侧）：
//
// 562：`nudo test --freeze` 的**源码写回**摧毁 UTF-8 BOM ⇒ BOM 从文件首字节
//      被挪到文件中段（`export` 那一行）⇒ 文件不再是「UTF-8 with BOM」，
//      而 BOM 以 U+FEFF 零宽字符的形式夹在源码中间。
// 938（case-emitter 侧）：diff 的**行内容**里出现 BOM ⇒ 「只有 BOM 不同」被
//      渲染成一处内容变更（`--exit-on-diff` 假红 / diff 噪音）。
//
// 不变量：写回只增不改 ⇒ BOM 留在**文件最前**、全文只有一枚、且不进 diff 内容。
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import {
  insertGeneratedCaseDirectives,
  stripGeneratedCaseDirectives,
  unifiedDiff,
} from "../case-emitter.ts";

const BOM = "\uFEFF";

/** 全文 BOM 计数 */
function bomCount(text: string): number {
  return text.split(BOM).length - 1;
}

/** 有顶层调用点 ⇒ 固化会真的写回（有 callsite 见证） */
const SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

describe("Bug 562 — 固化写回保住 UTF-8 BOM 的位置", () => {
  it("BOM 仍在文件最前（不被挪到文件中段），全文只有一枚", () => {
    const src = BOM + SRC;
    const analysis = analyzeFile("/test/bom.js", src);
    const out = insertGeneratedCaseDirectives(src, analysis);

    expect(out.changed).toBe(true);
    expect(out.source.startsWith(BOM)).toBe(true);
    expect(bomCount(out.source)).toBe(1);
    // 首行之后不再出现 BOM（BOM 没跟着首行下移到 `export` 那一行）
    const afterFirstLine = out.source.slice(out.source.indexOf("\n") + 1);
    expect(afterFirstLine.includes(BOM)).toBe(false);
    // 声明行回到「没有 BOM 贴着」的形态（BOM 只在文件最前）
    expect(out.source.split("\n").some((l) => l === "export function add(a, b) {")).toBe(true);
  });

  it("BOM 不被当成缩进抄进新插入的 JSDoc 块（\\s 含 U+FEFF）", () => {
    const src = BOM + SRC;
    const analysis = analyzeFile("/test/bom.js", src);
    const out = insertGeneratedCaseDirectives(src, analysis);

    const block = out.source.split("\n").filter((l) => l.includes("@nudo:case"));
    expect(block.length).toBe(1);
    expect(block[0]!.includes(BOM)).toBe(false);
  });

  it("剥离已生成指令时 BOM 不丢（首行整块被删也不丢）", () => {
    const src = `${BOM}/**
 * @nudo:case "call@L1" (1, 2)
 */
export function add(a, b) {
  return a + b;
}
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(src);
    expect(removed).toEqual(["call@L1"]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(bomCount(out)).toBe(1);
  });

  it("负控制：手写 case（无 call@ 命名）不动，BOM 也不动", () => {
    const src = `${BOM}/**
 * @nudo:case "manual" (1)
 */
export function add(a, b) {
  return a + b;
}
`;
    const { source: out, removed } = stripGeneratedCaseDirectives(src);
    expect(removed).toEqual([]);
    expect(out).toBe(src);
  });
});

describe("Bug 938（case-emitter 侧）— diff 字节保真（BOM 留在行内容里）", () => {
  it("两侧都带 BOM ⇒ 首行是公共行（无内容差异）", () => {
    expect(unifiedDiff(`${BOM}a\nb\n`, `${BOM}a\nb\n`, "t.txt")).toBe("");
    expect(unifiedDiff(`${BOM}a\nb\n`, `${BOM}a\nB\n`, "t.txt")).not.toContain("-a");
  });

  it("只有一侧带 BOM ⇒ 首行如实呈现为内容差异（不谎报「无改动」）", () => {
    // BOM 被发射器吃掉是**真实**的字节改动 ⇒ diff 必须看得见（把 BOM 藏起来
    // 会让「文件被重写」这件事变成空 diff = 谎报无改动）。
    const d = unifiedDiff(`${BOM}a\nb\n`, "a\nb\n", "t.txt");
    expect(d).toContain(`-${BOM}a`);
    expect(d).toContain("+a");
  });

  it("diff 的首行保留 BOM（native git 同形：上下文行含 BOM，补丁才贴得上）", () => {
    const d = unifiedDiff(`${BOM}a\nb\n`, `${BOM}a\nB\n`, "t.txt");
    expect(d).toContain(` ${BOM}a`);
  });
});

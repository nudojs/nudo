// emit-bug-563-crlf-fidelity.test.ts — Bug 563：
//
// `nudo test --freeze` 的源码写回把 **CRLF 文件改成混合行尾**（新插入的行用
// LF、原行保留 CRLF）⇒ `file(1)` 的判定从「with CRLF line terminators」变成
// 「with CRLF, LF line terminators」⇒ 文件的行尾属性被静默改写。
//
// 不变量：固化**只增不改** ⇒ 写回后源文件的行尾约定不变（纯 CRLF 仍是纯
// CRLF、纯 LF 仍是纯 LF），且原行逐字节不动。
//
// 注：根因行（写回时新插入的行不带 "\r"）由同文件 S9 分片的 Bug 547 修法
// 关闭（新行沿用**源文件的主导行尾**）；本文件是它的**回归钉**（不宣称新修）。
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { insertGeneratedCaseDirectives } from "../case-emitter.ts";

/** 有顶层调用点 ⇒ 固化会真的写回（有 callsite 见证） */
const LF_SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;
const CRLF_SRC = LF_SRC.replace(/\n/g, "\r\n");

/** 裸 LF（不含 CRLF）计数 */
function bareLfCount(text: string): number {
  return text.split("\n").length - 1 - (text.split("\r\n").length - 1);
}

/** 原行是否**逐字节**仍在输出里（按顺序出现的子序列） */
function keepsOriginalLines(original: string, output: string): boolean {
  const src = original.split("\n");
  const out = output.split("\n");
  let i = 0;
  for (const line of out) {
    if (i < src.length && line === src[i]) i++;
  }
  return i === src.length;
}

describe("Bug 563 — 固化写回不改源文件的行尾约定", () => {
  it("CRLF 源文件写回后仍是纯 CRLF（新插入的行不带裸 LF）", () => {
    const analysis = analyzeFile("/test/crlf.js", CRLF_SRC);
    const out = insertGeneratedCaseDirectives(CRLF_SRC, analysis);

    expect(out.changed).toBe(true);
    expect(bareLfCount(out.source)).toBe(0);
    // 原有的行逐字节不动
    expect(keepsOriginalLines(CRLF_SRC, out.source)).toBe(true);
  });

  it("负控制：LF 源文件写回后仍是纯 LF（不得被改成 CRLF）", () => {
    const analysis = analyzeFile("/test/lf.js", LF_SRC);
    const out = insertGeneratedCaseDirectives(LF_SRC, analysis);

    expect(out.changed).toBe(true);
    expect(out.source.includes("\r\n")).toBe(false);
    expect(keepsOriginalLines(LF_SRC, out.source)).toBe(true);
  });

  it("CRLF + 末行无终止符：行尾仍是纯 CRLF，末尾仍无换行", () => {
    const src = "export function add(a, b) {\r\n  return a + b;\r\n}\r\nconst x = add(1, 2);";
    const analysis = analyzeFile("/test/crlf-eof.js", src);
    const out = insertGeneratedCaseDirectives(src, analysis);

    expect(out.changed).toBe(true);
    expect(bareLfCount(out.source)).toBe(0);
    expect(out.source.endsWith("const x = add(1, 2);")).toBe(true);
    expect(out.source.endsWith("\n")).toBe(false);
  });

  it("负控制：文件末尾有无换行不变（LF + 有末尾换行）", () => {
    const analysis = analyzeFile("/test/lf-eol.js", LF_SRC);
    const out = insertGeneratedCaseDirectives(LF_SRC, analysis);

    expect(out.source.endsWith("\n")).toBe(true);
    expect(out.source.endsWith("\n\n")).toBe(false);
  });
});

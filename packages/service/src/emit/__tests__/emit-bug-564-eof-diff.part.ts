// emit-bug-564-eof-diff.test.ts — Bug 564：
//
// 源文件**末尾缺少换行**时，`nudo test --freeze --dry-run` 产出的 unified diff
// **不可 apply**（缺 `\ No newline at end of file` 标记 + EOF 行模型多算一格）
// ⇒ `git apply --check -p1` exit 1；而末尾有换行的同一文件完全正常（exit 0）。
//
// 不变量：产出的 diff 必须能被 `git apply` 接受 ⇒ 行模型与 native `diff -u` /
// `git diff` 同口径（末行无终止符 ⇒ 输出标记；末尾有无换行本身是内容差异）。
//
// 本文件同时是**字节保真族**的四形态验收矩阵：
//   ① LF + 有末尾换行 ② LF + 无末尾换行 ③ CRLF ④ UTF-8 BOM
// 每形态都断言：行尾属性不变 / BOM 位置不变 / 末尾换行不变 / diff 可 apply。
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile } from "@nudojs/service";
import { insertGeneratedCaseDirectives, unifiedDiff } from "../case-emitter.ts";

const BOM = "\uFEFF";

/** 有顶层调用点 ⇒ 固化会真的写回（有 callsite 见证） */
const LF_SRC = `export function add(a, b) {
  return a + b;
}
const x = add(1, 2);
`;

const FORMS: Array<{ label: string; source: string; bom: boolean; crlf: boolean; eof: boolean }> = [
  { label: "LF + 有末尾换行", source: LF_SRC, bom: false, crlf: false, eof: true },
  { label: "LF + 无末尾换行", source: LF_SRC.replace(/\n$/, ""), bom: false, crlf: false, eof: false },
  { label: "CRLF", source: LF_SRC.replace(/\n/g, "\r\n"), bom: false, crlf: true, eof: true },
  { label: "UTF-8 BOM", source: BOM + LF_SRC, bom: true, crlf: false, eof: true },
];

/** 裸 LF（不含 CRLF）计数 */
function bareLfCount(text: string): number {
  return text.split("\n").length - 1 - (text.split("\r\n").length - 1);
}

/** git 是否可用（不可用时跳过 apply 断言） */
function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 把 unifiedDiff 的产物丢给 `git apply --check -p1`（在临时目录里对着真实
 * 文件）⇒ 补丁可被 git 接受。
 */
function gitApplyAccepts(oldSource: string, newSource: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "nudo-diff-"));
  writeFileSync(join(dir, "lib.js"), oldSource, "utf-8");
  const patch = unifiedDiff(oldSource, newSource, "lib.js");
  try {
    execFileSync("git", ["apply", "--check", "-p1"], { cwd: dir, input: patch, stdio: ["pipe", "ignore", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

describe("Bug 564 — 末行无终止符的 diff 可被 git apply 接受", () => {
  it("末行没有换行时输出 `\\ No newline at end of file` 标记（native diff 同口径）", () => {
    const a = "const x = add(1, 2);\nexport function add(a, b) {\n  return a + b;\n}";
    const b = "const x = add(1, 2);\n/**\n * @nudo:case \"call@L1\" (1, 2)\n */\nexport function add(a, b) {\n  return a + b;\n}";
    const d = unifiedDiff(a, b, "t.txt");

    expect(d).toContain("\\ No newline at end of file");
    // hunk 头与 native `diff -u` 同口径（-1,4 +1,7）
    expect(d).toContain("@@ -1,4 +1,7 @@");
    // 标记紧跟在末行之后
    const lines = d.split("\n");
    expect(lines[lines.length - 3]).toBe(" }");
    expect(lines[lines.length - 2]).toBe("\\ No newline at end of file");
  });

  it("末行有换行时不输出标记（负控制）", () => {
    const d = unifiedDiff("a\nb\n", "a\nB\n", "t.txt");
    expect(d).not.toContain("No newline at end of file");
  });

  it("末尾换行的有无本身是内容差异（与 native diff 同口径）", () => {
    const d = unifiedDiff("a\nb\n", "a\nb", "t.txt");
    expect(d).toContain("-b");
    expect(d).toContain("+b");
    expect(d).toContain("\\ No newline at end of file");
  });

  it("行数不多算一格：末尾有换行的文件不产生 phantom 末行", () => {
    // "a\nb\n" 的真实行数是 2（不是 3）⇒ 纯插入的 hunk 头是 -1,2 +1,3
    const d = unifiedDiff("a\nb\n", "new\na\nb\n", "t.txt");
    expect(d).toContain("@@ -1,2 +1,3 @@");
  });
});

describe("字节保真四形态矩阵（写回只增不改 + diff 可 apply）", () => {
  for (const form of FORMS) {
    it(`${form.label}：行尾/BOM/末尾换行不变，且 diff 可被 git apply 接受`, () => {
      const analysis = analyzeFile("/test/matrix.js", form.source);
      const out = insertGeneratedCaseDirectives(form.source, analysis);
      expect(out.changed).toBe(true);

      // ① 行尾属性不变
      if (form.crlf) {
        expect(bareLfCount(out.source)).toBe(0);
        expect(out.source.includes("\r\n")).toBe(true);
      } else {
        expect(out.source.includes("\r\n")).toBe(false);
      }
      // ② BOM 位置不变（BOM 只在文件最前、全文一枚）
      expect(out.source.startsWith(BOM)).toBe(form.bom);
      expect(out.source.split(BOM).length - 1).toBe(form.bom ? 1 : 0);
      // ③ 末尾换行不变
      expect(out.source.endsWith("\n")).toBe(form.eof);

      // ④ diff 可被 git apply 接受
      if (hasGit()) {
        expect(gitApplyAccepts(form.source, out.source)).toBe(true);
      }
    });
  }
});

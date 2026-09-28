/**
 * string-aware 扫描基元：指令住注释、字符串里的同形文本不算。
 * hasNudoDirectives / generalize 门禁 / migrate tsc / sidecar-insert /
 * findModuleImportLoc 共用这一层——基元错了下游全错。
 */
import { describe, it, expect } from "vitest";
import {
  maskCommentsAndStrings,
  scanStringLiterals,
  stripCommentsAndStrings,
  stripStringsKeepComments,
} from "../code-text.ts";

describe("stripStringsKeepComments", () => {
  it("blanks string literals but keeps comment text", () => {
    const s = `const x = "@nudo:case";\n// @nudo:case real\n`;
    const out = stripStringsKeepComments(s);
    expect(out).not.toContain("@nudo:case\""); // string body gone
    expect(out).toContain("// @nudo:case real");
  });

  it("blanks template literals", () => {
    const out = stripStringsKeepComments("const x = `@nudo:pure`;");
    expect(out).not.toContain("@nudo:pure");
  });

  it("keeps JSDoc directive tags", () => {
    const out = stripStringsKeepComments("/**\n * @nudo:skip\n */\nfunction f() {}");
    expect(out).toContain("@nudo:skip");
  });

  it("string with // is not a comment (single-pass)", () => {
    const out = stripStringsKeepComments(`const u = "https://x"; // real\nexport const y = 1;`);
    expect(out).toContain("// real");
    expect(out).toContain("export const y = 1;");
  });
});

describe("maskCommentsAndStrings", () => {
  it("is length-preserving so offsets stay valid", () => {
    const s = `fn({ url: "http://x" }); // fn({`;
    const m = maskCommentsAndStrings(s);
    expect(m).toHaveLength(s.length);
    expect(m.indexOf("fn(")).toBe(0);
    // second fn( is inside comment → gone
    expect(m.indexOf("fn(")).toBe(m.lastIndexOf("fn("));
  });

  it("keeps newlines so line numbers align", () => {
    const s = `a\n/* c1\nc2 */\nb`;
    const m = maskCommentsAndStrings(s);
    expect(m.split("\n")).toHaveLength(s.split("\n").length);
  });

  it("blanks brace inside string so brace-counting is code-only", () => {
    const s = `fn({ desc: "}" });`;
    const m = maskCommentsAndStrings(s);
    expect(m).toHaveLength(s.length);
    // "}" 整段变空格：只剩外层 { } 可数
    expect(m.replace(/ /g, "")).toBe("fn({desc:});");
  });
});

describe("scanStringLiterals", () => {
  it("finds code-region strings and skips comment quotes", () => {
    const s = `// "not-this"\nconst a = "fs";\nrequire('path');`;
    const lits = scanStringLiterals(s);
    expect(lits.map((l) => l.value)).toEqual(["fs", "path"]);
  });

  it("reports start/length covering both quotes", () => {
    const s = `x("ab")`;
    const lit = scanStringLiterals(s)[0]!;
    expect(s.slice(lit.start, lit.start + lit.length)).toBe('"ab"');
  });
});

describe("stripCommentsAndStrings (existing contract)", () => {
  it("still blanks both comments and strings", () => {
    const out = stripCommentsAndStrings(`// cmt\nconst x = "str";`);
    expect(out).not.toContain("cmt");
    expect(out).not.toContain("str");
  });
});

/**
 * string-aware 扫描基元：指令住注释、字符串里的同形文本不算。
 * hasNudoDirectives / generalize 门禁 / migrate tsc / sidecar-insert /
 * findModuleImportLoc 共用这一层——基元错了下游全错。
 */
import { describe, it, expect } from "vitest";
import {
  maskCommentsAndStrings,
  scanStringLiterals,
  sourceHasCjsExports,
  sourceHasModuleDependency,
  sourceHasRequireCall,
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

describe("template interpolation is a code island", () => {
  it("keeps require() inside ${} visible to probes", () => {
    expect(sourceHasRequireCall('`${require("fs")}`')).toBe(true);
    expect(sourceHasRequireCall("`${require('fs')}`")).toBe(true);
  });

  it("still ignores require in cooked template text", () => {
    expect(sourceHasRequireCall("const s = `require(\"fs\")`;")).toBe(false);
    expect(sourceHasRequireCall("const s = `a require(\"fs\") b`;")).toBe(false);
  });

  it("nested templates stay aligned and do not swallow following code", () => {
    expect(
      sourceHasRequireCall("const s = `a${`b${c}`}d`; require(\"fs\");"),
    ).toBe(true);
    // 嵌套 cooked 文本不算代码；插值里的 c 可见
    expect(stripCommentsAndStrings("`${`b${c}`}d`")).toContain("c");
    expect(stripCommentsAndStrings("`${`b${c}`}d`")).not.toContain("b");
    expect(stripCommentsAndStrings("`${`b${c}`}d`")).not.toContain("d");
  });

  it("directive text in cooked template is still blanked", () => {
    expect(stripStringsKeepComments("const x = `@nudo:pure`;")).not.toContain("@nudo:pure");
  });
});

describe("regex literals do not open comments or leak into probes", () => {
  it("trailing // inside a regex does not start a line comment", () => {
    expect(
      sourceHasRequireCall("const re = /https?:\\/\\//; require(\"fs\");"),
    ).toBe(true);
  });

  it("regex body is not module-dependency / exports surface", () => {
    expect(sourceHasModuleDependency("const re = /import *from/;")).toBe(false);
    expect(sourceHasCjsExports("const x = /exports\\./; // exports.a")).toBe(false);
  });

  it("division is not treated as regex", () => {
    expect(sourceHasRequireCall("const x = a / b / c;")).toBe(false);
    // 若把 `/` 当 regex 开到行尾/EOF，后面的 require 会被吞进 regex 体
    expect(sourceHasRequireCall("const x = a / b; require(\"fs\");")).toBe(true);
    expect(sourceHasCjsExports("const x = a / b; // exports.a")).toBe(false);
    // 真注释仍吃掉后续
    expect(sourceHasRequireCall("const x = a / b; // require(\"fs\")")).toBe(false);
  });

  it("regex after return/=/( is still a regex", () => {
    expect(stripCommentsAndStrings("return /https?:\\/\\//; x")).toContain("x");
    expect(stripCommentsAndStrings("const r = /a/; x")).toContain("x");
    expect(stripCommentsAndStrings("f(/import *from/); x")).toContain("x");
  });
});

describe("mask/scan stay consistent with interpolation + regex", () => {
  it("mask keeps interpolation code and drops cooked text / regex body", () => {
    const s = "fn(`${a}`, /import *from/);";
    const m = maskCommentsAndStrings(s);
    expect(m).toHaveLength(s.length);
    expect(m).toContain("a");
    expect(m).not.toContain("import");
  });

  it("scanStringLiterals skips interpolated templates and regex", () => {
    const s = "x(`a${y}b`, /re/, \"ok\");";
    const lits = scanStringLiterals(s);
    expect(lits.map((l) => l.value)).toEqual(["ok"]);
  });

  it("scanStringLiterals still reports simple templates", () => {
    const s = "x(`fs`);";
    expect(scanStringLiterals(s).map((l) => l.value)).toEqual(["fs"]);
  });
});

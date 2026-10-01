/**
 * BUG-015 S4-004 回归：scanCaseTags / 文件级扫描的标签-载荷**同行分隔**。
 * 旧 `\s+`/`\s*` 可跨行：空 `@nudo:case` 标签把下一行内容粘成合法 case，
 * 未闭合名引号把下一行粘进名字，`//` 行注释把非注释行的 `@nudo:env` 粘成指令。
 * 多行 case 实参仍由 extractBalancedParens 单独支撑，不受影响。
 */
import { describe, it, expect } from "vitest";
import { scanCaseTags, scanCaseArgSpans, extractFileEnvNames, extractMockModuleRecords } from "../directive-scan.ts";

describe("scanCaseTags same-line separation (BUG-015 S4-004)", () => {
  it("empty tag does not glue the next line into a case", () => {
    expect(scanCaseTags("\n@nudo:case\n\"evil\" (1)\n")).toHaveLength(0);
  });

  it("name quote cannot span lines (no next-line attribution)", () => {
    const tags = scanCaseTags("\n@nudo:case \"a\n * @nudo:case \"b\" (1)\n");
    expect(tags.map((t) => t.name)).toEqual(["b"]);
  });

  it("argument paren must open on the tag line", () => {
    expect(scanCaseTags("\n@nudo:case \"a\"\n(1)\n")).toHaveLength(0);
  });

  it("multi-line arguments still parse (paren closed on a later line)", () => {
    const text = "\n * @nudo:case \"a\" (\n *   1,\n *   2\n * )\n";
    const tags = scanCaseTags(text);
    expect(tags.map((t) => t.name)).toEqual(["a"]);
    expect(tags[0]!.argsText).toContain("1,");
    expect(scanCaseArgSpans(text)).toHaveLength(1);
  });

  it("/// line-comment form still recognized", () => {
    expect(scanCaseTags("/ @nudo:case \"d\" (1)").map((t) => t.name)).toEqual(["d"]);
  });
});

describe("file-level line-comment scans stay on one line (BUG-015 S4-004 family)", () => {
  it("extractFileEnvNames does not glue a non-comment next line", () => {
    expect(extractFileEnvNames("//\n@nudo:env es\n")).toEqual([]);
  });

  it("extractFileEnvNames still reads same-line payload", () => {
    expect(extractFileEnvNames("// @nudo:env es\n")).toEqual(["es"]);
  });

  it("extractMockModuleRecords does not glue a non-comment next line", () => {
    expect(extractMockModuleRecords("//\n@nudo:mock-module \"s\" from \"./m.nudo.js\"\n")).toEqual([]);
  });

  it("extractMockModuleRecords still reads same-line payload", () => {
    const recs = extractMockModuleRecords("// @nudo:mock-module \"s\" from \"./m.nudo.js\"\n");
    expect(recs.map((r) => r.source)).toEqual(["s"]);
  });
});

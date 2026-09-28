/**
 * 指令扫描器不得把 `\` 当转义——parseCaseArgExpr 是原样 slice
 * （不反转义），`"foo\"` 表示值 `foo\`，不是未闭合字符串。
 */
import { describe, it, expect } from "vitest";
import { parseCaseArgExpr, parse, extractDirectives } from "@nudojs/parser";
import { litValue, strLit, numLit } from "@nudojs/core";
import { serializeCaseArg, buildCaseDirective } from "../emit/case-emitter.ts";

describe("case string round-trip with backslash", () => {
  it("trailing backslash round-trips", () => {
    const s = serializeCaseArg(strLit("foo\\"));
    expect(s).not.toBeNull();
    const back = parseCaseArgExpr(s!);
    expect(litValue(back)).toBe("foo\\");
  });

  it("buildCaseDirective with trailing backslash re-parses", () => {
    const line = buildCaseDirective("t", [strLit("C:\\"), numLit(1)]);
    expect(line).toBeTruthy();
    const m = line!.match(/\((.*)\)$/);
    expect(m).toBeTruthy();
    const args = m![1]!.split(",").map((p) => parseCaseArgExpr(p.trim()));
    expect(litValue(args[0]!)).toBe("C:\\");
    expect(litValue(args[1]!)).toBe(1);
  });

  it("directive with backslash value is extracted", () => {
    const src = `
/**
 * @nudo:case "t" ("foo\\")
 */
export function f(a) { return a; }
`;
    const file = parse(src);
    const found = extractDirectives(file);
    const cases = found.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases.length).toBe(1);
    const argsAbs = (cases[0] as { argsAbs: { term?: { value?: unknown } }[] }).argsAbs;
    expect(litValue(argsAbs[0]! as never)).toBe("foo\\");
  });
});

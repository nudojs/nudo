/**
 * case 字符串的 `serialize → parse` 往返（含反斜杠）。
 *
 * ★ 族 28 接线（Bug 840）：指令文法改为**解释 JS 转义**（parser 的
 * `scanStringLiteral` 取 Babel 的 cooked 值）⇒
 *  - 序列化侧**转义** `\`（值 `foo\` ⇒ 指令文本 `"foo\\"`）；
 *  - 解析侧把 `"foo\\"` 读成值 `foo\`。
 * 旧契约（`\` 不当转义、原样 slice）已随族 28 废止 ——
 * 旧契约下 `"foo\"` 表示值 `foo\`，那会让 `serialize → parse` 往返失真。
 */
import { describe, it, expect } from "vitest";
import { parseCaseArgExpr, parse, extractDirectives } from "@nudojs/parser";
import { litValue, strLit, numLit } from "@nudojs/core";
import { serializeCaseArg, buildCaseDirective } from "../emit/case-emitter.ts";

describe("case string round-trip with backslash", () => {
  it("trailing backslash round-trips", () => {
    const s = serializeCaseArg(strLit("foo\\"));
    expect(s).not.toBeNull();
    // 序列化必须转义 `\`：指令文本是 `"foo\\"`（两个反斜杠）
    expect(s).toBe('"foo\\\\"');
    const back = parseCaseArgExpr(s!);
    expect(litValue(back)).toEqual({ ok: true, value: "foo\\" });
  });

  it("buildCaseDirective with trailing backslash re-parses", () => {
    const line = buildCaseDirective("t", [strLit("C:\\"), numLit(1)]);
    expect(line).toBeTruthy();
    const m = line!.match(/\((.*)\)$/);
    expect(m).toBeTruthy();
    const args = m![1]!.split(",").map((p) => parseCaseArgExpr(p.trim()));
    expect(litValue(args[0]!)).toEqual({ ok: true, value: "C:\\" });
    expect(litValue(args[1]!)).toEqual({ ok: true, value: 1 });
  });

  it("directive with backslash value is extracted", () => {
    const src = `
/**
 * @nudo:case "t" ("foo\\\\")
 */
export function f(a) { return a; }
`;
    const file = parse(src);
    const found = extractDirectives(file);
    const cases = found.flatMap((f) => f.directives.filter((d) => d.kind === "case"));
    expect(cases.length).toBe(1);
    const argsAbs = (cases[0] as { argsAbs: { term?: { value?: unknown } }[] }).argsAbs;
    expect(litValue(argsAbs[0]! as never)).toEqual({ ok: true, value: "foo\\" });
  });

  it("truncated literal is not a value (fail-closed)", () => {
    // `"foo\"` 在新契约下是**截断**字面量 ⇒ 不认识（不是值 `foo\`）
    const back = parseCaseArgExpr('"foo\\"');
    expect(litValue(back).ok).toBe(false);
  });
});

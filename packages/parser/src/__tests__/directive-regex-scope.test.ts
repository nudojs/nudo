/**
 * 指令正则不得匹配 case 参数字符串或文档散文。
 * 回归背景：PURE/SKIP/SAMPLE 对整个 comment 文本跑正则——
 * `@nudo:case "g" ("@nudo:skip")` 会额外产出 skip 指令，函数被跳过；
 * 文档里写 "Mentioning @nudo:skip" 也会标记 skipped。
 * 同类：SKIP_REGEX 缺词边界，`@nudo:skipped` 也会命中。
 */
import { describe, it, expect } from "vitest";
import { parse, extractDirectives } from "../index.ts";

function dirs(src: string) {
  const file = parse(src);
  return extractDirectives(file);
}

describe("directive regexes ignore case args and prose", () => {
  it("case arg string @nudo:skip does not create skip directive", () => {
    const src = `
/**
 * @nudo:case "g" ("@nudo:skip")
 */
export function g(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("case");
    expect(kinds).not.toContain("skip");
  });

  it("case arg string @nudo:pure does not mark pure", () => {
    const src = `
/**
 * @nudo:case "g" ("@nudo:pure")
 */
export function g(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).not.toContain("pure");
  });

  it("prose mentioning @nudo:skip does not skip the function", () => {
    const src = `
/**
 * Adds numbers. Mentioning @nudo:skip in docs should not disable it.
 */
export function add(a, b) { return a + b; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).not.toContain("skip");
    expect(kinds).not.toContain("pure");
  });

  it("real @nudo:skip tag at line start still works", () => {
    const src = `
/**
 * @nudo:skip
 */
export function f() { return 1; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("skip");
  });

  it("real @nudo:pure tag at line start still works", () => {
    const src = `
/**
 * @nudo:pure
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("pure");
  });

  it("@nudo:skipped is not a skip directive (word boundary)", () => {
    const src = `
/**
 * @nudo:skipped
 */
export function f() { return 1; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).not.toContain("skip");
  });

  it("@nudo:sample tag still works", () => {
    const src = `
/**
 * @nudo:sample 3
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("sample");
  });

  it("case name containing skip text is fine", () => {
    const src = `
/**
 * @nudo:case "my skip case" (1)
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("case");
    expect(kinds).not.toContain("skip");
  });

  it("case arg string @nudo:case does not fabricate a second case", () => {
    const src = `
/**
 * @nudo:case "outer" ("@nudo:case \\"inner\\" (1)")
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const cases = d.flatMap((f) => f.directives.filter((x) => x.kind === "case"));
    expect(cases).toHaveLength(1);
  });

  it("prose mentioning @nudo:case does not create a case", () => {
    const src = `
/**
 * Docs: write @nudo:case "n" (1) to add a case.
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).not.toContain("case");
  });

  it("prose mentioning @nudo:mock does not create a mock", () => {
    const src = `
/**
 * Docs: @nudo:mock x = 1 is how you mock.
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).not.toContain("mock");
  });

  it("real @nudo:mock tag at line start still works", () => {
    const src = `
/**
 * @nudo:mock x = 1
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("mock");
  });

  it("real @nudo:case tag at line start still works", () => {
    const src = `
/**
 * @nudo:case "real" (1)
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("case");
  });

  it("directives inside multi-line case args do not leak", () => {
    const src = `
/**
 * @nudo:case "t" (
 * @nudo:pure
 * @nudo:skip
 * @nudo:mock g = 1
 * )
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toEqual(["case"]);
  });

  it("multi-line case args containing @nudo:pure does not mark pure", () => {
    const src = `
/**
 * @nudo:case "t" (
 * @nudo:pure
 * )
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("case");
    expect(kinds).not.toContain("pure");
  });

  it("multi-line case args containing @nudo:skip does not skip", () => {
    const src = `
/**
 * @nudo:case "t" (
 * @nudo:skip
 * )
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("case");
    expect(kinds).not.toContain("skip");
  });

  it("multi-line case args containing @nudo:mock does not create mock", () => {
    const src = `
/**
 * @nudo:case "t" (
 * @nudo:mock g = 1
 * )
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("case");
    expect(kinds).not.toContain("mock");
  });

  it("nested @nudo:case inside multi-line case args does not fabricate a second case", () => {
    const src = `
/**
 * @nudo:case "t" (
 *   1
 *   @nudo:case "inner" (9)
 * )
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const cases = d.flatMap((f) => f.directives.filter((x) => x.kind === "case"));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.kind === "case" && cases[0].name).toBe("t");
  });

  it("sibling cases after a multi-line case still work", () => {
    const src = `
/**
 * @nudo:case "t" (
 *   1
 * )
 * @nudo:case "inner" (9)
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const cases = d.flatMap((f) => f.directives.filter((x) => x.kind === "case"));
    expect(cases).toHaveLength(2);
  });

  it("real @nudo:pure after multi-line case args still works", () => {
    const src = `
/**
 * @nudo:case "t" (
 *   1
 * )
 * @nudo:pure
 */
export function f(x) { return x; }
`;
    const d = dirs(src);
    const kinds = d.flatMap((f) => f.directives.map((x) => x.kind));
    expect(kinds).toContain("case");
    expect(kinds).toContain("pure");
  });
});

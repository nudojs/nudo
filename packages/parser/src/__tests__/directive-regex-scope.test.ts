/**
 * 指令正则的识别边界：只认行首标签；case 参数、散文、多行参数里的同形文本
 * 不得伪造指令；真实标签与多行参数后的兄弟标签仍生效。
 */
import { describe, it, expect } from "vitest";
import { parse, extractDirectives } from "../index.ts";

const kindsOf = (src: string) =>
  extractDirectives(parse(src)).flatMap((f) => f.directives.map((d) => d.kind));
const casesOf = (src: string) =>
  extractDirectives(parse(src)).flatMap((f) => f.directives.filter((d) => d.kind === "case"));

type Pollution = {
  src: string;
  forbidden?: string[];
  required?: string[];
  caseCount?: number;
  caseName?: string;
};

const POLLUTION_CASES: { name: string; cases: Pollution[] }[] = [
  {
    name: "case 参数字符串里的标签",
    cases: [
      { src: `/**\n * @nudo:case "g" ("@nudo:skip")\n */\nexport function g(x) { return x; }`, forbidden: ["skip"], required: ["case"] },
      { src: `/**\n * @nudo:case "g" ("@nudo:pure")\n */\nexport function g(x) { return x; }`, forbidden: ["pure"], required: ["case"] },
    ],
  },
  {
    name: "文档散文里的标签",
    cases: [
      { src: `/**\n * Adds numbers. Mentioning @nudo:skip in docs should not disable it.\n */\nexport function add(a, b) { return a + b; }`, forbidden: ["skip", "pure"] },
      { src: `/**\n * Docs: write @nudo:case "n" (1) to add a case.\n */\nexport function f(x) { return x; }`, forbidden: ["case"] },
      { src: `/**\n * Docs: @nudo:mock x = 1 is how you mock.\n */\nexport function f(x) { return x; }`, forbidden: ["mock"] },
    ],
  },
  {
    name: "标签词边界",
    cases: [{ src: `/**\n * @nudo:skipped\n */\nexport function f() { return 1; }`, forbidden: ["skip"] }],
  },
  {
    name: "case 名称含 skip 文本",
    cases: [{ src: `/**\n * @nudo:case "my skip case" (1)\n */\nexport function f(x) { return x; }`, required: ["case"], forbidden: ["skip"] }],
  },
  {
    name: "多行 case 参数内的标签不泄漏",
    cases: [
      { src: `/**\n * @nudo:case "t" (\n * @nudo:pure\n * )\n */\nexport function f(x) { return x; }`, required: ["case"], forbidden: ["pure"] },
      { src: `/**\n * @nudo:case "t" (\n * @nudo:skip\n * )\n */\nexport function f(x) { return x; }`, required: ["case"], forbidden: ["skip"] },
      { src: `/**\n * @nudo:case "t" (\n * @nudo:mock g = 1\n * )\n */\nexport function f(x) { return x; }`, required: ["case"], forbidden: ["mock"] },
      {
        src: `/**\n * @nudo:case "t" (\n *   1\n *   @nudo:case "inner" (9)\n * )\n */\nexport function f(x) { return x; }`,
        required: ["case"],
        caseCount: 1,
        caseName: "t",
      },
    ],
  },
];

describe("指令正则忽略参数/散文/多行参数", () => {
  it.each(POLLUTION_CASES)("$name", ({ cases }) => {
    for (const { src, forbidden = [], required = [], caseCount, caseName } of cases) {
      const kinds = kindsOf(src);
      for (const kind of forbidden) expect(kinds, `伪造 ${kind}: ${src}`).not.toContain(kind);
      for (const kind of required) expect(kinds, `缺 ${kind}: ${src}`).toContain(kind);
      if (caseCount !== undefined) expect(casesOf(src)).toHaveLength(caseCount);
      if (caseName !== undefined) expect(casesOf(src)[0]?.kind === "case" && casesOf(src)[0].name).toBe(caseName);
    }
  });
});

const REAL_TAGS = [
  { tag: "skip", src: `/**\n * @nudo:skip\n */\nexport function f() { return 1; }` },
  { tag: "pure", src: `/**\n * @nudo:pure\n */\nexport function f(x) { return x; }` },
  { tag: "sample", src: `/**\n * @nudo:sample 3\n */\nexport function f(x) { return x; }` },
  { tag: "mock", src: `/**\n * @nudo:mock x = 1\n */\nexport function f(x) { return x; }` },
  { tag: "case", src: `/**\n * @nudo:case "real" (1)\n */\nexport function f(x) { return x; }` },
];

describe("真实行首标签仍生效", () => {
  it.each(REAL_TAGS)("@nudo:$tag", ({ tag, src }) => {
    expect(kindsOf(src)).toContain(tag);
  });
});

describe("多行 case 参数后的兄弟标签", () => {
  it("多行 case 之后的同级 case 仍被提取", () => {
    const src = `/**\n * @nudo:case "t" (\n *   1\n * )\n * @nudo:case "inner" (9)\n */\nexport function f(x) { return x; }`;
    const cases = casesOf(src);
    expect(cases).toHaveLength(2);
    expect(cases.map((c) => c.kind === "case" && c.name)).toEqual(["t", "inner"]);
  });

  it("多行 case 之后的真实 pure 仍生效", () => {
    const src = `/**\n * @nudo:case "t" (\n *   1\n * )\n * @nudo:pure\n */\nexport function f(x) { return x; }`;
    expect(kindsOf(src)).toEqual(expect.arrayContaining(["case", "pure"]));
  });
});

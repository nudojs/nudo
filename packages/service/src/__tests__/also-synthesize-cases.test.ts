/**
 * alsoSynthesizeCases（`nudo test --both-paths`）：
 * 有 @nudo:case 指令的函数默认**独占**（synth 门关着，只有指令见证）；
 * alsoSynthesizeCases = true / [名字] ⇒ 同一轮里合成 call@/entry@ 见证，
 * 指令见证不丢、也不吃掉别家函数的独占默认。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "../analyzer.ts";

const SRC = `
/**
 * @nudo:case "a" (2, 3) => 5
 */
export function add(a, b) { return a + b; }

/**
 * @nudo:case "m" (2, 3) => 6
 */
export function mul(a, b) { return a * b; }

add(10, 20);
`;

const fnCases = (r: ReturnType<typeof analyzeFile>, name: string) =>
  r.functions.find((f) => f.name === name)!.cases;

describe("alsoSynthesizeCases", () => {
  it("default (undefined): directive functions stay exclusive — call sites produce nothing", () => {
    const r = analyzeFile("/bp/default.js", SRC);
    expect(fnCases(r, "add").map((c) => c.name)).toEqual(["a"]);
    expect(fnCases(r, "mul").map((c) => c.name)).toEqual(["m"]);
  });

  it("true: directive witnesses survive AND call@ synthesis runs in the same round", () => {
    const r = analyzeFile("/bp/all.js", SRC, undefined, undefined, undefined, undefined, true);
    const add = fnCases(r, "add");
    // 指令见证仍在（先于合成见证，顺序由既有 case 排布决定）
    expect(add.map((c) => c.name)).toContain("a");
    expect(add.some((c) => c.name.startsWith("call@"))).toBe(true);
    // 机器面可分辨两条路径（source: directive / callsite）
    expect(add.find((c) => c.name === "a")!.source).toBe("directive");
    expect(add.find((c) => c.name.startsWith("call@"))!.source).toBe("callsite");
    // 有调用点的函数不再需要 entry@ 兜底
    expect(add.some((c) => c.name.startsWith("entry@"))).toBe(false);
    // mul（同为指令函数但无调用点）：entry@ 合成照跑（both-paths 不因指令存在而静默）
    const mul = fnCases(r, "mul");
    expect(mul.map((c) => c.name)).toContain("m");
    expect(mul.some((c) => c.name.startsWith("entry@"))).toBe(true);
  });

  it("name list: only the named directive function gains synthesis", () => {
    const r = analyzeFile("/bp/named.js", SRC, undefined, undefined, undefined, undefined, ["add"]);
    expect(fnCases(r, "add").some((c) => c.name.startsWith("call@"))).toBe(true);
    // mul 不在名单 ⇒ 保持独占默认（entry@ 不出现）
    const mul = fnCases(r, "mul");
    expect(mul.map((c) => c.name)).toEqual(["m"]);
  });

  it("true on a file without directives: identical to default behavior", () => {
    const src = "export function f(x) { return x * 2; }\nf(4);\n";
    const def = analyzeFile("/bp/plain-default.js", src);
    const both = analyzeFile("/bp/plain-both.js", src, undefined, undefined, undefined, undefined, true);
    expect(fnCases(both, "f").map((c) => (c.name))).toEqual(fnCases(def, "f").map((c) => c.name));
  });

  it("empty name list = no-op (nobody targeted)", () => {
    const r = analyzeFile("/bp/empty.js", SRC, undefined, undefined, undefined, undefined, []);
    expect(fnCases(r, "add").map((c) => c.name)).toEqual(["a"]);
  });
});

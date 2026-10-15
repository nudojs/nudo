/**
 * dts 投影消费契约面（export CLI 从 effectiveInterface 取，与 check 签名面
 * 同数据源）：手写契约（sidecar / @nudo:contract）参数/返回位投影、
 * case 见证补位、无证据位 unknown 上报、契约 vs HOF 泛型优先级。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  anyAbs,
  anyVar,
  bool,
  num,
  numLit,
  obj,
  str,
  strLit,
  type Abs,
} from "@nudojs/core";
import { projectFunctionDts, generateFunctionDtsLines } from "../dts-generator.ts";
import type { FunctionAnalysis } from "../../analyzer-types.ts";

const neverAbs = (): Abs => abs({ k: "never" }, undefined, undefined, "exact");

/** 最小 fn 骨架：cases = 单条 entry@ 兜底（argAbs 全 any、结果 any） */
function fnOf(
  name: string,
  paramNames: string[],
  cases: FunctionAnalysis["cases"],
  extra: Partial<FunctionAnalysis> = {},
): FunctionAnalysis {
  return {
    name,
    loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    paramNames,
    cases,
    ...extra,
  } as FunctionAnalysis;
}

const entryCase = (argAbs: Abs[], result: Abs): FunctionAnalysis["cases"] => [
  { name: "entry@L1", argAbs, abs: result, throwsAbs: neverAbs() },
];

describe("dts contract face — 参数位", () => {
  it("契约参数位投影契约形态（entry@ any 证据不再吞成 unknown）", () => {
    const fn = fnOf("greet", ["u"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn, {
      params: [{ name: "u", abs: obj({ name: { value: str() } }) }],
    });
    expect(p.lines.join("\n")).toContain("export declare function greet(u: { name: string })");
    expect(p.params).toEqual([{ name: "u", type: "{ name: string }" }]);
  });

  it("契约只覆盖的参数位优先；未覆盖位落 case 见证 widen", () => {
    const fn = fnOf("pair", ["cfg", "n"], entryCase([anyAbs, numLit(7)], anyAbs));
    const p = projectFunctionDts(fn, {
      params: [{ name: "cfg", abs: obj({ debug: { value: bool() } }) }],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function pair(cfg: { debug: boolean }, n: number)",
    );
    expect(p.params[1]).toEqual({ name: "n", type: "number" });
  });

  it("契约参数位逆变 widen：lit 契约剥到基类型（与 case-widen 同口径）", () => {
    const fn = fnOf("pin", ["mode"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn, { params: [{ name: "mode", abs: strLit("fast") }] });
    expect(p.lines.join("\n")).toContain("pin(mode: string)");
  });

  it("形参表之外的契约参数名不投影（不撒 arity 谎言）", () => {
    const fn = fnOf("one", ["a"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "ghost", abs: str() },
      ],
    });
    expect(p.lines.join("\n")).toContain("one(a: number)");
    expect(p.lines.join("\n")).not.toContain("ghost");
  });
});

describe("dts contract face — 返回位", () => {
  it("契约 returns 投影返回位", () => {
    const fn = fnOf("f", ["x"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn, { params: [{ name: "x", abs: num() }], return: str() });
    expect(p.lines.join("\n")).toContain("): string;");
  });

  it("契约返回优先于 case 观察", () => {
    const fn = fnOf("f", ["x"], entryCase([numLit(1)], numLit(2)));
    const p = projectFunctionDts(fn, { params: [], return: str() });
    expect(p.lines.join("\n")).toContain("): string;");
  });

  it("无契约返回落 case 观察（combinedAbs 优先）", () => {
    const fn = fnOf("f", ["x"], entryCase([numLit(1)], numLit(2)), {
      combinedAbs: numLit(9),
    });
    const p = projectFunctionDts(fn, { params: [{ name: "x", abs: num() }] });
    expect(p.lines.join("\n")).toContain("): number;");
  });
});

describe("dts contract face — 分支交互", () => {
  it("skip / 无 case 函数 + 契约参数位：具名投影（不再 rest-args unknown[]）", () => {
    const skipped = fnOf("sk", ["u"], [], {
      skipped: true,
      combinedAbs: num(),
    });
    const p = projectFunctionDts(skipped, {
      params: [{ name: "u", abs: obj({ id: { value: num() } }) }],
    });
    expect(p.lines).toEqual(["export declare function sk(u: { id: number }): number;"]);
    expect(p.params).toEqual([{ name: "u", type: "{ id: number }" }]);
  });

  it("skip 无契约：保持历史 rest-args 声明面", () => {
    const skipped = fnOf("sk", ["u"], [], {
      skipped: true,
      combinedAbs: num(),
    });
    const p = projectFunctionDts(skipped);
    expect(p.lines).toEqual(["export declare function sk(...args: unknown[]): number;"]);
    expect(p.params).toEqual([]);
  });

  it("契约参数面优先于 HOF 泛型快照（不混投影）", () => {
    const fn = fnOf("apply2", ["xs", "transform"], [], {
      hof: {
        entryShapes: [
          {
            param: "xs",
            abs: abs(
              { k: "arr", element: anyVar("A1") },
              undefined,
              undefined,
              "path",
            ),
          },
        ],
        symbolic: anyVar("B_transform"),
      },
    });
    // 无契约：泛型投影（C3.3 既有行为）
    expect(generateFunctionDtsLines(fn).join("\n")).toContain("apply2<");
    // 有契约：具名契约面，不再泛型
    const p = projectFunctionDts(fn, {
      params: [
        {
          name: "transform",
          abs: abs(
            { k: "fn", params: ["x"], returnType: str(), paramTypes: [num()] },
            undefined,
            undefined,
            "path",
          ),
        },
      ],
    });
    expect(p.lines.join("\n")).not.toContain("apply2<");
    expect(p.lines.join("\n")).toContain("transform: (x: number) => string");
  });
});

describe("dts contract face — 无证据位上报", () => {
  it("无契约无 case 值证据的参数位 type=unknown（stderr 提示数据源）", () => {
    const fn = fnOf("bare", ["x"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn);
    expect(p.params).toEqual([{ name: "x", type: "unknown" }]);
    expect(p.lines.join("\n")).toContain("bare(x: unknown)");
  });

  it("无信息 entry@ 兜底行不进 JSDoc（Case 行与主签名不再矛盾）", () => {
    const fn = fnOf("greet", ["u"], entryCase([anyAbs], anyAbs));
    const p = projectFunctionDts(fn, {
      params: [{ name: "u", abs: obj({ name: { value: str() } }) }],
      return: str(),
    });
    expect(p.lines.join("\n")).not.toContain("Case: entry@");
  });

  it("有信息的 case 行仍保留（字面量台账）", () => {
    const fn = fnOf("greet", ["u"], [
      {
        name: "named",
        argAbs: [obj({ name: { value: strLit("Ada") } })],
        abs: strLit("Ada"),
        throwsAbs: neverAbs(),
      },
    ]);
    const p = projectFunctionDts(fn);
    expect(p.lines.join("\n")).toContain('Case: named ({ name: "Ada" }) => "Ada"');
  });
});

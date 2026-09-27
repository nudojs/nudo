/**
 * RegExp 方法保守面：subject 非字面量时 `exec` 必须给「null | 匹配数组」的
 * 保守并，而不是 undefined；nullish 字面量返回位证据预过滤（T4 caveat 同口径）。
 *
 * 此前 exec 返回 undefined → 调用方回落到「方法不存在」路径，结果被当成
 * Abs undefined：`typeof m` 折成字面量 "undefined"、`m === null` 折 false、
 * 捕获组下标全 unknown，真实项目里 parseVersion 形态的返回因此整条退化。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, formatAbs, abs, checkSource, pTrue } from "@nudojs/core";

const abstractStr = () => abs({ k: "prim", type: "string" }, undefined, undefined, "path");
const litStr = (v: string) =>
  abs({ k: "prim", type: "string" }, { op: "lit", value: v } as never, undefined, "exact");

function callFn(src: string, name: string, args: unknown[] = []) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, name, args as never[]);
}

const SRC = `
const RE = /^(\\d+)\\.(\\d+)$/;
export function execOnly(v) { return RE.exec(v); }
export function viaTypeof(v) { const m = RE.exec(v); return typeof m; }
export function viaEqNull(v) { const m = RE.exec(v); if (m === null) return "none"; return "some"; }
export function group(v) { const m = RE.exec(v); if (!m) return null; return { major: Number(m[1]), minor: Number(m[2]) }; }
`;

const STDLIB = `import { shape, number } from "@nudojs/core";\nexport const parsed = shape({ major: number(), minor: number() });`;

function checkWith(src: string) {
  return checkSource("/t/exec.js", src, pTrue, {
    loadModule: (spec: string) => (spec.includes("std.nudo") ? STDLIB : undefined),
    fromFile: "/t/exec.js",
  });
}

describe("RegExp.exec with non-literal subject", () => {
  it("literal subject still folds exactly", () => {
    const r = callFn(SRC, "execOnly", [litStr("12.34")]);
    expect(formatAbs(r.result)).toContain('"12"');
  });

  it("abstract subject: result is not Abs-undefined", () => {
    const r = callFn(SRC, "execOnly", [abstractStr()]);
    expect(formatAbs(r.result)).not.toBe("undefined");
  });

  it("capture groups stay readable: Number(m[i]) is a number", () => {
    const r = checkWith(`/// @nudo:import { parsed } from "./std.nudo.js"\n${SRC}`);
    const sig = r.signatures?.find((s) => s.name === "group");
    expect(sig).toBeDefined();
    expect(formatAbs(sig!.abs)).toContain("major: number");
  });

  it("typeof m is not folded to the literal \"undefined\"", () => {
    const r = callFn(SRC, "viaTypeof", [abstractStr()]);
    expect(formatAbs(r.result)).toContain("string");
    expect(formatAbs(r.result)).not.toContain('"undefined"');
  });

  it("m === null is not folded to false (both branches reachable)", () => {
    const r = callFn(SRC, "viaEqNull", [abstractStr()]);
    const out = formatAbs(r.result);
    expect(out).toContain("none");
    expect(out).toContain("some");
  });
});

describe("nullish return evidence is prefiltered (T4 caveat)", () => {
  it("`return null` against a shape return contract is not a violation", () => {
    const r = checkWith(`/// @nudo:import { parsed } from "./std.nudo.js"
/**
 * @nudo:contract return parsed
 */
export function nothing(v) {
  if (v) return null;
  return null;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:constraint-violated")).toEqual([]);
  });
});

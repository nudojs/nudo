/**
 * 字符串拼接的 any 面：一侧确定是 string 时结果类型即 string。
 *
 * `"s" + x` / `x + "s"` / `` `${x}` ``（x 无约束 = any）在 JS 里都是 string
 * （ToString 对 Symbol 抛的路径不建模）。此前 concatString 直接回退 unknown —
 * 与 limitations.md 的混合 `+` 粗化纪律（number⊗obj/unknown → number|string）
 * 自相矛盾，并把整条 return 污染成 unknown + 误报 nudo:unknown-inference。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, formatAbs, abs, strLit } from "@nudojs/core";

const anyAbs = () => abs({ k: "any" }, undefined, undefined, "exact");

function callFn(src: string, name: string, args: unknown[] = []) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, name, args as never[]);
}

const SRC = `
export function tpl(x) { return \`\${x}\`; }
export function left(x) { return "s" + x; }
export function right(x) { return x + "s"; }
export function tplTwo(x, y) { return \`a\${x}b\${y}c\`; }
export function length(x) { return \`\${x}\`.length; }
export function num(x) { return 1 + x; }
`;

/** formatAbs 前缀即 shape 面：`string  #path` / `number  #path`，并集是 `number | string` */
function faceOf(src: string, name: string, args: unknown[] = []) {
  const out = formatAbs(callFn(SRC, name, args).result);
  return out.split(/\s{2,}/)[0]!;
}

describe("string concat with an any operand", () => {
  it("template with an any part is string", () => {
    expect(faceOf(SRC, "tpl", [anyAbs()])).toBe("string");
  });

  it("string on either side is string", () => {
    expect(faceOf(SRC, "left", [anyAbs()])).toBe("string");
    expect(faceOf(SRC, "right", [anyAbs()])).toBe("string");
  });

  it("multi-part template with any parts is string", () => {
    expect(faceOf(SRC, "tplTwo", [anyAbs(), anyAbs()])).toBe("string");
  });

  it("length of a template with an any part stays number", () => {
    expect(faceOf(SRC, "length", [anyAbs()])).toBe("number");
  });

  it("mixed number + any still narrows to number | string (unchanged)", () => {
    expect(faceOf(SRC, "num", [anyAbs()])).toBe("number | string");
  });

  it("all-literal concat still folds exactly", () => {
    const r = callFn(SRC, "left", [strLit("b")]);
    expect(formatAbs(r.result)).toContain('"sb"');
    expect(r.result.conf).toBe("exact");
  });
});

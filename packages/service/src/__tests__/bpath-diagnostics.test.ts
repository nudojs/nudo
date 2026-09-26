import { describe, it, expect } from "vitest";
import { collectBPathDiagnostics } from "@nudojs/service";

describe("B-path static diagnostics", () => {
  it("marks statements after return as unreachable", () => {
    const src = `
function f() {
  return 1;
  const dead = 2;
  console.log("no");
}
`;
    const d = collectBPathDiagnostics(src);
    expect(d.unreachable.length).toBeGreaterThanOrEqual(1);
    // dead 声明与后续 console
    const lines = d.unreachable.map((u) => u.range.start.line);
    expect(lines.some((l) => l >= 4)).toBe(true);
  });

  it("marks statements after throw as unreachable", () => {
    const src = `
function f(n) {
  if (n) {
    throw new Error("x");
    return 1;
  }
  return 0;
}
`;
    const d = collectBPathDiagnostics(src);
    expect(d.unreachable.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag code after if/else both return", () => {
    const src = `
function f(n) {
  if (n) { return 1; } else { return 2; }
}
`;
    const d = collectBPathDiagnostics(src);
    // if 内无后续语句
    expect(d.unreachable).toHaveLength(0);
  });

  it("flags unknown global calls as builtin-unknown", () => {
    const src = `
function f() {
  return someNativeApi(1);
}
`;
    const d = collectBPathDiagnostics(src);
    expect(d.builtinUnknown.map((b) => b.name)).toContain("someNativeApi");
  });

  it("extraKnown (@nudo:mock / @nudo:env covered) globals are not flagged", () => {
    const src = `
function f() {
  return someNativeApi(1);
}
`;
    expect(collectBPathDiagnostics(src, ["someNativeApi"]).builtinUnknown).toHaveLength(0);
    // 无覆盖时仍报
    expect(collectBPathDiagnostics(src).builtinUnknown.map((b) => b.name)).toContain("someNativeApi");
  });

  it("does not flag locals, imports, or known globals", () => {
    const src = `
import { helper } from "./h.js";
function local(x) { return x; }
function f() {
  const y = local(1);
  return helper(y) + Math.max(1, 2) + JSON.stringify(y);
}
`;
    const d = collectBPathDiagnostics(src);
    expect(d.builtinUnknown).toHaveLength(0);
  });

  it("static require / require.resolve are not builtin-unknown", () => {
    const src = `
const a = require("./a.js");
const b = require(\`./b.js\`);
const c = require("./" + "c" + ".js");
const d = require.resolve("./d.js");
function f() { return a; }
`;
    const d = collectBPathDiagnostics(src);
    expect(d.builtinUnknown.map((b) => b.name)).not.toContain("require");
    expect(d.builtinUnknown).toHaveLength(0);
  });

  it("dynamic require / require.resolve stay honest builtin-unknown", () => {
    const src = `
function f(name) {
  const m = require(name);
  const p = require.resolve("./" + name + ".js");
  return m;
}
`;
    const d = collectBPathDiagnostics(src);
    expect(d.builtinUnknown.map((b) => b.name)).toContain("require");
  });
});

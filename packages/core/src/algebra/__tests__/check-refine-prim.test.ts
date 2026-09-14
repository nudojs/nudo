/**
 * refine 模板门禁：array()/string() 与 body 方法访问的结构门禁优先级。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/refine-prim.js", withStdImport(src), pTrue, stdOpts);
}
function errorCodes(src: string): string[] {
  return issuesOf(src)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);
}

describe("array() refine", () => {
  it("ok: valid array of positives", () => {
    const r = issuesOf(`
/**
 * @nudo:refine items positives
 */
function sumPos(items) { return items; }
sumPos([1, 2, 3]);
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: element violates number().gt(0)", () => {
    const r = issuesOf(`
/**
 * @nudo:refine items positives
 */
function sumPos(items) { return items; }
sumPos([-1, 2]);
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(err).toBeDefined();
    expect(err!.expected).toContain(">");
  });

  it("error: non-array arg", () => {
    const r = issuesOf(`
/**
 * @nudo:refine items positives
 */
function sumPos(items) { return items; }
sumPos("nope");
`);
    expect(r.ok).toBe(false);
  });

  it("does not invent {some} from findings.some when refine is array()", () => {
    const r = issuesOf(`
/**
 * @nudo:refine findings findings
 */
function report(findings) {
  return findings.some(f => f.severity);
}
report([{ severity: "high" }]);
`);
    // 无 arg-structure 误报；refine 优先于 body 方法访问
    expect(r.issues.filter((i) => i.code === "nudo:arg-structure")).toEqual([]);
  });
});

describe("string() refine", () => {
  it("error: number arg against string()", () => {
    const r = issuesOf(`
/**
 * @nudo:refine s nonEmpty
 */
function greet(s) { return "hi " + s; }
greet(42);
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("string");
  });

  it("error: empty string against string().min(1)", () => {
    const r = issuesOf(`
/**
 * @nudo:refine n shortName
 */
function nick(n) { return n; }
nick("");
`);
    expect(r.ok).toBe(false);
  });

  it("ok: valid string", () => {
    const r = issuesOf(`
/**
 * @nudo:refine s nonEmpty
 */
function greet(s) { return "hi " + s; }
greet("ada");
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("structural gate vs refine priority", () => {
  it("shape() call site still checks fields", () => {
    const r = issuesOf(`
/**
 * @nudo:refine u userShape
 */
function register(u) { return u.name; }
register({ id: -1, name: "a" });
`);
    expect(r.ok).toBe(false);
  });

  it("method call on param is not a required data field", () => {
    const r = issuesOf(`
function take(xs) {
  return xs.map(x => x);
}
take([1, 2, 3]);
`);
    expect(r.issues.filter((i) => i.code === "nudo:arg-structure")).toEqual([]);
  });

  it("wrapper→target refine propagates across same-file calls", () => {
    const r = issuesOf(`
/**
 * @nudo:refine u userShape
 */
function register(u) { return u.name; }
function wrapper(u) { return register(u); }
wrapper({ id: 3 });
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.message.includes("wrapper→register"));
    expect(err).toBeDefined();
  });
});

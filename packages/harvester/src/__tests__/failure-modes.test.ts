/**
 * Harvester failure modes: malformed .d.ts input, resource limits, and
 * circular types must fail closed / stay honest — never crash or hang.
 */
import { describe, it, expect, afterAll } from "vitest";
import { rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestDts, emitEnvModule } from "../index.ts";
import { formatShape, getFnImpl } from "@nudojs/core";

const dirs: string[] = [];

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-fail-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function shapeOfGlobal(env: ReturnType<typeof harvestDts>, name: string): string {
  const abs = env.globals[name];
  expect(abs, `global "${name}" missing`).toBeTruthy();
  return formatShape(abs!);
}

describe("harvestDts — missing / unreadable inputs", () => {
  it("counts a nonexistent file as skipped and does not throw", () => {
    const env = harvestDts(["/definitely/not/here.d.ts"]);
    expect(env.stats.skipped).toBe(1);
    expect(env.stats.files).toBe(0);
    expect(env.globals).toEqual({});
    expect(env.modules).toEqual({});
  });

  it("skips an oversized file via maxFileBytes (honest stats)", () => {
    const big = writeTemp(
      "big.d.ts",
      `export declare function f(x: number): number;\n// ${"x".repeat(5000)}\n`,
    );
    const env = harvestDts([big], { maxFileBytes: 64 });
    expect(env.stats.skipped).toBe(1);
    expect(env.stats.files).toBe(0);
    expect(env.globals.f).toBeUndefined();
  });

  it("skips all files when the deadline is already expired (maxMs < 0)", () => {
    const a = writeTemp("a.d.ts", `export declare function f(x: number): number;\n`);
    const env = harvestDts([a, a], { maxMs: -1 });
    expect(env.stats.skipped).toBe(2);
    expect(env.stats.files).toBe(0);
  });

  it("handles an empty file list", () => {
    const env = harvestDts([]);
    expect(env.stats).toEqual({ files: 0, symbols: 0, skipped: 0 });
  });
});

describe("harvestDts — malformed declaration text", () => {
  it("binary garbage does not crash (honest empty/partial harvest)", () => {
    const garbage = String.fromCharCode(0, 1, 2, 0xff, 0xfe) + "not typescript";
    const bin = writeTemp("bin.d.ts", garbage);
    const env = harvestDts([bin]);
    // createSourceFile is error-tolerant; result must be a table, not a throw
    expect(env.globals).toBeTypeOf("object");
    expect(env.modules).toBeTypeOf("object");
    expect(env.stats.files).toBe(1);
  });

  it("truncated / unbalanced syntax does not crash", () => {
    const broken = writeTemp(
      "broken.d.ts",
      `export declare function f(x: {\ninterface\ndeclare module "m" {\n`,
    );
    const env = harvestDts([broken]);
    expect(env.globals).toBeTypeOf("object");
    expect(env.stats.files).toBe(1);
  });

  it("a valid declaration next to garbage still harvests the good symbol", () => {
    const good = writeTemp(
      "mixed.d.ts",
      `export declare function keep(x: number): string;\n!!!!\nexport declare function alsoKeep(): void;\n`,
    );
    const env = harvestDts([good]);
    expect(env.globals.keep).toBeTruthy();
    expect(env.globals.alsoKeep).toBeTruthy();
    expect(shapeOfGlobal(env, "keep")).toContain("=>");
  });

  it("emitEnvModule emits source for a degraded env (no crash)", () => {
    const garbage = writeTemp("g.d.ts", "<<<<>>>>");
    const env = harvestDts([garbage]);
    const code = emitEnvModule(env, "garbage-pkg");
    expect(code).toContain("export function defineEnv()");
    expect(code).toContain("garbage-pkg");
  });
});

describe("harvestDts — circular / recursive types (fail-closed, no hang)", () => {
  it("self-referential interface terminates via the recursion guard", () => {
    const p = writeTemp(
      "circular.d.ts",
      `interface Node {
  value: number;
  next: Node | null;
}
export declare function head(n: Node): number;
`,
    );
    const env = harvestDts([p]);
    expect(env.globals.head).toBeTruthy();
    const s = shapeOfGlobal(env, "head");
    expect(s).toContain("=>");
    // recursion guard keeps the brand name instead of expanding forever
    expect(s).toContain("Node");
  });

  it("mutually recursive interfaces terminate", () => {
    const p = writeTemp(
      "mutual.d.ts",
      `interface A { tag: string; b: B; }
interface B { tag: string; a: A; }
export declare function walk(a: A): B;
`,
    );
    const env = harvestDts([p]);
    expect(env.globals.walk).toBeTruthy();
    const s = shapeOfGlobal(env, "walk");
    expect(s).toContain("=>");
    expect(s.length).toBeGreaterThan(0);
  });

  it("self-referential type alias terminates via alias depth cap", () => {
    const p = writeTemp(
      "alias-cycle.d.ts",
      `type Rec = { next: Rec; n: number };
export declare function f(x: Rec): number;
`,
    );
    const env = harvestDts([p]);
    expect(env.globals.f).toBeTruthy();
    const s = shapeOfGlobal(env, "f");
    expect(s).toContain("=>");
  });

  it("deep alias chain beyond MAX_ALIAS_DEPTH collapses to unknown (honest)", () => {
    // MAX_ALIAS_DEPTH = 8 — a 12-hop chain must not blow the stack.
    const chain = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? `type A0 = number;` : `type A${i} = A${i - 1};`,
    ).join("\n");
    const p = writeTemp(
      "deep-alias.d.ts",
      `${chain}\nexport declare function f(x: A11): A11;\n`,
    );
    const env = harvestDts([p]);
    expect(env.globals.f).toBeTruthy();
    const s = shapeOfGlobal(env, "f");
    expect(s).toContain("=>");
    // either fully resolved to number, or honest unknown at the cut — both fine;
    // the contract is: no throw, no hang, and a usable signature.
    expect(s.length).toBeGreaterThan(0);
    expect(getFnImpl(env.globals.f!)).toBeTruthy();
  });

  it("class with self-typed members terminates", () => {
    const p = writeTemp(
      "class-cycle.d.ts",
      `export declare class Tree {
  value: number;
  left: Tree;
  right: Tree;
}
`,
    );
    const env = harvestDts([p]);
    expect(env.globals.Tree).toBeTruthy();
  });
});

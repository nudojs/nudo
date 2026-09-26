import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { abs, num, str, v, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";
import { analyzeFile } from "@nudojs/service";
import { resetAllAnalysisCaches } from "@nudojs/service";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tscNoEmit(dts: string): { ok: boolean; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-hof-dts-"));
  dirs.push(dir);
  const p = join(dir, "mod.d.ts");
  writeFileSync(p, dts.endsWith("\n") ? dts : dts + "\n", "utf-8");
  try {
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

const anyVar = (id: string): Abs => abs({ k: "any" }, v(id), undefined, "path");

describe("C3.3 HOF dts generic projection", () => {
  it("processItems projects param relation as TS generics", () => {
    resetAllAnalysisCaches();
    const source = `
function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
`;
    const result = analyzeFile("/test/hof-process.js", source);
    const fn = result.functions.find((f) => f.name === "processItems");
    expect(fn).toBeDefined();
    expect(fn!.hof).toBeDefined();
    expect(fn!.hof!.fnRels?.length ?? 0).toBeGreaterThan(0);

    const dts = generateDts(result);
    expect(dts).toContain("export declare function processItems<");
    // 泛型参数：A1（items 元素）与 B_transform（transform 返回）
    expect(dts).toMatch(/function processItems<[A-Za-z0-9_$,\s]+>\(/);
    // 参数位应出现数组 / 函数类型，而不是全 unknown
    expect(dts).not.toContain("processItems(items: unknown");
    const check = tscNoEmit(dts);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("withRetry: zero-arg callback projects B_fn", () => {
    resetAllAnalysisCaches();
    const source = `
function withRetry(fn) {
  return fn();
}
`;
    const result = analyzeFile("/test/hof-retry.js", source);
    const dts = generateDts(result);
    expect(dts).toContain("export declare function withRetry<");
    expect(dts).toMatch(/\(fn: \(\) => [A-Za-z0-9_$]+\)/);
    const check = tscNoEmit(dts);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("absToTSType renders type vars only when mapped", () => {
    const a = anyVar("A1");
    expect(absToTSType(a)).toBe("unknown");
    expect(absToTSType(a, new Map([["A1", "T"]]))).toBe("T");
    const arr = abs({ k: "arr", element: a }, undefined, undefined, "path");
    expect(absToTSType(arr, new Map([["A1", "T"]]))).toBe("T[]");
  });

  it("sanitize B:param names to legal TS identifiers", () => {
    const fnAbs = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [anyVar("A1")],
        returnType: anyVar("B:transform"),
      },
      undefined,
      undefined,
      "path",
    );
    const ts = absToTSType(
      fnAbs,
      new Map([
        ["A1", "A1"],
        ["B:transform", "B_transform"],
      ]),
    );
    expect(ts).toBe("(x: A1) => B_transform");
  });

  it("hand-built hof snapshot emits generic declare line", () => {
    const itemsAbs = abs(
      { k: "arr", element: anyVar("A1") },
      undefined,
      undefined,
      "path",
    );
    const transformAbs = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [anyVar("A1")],
        returnType: anyVar("B:transform"),
      },
      undefined,
      undefined,
      "path",
    );
    const filterAbs = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [anyVar("A1")],
        returnType: abs({ k: "prim", type: "boolean" }, undefined, undefined, "exact"),
      },
      undefined,
      undefined,
      "path",
    );
    const retAbs = abs(
      { k: "arr", element: anyVar("B:transform") },
      undefined,
      undefined,
      "path",
    );
    const fn = {
      name: "mapItems",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
      paramNames: ["items", "transform", "filter"],
      cases: [],
      combinedAbs: retAbs,
      hof: {
        entryShapes: [{ param: "items", abs: itemsAbs }],
        fnRels: [
          { param: "transform", abs: transformAbs },
          { param: "filter", abs: filterAbs },
        ],
        symbolic: retAbs,
      },
    };
    const dts = generateDts({ functions: [fn] } as never);
    expect(dts).toContain("export declare function mapItems<A1, B_transform>");
    expect(dts).toContain("items: A1[]");
    expect(dts).toContain("transform: (x: A1) => B_transform");
    expect(dts).toContain("filter: (x: A1) => boolean");
    expect(dts).toContain("): B_transform[];");
    const check = tscNoEmit(dts);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("no hof falls back to case-widen (existing path)", () => {
    const fn = {
      name: "add",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 3 } },
      paramNames: ["a", "b"],
      cases: [
        {
          name: "c",
          argAbs: [num(), num()],
          abs: num(),
          throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
        },
      ],
    };
    const dts = generateDts({ functions: [fn] } as never);
    expect(dts).toContain("export declare function add(a: number, b: number): number;");
    expect(dts).not.toContain("function add<");
  });
});

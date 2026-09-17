import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { abs, num, str, bool, numLit, strLit, objOf, type Abs } from "@nudojs/core";
import { absToTSType, generateDts } from "../dts-generator.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
const tupleOf = (elements: Abs[]): Abs => abs({ k: "tuple", elements }, undefined, undefined, "exact");
const promiseOf = (inner: Abs): Abs => abs({ k: "eff", eff: "promise", inner }, undefined, undefined, "exact");
const unionOf = (...members: Abs[]): Abs => abs({ k: "sum", members }, undefined, undefined, "exact");
const fnAbs = (
  params: string[],
  returnType?: Abs,
  paramTypes?: Abs[],
): Abs => abs({ k: "fn", params, returnType, paramTypes }, undefined, undefined, "exact");
const brandOf = (name: string, shape: Abs = objOf({})): Abs =>
  abs({ k: "brand", name, shape }, undefined, undefined, "path");
const optSlot = (value: Abs): Abs =>
  ({ shape: { k: "obj", slots: { f: { value, optional: true } } }, conf: "exact" }) as Abs;

function tscNoEmit(dts: string): { ok: boolean; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-dts-q-"));
  dirs.push(dir);
  const p = join(dir, "mod.d.ts");
  writeFileSync(p, dts.endsWith("\n") ? dts : dts + "\n", "utf-8");
  try {
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", p],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("absToTSType legality (E1)", () => {
  it("wraps function types inside unions", () => {
    const ts = absToTSType(unionOf(num(), fnAbs(["x"], num())));
    // `(x: unknown) => number` as a bare union member is invalid TS
    expect(ts).toMatch(/number \| \(\(x: unknown\) => number\)|number \| \(x: unknown\) => number/);
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("wraps function types as array elements", () => {
    const ts = absToTSType(arrOf(fnAbs(["x"], num())));
    // bare `(x: unknown) => number[]` parses as a function returning number[]
    expect(ts).toBe("((x: unknown) => number)[]");
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("wraps function types under optional | undefined", () => {
    const ts = absToTSType(optSlot(fnAbs(["x"], num())));
    // bare `(x: unknown) => number | undefined` attaches | undefined to the return
    expect(ts).toBe("{ f: ((x: unknown) => number) | undefined }");
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("wraps function types as promise payloads", () => {
    const ts = absToTSType(promiseOf(fnAbs(["x"], num())));
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("uses paramTypes and returnType when present", () => {
    const ts = absToTSType(fnAbs(["x", "y"], num(), [num(), str()]));
    expect(ts).toBe("(x: number, y: string) => number");
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("quotes object keys that are not identifiers", () => {
    const obj = abs(
      {
        k: "obj",
        slots: {
          "foo-bar": { value: num() },
          "123": { value: str() },
          default: { value: bool() },
          ok: { value: num() },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    const ts = absToTSType(obj);
    expect(ts).toContain('"foo-bar": number');
    expect(ts).toContain("123: string");
    expect(ts).toContain("default: boolean");
    expect(ts).toContain("ok: number");
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("renders rest params as array type in function types", () => {
    const ts = absToTSType(fnAbs(["...args"], num(), [arrOf(num())]));
    expect(ts).toBe("(...args: number[]) => number");
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("sanitizes reserved / invalid fn param names in type projection", () => {
    const ts = absToTSType(fnAbs(["default", "class", ""], num()));
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("keeps heterogeneous tuples legal", () => {
    const ts = absToTSType(tupleOf([num(), unionOf(str(), bool()), fnAbs([], num())]));
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("keeps brand | primitive unions legal", () => {
    const ts = absToTSType(unionOf(brandOf("Error"), num(), arrOf(unionOf(num(), str()))));
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("object-of-function-array and nested optional stay legal", () => {
    const obj = abs(
      {
        k: "obj",
        slots: {
          handlers: { value: arrOf(fnAbs(["e"], promiseOf(num()))) },
          meta: { value: unionOf(str(), fnAbs([], num())), optional: true },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    const ts = absToTSType(obj);
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("generateDts for HOF-shaped returns is tsc-clean", () => {
    const fn = {
      name: "makeMapper",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
      paramNames: ["n"],
      cases: [
        {
          name: "c",
          argAbs: [num()],
          abs: fnAbs(["x"], num(), [num()]),
          throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
        },
      ],
    };
    const dts = generateDts({ functions: [fn] } as unknown as Parameters<typeof generateDts>[0]);
    expect(dts).toContain("export declare function makeMapper");
    const check = tscNoEmit(dts);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("generateDts for return-position function union is tsc-clean", () => {
    const fn = {
      name: "eitherFn",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
      paramNames: ["x"],
      cases: [
        {
          name: "n",
          argAbs: [num()],
          abs: num(),
          throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
        },
        {
          name: "f",
          argAbs: [str()],
          abs: fnAbs(["y"], num(), [num()]),
          throwsAbs: abs({ k: "never" }, undefined, undefined, "exact"),
        },
      ],
    };
    const dts = generateDts({ functions: [fn] } as unknown as Parameters<typeof generateDts>[0]);
    const check = tscNoEmit(dts);
    expect(check.ok, check.stderr).toBe(true);
  });
});

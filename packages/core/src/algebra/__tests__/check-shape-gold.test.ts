/**
 * shape 约束金标：契约规范 object 形状，无需 interface/type。
 * 唯一 refine 形态：@nudo:contract <param> <shapeName>
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import {
  shape,
  number,
  string,
  isNudoConstraint,
  instantiateConstraint,
} from "../constraint.ts";
import { predToString } from "../pred.ts";
import { execNudoModule } from "../refine.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/shape.js", withStdImport(src), pTrue, stdOpts);
}

function errorCodes(src: string): string[] {
  return issuesOf(src)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);
}

describe("shape() constraint builder", () => {
  it("builds field map from number()/string()", () => {
    const c = shape({ id: number().gt(0), name: string() });
    expect(isNudoConstraint(c)).toBe(true);
    expect(Object.keys(c.fields ?? {}).sort()).toEqual(["id", "name"]);
    expect(c.fields!.id!.constraint.prim).toBe("number");
    expect(c.fields!.name!.constraint.prim).toBe("string");
  });

  it("instantiates to field-access Preds", () => {
    const c = shape({ id: number().gt(0), name: string() });
    const p = instantiateConstraint(c, "u");
    const s = predToString(p);
    expect(s).toContain("u.id");
    expect(s).toContain(">");
    expect(s).toContain("typeof u.name");
  });

  it("optional() marks field", () => {
    const c = shape({ label: string().optional() });
    expect(c.fields!.label!.optional).toBe(true);
    expect(c.fields!.label!.constraint.isOptional).toBe(true);
  });

  it("executes shape in .nudo.js", () => {
    const src = `
export const user = shape({ id: number().gt(0), name: string() });
`;
    const exp = execNudoModule(src);
    expect(isNudoConstraint(exp.user)).toBe(true);
    expect(Object.keys((exp.user as { fields: object }).fields).sort()).toEqual([
      "id",
      "name",
    ]);
  });
});

describe("check: object literal ⊭ shape", () => {
  it("ok: valid object", () => {
    const r = issuesOf(`
/**
 * @nudo:contract u userShape
 */
function register(u) {
  return u.name;
}
register({ id: 1, name: "a" });
`);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: field bound violated (id > 0)", () => {
    const r = issuesOf(`
/**
 * @nudo:contract u userShape
 */
function register(u) {
  return u.name;
}
register({ id: -1, name: "a" });
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("u.id");
    expect(err!.expected).toContain(">");
  });

  it("error: missing required field", () => {
    // body 不访问 name，仅契约声明要求该字段
    const r = issuesOf(`
/**
 * @nudo:contract u userShape
 */
function register(u) {
  return u.id;
}
register({ id: 1 });
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("missing");
    expect(err!.expected).toContain("name");
  });

  it("error: field prim mismatch (name is number)", () => {
    const r = issuesOf(`
/**
 * @nudo:contract u userShape
 */
function register(u) {
  return u.name;
}
register({ id: 1, name: 2 });
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("string");
  });

  it("ok: optional field omitted", () => {
    const r = issuesOf(`
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
setup({ retries: 3 });
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: optional field present but wrong type", () => {
    const r = issuesOf(`
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
setup({ retries: 3, label: 9 });
`);
    expect(r.ok).toBe(false);
    expect(
      r.issues.some(
        (i) =>
          i.code === "nudo:constraint-violated" &&
          (i.expected ?? "").includes("string"),
      ),
    ).toBe(true);
  });

  it("error: numeric upper bound on shape field", () => {
    const r = issuesOf(`
/**
 * @nudo:contract c configShape
 */
function setup(c) {
  return c.retries;
}
setup({ retries: 99 });
`);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(err).toBeDefined();
    expect(err!.expected).toContain("≤");
  });

  it("ok: unknown identifier arg (no false positive)", () => {
    const r = issuesOf(`
/**
 * @nudo:contract u userShape
 */
function register(u) {
  return u.name;
}
const payload = getPayload();
register(payload);
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("ok: no refine → no shape gate", () => {
    const r = issuesOf(`
function open(u) {
  return u;
}
open({ id: -1 });
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("ok: nested shape + array fields", () => {
    const r = issuesOf(`
/**
 * @nudo:contract o orderShape
 */
function place(o) {
  return o.user.id;
}
place({ user: { id: 1, name: "a" }, tags: ["x"] });
`);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: nested shape field bound", () => {
    const r = issuesOf(`
/**
 * @nudo:contract o orderShape
 */
function place(o) {
  return o.user.id;
}
place({ user: { id: -1, name: "a" }, tags: ["x"] });
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("error: array element min length", () => {
    const r = issuesOf(`
/**
 * @nudo:contract o orderShape
 */
function place(o) {
  return o.tags;
}
place({ user: { id: 1, name: "a" }, tags: [""] });
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("ok: int refine", () => {
    const ok = issuesOf(`
/**
 * @nudo:contract n intId
 */
function take(n) { return n; }
take(3);
`);
    expect(ok.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: int refine rejects non-integer", () => {
    const r = issuesOf(`
/**
 * @nudo:contract n intId
 */
function take(n) { return n; }
take(1.5);
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.expected?.includes("int"))).toBe(true);
  });

  it("error: array refine rejects non-array", () => {
    const r = issuesOf(`
/**
 * @nudo:contract xs positives
 */
function take(xs) { return xs; }
take(1);
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.expected?.includes("array"))).toBe(true);
  });

  it("error: array element bound", () => {
    const r = issuesOf(`
/**
 * @nudo:contract xs positives
 */
function take(xs) { return xs; }
take([-1]);
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(true);
  });

  it("error: string min length", () => {
    const r = issuesOf(`
/**
 * @nudo:contract s shortName
 */
function take(s) { return s; }
take("");
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.expected?.includes("length"))).toBe(true);
  });
});

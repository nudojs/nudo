/**
 * shape 约束金标：契约规范 object 形状，无需 interface/type。
 * 唯一 refine 形态：@nudo:contract <param> <shapeName>
 */
import { describe, it, expect } from "vitest";
import "../index.ts";
import {
  shape,
  number,
  string,
  isNudoConstraint,
  instantiateConstraint,
} from "../constraint.ts";
import { predToString } from "../pred.ts";
import { execNudoModule } from "../refine.ts";
import { checkSource, pTrue } from "../index.ts";
import { issuesOf, sidecarOpts } from "./nudo-constraints.ts";

function errorCodes(src: string): string[] {
  return issuesOf(src, "/t/shape.js")
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("ok: no refine → no shape gate", () => {
    const r = issuesOf(`
function open(u) {
  return u;
}
open({ id: -1 });
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
    expect(ok.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("error: int refine rejects non-integer", () => {
    const r = issuesOf(`
/**
 * @nudo:contract n intId
 */
function take(n) { return n; }
take(1.5);
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
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
`, "/t/shape.js");
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.expected?.includes("length"))).toBe(true);
  });
});

/**
 * 嵌套字段位的两条契约门（prim 门 / element 门）。
 *
 * 口径基准是**同一条约束在顶层标量位的裁决**（`checkShapeReqs` /
 * `checkReqs`）与 guard / zod / standard 三面产物：它们对同一实参都判违例，
 * 嵌套位此前静默放行。
 */
const NESTED_SIDE = `
export const scalarField = shape({ x: number() });
export const arrField = shape({ a: array(number()) });
`;
const NESTED_FILE = "/t/nested-gate.js";
const NESTED_MARK = "nested-gate";

/** 单次调用的嵌套字段位诊断（error 面） */
function nestedErrors(
  arg: string,
  contract: "scalarField" | "arrField",
  prelude = "",
): { code: string; expected?: string }[] {
  const src = `/// @nudo:import { scalarField, arrField } from "./${NESTED_MARK}.nudo.js"
/**
 * @nudo:contract o ${contract}
 */
function f(o) { return 0; }
${prelude}f(${arg});
`;
  return checkSource(NESTED_FILE, src, pTrue, sidecarOpts(NESTED_MARK, NESTED_SIDE)).issues.filter(
    (i) => i.severity === "error",
  );
}

describe("nested field gate: number() on a确定 non-prim value", () => {
  it("nested number() rejects obj / arr / tuple / fn / brand with typeof text", () => {
    const cases = ["{ x: {} }", "{ x: [] }", "{ x: [1] }", "{ x: () => 1 }", "{ x: new Date(0) }"];
    for (const arg of cases) {
      const errs = nestedErrors(arg, "scalarField");
      expect(errs, arg).toHaveLength(1);
      expect(errs[0]!.code, arg).toBe("nudo:constraint-violated");
      expect(errs[0]!.expected, arg).toBe('typeof o.x = "number"');
    }
  });

  it("nested number() keeps the existing nullish violations", () => {
    for (const arg of ["{ x: null }", "{ x: undefined }"]) {
      const errs = nestedErrors(arg, "scalarField");
      expect(errs, arg).toHaveLength(1);
      expect(errs[0]!.expected, arg).toBe('typeof o.x = "number"');
    }
  });

  it("nested number() stays quiet on legal values (no new false red)", () => {
    expect(nestedErrors("{ x: 1 }", "scalarField")).toEqual([]);
    // 无信息实参（any / 未知标识符）不可证 ⇒ 不猜
    expect(nestedErrors("{ x: payload }", "scalarField", "const payload = getPayload();\n")).toEqual(
      [],
    );
  });

  it("nested number() matches the top-level scalar verdict on the same value", () => {
    // 同一 `{}` 实参：顶层 `number()` 报违例；嵌套字段位必须同结论
    const top = issuesOf(`
/**
 * @nudo:contract n num
 */
function take(n) { return 0; }
take({});
`).issues.filter((i) => i.severity === "error");
    expect(top.map((i) => i.expected)).toEqual(['typeof n = "number"']);
    expect(nestedErrors("{ x: {} }", "scalarField")[0]!.expected).toBe('typeof o.x = "number"');
  });
});

describe("nested field gate: array(...) requires an array", () => {
  it("nested array() rejects prim / string / null / object fields", () => {
    for (const arg of ["{ a: 5 }", '{ a: "s" }', "{ a: null }", "{ a: { x: 1 } }"]) {
      const errs = nestedErrors(arg, "arrField");
      expect(errs, arg).toHaveLength(1);
      expect(errs[0]!.code, arg).toBe("nudo:constraint-violated");
      expect(errs[0]!.expected, arg).toBe("array at o.a");
    }
  });

  it("nested array() on a real array still reports only the element position", () => {
    const errs = nestedErrors('{ a: [1, "x"] }', "arrField");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.code).toBe("nudo:constraint-violated");
    expect(errs[0]!.expected).toBe('typeof o.a[1] = "number"');
  });

  it("nested array() stays quiet on legal arrays (no new false red)", () => {
    expect(nestedErrors("{ a: [1, 2] }", "arrField")).toEqual([]);
    expect(nestedErrors("{ a: [] }", "arrField")).toEqual([]);
    expect(
      nestedErrors("{ a: payload }", "arrField", "const payload = getPayload();\n"),
    ).toEqual([]);
  });
});

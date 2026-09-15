import { describe, it, expect } from "vitest";
import {
  absToTypeValue,
  typeValueToAbs,
  getTvConfidence,
  numLit,
  numVar,
  gtNum,
  v,
  litValue,
  formatShape,
  analyzeFn,
  objOf,
  strLit,
  boolLit,
} from "../index.ts";
import { typeValueToString, T } from "../../type-value.ts";

describe("bridge Abs → TypeValue", () => {
  it("literal 4 → literal 4 #exact", () => {
    const tv = absToTypeValue(numLit(4));
    expect(tv.kind).toBe("literal");
    if (tv.kind === "literal") expect(tv.value).toBe(4);
    expect(getTvConfidence(tv)).toBe("exact");
  });

  it("plain number prim → primitive number", () => {
    const tv = absToTypeValue({
      shape: { k: "prim", type: "number" },
      conf: "exact",
    });
    expect(typeValueToString(tv)).toBe("number");
  });

  it("x>0 with pred → refined number", () => {
    const a = numVar("x", gtNum(v("x"), 0));
    const tv = absToTypeValue(a);
    // term 是 var，会丢 term；pred 可 encode 为 refined
    expect(tv.kind === "refined" || tv.kind === "primitive").toBe(true);
  });

  it("object slots map to object TypeValue", () => {
    const o = objOf({
      host: { value: strLit("localhost") },
      port: { value: numLit(8080) },
      debug: { value: boolLit(false) },
    });
    const tv = absToTypeValue(o);
    expect(tv.kind).toBe("object");
    expect(typeValueToString(tv)).toContain("host");
    expect(typeValueToString(tv)).toContain("8080");
  });
});

describe("bridge TypeValue → Abs", () => {
  it("literal 6 → Abs exact 6", () => {
    const abs = typeValueToAbs(T.literal(6));
    expect(litValue(abs)).toBe(6);
    expect(abs.conf).toBe("exact");
  });

  it("primitive string → prim string", () => {
    const abs = typeValueToAbs(T.string);
    expect(formatShape(abs)).toBe("string");
  });

  it("object → obj slots", () => {
    const abs = typeValueToAbs(
      T.object({ a: T.literal(1), b: T.string }),
    );
    expect(abs.shape.k).toBe("obj");
  });

  it("round-trip literal", () => {
    const tv = absToTypeValue(numLit(42));
    const back = typeValueToAbs(tv);
    expect(litValue(back)).toBe(42);
  });

  it("round-trip primitive (lossless)", () => {
    const abs0 = {
      shape: { k: "prim" as const, type: "number" as const },
      conf: "exact" as const,
    };
    const tv = absToTypeValue(abs0);
    const back = typeValueToAbs(tv);
    expect(formatShape(back)).toBe("number");
  });
});

describe("bridge any / conf / refined reverse (rewrite closeout)", () => {
  it("Abs any projects as unknown but keeps path conf (not partial)", () => {
    const a: import("../abs.ts").Abs = { shape: { k: "any" }, conf: "path" };
    const tv = absToTypeValue(a);
    expect(tv.kind).toBe("unknown");
    expect(getTvConfidence(tv)).toBe("path");
  });

  it("Abs analysis-fail unknown keeps partial conf", () => {
    const a: import("../abs.ts").Abs = { shape: { k: "unknown" }, conf: "partial" };
    const tv = absToTypeValue(a);
    expect(tv.kind).toBe("unknown");
    expect(getTvConfidence(tv)).toBe("partial");
  });

  it("widened TypeValue does not round-trip as exact", () => {
    const src = `
      function scale(x) { return x + 1; }
    `;
    const r = analyzeFn(src, "scale", [numVar("x")]);
    const tv = absToTypeValue(r);
    const back = typeValueToAbs(tv);
    expect(back.conf === "exact").toBe(false);
  });

  it("refined numeric pred reverse-encodes into Abs pred", () => {
    const a = numVar("x", gtNum(v("x"), 0));
    const tv = absToTypeValue(a);
    expect(tv.kind).toBe("refined");
    const back = typeValueToAbs(tv);
    expect(back.shape.k).toBe("prim");
    expect(back.pred).toBeDefined();
    expect(back.pred!.op).toBe("gt");
    // pred 右端恢复为字面量 0
    if (back.pred!.op === "gt") {
      expect(back.pred!.b.op).toBe("lit");
      if (back.pred!.b.op === "lit") expect(back.pred!.b.value).toBe(0);
    }
  });

  it("refined le reverse-encodes", () => {
    const a: import("../abs.ts").Abs = {
      shape: { k: "prim", type: "number" },
      term: v("n"),
      pred: { op: "le", a: v("n"), b: { op: "lit", value: 10 } },
      conf: "path",
    };
    const tv = absToTypeValue(a);
    expect(tv.kind).toBe("refined");
    const back = typeValueToAbs(tv);
    expect(back.pred?.op).toBe("le");
  });
});

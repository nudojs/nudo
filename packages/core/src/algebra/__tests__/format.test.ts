import { describe, it, expect } from "vitest";
import { formatShape, formatAbs } from "../format.ts";
import { abs, num, str } from "../abs.ts";
import { v, lit } from "../term.ts";
import { ge } from "../pred.ts";

describe("formatShape brand/eff/fn", () => {
  it("brand shows class name", () => {
    const inner = abs(num().shape, undefined, undefined, "exact");
    const a = abs({ k: "brand", name: "Counter", shape: inner }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("Counter");
  });

  it("eff shows promise inner", () => {
    const inner = abs(num().shape, undefined, undefined, "exact");
    const a = abs({ k: "eff", eff: "promise", inner }, undefined, undefined, "exact");
    expect(formatShape(a)).toBe("promise<number>");
  });

  it("fn shows return shape when present", () => {
    const a = abs(
      { k: "fn", params: ["x"], returnType: abs(num().shape, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("(x) => number");
  });

  it("fn rest param label renders ...name: type", () => {
    const strT = str();
    const a = abs(
      {
        k: "fn",
        params: ["x0", "...paths"],
        paramTypes: [strT, strT],
        returnType: strT,
      },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("(string, ...paths: string) => string");
  });

  it("fn optional param label renders name?: type", () => {
    const objT = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    const brand = abs({ k: "brand", name: "EventEmitter", shape: objT }, undefined, undefined, "exact");
    const a = abs(
      {
        k: "fn",
        params: ["options?"],
        paramTypes: [objT],
        returnType: brand,
      },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("(options?: {  }) => EventEmitter");
  });

  it("fn rest-only with paramTypes renders (...paths: type)", () => {
    const strT = str();
    const a = abs(
      {
        k: "fn",
        params: ["...paths"],
        paramTypes: [strT],
        returnType: strT,
      },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("(...paths: string) => string");
  });

  it("Map/Set brand shows type args from __key/__value/__elem", () => {
    const strT = abs(str().shape, undefined, undefined, "exact");
    const numT = abs(num().shape, undefined, undefined, "exact");
    const map = abs(
      {
        k: "brand",
        name: "Map",
        shape: abs(
          {
            k: "obj",
            slots: { __key: { value: strT }, __value: { value: numT } },
          },
          undefined,
          undefined,
          "exact",
        ),
      },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(map)).toBe("Map<string, number>");
    const set = abs(
      {
        k: "brand",
        name: "Set",
        shape: abs(
          { k: "obj", slots: { __elem: { value: numT } } },
          undefined,
          undefined,
          "exact",
        ),
      },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(set)).toBe("Set<number>");
    const bare = abs({ k: "brand", name: "Map", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") }, undefined, undefined, "exact");
    expect(formatShape(bare)).toBe("Map");
  });

  it("Map type vars render as α names", () => {
    const K = abs({ k: "any" }, v("K"), undefined, "path");
    const V = abs({ k: "any" }, v("V"), undefined, "path");
    const map = abs(
      {
        k: "brand",
        name: "Map",
        shape: abs(
          {
            k: "obj",
            slots: { __key: { value: K }, __value: { value: V } },
          },
          undefined,
          undefined,
          "path",
        ),
      },
      undefined,
      undefined,
      "path",
    );
    expect(formatShape(map)).toBe("Map<K, V>");
  });

  it("formatAbs still includes pred", () => {
    const a = abs(num().shape, v("x"), ge(v("x"), lit(0)), "path");
    expect(formatAbs(a)).toContain("0");
  });
});

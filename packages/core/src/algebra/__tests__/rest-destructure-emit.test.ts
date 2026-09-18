import { describe, it, expect } from "vitest";
import { transpile } from "../exec/transpile.ts";
import { $obj, $objRest, $get, $orDefault, formatAbs } from "@nudojs/core";
import { numLit } from "@nudojs/core";

describe("RestElement emit + rest runtime", () => {
  it("transpile emits $objRest / $arrRest", () => {
    const objSrc = `function f(o) { const { a, ...rest } = o; return rest; }`;
    const arrSrc = `function g(xs) { const [h, ...t] = xs; return t; }`;
    expect(transpile(objSrc)).toContain("$objRest");
    expect(transpile(arrSrc)).toContain("$arrRest");
  });

  it("$objRest drops named keys", () => {
    const o = $obj({ a: numLit(1), b: numLit(2) } as never);
    const rest = $objRest(o, ["a"]);
    const b = $get(rest, "b");
    expect(formatAbs(b)).toContain("2");
  });
});

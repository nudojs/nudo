import { describe, it, expect, afterEach } from "vitest";
import { createEnvironment, typeValueToString, T } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { evaluateFunctionFull, resetMemo } from "../evaluator/evaluator.ts";
import { resetPhi } from "../evaluator/abs-route.ts";

function runFn(src: string, args: any[]) {
  resetPhi();
  resetMemo();
  const ast = parse(src);
  const fnNode = (ast.program.body as any[]).find(
    (s) => s.type === "FunctionDeclaration",
  );
  return evaluateFunctionFull(fnNode, args, createEnvironment()).value;
}

describe("object spread algebra routing", () => {
  afterEach(() => {
    resetPhi();
  });

  it("spread keeps literal fields: defaults ⊕ {port:3000}", () => {
    const src = `
      function createConfig(options) {
        return {
          host: "localhost",
          port: 8080,
          debug: false,
          ...options,
        };
      }
    `;
    const over = T.object({ port: T.literal(3000), debug: T.literal(true) });
    const on = runFn(src, [over]);

    expect(on.kind).toBe("object");
    if (on.kind !== "object") return;
    expect(typeValueToString(on.properties.host!)).toBe('"localhost"');
    expect(typeValueToString(on.properties.port!)).toBe("3000");
    expect(typeValueToString(on.properties.debug!)).toBe("true");
  });

  it("empty spread keeps all defaults", () => {
    const src = `
      function c(options) {
        return { a: 1, b: "x", ...options };
      }
    `;
    const on = runFn(src, [T.object({})]);
    expect(on.kind).toBe("object");
    if (on.kind !== "object") return;
    expect(typeValueToString(on.properties.a!)).toBe("1");
    expect(typeValueToString(on.properties.b!)).toBe('"x"');
  });

  it("object without spread unchanged", () => {
    const src = `function f() { return { x: 1, y: 2 }; }`;
    const on = runFn(src, []);
    expect(typeValueToString(on)).toBe('{ x: 1, y: 2 }');
  });
});

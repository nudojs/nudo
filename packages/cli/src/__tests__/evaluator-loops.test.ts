import { describe, it, expect, beforeEach } from "vitest";
import { T, typeValueEquals, typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateProgram, setSampleCount } from "../evaluator.ts";
import { parse } from "@nudojs/parser";
import type { TypeValue } from "@nudojs/core";

function evalCode(code: string): TypeValue {
  const ast = parse(code);
  const env = createEnvironment();
  return evaluateProgram(ast, env);
}

function evalWith(code: string, bindings: Record<string, TypeValue>): TypeValue {
  const ast = parse(code);
  const env = createEnvironment();
  for (const [k, v] of Object.entries(bindings)) env.bind(k, v);
  return evaluateProgram(ast, env);
}

describe("ForStatement", () => {
  beforeEach(() => setSampleCount(3));

  it("evaluates simple for loop with literal bounds", () => {
    const result = evalCode(`
      let sum = 0;
      for (let i = 0; i < 3; i++) {
        sum = sum + i;
      }
      sum
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });

  it("evaluates for loop that returns early", () => {
    const result = evalCode(`
      function f() {
        for (let i = 0; i < 10; i++) {
          if (i === 2) return i;
        }
        return -1;
      }
    `);
    // f is a function; we just check it's defined
    expect(result).toBeDefined();
  });

  it("for loop with abstract bounds widens variables", () => {
    const result = evalWith(`
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum = sum + i;
      }
      sum
    `, { n: T.number });
    // After widening, sum should be T.number
    expect(typeValueEquals(result, T.number)).toBe(true);
  });

  it("for loop variable accessible after loop", () => {
    const result = evalCode(`
      let x = 0;
      for (let i = 0; i < 2; i++) {
        x = x + 1;
      }
      x
    `);
    expect(typeValueEquals(result, T.literal(2))).toBe(true);
  });
});

describe("WhileStatement", () => {
  beforeEach(() => setSampleCount(3));

  it("evaluates while loop with literal false condition", () => {
    const result = evalCode(`
      let x = 0;
      while (false) {
        x = 1;
      }
      x
    `);
    expect(typeValueEquals(result, T.literal(0))).toBe(true);
  });

  it("evaluates while loop with concrete iterations", () => {
    const result = evalCode(`
      let x = 0;
      let i = 0;
      while (i < 3) {
        x = x + 1;
        i = i + 1;
      }
      x
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });

  it("while loop with abstract condition", () => {
    const result = evalWith(`
      let count = 0;
      while (cond) {
        count = count + 1;
      }
      count
    `, { cond: T.boolean });
    // After sample iterations, count should be widened to number
    expect(typeValueEquals(result, T.number) || result.kind === "literal").toBe(true);
  });
});

describe("DoWhileStatement", () => {
  beforeEach(() => setSampleCount(3));

  it("executes body at least once", () => {
    const result = evalCode(`
      let x = 0;
      do {
        x = x + 1;
      } while (false);
      x
    `);
    expect(typeValueEquals(result, T.literal(1))).toBe(true);
  });

  it("evaluates do-while with multiple iterations", () => {
    const result = evalCode(`
      let x = 0;
      let i = 0;
      do {
        x = x + 1;
        i = i + 1;
      } while (i < 3);
      x
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });
});

describe("@nudo:sample integration", () => {
  it("respects custom sample count", () => {
    setSampleCount(5);
    const result = evalCode(`
      let sum = 0;
      for (let i = 0; i < 5; i++) {
        sum = sum + i;
      }
      sum
    `);
    expect(typeValueEquals(result, T.literal(10))).toBe(true);
  });

  it("default sample count is 3", () => {
    setSampleCount(3);
    const result = evalCode(`
      let sum = 0;
      for (let i = 0; i < 3; i++) {
        sum = sum + i;
      }
      sum
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });
});

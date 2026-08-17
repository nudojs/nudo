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

  it("let loop variable gets a fresh binding per iteration for closures", () => {
    // Real JS semantics: let creates a per-iteration scope, so each closure
    // captures the value at its own iteration.
    const result = evalCode(`
      const fns = [];
      for (let i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      [fns[0](), fns[1](), fns[2]()]
    `);
    expect(typeValueToString(result)).toBe("[0, 1, 2]");
  });

  it("var loop variable shares one binding across iterations for closures", () => {
    // var keeps a single shared cell: every closure observes the final value.
    const result = evalCode(`
      const fns = [];
      for (var i = 0; i < 3; i++) {
        fns.push(() => i);
      }
      [fns[0](), fns[1](), fns[2]()]
    `);
    expect(typeValueToString(result)).toBe("[3, 3, 3]");
  });

  it("let loop closure sees body-side increments; loop still progresses", () => {
    // Real JS: an assignment in the body targets the per-iteration binding
    // the closure captured (node: fns[0]() === 1), unlike the update clause
    // which runs outside it. No update clause here — the copy-back from the
    // per-iteration binding must still drive the loop condition.
    const result = evalCode(`
      const fns = [];
      let total = 0;
      for (let i = 0; i < 3;) {
        fns.push(() => i);
        total = total + i;
        i = i + 1;
      }
      [fns[0](), total]
    `);
    expect(typeValueToString(result)).toBe("[1, 3]");
  });

  it("for-of over a union of tuples iterates every member", () => {
    const result = evalWith(`
      function pick(c) {
        if (c) { return [9]; }
        return [10, [11, 12]];
      }
      function f(a, t) {
        const r = t || [];
        for (const e of a) {
          if (Array.isArray(e)) { f(e, r) } else { r.push(e) }
        }
        return r;
      }
      f(pick(c))
    `, { c: T.boolean });
    // Both union members' elements flow through the body (concatenated),
    // including the recursive flattening of the nested [11, 12] member.
    // (typeValueEquals has no tuple branch — compare rendered form.)
    expect(typeValueToString(result)).toBe("[9, 10, 11, 12]");
  });

  it("for-of over a union with non-iterable members skips them", () => {
    const result = evalWith(`
      function pick(c) {
        if (c) { return [1, 2]; }
        if (c === 2) { return 42; }
        return "str";
      }
      function f(a, t) {
        const r = t || [];
        for (const e of a) {
          if (Array.isArray(e)) { f(e, r) } else { r.push(e) }
        }
        return r;
      }
      f(pick(c))
    `, { c: T.boolean });
    // number/string members of the union contribute nothing; the tuple
    // member's pushes still land on the shared accumulator.
    expect(typeValueToString(result)).toBe("[1, 2]");
  });

  it("break terminates loop iteration and skips the rest of the body", () => {
    // Guard-style break (reach.js pattern): the member access after break
    // must not execute on the falsy receiver. Before break was implemented
    // the loop kept evaluating the body and dereferenced the undefined ref.
    const result = evalWith(`
      function step(ref, key) {
        let out = null;
        for (const k of [key]) {
          if (!ref) {
            out = 'default';
            break;
          }
          out = ref[k];
        }
        return out;
      }
      step(ref, 'a')
    `, { ref: T.undefined });
    expect(typeValueToString(result)).toBe('"default"');
  });

  it("break stops the loop and continue skips to the update clause", () => {
    const result = evalCode(`
      const collected = [];
      for (let i = 0; i < 5; i++) {
        if (i === 1) { continue; }
        if (i === 3) { break; }
        collected.push(i);
      }
      collected
    `);
    // continue skips push(1); break stops before 3 and 4
    expect(typeValueToString(result)).toBe("[0, 2]");
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

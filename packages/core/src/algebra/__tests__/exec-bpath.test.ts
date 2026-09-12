import { describe, it, expect } from "vitest";
import {
  $add,
  $lt,
  $lit,
  $fork,
  $for,
  $forIter,
  num,
  numVar,
  litValue,
  transpile,
} from "@nudojs/core";

describe("B-path runtime ops", () => {
  it("add(lit, lit) stays exact literal", () => {
    const r = $add($lit(1), $lit(3));
    expect(litValue(r)).toBe(4);
  });

  it("add(number, lit) is number", () => {
    const r = $add(num(), $lit(1));
    expect(r.shape.k).toBe("prim");
    if (r.shape.k === "prim") expect(r.shape.type).toBe("number");
  });

  it("add(var, lit) keeps term identity", () => {
    const r = $add(numVar("x"), $lit(1));
    expect(r.term?.op).toBe("app");
  });
});

describe("B-path $fork", () => {
  it("literal true takes consequent only", () => {
    const r = $fork($lit(true), () => $lit(1), () => $lit(2));
    expect(litValue(r)).toBe(1);
  });

  it("literal false takes alternate only", () => {
    const r = $fork($lit(false), () => $lit(1), () => $lit(2));
    expect(litValue(r)).toBe(2);
  });

  it("abstract boolean joins both branches", () => {
    const cond = {
      shape: { k: "prim" as const, type: "boolean" as const },
      conf: "exact" as const,
    };
    const r = $fork(cond, () => $lit(1), () => $lit(2));
    expect(litValue(r)).toBeUndefined();
  });
});

describe("B-path $for (bounded)", () => {
  it("concrete trip count: i goes 0→3", () => {
    const r = $for(
      $lit(0),
      (s) => $lt(s, $lit(3)),
      (s) => $add(s, $lit(1)),
      (s) => s,
      8,
    );
    expect(litValue(r)).toBe(3);
  });

  it("abstract bound terminates within budget", () => {
    const n = num();
    const r = $for(
      $lit(0),
      (s) => $lt(s, n),
      (s) => $add(s, $lit(1)),
      (s) => s,
      4,
    );
    expect(r).toBeDefined();
    expect(r.conf).not.toBe("opaque");
  });

  it("generator yields at most maxIters", () => {
    const states = [
      ...$forIter(
        $lit(0),
        () => $lit(true),
        (s) => $add(s, $lit(1)),
        (s) => s,
        5,
      ),
    ];
    expect(states.length).toBe(5);
  });
});

describe("B-path transpile", () => {
  it("rewrites + to $add", () => {
    const out = transpile(`function add(a, b) { return a + b; }`, {
      runtimeImport: "@nudojs/core/exec",
    });
    expect(out).toContain("$add(a, b)");
    expect(out).not.toMatch(/return a \+ b/);
  });

  it("rewrites if to $fork", () => {
    const out = transpile(`function f(x) { if (x > 0) { return 1; } return 2; }`, {
      runtimeImport: "@nudojs/core/exec",
    });
    expect(out).toContain("$fork(");
    expect(out).toContain("$gt(");
  });

  it("emits $for for classic counting loops", () => {
    const out = transpile(
      `function sum(n) { let i = 0; for (let i = 0; i < n; i = i + 1) {} return i; }`,
      { runtimeImport: "@nudojs/core/exec", maxLoopIters: 4 },
    );
    expect(out).toContain("$for(");
  });
});

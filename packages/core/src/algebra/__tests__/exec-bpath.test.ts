import { describe, it, expect } from "vitest";
import {
  $add,
  $lt,
  $lit,
  $fork,
  $for,
  $forIter,
  $obj,
  $get,
  $set,
  $while,
  $whileSeq,
  num,
  numVar,
  litValue,
  absToString,
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

describe("B-path objects", () => {
  it("$get reads slots; miss is undefined", () => {
    const o = $obj({ id: $lit(1), name: $lit("Ada") });
    expect(litValue($get(o, "id"))).toBe(1);
    expect(litValue($get(o, "name"))).toBe("Ada");
    expect(litValue($get(o, "missing"))).toBeUndefined();
    expect(absToString($get(o, "missing"))).toContain("undefined");
  });

  it("$set returns new object with updated slot", () => {
    const o = $obj({ id: $lit(1) });
    const o2 = $set(o, "id", $lit(2));
    expect(litValue($get(o, "id"))).toBe(1);
    expect(litValue($get(o2, "id"))).toBe(2);
  });
});

describe("B-path $while", () => {
  it("concrete countdown", () => {
    const r = $while(
      $obj({ i: $lit(3), acc: $lit(0) }),
      (s) => $lt($lit(0), $get(s, "i")),
      (s) => $set($set(s, "acc", $add($get(s, "acc"), $get(s, "i"))), "i", $lit(0)),
      8,
    );
    // i>0 false immediately after first step sets i=0... actually first test 0<3 true
    // step: acc=0+3=3, i=0 → next test 0<0 false → exit  {i:0, acc:3}
    expect(litValue($get(r, "acc"))).toBe(3);
  });

  it("$whileSeq runs body while test true", () => {
    let i = $lit(0);
    const hits: number[] = [];
    $whileSeq(
      () => $lt(i, $lit(3)),
      () => {
        hits.push(litValue(i) as number);
        i = $add(i, $lit(1));
      },
      8,
    );
    expect(hits).toEqual([0, 1, 2]);
    expect(litValue(i)).toBe(3);
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

  it("rewrites object literal and member access", () => {
    const out = transpile(
      `function make() { const o = { id: 1, name: "x" }; return o.id; }`,
      { runtimeImport: "@nudojs/core/exec" },
    );
    expect(out).toContain("$obj(");
    expect(out).toContain('$get(o, "id")');
  });

  it("rewrites while to $whileSeq", () => {
    const out = transpile(
      `function f(n) { let i = 0; while (i < n) { i = i + 1; } return i; }`,
      { runtimeImport: "@nudojs/core/exec", maxLoopIters: 5 },
    );
    expect(out).toContain("$whileSeq(");
  });

  it("rewrites obj.field = v to $set", () => {
    const out = transpile(`function f() { const o = { a: 1 }; o.a = 2; return o; }`, {
      runtimeImport: "@nudojs/core/exec",
    });
    expect(out).toContain("$set(");
  });
});

import { describe, it, expect } from "vitest";
import { T, typeValueEquals, typeValueToString, createEnvironment, isSubtypeOf } from "@nudo/core";
import { parse } from "@nudo/parser";
import { evaluateFunction, evaluateProgram } from "../evaluator.ts";

function evalExpr(source: string) {
  const ast = parse(source);
  return evaluateProgram(ast, createEnvironment());
}

// --- Destructuring ---

describe("Object destructuring", () => {
  it("basic object destructuring", () => {
    const result = evalExpr(`
      const obj = { x: 1, y: 2 };
      const { x, y } = obj;
      x + y;
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });

  it("destructuring with default value", () => {
    const result = evalExpr(`
      const obj = { x: 1 };
      const { x, y = 10 } = obj;
      y;
    `);
    expect(typeValueEquals(result, T.literal(10))).toBe(true);
  });

  it("destructuring uses value when present (not default)", () => {
    const result = evalExpr(`
      const obj = { x: 1, y: 5 };
      const { y = 10 } = obj;
      y;
    `);
    expect(typeValueEquals(result, T.literal(5))).toBe(true);
  });

  it("nested object destructuring", () => {
    const result = evalExpr(`
      const obj = { a: { b: 42 } };
      const { a: { b } } = obj;
      b;
    `);
    expect(typeValueEquals(result, T.literal(42))).toBe(true);
  });

  it("rest element in object destructuring", () => {
    const result = evalExpr(`
      const obj = { x: 1, y: 2, z: 3 };
      const { x, ...rest } = obj;
      rest;
    `);
    if (result.kind === "object") {
      expect(typeValueEquals(result.properties.y, T.literal(2))).toBe(true);
      expect(typeValueEquals(result.properties.z, T.literal(3))).toBe(true);
      expect(result.properties.x).toBeUndefined();
    } else {
      expect(result.kind).toBe("object");
    }
  });
});

describe("Array destructuring", () => {
  it("basic array destructuring", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      const [a, b, c] = arr;
      a + b + c;
    `);
    expect(typeValueEquals(result, T.literal(6))).toBe(true);
  });

  it("array destructuring with skip", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      const [, , c] = arr;
      c;
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });

  it("array destructuring with rest", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3, 4];
      const [first, ...rest] = arr;
      rest;
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(3);
      expect(typeValueEquals(result.elements[0], T.literal(2))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });

  it("array destructuring with default", () => {
    const result = evalExpr(`
      const arr = [1];
      const [a, b = 99] = arr;
      b;
    `);
    expect(typeValueEquals(result, T.literal(99))).toBe(true);
  });
});

describe("Destructuring in function params", () => {
  it("object destructuring in function params", () => {
    const result = evalExpr(`
      function getX({ x }) { return x; }
      getX({ x: 42, y: 10 });
    `);
    expect(typeValueEquals(result, T.literal(42))).toBe(true);
  });

  it("array destructuring in function params", () => {
    const result = evalExpr(`
      const getFirst = ([a, b]) => a + b;
      getFirst([3, 7]);
    `);
    expect(typeValueEquals(result, T.literal(10))).toBe(true);
  });

  it("default values in function param destructuring", () => {
    const result = evalExpr(`
      function greet({ name = "world" }) { return name; }
      greet({});
    `);
    expect(typeValueEquals(result, T.literal("world"))).toBe(true);
  });
});

// --- Spread operator ---

describe("Spread in object expression", () => {
  it("spreads object properties", () => {
    const result = evalExpr(`
      const a = { x: 1, y: 2 };
      const b = { ...a, z: 3 };
      b;
    `);
    if (result.kind === "object") {
      expect(typeValueEquals(result.properties.x, T.literal(1))).toBe(true);
      expect(typeValueEquals(result.properties.y, T.literal(2))).toBe(true);
      expect(typeValueEquals(result.properties.z, T.literal(3))).toBe(true);
    } else {
      expect(result.kind).toBe("object");
    }
  });

  it("later properties override spread", () => {
    const result = evalExpr(`
      const a = { x: 1, y: 2 };
      const b = { ...a, x: 99 };
      b.x;
    `);
    expect(typeValueEquals(result, T.literal(99))).toBe(true);
  });
});

describe("Spread in array expression", () => {
  it("spreads tuple into array", () => {
    const result = evalExpr(`
      const a = [1, 2];
      const b = [...a, 3, 4];
      b;
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(4);
      expect(typeValueEquals(result.elements[0], T.literal(1))).toBe(true);
      expect(typeValueEquals(result.elements[3], T.literal(4))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });

  it("spreads at beginning and end", () => {
    const result = evalExpr(`
      const a = [2, 3];
      const b = [1, ...a, 4];
      b;
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(4);
      expect(typeValueEquals(result.elements[0], T.literal(1))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal(2))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

// --- Mutability tracking ---

describe("Object mutability", () => {
  it("MemberExpression assignment modifies object in place", () => {
    const result = evalExpr(`
      const obj = { x: 1 };
      obj.x = 2;
      obj.x;
    `);
    expect(typeValueEquals(result, T.literal(2))).toBe(true);
  });

  it("alias shares reference", () => {
    const result = evalExpr(`
      const obj = { x: 1 };
      const alias = obj;
      alias.x = 99;
      obj.x;
    `);
    expect(typeValueEquals(result, T.literal(99))).toBe(true);
  });

  it("adding new property to object", () => {
    const result = evalExpr(`
      const obj = { x: 1 };
      obj.y = 2;
      obj.y;
    `);
    expect(typeValueEquals(result, T.literal(2))).toBe(true);
  });
});

// --- Array.prototype methods ---

describe("Array.prototype.map", () => {
  it("maps over tuple with literal callback", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.map((x) => x + 10);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(3);
      expect(typeValueEquals(result.elements[0], T.literal(11))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal(12))).toBe(true);
      expect(typeValueEquals(result.elements[2], T.literal(13))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });

  it("maps over tuple producing different types", () => {
    const result = evalExpr(`
      const arr = [1, "hello", true];
      arr.map((x) => typeof x);
    `);
    if (result.kind === "tuple") {
      expect(typeValueEquals(result.elements[0], T.literal("number"))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal("string"))).toBe(true);
      expect(typeValueEquals(result.elements[2], T.literal("boolean"))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

describe("Array.prototype.filter", () => {
  it("filters tuple with concrete predicate", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3, 4];
      arr.filter((x) => x > 2);
    `);
    expect(result.kind).toBe("array");
  });

  it("filters tuple removing known-false elements", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.filter((x) => x === 2);
    `);
    expect(result.kind).toBe("array");
  });
});

describe("Array.prototype.reduce", () => {
  it("reduces tuple with initial value", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.reduce((acc, x) => acc + x, 0);
    `);
    expect(typeValueEquals(result, T.literal(6))).toBe(true);
  });

  it("reduces tuple without initial value", () => {
    const result = evalExpr(`
      const arr = [10, 20, 30];
      arr.reduce((acc, x) => acc + x);
    `);
    expect(typeValueEquals(result, T.literal(60))).toBe(true);
  });
});

describe("Array.prototype.find", () => {
  it("find returns element | undefined", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.find((x) => x > 1);
    `);
    const str = typeValueToString(result);
    expect(str).toContain("undefined");
  });
});

describe("Array.prototype.some/every", () => {
  it("some on tuple with concrete values", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.some((x) => x === 2);
    `);
    expect(typeValueEquals(result, T.literal(true))).toBe(true);
  });

  it("every on tuple with concrete values", () => {
    const result = evalExpr(`
      const arr = [2, 4, 6];
      arr.every((x) => x > 0);
    `);
    expect(typeValueEquals(result, T.literal(true))).toBe(true);
  });

  it("every returns false when not all match", () => {
    const result = evalExpr(`
      const arr = [2, 4, -1];
      arr.every((x) => x > 0);
    `);
    expect(typeValueEquals(result, T.literal(false))).toBe(true);
  });
});

describe("Array.prototype.push", () => {
  it("push modifies tuple in place", () => {
    const result = evalExpr(`
      const arr = [1, 2];
      arr.push(3);
      arr;
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(3);
      expect(typeValueEquals(result.elements[2], T.literal(3))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });

  it("push returns new length", () => {
    const result = evalExpr(`
      const arr = [1, 2];
      arr.push(3);
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });
});

describe("Array.prototype misc", () => {
  it("forEach returns undefined", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.forEach((x) => x + 1);
    `);
    expect(typeValueEquals(result, T.undefined)).toBe(true);
  });

  it("includes with literal value", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.includes(2);
    `);
    expect(typeValueEquals(result, T.literal(true))).toBe(true);
  });

  it("indexOf returns number", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.indexOf(2);
    `);
    expect(typeValueEquals(result, T.number)).toBe(true);
  });

  it("join returns string", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      arr.join(",");
    `);
    expect(typeValueEquals(result, T.string)).toBe(true);
  });

  it("slice on tuple", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3, 4];
      arr.slice(1, 3);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(2);
      expect(typeValueEquals(result.elements[0], T.literal(2))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal(3))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });

  it("concat tuples", () => {
    const result = evalExpr(`
      const a = [1, 2];
      const b = [3, 4];
      a.concat(b);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(4);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

// --- Object static methods ---

describe("Object.keys", () => {
  it("returns tuple of literal keys for known object", () => {
    const result = evalExpr(`
      const obj = { x: 1, y: 2, z: 3 };
      Object.keys(obj);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(3);
      expect(typeValueEquals(result.elements[0], T.literal("x"))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal("y"))).toBe(true);
      expect(typeValueEquals(result.elements[2], T.literal("z"))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

describe("Object.values", () => {
  it("returns tuple of values for known object", () => {
    const result = evalExpr(`
      const obj = { x: 1, y: "hello" };
      Object.values(obj);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(2);
      expect(typeValueEquals(result.elements[0], T.literal(1))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal("hello"))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

describe("Object.entries", () => {
  it("returns tuple of [key, value] tuples", () => {
    const result = evalExpr(`
      const obj = { a: 1, b: 2 };
      Object.entries(obj);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(2);
      const first = result.elements[0];
      if (first.kind === "tuple") {
        expect(typeValueEquals(first.elements[0], T.literal("a"))).toBe(true);
        expect(typeValueEquals(first.elements[1], T.literal(1))).toBe(true);
      }
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

// --- for-of / for-in ---

describe("for-of loop", () => {
  it("iterates over tuple elements", () => {
    const result = evalExpr(`
      const arr = [1, 2, 3];
      let sum = 0;
      for (const x of arr) {
        sum = sum + x;
      }
      sum;
    `);
    expect(typeValueEquals(result, T.literal(6))).toBe(true);
  });

  it("for-of with destructuring", () => {
    const result = evalExpr(`
      const pairs = [[1, "a"], [2, "b"]];
      let total = 0;
      for (const [num] of pairs) {
        total = total + num;
      }
      total;
    `);
    expect(typeValueEquals(result, T.literal(3))).toBe(true);
  });
});

describe("for-in loop", () => {
  it("iterates over object keys", () => {
    const result = evalExpr(`
      const obj = { a: 1, b: 2, c: 3 };
      const keys = [];
      for (const k in obj) {
        keys.push(k);
      }
      keys;
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(3);
      expect(typeValueEquals(result.elements[0], T.literal("a"))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

// --- Integration: combining features ---

describe("Integration: map + destructuring", () => {
  it("maps objects and destructures", () => {
    const result = evalExpr(`
      const items = [{ name: "a", value: 1 }, { name: "b", value: 2 }];
      items.map(({ name, value }) => value + 10);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(2);
      expect(typeValueEquals(result.elements[0], T.literal(11))).toBe(true);
      expect(typeValueEquals(result.elements[1], T.literal(12))).toBe(true);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

describe("Integration: spread + Object methods", () => {
  it("Object.keys after spread merge", () => {
    const result = evalExpr(`
      const a = { x: 1 };
      const b = { y: 2 };
      const merged = { ...a, ...b };
      Object.keys(merged);
    `);
    if (result.kind === "tuple") {
      expect(result.elements).toHaveLength(2);
    } else {
      expect(result.kind).toBe("tuple");
    }
  });
});

describe("Integration: reduce with object accumulator", () => {
  it("builds object via reduce", () => {
    const result = evalExpr(`
      const pairs = [["a", 1], ["b", 2]];
      pairs.reduce((acc, [key, val]) => {
        acc[key] = val;
        return acc;
      }, {});
    `);
    expect(result.kind).toBe("object");
  });
});

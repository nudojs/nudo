import { describe, it, expect } from "vitest";
import { listTopFunctions } from "../scan.ts";
import { localNamedExports, effectiveInterface, formatConstraint } from "../interface.ts";
import { generalizeFromAst } from "../generalize.ts";
import { number, fn } from "../constraint.ts";

function makeFiles(files: Record<string, string>) {
  const resolve = (from: string, spec: string): string => {
    if (!spec.startsWith(".")) return spec;
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  return {
    loadModule: (spec: string, from: string): string | undefined =>
      files[resolve(from, spec)],
  };
}

const STORE = `
export class MemoryStore {
  constructor() {
    this.items = {};
  }
  set(key, value) {
    this.items[key] = value;
    return true;
  }
  get(key) {
    return this.items[key];
  }
  static create() {
    return new MemoryStore();
  }
}
`;

describe("C4.2 class method surface", () => {
  it("listTopFunctions includes exported Class.method, skips ctor/get; static included", () => {
    const names = listTopFunctions(STORE);
    expect(names).toContain("MemoryStore.set");
    expect(names).toContain("MemoryStore.get");
    expect(names.filter((n) => n.includes("constructor"))).toEqual([]);
    // static methods are consumer-visible entry keys (design §3.2)
    expect(names.filter((n) => n.includes("create"))).toEqual(["MemoryStore.create"]);
  });

  it("localNamedExports registers Class.method keys", () => {
    const exp = localNamedExports(STORE);
    expect(exp.has("MemoryStore")).toBe(true);
    expect(exp.has("MemoryStore.set")).toBe(true);
    expect(exp.has("MemoryStore.get")).toBe(true);
  });

  it("generalize extractFn finds MemoryStore.set", () => {
    const g = generalizeFromAst("MemoryStore.set", STORE);
    expect(g).toBeDefined();
    expect(g!.params).toEqual(["key", "value"]);
  });
});

describe("C4.2 class methods via export list / export default", () => {
  const LOCAL_EXPORT_LIST = `
class Foo {
  bar(x) { return x + 1; }
  static make() { return new Foo(); }
  get hidden() { return 1; }
}
export { Foo };
`;
  const LOCAL_EXPORT_DEFAULT = `
class Store {
  get(key) { return key; }
}
export default Store;
`;
  const EXPORT_ALIAS = `
class Local {
  run() { return 1; }
}
export { Local as Public };
`;

  it("listTopFunctions includes Class.method for export { Foo }", () => {
    const names = listTopFunctions(LOCAL_EXPORT_LIST);
    expect(names).toContain("Foo.bar");
    // static methods are consumer-visible entry keys (design §3.2)
    expect(names.filter((n) => n.includes("make"))).toEqual(["Foo.make"]);
    expect(names.filter((n) => n.includes("hidden"))).toEqual([]);
  });

  it("listTopFunctions includes Class.method for export default Foo", () => {
    const names = listTopFunctions(LOCAL_EXPORT_DEFAULT);
    expect(names).toContain("Store.get");
  });

  it("listTopFunctions uses declaration name for export { Local as Public }", () => {
    const names = listTopFunctions(EXPORT_ALIAS);
    expect(names).toContain("Local.run");
  });

  it("localNamedExports registers Class.method for export list", () => {
    const exp = localNamedExports(LOCAL_EXPORT_LIST);
    expect(exp.has("Foo")).toBe(true);
    expect(exp.has("Foo.bar")).toBe(true);
  });

  it("sidecar binds Class.method for export list form", () => {
    const { loadModule } = makeFiles({
      "/t/foo.nudo.js": `export const Foo_bar = fn({ x: number() }, number());`,
    });
    const r = effectiveInterface(LOCAL_EXPORT_LIST, "Foo.bar", {
      loadModule,
      fromFile: "/t/foo.js",
    });
    expect(r).toBeDefined();
    expect(r!.source).toBe("handwritten");
    expect(formatConstraint(r!.params[0]!.constraint)).toBe("number()");
  });

  it("localNamedExports registers Class.method for export default named binding", () => {
    const exp = localNamedExports(LOCAL_EXPORT_DEFAULT);
    expect(exp.has("Store")).toBe(true);
    expect(exp.has("Store.get")).toBe(true);
  });

  it("generalize extractFn finds Class.method on local + export list", () => {
    const g = generalizeFromAst("Foo.bar", LOCAL_EXPORT_LIST);
    expect(g).toBeDefined();
    expect(g!.params).toEqual(["x"]);
  });
});

describe("object method this via bindThis", () => {
  it("{ n:5, getN(){ return this.n } }.getN() folds to 5", async () => {
    const { runTranspiled, callTranspiledExportFull, formatAbs, litValue } = await import(
      "@nudojs/core"
    );
    const src = `
export function f() {
  return { n: 5, getN(){ return this.n; } }.getN();
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toBe(5);
    expect(formatAbs(r.result)).toContain("5");
  });

  it("object method with args receives this + user params", async () => {
    const { runTranspiled, callTranspiledExportFull, litValue } = await import("@nudojs/core");
    const src = `
export function f() {
  const o = { base: 10, add(x){ return this.base + x; } };
  return o.add(5);
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    // this.base=10 + x=5 → 15；若 this 未注入会 unknown 或仅 5
    expect(litValue(r.result)).toBe(15);
  });
});

const LOCAL_EXPORT_LIST = `
class MemoryStore {
  constructor() {
    this.items = {};
  }
  set(key, value) {
    this.items[key] = value;
    return true;
  }
  get(key) {
    return this.items[key];
  }
}
export { MemoryStore };
`;

const LOCAL_EXPORT_DEFAULT = `
class Counter {
  n = 0;
  bump() {
    this.n = this.n + 1;
    return this.n;
  }
}
export default Counter;
`;

describe("C4.2 / P1 local class via export list", () => {
  it("listTopFunctions includes Class.method for export { Foo }", () => {
    const names = listTopFunctions(LOCAL_EXPORT_LIST);
    expect(names).toContain("MemoryStore.set");
    expect(names).toContain("MemoryStore.get");
  });

  it("listTopFunctions includes Class.method for export default Foo", () => {
    const names = listTopFunctions(LOCAL_EXPORT_DEFAULT);
    expect(names).toContain("Counter.bump");
  });

  it("localNamedExports registers Class.method for export { Foo }", () => {
    const exp = localNamedExports(LOCAL_EXPORT_LIST);
    expect(exp.has("MemoryStore")).toBe(true);
    expect(exp.has("MemoryStore.set")).toBe(true);
    expect(exp.has("MemoryStore.get")).toBe(true);
  });

  it("localNamedExports registers Class.method for export default Foo", () => {
    const exp = localNamedExports(LOCAL_EXPORT_DEFAULT);
    expect(exp.has("default")).toBe(true);
    expect(exp.has("Counter")).toBe(true);
    expect(exp.has("Counter.bump")).toBe(true);
  });

  it("generalize extractFn finds method on local class via export list", () => {
    const g = generalizeFromAst("MemoryStore.set", LOCAL_EXPORT_LIST);
    expect(g).toBeDefined();
    expect(g!.params).toEqual(["key", "value"]);
  });

  it("does not register methods for non-exported local class", () => {
    const src = `
class Hidden {
  secret() { return 1; }
}
export function peek() { return 1; }
`;
    const names = listTopFunctions(src);
    expect(names).toContain("peek");
    expect(names).not.toContain("Hidden.secret");
  });
});

describe("object method shorthand this binding (P1)", () => {
  it("{n:5,getN(){return this.n}}.getN() → 5", async () => {
    const { runTranspiled, callTranspiledExportFull, litValue: lv } = await import(
      "@nudojs/core"
    );
    const src = `
export function f() {
  return { n: 5, getN() { return this.n; } }.getN();
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(lv(r.result)).toBe(5);
  });

  it("method via variable still binds receiver", async () => {
    const { runTranspiled, callTranspiledExportFull, litValue: lv } = await import(
      "@nudojs/core"
    );
    const src = `
export function f() {
  const o = { n: 7, getN() { return this.n; } };
  return o.getN();
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(lv(r.result)).toBe(7);
  });
});

describe("C4.2 sidecar binding for class methods", () => {
  it("binds via export const MemoryStore_set", () => {
    const { loadModule } = makeFiles({
      "/t/store.nudo.js": `export const MemoryStore_set = fn({ key: string() }, boolean());`,
    });
    const r = effectiveInterface(STORE, "MemoryStore.set", {
      loadModule,
      fromFile: "/t/store.js",
    });
    expect(r).toBeDefined();
    expect(r!.source).toBe("handwritten");
    expect(formatConstraint(r!.params[0]!.constraint)).toBe("string()");
  });

  it("binds via nested export const MemoryStore = { set: fn(…) }", () => {
    const { loadModule } = makeFiles({
      "/t/store.nudo.js": `export const MemoryStore = { set: fn({ key: number() }, boolean()) };`,
    });
    const r = effectiveInterface(STORE, "MemoryStore.set", {
      loadModule,
      fromFile: "/t/store.js",
    });
    expect(r).toBeDefined();
    expect(formatConstraint(r!.params[0]!.constraint)).toBe("number()");
  });

  it("binds via export const MemoryStore = { set: fn } with dotted key", () => {
    const { loadModule } = makeFiles({
      "/t/store.nudo.js": `export const MemoryStore = {};\nexport const ["MemoryStore.set"] = undefined;`,
    });
    // 无效侧车 → 不绑（fail-open，不 throw）
    expect(() =>
      effectiveInterface(STORE, "MemoryStore.set", {
        loadModule,
        fromFile: "/t/store.js",
      }),
    ).not.toThrow();
  });

  it("no sidecar → class method stays implicit", () => {
    const { loadModule } = makeFiles({});
    const r = effectiveInterface(STORE, "MemoryStore.set", {
      loadModule,
      fromFile: "/t/store.js",
    });
    expect(r).toBeUndefined();
  });
});

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
  it("listTopFunctions includes exported Class.method, skips ctor/static/get", () => {
    const names = listTopFunctions(STORE);
    expect(names).toContain("MemoryStore.set");
    expect(names).toContain("MemoryStore.get");
    expect(names.filter((n) => n.includes("constructor"))).toEqual([]);
    expect(names.filter((n) => n.includes("create"))).toEqual([]);
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

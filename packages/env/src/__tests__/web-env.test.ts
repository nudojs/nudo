import { describe, it, expect } from "vitest";
import { defineEnv } from "../web.ts";
import { formatShape, litValue, getFnImpl, strLit } from "@nudojs/core";
import type { Abs } from "@nudojs/core";

/**
 * Web env face (packages/env/src/web.ts) — ES globals + Fetch/URL/DOM.
 * Asserts Abs-native signatures exist (shape-level). Mirrors node-env-gaps style.
 */

type Env = ReturnType<typeof defineEnv>;

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") {
      cur = cur.shape.shape as Abs | undefined;
    }
    if (!cur || cur.shape.k !== "obj") return undefined;
    const slot = cur.shape.slots[k];
    cur = slot?.value;
  }
  return cur;
}

function globalOf(env: Env, name: string): Abs {
  const g = env.globals[name];
  expect(g, `global "${name}" missing`).toBeTruthy();
  return g!;
}

/** Constructors are envFn wrappers — members live on the return object. */
function instanceOf(a: Abs): Abs {
  return a.shape.k === "fn" && a.shape.returnType ? a.shape.returnType : a;
}

describe("web env load + Fetch/URL/DOM faces", () => {
  const env = defineEnv();

  it("loads without throwing and merges ES globals", () => {
    expect(env.globals).toBeTypeOf("object");
    // ES face survives the merge
    expect(env.globals.JSON).toBeTruthy();
    expect(env.globals.Math).toBeTruthy();
    expect(env.globals.Promise).toBeTruthy();
    expect(env.globals.console).toBeTruthy();
  });

  it("fetch / Request / Response are present with body methods", () => {
    const fetchFn = globalOf(env, "fetch");
    expect(shapeOf(fetchFn, "fetch")).toContain("=>");

    const Request = instanceOf(globalOf(env, "Request"));
    expect(shapeOf(Request, "Request instance")).toBeTruthy();
    for (const name of ["json", "text", "arrayBuffer", "clone"] as const) {
      expect(shapeOf(walk(Request, name), `Request.${name}`)).toContain("=>");
    }
    expect(shapeOf(walk(Request, "ok"), "Request.ok")).toContain("bool");
    expect(shapeOf(walk(Request, "status"), "Request.status")).toContain("number");

    const Response = globalOf(env, "Response");
    // Response statics
    for (const name of ["json", "redirect", "error"] as const) {
      expect(shapeOf(walk(Response, name), `Response.${name}`)).toContain("=>");
    }
  });

  it("URL / URLSearchParams have typed members and literal-fold", () => {
    const URLFn = globalOf(env, "URL");
    const impl = getFnImpl(URLFn)!;
    const folded = impl.apply!([strLit("https://example.com/a?b=1")]);
    expect(folded).toBeTruthy();
    // literal fold: href carries the concrete URL string
    expect(litValue(walk(folded, "href")!)).toBe("https://example.com/a?b=1");
    expect(litValue(walk(folded, "origin")!)).toBe("https://example.com");
    expect(shapeOf(walk(folded, "searchParams"), "URL.searchParams")).toBeTruthy();
    expect(shapeOf(walk(folded, "toString"), "URL.toString")).toContain("=>");

    const URLSearchParams = instanceOf(globalOf(env, "URLSearchParams"));
    for (const name of ["append", "get", "has", "set", "toString"] as const) {
      expect(
        shapeOf(walk(URLSearchParams, name), `URLSearchParams.${name}`),
      ).toContain("=>");
    }
    expect(shapeOf(walk(URLSearchParams, "size"), "URLSearchParams.size")).toContain(
      "number",
    );
  });

  it("timers / microtasks / rAF are typed", () => {
    for (const name of [
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ] as const) {
      expect(shapeOf(globalOf(env, name), name)).toContain("=>");
    }
  });

  it("localStorage / sessionStorage expose the Storage surface", () => {
    for (const name of ["localStorage", "sessionStorage"] as const) {
      const store = globalOf(env, name);
      for (const m of ["getItem", "setItem", "removeItem", "clear", "key"] as const) {
        expect(shapeOf(walk(store, m), `${name}.${m}`)).toContain("=>");
      }
      expect(shapeOf(walk(store, "length"), `${name}.length`)).toContain("number");
    }
  });

  it("document / navigator / history / location are shaped", () => {
    const document = globalOf(env, "document");
    for (const name of ["getElementById", "querySelector", "createElement"] as const) {
      expect(shapeOf(walk(document, name), `document.${name}`)).toContain("=>");
    }
    expect(shapeOf(walk(document, "title"), "document.title")).toContain("string");

    const navigator = globalOf(env, "navigator");
    expect(shapeOf(walk(navigator, "userAgent"), "navigator.userAgent")).toContain(
      "string",
    );
    expect(shapeOf(walk(navigator, "clipboard", "writeText"), "clipboard.writeText")).toContain(
      "=>",
    );

    const history = globalOf(env, "history");
    expect(shapeOf(walk(history, "pushState"), "history.pushState")).toContain("=>");
    const location = globalOf(env, "location");
    expect(shapeOf(walk(location, "href"), "location.href")).toContain("string");
  });

  it("crypto / performance / AbortController resolve", () => {
    const crypto = globalOf(env, "crypto");
    expect(shapeOf(walk(crypto, "randomUUID"), "crypto.randomUUID")).toContain("=>");
    expect(
      shapeOf(walk(crypto, "subtle", "digest"), "crypto.subtle.digest"),
    ).toContain("=>");

    const performance = globalOf(env, "performance");
    expect(shapeOf(walk(performance, "now"), "performance.now")).toContain("=>");

    // AbortController is a constructor fn; abort lives on its return object
    const AbortController = globalOf(env, "AbortController");
    expect(shapeOf(AbortController, "AbortController")).toContain("=>");
    const ret = instanceOf(AbortController);
    expect(shapeOf(ret, "AbortController return")).toBeTruthy();
    expect(shapeOf(walk(ret, "abort"), "AbortController.abort")).toContain("=>");
  });

  it("atob / btoa fold on literals", () => {
    const btoaFn = globalOf(env, "btoa");
    const impl = getFnImpl(btoaFn)!;
    const folded = impl.apply!([strLit("hi")]);
    expect(litValue(folded!)).toBe(Buffer.from("hi").toString("base64"));
    const atobFn = globalOf(env, "atob");
    const aImpl = getFnImpl(atobFn)!;
    const decoded = aImpl.apply!([strLit(Buffer.from("hi").toString("base64"))]);
    expect(litValue(decoded!)).toBe("hi");
  });

  it("TextEncoder / TextDecoder / structuredClone are typed", () => {
    expect(shapeOf(globalOf(env, "TextEncoder"), "TextEncoder")).toContain("=>");
    expect(shapeOf(globalOf(env, "TextDecoder"), "TextDecoder")).toContain("=>");
    expect(shapeOf(globalOf(env, "structuredClone"), "structuredClone")).toContain("=>");
  });
});

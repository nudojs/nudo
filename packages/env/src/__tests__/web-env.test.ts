/**
 * Web env face：ES globals + Fetch/URL/DOM；不声明会遮蔽宿主内建的全局。
 */
import { describe, it, expect } from "vitest";
import { defineEnv } from "../web.ts";
import { formatShape, litValue, getFnImpl, absOnly, strLit } from "@nudojs/core";
import type { Abs } from "@nudojs/core";

type Env = ReturnType<typeof defineEnv>;

const shapeOf = (a: Abs | undefined, label: string): string => {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
};

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

const globalOf = (env: Env, name: string): Abs => {
  const g = env.globals[name];
  expect(g, `global "${name}" missing`).toBeTruthy();
  return g!;
};

const staticSlot = (a: Abs | undefined, name: string): Abs | undefined => {
  if (!a || a.shape.k !== "fn") return undefined;
  return (a.shape as { slots?: Record<string, { value: Abs }> }).slots?.[name]?.value;
};

const instanceOf = (a: Abs): Abs => (a.shape.k === "fn" && a.shape.returnType ? a.shape.returnType : a);

describe("web env", () => {
  const env = defineEnv();

  it("加载并合并 ES globals", () => {
    expect(env.globals).toBeTypeOf("object");
    for (const name of ["JSON", "Math", "Promise", "console"]) expect(env.globals[name], name).toBeTruthy();
  });

  it("fetch / Request / Response 面", () => {
    expect(shapeOf(globalOf(env, "fetch"), "fetch")).toContain("=>");
    const Request = instanceOf(globalOf(env, "Request"));
    for (const name of ["json", "text", "arrayBuffer", "clone"]) expect(shapeOf(walk(Request, name), `Request.${name}`)).toContain("=>");
    expect(shapeOf(walk(Request, "method"), "Request.method")).toContain("string");
    expect(walk(Request, "status"), "Request.status").toBeUndefined();
    expect(walk(Request, "ok"), "Request.ok").toBeUndefined();

    const ResponseCtor = globalOf(env, "Response");
    for (const name of ["json", "redirect", "error"]) expect(shapeOf(staticSlot(ResponseCtor, name), `Response.${name}`)).toContain("=>");
    const Response = instanceOf(ResponseCtor);
    expect(shapeOf(walk(Response, "status"), "Response.status")).toContain("number");
    expect(shapeOf(walk(Response, "ok"), "Response.ok")).toContain("bool");
  });

  it("URL / URLSearchParams 字面量折叠与成员", () => {
    const URLFn = globalOf(env, "URL");
    const folded = absOnly(getFnImpl(URLFn)!.apply!([strLit("https://example.com/a?b=1")]));
    expect(litValue(walk(folded, "href")!)).toEqual({ ok: true, value: "https://example.com/a?b=1" });
    expect(litValue(walk(folded, "origin")!)).toEqual({ ok: true, value: "https://example.com" });
    expect(shapeOf(walk(folded, "searchParams"), "URL.searchParams")).toBeTruthy();
    expect(shapeOf(walk(folded, "toString"), "URL.toString")).toContain("=>");

    const params = instanceOf(globalOf(env, "URLSearchParams"));
    for (const name of ["append", "get", "has", "set", "toString"]) expect(shapeOf(walk(params, name), `URLSearchParams.${name}`)).toContain("=>");
    expect(shapeOf(walk(params, "size"), "URLSearchParams.size")).toContain("number");
  });

  it("timers / storage / DOM / crypto / 未声明全局", () => {
    for (const name of ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"]) {
      expect(shapeOf(globalOf(env, name), name)).toContain("=>");
    }
    expect(env.globals["queueMicrotask"]).toBeUndefined();

    for (const name of ["localStorage", "sessionStorage"] as const) {
      const store = globalOf(env, name);
      for (const m of ["getItem", "setItem", "removeItem", "clear", "key"]) expect(shapeOf(walk(store, m), `${name}.${m}`)).toContain("=>");
      expect(shapeOf(walk(store, "length"), `${name}.length`)).toContain("number");
    }

    const document = globalOf(env, "document");
    for (const name of ["getElementById", "querySelector", "createElement"]) expect(shapeOf(walk(document, name), `document.${name}`)).toContain("=>");
    expect(shapeOf(walk(document, "title"), "document.title")).toContain("string");
    const navigator = globalOf(env, "navigator");
    expect(shapeOf(walk(navigator, "userAgent"), "navigator.userAgent")).toContain("string");
    expect(shapeOf(walk(navigator, "clipboard", "writeText"), "clipboard.writeText")).toContain("=>");
    expect(shapeOf(walk(globalOf(env, "history"), "pushState"), "history.pushState")).toContain("=>");
    expect(shapeOf(walk(globalOf(env, "location"), "href"), "location.href")).toContain("string");

    const crypto = globalOf(env, "crypto");
    expect(shapeOf(walk(crypto, "randomUUID"), "crypto.randomUUID")).toContain("=>");
    expect(shapeOf(walk(crypto, "subtle", "digest"), "crypto.subtle.digest")).toContain("=>");
    expect(shapeOf(walk(globalOf(env, "performance"), "now"), "performance.now")).toContain("=>");
    const AbortController = globalOf(env, "AbortController");
    expect(shapeOf(AbortController, "AbortController")).toContain("=>");
    expect(shapeOf(walk(instanceOf(AbortController), "abort"), "AbortController.abort")).toContain("=>");

    for (const name of ["atob", "btoa", "TextEncoder", "TextDecoder", "structuredClone"]) {
      expect(env.globals[name], `${name} must not be declared`).toBeUndefined();
    }
  });
});

import { describe, it, expect } from "vitest";
import { defineEnv } from "../node.ts";
import { formatShape } from "@nudojs/core";
import type { Abs } from "@nudojs/core";

/**
 * B3 — handwritten node env high-frequency gaps.
 * Asserts Abs-native signatures exist (shape-level; not full Node soundness).
 */

function lookupModule(env: ReturnType<typeof defineEnv>, mod: string): Record<string, Abs> {
  const m = env.modules?.[mod];
  expect(m, `module "${mod}" missing`).toBeTruthy();
  return m!;
}

function shapeOf(a: Abs | undefined): string {
  expect(a, "expected Abs at path").toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    // brand carries its payload as shape.shape (an Abs), not as obj slots
    if (cur.shape.k === "brand") {
      cur = cur.shape.shape as Abs | undefined;
    }
    if (!cur || cur.shape.k !== "obj") return undefined;
    const slot = cur.shape.slots[k];
    cur = slot?.value;
  }
  return cur;
}

describe("node env high-frequency gaps (B3)", () => {
  const env = defineEnv();

  it("exports events module under bare and node: keys", () => {
    const events = lookupModule(env, "events");
    const nodeEvents = lookupModule(env, "node:events");
    expect(events.EventEmitter).toBeTruthy();
    expect(nodeEvents.EventEmitter).toBeTruthy();
    expect(events.once).toBeTruthy();
    expect(events.on).toBeTruthy();
  });

  it("EventEmitter constructor returns EventEmitter brand with on/once/emit/off", () => {
    const events = lookupModule(env, "events");
    const ctor = events.EventEmitter!;
    const s = shapeOf(ctor);
    expect(s).toContain("EventEmitter");
    // ctor is envFn → shape.k fn; return type is the brand
    expect(ctor.shape.k === "fn" || ctor.shape.k === "brand").toBe(true);
    if (ctor.shape.k === "fn" && ctor.shape.returnType) {
      const ret = ctor.shape.returnType;
      expect(formatShape(ret)).toContain("EventEmitter");
      const on = walk(ret, "on");
      const emit = walk(ret, "emit");
      const off = walk(ret, "off");
      const once = walk(ret, "once");
      expect(shapeOf(on)).toContain("=>");
      expect(shapeOf(emit)).toContain("=>");
      expect(shapeOf(off)).toContain("=>");
      expect(shapeOf(once)).toContain("=>");
    }
  });

  it("util exposes promisify / inspect / format (+ types)", () => {
    const util = lookupModule(env, "util");
    expect(shapeOf(util.promisify)).toContain("=>");
    expect(shapeOf(util.inspect)).toContain("=>");
    expect(shapeOf(util.format)).toContain("=>");
    const isDate = walk(util.types!, "isDate");
    expect(shapeOf(isDate)).toContain("bool");
  });

  it("stream skeleton brands + pipe exist", () => {
    const stream = lookupModule(env, "stream");
    for (const name of ["Readable", "Writable", "Duplex", "Transform"] as const) {
      const ctor = stream[name];
      expect(ctor, name).toBeTruthy();
      const s = shapeOf(ctor);
      expect(s).toContain(name);
    }
    expect(stream.pipeline).toBeTruthy();
  });

  it("querystring parse/stringify present", () => {
    const qs = lookupModule(env, "querystring");
    expect(shapeOf(qs.parse)).toContain("ParsedQueryString");
    expect(shapeOf(qs.stringify)).toContain("=>");
    expect(shapeOf(qs.escape)).toContain("=>");
  });

  it("fs.promises common methods present under fs and node:fs/promises", () => {
    const fs = lookupModule(env, "fs");
    for (const name of [
      "readFile",
      "writeFile",
      "mkdir",
      "rm",
      "appendFile",
      "unlink",
      "rename",
      "copyFile",
      "chmod",
    ] as const) {
      expect(fs[name], `fs.${name}`).toBeTruthy();
      expect(shapeOf(fs[name])).toContain("promise");
    }
    const promises = lookupModule(env, "node:fs/promises");
    expect(promises.readFile).toBeTruthy();
    expect(promises.unlink).toBeTruthy();
    expect(promises.copyFile).toBeTruthy();
  });

  it("path / url / crypto / process high-frequency slots stay resolved", () => {
    const path = lookupModule(env, "path");
    const joinFmt = shapeOf(path.join);
    expect(joinFmt).toContain("=>");
    // rest label — not five required strings
    expect(joinFmt).toContain("...paths");
    expect(joinFmt).not.toMatch(/\(string, string, string, string, string\)/);
    const resolveFmt = shapeOf(path.resolve);
    expect(resolveFmt).toContain("...paths");
    expect(path.parse).toBeTruthy();
    expect(shapeOf(path.parse)).toContain("{");
    const url = lookupModule(env, "url");
    expect(url.URL).toBeTruthy();
    expect(url.URLSearchParams).toBeTruthy();
    const crypto = lookupModule(env, "crypto");
    expect(shapeOf(crypto.randomUUID)).toContain("=>");
    const process = env.globals.process;
    expect(process).toBeTruthy();
    const cwd = walk(process!, "cwd");
    expect(shapeOf(cwd)).toContain("=>");
  });

  it("variadic/optional Node APIs do not over-declare required arity", () => {
    const path = lookupModule(env, "path");
    expect(shapeOf(path.join)).toBe("(string, ...paths: string) => string");
    expect(shapeOf(path.resolve)).toBe("(...paths: string) => string");
    const util = lookupModule(env, "util");
    expect(shapeOf(util.format)).toBe("(string, ...args: unknown) => string");
    const events = lookupModule(env, "events");
    expect(shapeOf(events.EventEmitter)).toContain("options?");
    expect(shapeOf(events.EventEmitter)).toContain("EventEmitter");
    const qs = lookupModule(env, "querystring");
    expect(shapeOf(qs.parse)).toContain("sep?");
    const stream = lookupModule(env, "stream");
    expect(shapeOf(stream.Readable)).toContain("options?");
  });
});

import { describe, it, expect } from "vitest";
import { defineEnv } from "../node.ts";
import { formatShape } from "@nudojs/core";
import { requiredFnArity } from "@nudojs/core";
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

/** clean = format 串不含 unknown/any 叶子 token */
function expectLeafClean(fmt: string, label: string): void {
  expect(fmt, `${label} should not mention unknown/any`).not.toMatch(
    /(^|[^\w])(unknown|any)([^\w]|$)/,
  );
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
    expectLeafClean(s, "events.EventEmitter");
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
    const promisifyFmt = shapeOf(util.promisify);
    expect(promisifyFmt).toContain("=>");
    expectLeafClean(promisifyFmt, "util.promisify");
    // inspect options typed; value slot is product-any (honest)
    expect(shapeOf(util.inspect)).toContain("options?");
    expect(shapeOf(util.format)).toContain("=>");
    const isDate = walk(util.types!, "isDate");
    expect(shapeOf(isDate)).toContain("bool");
    const inheritsFmt = shapeOf(util.inherits);
    expectLeafClean(inheritsFmt, "util.inherits");
    const callbackifyFmt = shapeOf(util.callbackify);
    expectLeafClean(callbackifyFmt, "util.callbackify");
  });

  it("stream skeleton brands + pipe exist", () => {
    const stream = lookupModule(env, "stream");
    for (const name of ["Readable", "Writable", "Duplex", "Transform"] as const) {
      const ctor = stream[name];
      expect(ctor, name).toBeTruthy();
      const s = shapeOf(ctor);
      expect(s).toContain(name);
      expectLeafClean(s, `stream.${name}`);
      expect(s).toContain("options?");
    }
    expect(stream.pipeline).toBeTruthy();
    expectLeafClean(shapeOf(stream.pipeline), "stream.pipeline");
  });

  it("querystring parse/stringify present with typed options", () => {
    const qs = lookupModule(env, "querystring");
    expect(shapeOf(qs.parse)).toContain("ParsedQueryString");
    expectLeafClean(shapeOf(qs.parse), "querystring.parse");
    expect(shapeOf(qs.stringify)).toContain("=>");
    expectLeafClean(shapeOf(qs.stringify), "querystring.stringify");
    expect(shapeOf(qs.escape)).toContain("=>");
  });

  it("fs.promises methods live under fs/promises — not Promise-typed on callback fs", () => {
    const fs = lookupModule(env, "fs");
    expect(fs.readFileSync).toBeTruthy();
    expect(shapeOf(fs.readFileSync)).not.toContain("promise");
    // callback-style async on fs: returns undefined, not promise
    expect(shapeOf(fs.readFile)).toContain("undefined");
    expect(shapeOf(fs.readFile)).not.toContain("promise");
    expectLeafClean(shapeOf(fs.readFile), "fs.readFile");
    for (const mod of ["fs/promises", "node:fs/promises"] as const) {
      const promises = lookupModule(env, mod);
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
        expect(promises[name], `${mod}.${name}`).toBeTruthy();
        expect(shapeOf(promises[name]), `${mod}.${name}`).toContain("promise");
      }
      expectLeafClean(shapeOf(promises.readFile), `${mod}.readFile`);
      expectLeafClean(shapeOf(promises.mkdir), `${mod}.mkdir`);
    }
  });

  it("fs.statSync times are Date brand; options typed", () => {
    const fs = lookupModule(env, "fs");
    const fmt = shapeOf(fs.statSync);
    expectLeafClean(fmt, "fs.statSync");
    expect(fmt).toContain("Date");
    expect(fmt).not.toContain("mtime: unknown");
    expect(fmt).toContain("options?");
    const stat = fs.statSync!;
    if (stat.shape.k === "fn" && stat.shape.returnType) {
      const isFile = walk(stat.shape.returnType, "isFile");
      expect(shapeOf(isFile)).toContain("bool");
      const mtime = walk(stat.shape.returnType, "mtime");
      expect(shapeOf(mtime)).toBe("Date");
    }
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
    expectLeafClean(shapeOf(path.sep), "path.sep");
    expectLeafClean(shapeOf(path.posix), "path.posix");
    expectLeafClean(shapeOf(path.win32), "path.win32");
    const url = lookupModule(env, "url");
    expect(url.URL).toBeTruthy();
    expect(url.URLSearchParams).toBeTruthy();
    const searchFmt = shapeOf(url.URLSearchParams);
    expectLeafClean(searchFmt, "url.URLSearchParams");
    expect(searchFmt).toContain("string | null");
    const crypto = lookupModule(env, "crypto");
    expect(shapeOf(crypto.randomUUID)).toContain("=>");
    const hashFmt = shapeOf(crypto.createHash);
    expectLeafClean(hashFmt, "crypto.createHash");
    expect(hashFmt).toContain("Hash");
    const process = env.globals.process;
    expect(process).toBeTruthy();
    const cwd = walk(process!, "cwd");
    expect(shapeOf(cwd)).toContain("=>");
  });

  it("process.env is open string map; nextTick / exitCode / version typed", () => {
    const process = env.globals.process!;
    const envFmt = shapeOf(walk(process, "env"));
    expectLeafClean(envFmt, "process.env");
    expect(envFmt).toContain("string");
    // empty `{  }` is not a leaf-clean Record semantics
    expect(envFmt.replace(/\s+/g, " ").trim()).not.toBe("{  }");
    const nextTickFmt = shapeOf(walk(process, "nextTick"));
    expectLeafClean(nextTickFmt, "process.nextTick");
    const exitCodeFmt = shapeOf(walk(process, "exitCode"));
    expectLeafClean(exitCodeFmt, "process.exitCode");
    expect(exitCodeFmt).toContain("number");
    expectLeafClean(shapeOf(walk(process, "version")), "process.version");
    expectLeafClean(shapeOf(walk(process, "platform")), "process.platform");
  });

  it("os / Buffer / assert high-frequency slots exist and are leaf-clean where possible", () => {
    const os = lookupModule(env, "os");
    for (const name of ["homedir", "tmpdir", "platform"] as const) {
      expect(os[name], name).toBeTruthy();
      expectLeafClean(shapeOf(os[name]), `os.${name}`);
    }
    expectLeafClean(shapeOf(os.EOL), "os.EOL");
    expectLeafClean(shapeOf(os.cpus), "os.cpus");

    const BufferCtor = env.globals.Buffer!;
    const allocFmt = shapeOf(walk(BufferCtor, "alloc"));
    expect(allocFmt).toContain("Buffer");
    expectLeafClean(allocFmt, "Buffer.alloc");
    expectLeafClean(shapeOf(walk(BufferCtor, "concat")), "Buffer.concat");
    expectLeafClean(shapeOf(walk(BufferCtor, "from")), "Buffer.from");

    const assertMod = lookupModule(env, "assert");
    expect(assertMod.ok).toBeTruthy();
    expect(assertMod.strictEqual).toBeTruthy();
    expect(assertMod.deepStrictEqual).toBeTruthy();
    // value 参数是产品 any — 不假装具体；返回 undefined 干净
    expect(shapeOf(assertMod.strictEqual)).toContain("=>");
    expect(shapeOf(assertMod.deepStrictEqual)).toContain("=>");
  });

  it("variadic/optional Node APIs declare required arity only + optional labels", () => {
    const path = lookupModule(env, "path");
    expect(shapeOf(path.join)).toBe("(string, ...paths: string) => string");
    expect(shapeOf(path.resolve)).toBe("(...paths: string) => string");
    // basename: ext optional — typed label; required slot is path only
    expect(shapeOf(path.basename)).toBe("(string, ext?: string) => string");
    const util = lookupModule(env, "util");
    // util.format() is valid with zero args in Node; mixed args are product-any
    expect(shapeOf(util.format)).toBe("(...args: any) => string");
    const events = lookupModule(env, "events");
    expect(shapeOf(events.EventEmitter)).toBe(
      "(options?: { captureRejections?: boolean }) => EventEmitter",
    );
    // required arity 0 via labels (paramTypes still carries the optional slot type)
    const ee = events.EventEmitter!;
    expect(ee.shape.k).toBe("fn");
    if (ee.shape.k === "fn") {
      expect(requiredFnArity(ee.shape.params)).toBe(0);
      expect(ee.shape.paramTypes?.length).toBe(ee.shape.params.length);
    }
    const url = lookupModule(env, "url");
    expect(shapeOf(url.URL)).toContain("base?: string");
    const qs = lookupModule(env, "querystring");
    expect(shapeOf(qs.parse)).toBe(
      "(string, sep?: string, eq?: string, options?: { maxKeys?: number }) => ParsedQueryString",
    );
    const stream = lookupModule(env, "stream");
    expect(shapeOf(stream.Readable)).toContain("options?");
    expect(shapeOf(stream.Readable)).toContain("Readable");
  });

  it("ChildProcess instance surface is signature-level (spawn returns typed brand)", () => {
    const cp = lookupModule(env, "child_process");
    const spawnFmt = shapeOf(cp.spawn);
    expect(spawnFmt).toContain("=> ChildProcess");
    expect(spawnFmt).toContain("options?");
    // execFile 同轨
    expect(shapeOf(cp.execFile)).toContain("ChildProcess");
    // 实例槽：stdio 流 + on/kill/pid
    const ret = (cp.spawn as { shape?: { returnType?: Abs } }).shape?.returnType;
    expect(ret, "spawn returnType").toBeTruthy();
    const pid = walk(ret!, "pid");
    expect(shapeOf(pid)).toContain("number");
    const stdout = walk(ret!, "stdout");
    expect(shapeOf(stdout)).toContain("Readable");
    const kill = walk(ret!, "kill");
    expect(shapeOf(kill)).toContain("=>");
    const on = walk(ret!, "on");
    expect(shapeOf(on)).toContain("=>");
  });

  it("stream user hooks (transform/flush/read/write/final) are typed for refine", () => {
    const stream = lookupModule(env, "stream");
    const t = stream.Transform!;
    const opt = (t as { shape?: { paramTypes?: Abs[] } }).shape?.paramTypes?.[0];
    expect(opt, "Transform options").toBeTruthy();
    const transform = walk(opt!, "transform");
    // (chunk, encoding, callback) — 类型面可 refine；label 在 params
    expect(shapeOf(transform), "transform hook").toContain("string | Buffer");
    expect(shapeOf(transform), "transform hook").toContain("=>");
    const flush = walk(opt!, "flush");
    expect(shapeOf(flush)).toContain("=>");
    // stream.promises.pipeline 存在
    const promises = walk(stream.promises!, "pipeline");
    expect(shapeOf(promises)).toContain("=>");
  });
});

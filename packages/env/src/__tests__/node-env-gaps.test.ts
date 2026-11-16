/** node env 高频面：模块导出、签名/品牌、fs vs fs/promises、URL 折叠。 */
import { describe, it, expect } from "vitest";
import { defineEnv } from "../node.ts";
import { formatShape, getFnImpl, absOnly, litValue, strLit, requiredFnArity } from "@nudojs/core";
import type { Abs } from "@nudojs/core";

const lookupModule = (env: ReturnType<typeof defineEnv>, mod: string): Record<string, Abs> => {
  const m = env.modules?.[mod];
  expect(m, `module "${mod}" missing`).toBeTruthy();
  return m!;
};

const shapeOf = (a: Abs | undefined): string => {
  expect(a, "expected Abs at path").toBeTruthy();
  return formatShape(a!);
};

const expectLeafClean = (fmt: string, label: string): void => {
  expect(fmt, `${label} should not mention unknown/any`).not.toMatch(/(^|[^\w])(unknown|any)([^\w]|$)/);
};

function walk(a: Abs, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (cur && cur.shape.k === "fn") {
      cur = (cur.shape as { slots?: Record<string, { value: Abs }> }).slots?.[k]?.value;
      if (!cur) return undefined;
      continue;
    }
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

describe("node env 高频面", () => {
  const env = defineEnv();

  it("events 模块（bare/node:）与 EventEmitter 实例方法", () => {
    for (const mod of ["events", "node:events"]) {
      const events = lookupModule(env, mod);
      expect(events.EventEmitter, mod).toBeTruthy();
      expect(events.once, mod).toBeTruthy();
      expect(events.on, mod).toBeTruthy();
    }
    const ctor = lookupModule(env, "events").EventEmitter!;
    const s = shapeOf(ctor);
    expect(s).toContain("EventEmitter");
    expectLeafClean(s, "events.EventEmitter");
    const ret = (ctor.shape as { returnType?: Abs }).returnType!;
    expect(formatShape(ret)).toContain("EventEmitter");
    for (const name of ["on", "emit", "off", "once"]) expect(shapeOf(walk(ret, name)), name).toContain("=>");
  });

  it("util / stream / querystring 签名与品牌", () => {
    const util = lookupModule(env, "util");
    const promisifyFmt = shapeOf(util.promisify);
    expect(promisifyFmt).toContain("=>");
    expectLeafClean(promisifyFmt, "util.promisify");
    expect(shapeOf(util.inspect)).toContain("options?");
    expect(shapeOf(util.format)).toContain("=>");
    expect(shapeOf(walk(util.types!, "isDate"))).toContain("bool");
    for (const name of ["inherits", "callbackify"]) expectLeafClean(shapeOf(util[name]), `util.${name}`);

    const stream = lookupModule(env, "stream");
    for (const name of ["Readable", "Writable", "Duplex", "Transform"] as const) {
      const s = shapeOf(stream[name]);
      expect(s, name).toContain(name);
      expectLeafClean(s, `stream.${name}`);
      expect(s).toContain("options?");
    }
    expectLeafClean(shapeOf(stream.pipeline), "stream.pipeline");

    const qs = lookupModule(env, "querystring");
    expect(shapeOf(qs.parse)).toContain("ParsedQueryString");
    expectLeafClean(shapeOf(qs.parse), "querystring.parse");
    expect(shapeOf(qs.stringify)).toContain("=>");
    expect(shapeOf(qs.escape)).toContain("=>");
  });

  it("fs 回调面返回 undefined；fs/promises 面返回 promise；statSync Date 品牌", () => {
    const fs = lookupModule(env, "fs");
    expect(fs.readFileSync).toBeTruthy();
    expect(shapeOf(fs.readFileSync)).not.toContain("promise");
    expect(shapeOf(fs.readFile)).toContain("undefined");
    expect(shapeOf(fs.readFile)).not.toContain("promise");
    expectLeafClean(shapeOf(fs.readFile), "fs.readFile");

    for (const mod of ["fs/promises", "node:fs/promises"] as const) {
      const promises = lookupModule(env, mod);
      for (const name of ["readFile", "writeFile", "mkdir", "rm", "appendFile", "unlink", "rename", "copyFile", "chmod"] as const) {
        expect(promises[name], `${mod}.${name}`).toBeTruthy();
        expect(shapeOf(promises[name]), `${mod}.${name}`).toContain("promise");
      }
      expectLeafClean(shapeOf(promises.readFile), `${mod}.readFile`);
      expectLeafClean(shapeOf(promises.mkdir), `${mod}.mkdir`);
    }

    const statFmt = shapeOf(fs.statSync);
    expectLeafClean(statFmt, "fs.statSync");
    expect(statFmt).toContain("Date");
    expect(statFmt).not.toContain("mtime: unknown");
    expect(statFmt).toContain("options?");
    const stat = (fs.statSync as { shape?: { returnType?: Abs } }).shape?.returnType!;
    expect(shapeOf(walk(stat, "isFile"))).toContain("bool");
    expect(shapeOf(walk(stat, "mtime"))).toBe("Date");
  });

  it("path / url / crypto / process 高频槽", () => {
    const path = lookupModule(env, "path");
    const joinFmt = shapeOf(path.join);
    expect(joinFmt).toContain("...paths");
    expect(joinFmt).not.toMatch(/\(string, string, string, string, string\)/);
    expect(shapeOf(path.resolve)).toContain("...paths");
    expect(shapeOf(path.parse)).toContain("{");
    for (const name of ["sep", "posix", "win32"]) expectLeafClean(shapeOf(path[name]), `path.${name}`);

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

    const process = env.globals.process!;
    expect(shapeOf(walk(process, "cwd"))).toContain("=>");
    const envFmt = shapeOf(walk(process, "env"));
    expectLeafClean(envFmt, "process.env");
    expect(envFmt).toContain("string");
    expect(envFmt.replace(/\s+/g, " ").trim()).not.toBe("{  }");
    expectLeafClean(shapeOf(walk(process, "nextTick")), "process.nextTick");
    expect(shapeOf(walk(process, "exitCode"))).toContain("number");
    expectLeafClean(shapeOf(walk(process, "exitCode")), "process.exitCode");
    expectLeafClean(shapeOf(walk(process, "version")), "process.version");
    expectLeafClean(shapeOf(walk(process, "platform")), "process.platform");
  });

  it("os / Buffer / assert 高频槽", () => {
    const os = lookupModule(env, "os");
    for (const name of ["homedir", "tmpdir", "platform"] as const) {
      expect(os[name], name).toBeTruthy();
      expectLeafClean(shapeOf(os[name]), `os.${name}`);
    }
    expectLeafClean(shapeOf(os.EOL), "os.EOL");
    expectLeafClean(shapeOf(os.cpus), "os.cpus");

    const BufferCtor = env.globals.Buffer!;
    expect(shapeOf(walk(BufferCtor, "alloc"))).toContain("Buffer");
    expectLeafClean(shapeOf(walk(BufferCtor, "alloc")), "Buffer.alloc");
    expectLeafClean(shapeOf(walk(BufferCtor, "concat")), "Buffer.concat");
    expectLeafClean(shapeOf(walk(BufferCtor, "from")), "Buffer.from");

    const assertMod = lookupModule(env, "assert");
    for (const name of ["ok", "strictEqual", "deepStrictEqual"] as const) expect(assertMod[name], name).toBeTruthy();
    expect(shapeOf(assertMod.strictEqual)).toContain("=>");
    expect(shapeOf(assertMod.deepStrictEqual)).toContain("=>");
  });

  it("变长/可选签名只声明 required arity + optional 标签", () => {
    const path = lookupModule(env, "path");
    expect(shapeOf(path.join)).toBe("(string, ...paths: string) => string");
    expect(shapeOf(path.resolve)).toBe("(...paths: string) => string");
    expect(shapeOf(path.basename)).toBe("(string, ext?: string) => string");

    const util = lookupModule(env, "util");
    expect(shapeOf(util.format)).toBe("(...args: any) => string");

    const events = lookupModule(env, "events");
    expect(shapeOf(events.EventEmitter)).toBe("(options?: { captureRejections?: boolean }) => EventEmitter");
    const ee = events.EventEmitter!;
    expect(ee.shape.k).toBe("fn");
    if (ee.shape.k === "fn") {
      expect(requiredFnArity(ee.shape.params)).toBe(0);
      expect(ee.shape.paramTypes?.length).toBe(ee.shape.params.length);
    }

    const url = lookupModule(env, "url");
    expect(shapeOf(url.URL)).toContain("base?: string");
    const qs = lookupModule(env, "querystring");
    expect(shapeOf(qs.parse)).toBe("(string, sep?: string, eq?: string, options?: { maxKeys?: number }) => ParsedQueryString");
    expect(shapeOf(lookupModule(env, "stream").Readable)).toContain("options?");
  });

  it("ChildProcess 实例面 + stream 用户钩子", () => {
    const cp = lookupModule(env, "child_process");
    expect(shapeOf(cp.spawn)).toContain("=> ChildProcess");
    expect(shapeOf(cp.spawn)).toContain("options?");
    expect(shapeOf(cp.execFile)).toContain("ChildProcess");
    const ret = (cp.spawn as { shape?: { returnType?: Abs } }).shape?.returnType!;
    expect(shapeOf(walk(ret, "pid"))).toContain("number");
    expect(shapeOf(walk(ret, "stdout"))).toContain("Readable");
    expect(shapeOf(walk(ret, "kill"))).toContain("=>");
    expect(shapeOf(walk(ret, "on"))).toContain("=>");

    const stream = lookupModule(env, "stream");
    const opt = (stream.Transform as { shape?: { paramTypes?: Abs[] } }).shape?.paramTypes?.[0]!;
    const transform = walk(opt, "transform");
    expect(shapeOf(transform)).toContain("string | Buffer");
    expect(shapeOf(transform)).toContain("=>");
    expect(shapeOf(walk(opt, "flush"))).toContain("=>");
    expect(shapeOf(walk(stream.promises!, "pipeline"))).toContain("=>");
  });

  it("URL 助手：fileURLToPath 解码 / pathToFileURL 编码 / 非法输入不折字面量", () => {
    const url = lookupModule(env, "url");
    const toPath = getFnImpl(url.fileURLToPath!)!;
    const foldPath = (s: string) => litValue(absOnly(toPath.apply!([strLit(s)])));
    expect(foldPath("file:///tmp/foo%20bar")).toEqual({ ok: true, value: "/tmp/foo bar" });
    expect(foldPath("file:///tmp/caf%C3%A9")).toEqual({ ok: true, value: "/tmp/café" });

    const toURL = getFnImpl(url.pathToFileURL!)!;
    const result = absOnly(toURL.apply!([strLit("/tmp/foo bar")]));
    const hrefSlot = (result.shape as { slots: Record<string, { value: Abs }> }).slots.href;
    expect(litValue(hrefSlot.value)).toEqual({ ok: true, value: "file:///tmp/foo%20bar" });

    const invalid = absOnly(toPath.apply!([strLit("not-a-url")]));
    expect(invalid).toBeTruthy();
    expect(litValue(invalid).ok).toBe(false);
  });
});

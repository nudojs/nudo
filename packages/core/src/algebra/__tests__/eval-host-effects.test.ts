/**
 * 求值引擎宿主副作用守卫：fetch / 定时器等宿主全局不得真实执行。
 * 直接执行会把 Abs 实参喂给原生实现——fetch(unknownAbs) 以 "[object Object]"
 * 发起真请求（ERR_INVALID_URL / 未处理 rejection 崩掉分析进程）。
 * 命中即 fail-closed（opaque unknown + 截断上报）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { runTranspiled, callTranspiledExportFull, checkSource, pTrue, strLit, $lit } from "@nudojs/core";
import { setAbsTruncationCollector } from "@nudojs/core/internal";

function callFn(src: string, name: string, args: unknown[] = []) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, name, args as never[]);
}

const origFetch = globalThis.fetch;
const origSetTimeout = globalThis.setTimeout;
const origWS = (globalThis as Record<string, unknown>).WebSocket;
const origXhr = (globalThis as Record<string, unknown>).XMLHttpRequest;
const origEs = (globalThis as Record<string, unknown>).EventSource;

afterEach(() => {
  globalThis.fetch = origFetch;
  globalThis.setTimeout = origSetTimeout;
  const g = globalThis as Record<string, unknown>;
  if (origWS === undefined) delete g.WebSocket; else g.WebSocket = origWS;
  if (origXhr === undefined) delete g.XMLHttpRequest; else g.XMLHttpRequest = origXhr;
  if (origEs === undefined) delete g.EventSource; else g.EventSource = origEs;
});

describe("B host side-effect guard", () => {
  it("fetch 不真实执行：fail-closed opaque + 截断上报", () => {
    let called = 0;
    globalThis.fetch = ((..._a: unknown[]) => {
      called++;
      return Promise.reject(new Error("must not run"));
    }) as typeof fetch;

    const seen: string[] = [];
    setAbsTruncationCollector((l: string) => seen.push(l));
    try {
      const r = callFn(`export function load(url) { return fetch(url); }`, "load", [
        strLit("https://example.com"),
      ]);
      expect(called).toBe(0);
      expect(r.result.shape.k).toBe("unknown");
      expect(r.result.conf).toBe("opaque");
      expect(seen).toContain("#host-effect:fetch");
    } finally {
      setAbsTruncationCollector(null);
    }
  });

  it("别名引用（const f = fetch）同样不执行", () => {
    let called = 0;
    globalThis.fetch = ((..._a: unknown[]) => {
      called++;
      return Promise.reject(new Error("must not run"));
    }) as typeof fetch;

    const r = callFn(`export function load(url) { const f = fetch; return f(url); }`, "load", [
      strLit("https://example.com"),
    ]);
    expect(called).toBe(0);
    expect(r.result.conf).toBe("opaque");
  });

  it("setTimeout 不排真实定时器", () => {
    let scheduled = 0;
    globalThis.setTimeout = ((..._a: unknown[]) => {
      scheduled++;
      return 0 as never;
    }) as unknown as typeof setTimeout;

    const r = callFn(`export function later(cb) { return setTimeout(cb, 0); }`, "later", [
      $lit(undefined),
    ]);
    expect(scheduled).toBe(0);
    expect(r.result.conf).toBe("opaque");
  });

  it("普通宿主函数（非守卫名单）仍真实执行", () => {
    let called = 0;
    (globalThis as Record<string, unknown>).__nudoProbe = () => {
      called++;
      return 42;
    };
    try {
      callFn(`export function probe() { return __nudoProbe(); }`, "probe", []);
      expect(called).toBe(1);
    } finally {
      delete (globalThis as Record<string, unknown>).__nudoProbe;
    }
  });

  it("check 面：nudo:host-effect-blocked（info），不误报 recursion-truncated", () => {
    const src = `export function load(url) { return fetch(url); }`;
    const r = checkSource("/t/net.js", src, pTrue);
    const blocked = r.issues.filter((i) => i.code === "nudo:host-effect-blocked");
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0]!.severity).toBe("info");
    expect(blocked[0]!.message).toContain("fetch");
    expect(r.issues.filter((i) => i.code === "nudo:recursion-truncated")).toHaveLength(0);
  });

  it("new WebSocket：构造器不真实执行，fail-closed opaque", () => {
    let constructed = 0;
    class FakeWS {
      constructor() {
        constructed++;
        throw new Error("must not construct");
      }
    }
    (globalThis as Record<string, unknown>).WebSocket = FakeWS;

    const seen: string[] = [];
    setAbsTruncationCollector((l: string) => seen.push(l));
    try {
      const r = callFn(`export function open(u) { return new WebSocket(u); }`, "open", [
        strLit("wss://example.com"),
      ]);
      expect(constructed).toBe(0);
      expect(r.result.shape.k).toBe("unknown");
      expect(r.result.conf).toBe("opaque");
      expect(seen).toContain("#host-effect:WebSocket");
    } finally {
      setAbsTruncationCollector(null);
    }
  });

  it("new XMLHttpRequest / EventSource 同样不真实构造", () => {
    let xhrCtor = 0;
    let esCtor = 0;
    (globalThis as Record<string, unknown>).XMLHttpRequest = function FakeXhr() {
      xhrCtor++;
      throw new Error("must not construct");
    };
    (globalThis as Record<string, unknown>).EventSource = function FakeEs() {
      esCtor++;
      throw new Error("must not construct");
    };

    const r1 = callFn(`export function mk() { return new XMLHttpRequest(); }`, "mk", []);
    const r2 = callFn(`export function mk2(u) { return new EventSource(u); }`, "mk2", [
      strLit("https://example.com/es"),
    ]);
    expect(xhrCtor).toBe(0);
    expect(esCtor).toBe(0);
    expect(r1.result.conf).toBe("opaque");
    expect(r2.result.conf).toBe("opaque");
  });

  it("非守卫构造器（new Date）仍走正常 brand 路径", () => {
    const r = callFn(`export function d() { return new Date(0); }`, "d", []);
    // 非名单构造器不得被守卫打成 opaque unknown
    expect(r.result.shape.k).not.toBe("unknown");
    expect(r.result.conf).not.toBe("opaque");
  });
});

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { checkWeb, webEnvGlobals } from "./env-bug-s1-helpers.ts";

/**
 * 族 15 · BUG-161 — web env 的浏览器构造器返回**普通对象面**（无 brand）
 * ⇒ `instanceof` **恒假**、`constructor.name` 恒 `"Object"` ⇒ 与宿主**相反**
 * ⇒ 真实分支被消成死代码（假绿 + 自信的错值）。node env 同 API 全对。
 *
 * 修法：实例面改 `brandOf("Event")` 等（与 node env 同源）。
 *
 * 反向钉：把 `EventInstance` 改回 `objAbs(eventSlots)` ⇒ 本文件必挂。
 *
 * ⚠️ `URLSearchParams` 例外：core 按 **brand 名**路由内建建模并**忽略** env
 * 的槽表（实测 `.get` 折 unknown，`env-bug-930` 回归）⇒ 暂不加 brand
 * （见 web.ts 的说明）。其余 12 个构造器均已带 brand。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 161 — web browser constructors keep their brand", () => {
  it("host oracle: instanceof is true and constructor.name is the class name", () => {
    const out = host(`
      const e = new Event("t");
      console.log(JSON.stringify({
        inst: e instanceof Event,
        name: e.constructor.name,
        req: new Request("http://x/") instanceof Request,
        hdr: new Headers() instanceof Headers,
      }));
    `);
    expect(JSON.parse(out)).toEqual({ inst: true, name: "Event", req: true, hdr: true });
  });

  it("web: new Event(...) instanceof Event folds to true (was false)", () => {
    const out = checkWeb(`export function f(){ return new Event("t") instanceof Event; }`);
    expect(out.signatures[0]!.display).toBe("true");
  });

  it("web: the real branch of instanceof is reachable (was dead code)", () => {
    const out = checkWeb(`export function f(){
  const e = new Event("t");
  if (e instanceof Event) { return "is-event"; }
  return "not-event";
}`);
    expect(out.signatures[0]!.display).toBe('"is-event"');
  });

  it("web: constructor.name folds to the class name (was \"Object\")", () => {
    const out = checkWeb(`export function f(){ return new Event("t").constructor.name; }`);
    expect(out.signatures[0]!.display).toBe('"Event"');
  });

  it("web: other constructors are branded instances", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("http://x/");
  return [r instanceof Request, new Headers() instanceof Headers, new AbortController() instanceof AbortController];
}`);
    expect(out.signatures[0]!.display).toBe("[true, true, true]");
  });

  it("every browser constructor's instance face carries a brand", () => {
    const globals = webEnvGlobals();
    for (const name of [
      "Event",
      "CustomEvent",
      "Request",
      "Response",
      "Headers",
      "AbortController",
      "EventTarget",
      "DOMParser",
      "XMLHttpRequest",
      "Worker",
      "FileReader",
      "IntersectionObserver",
    ]) {
      const g = globals[name];
      expect(g?.shape.k, `${name} must be a ctor fn`).toBe("fn");
      const ret = (g!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType;
      expect(ret?.shape.k, `${name} instance must be a brand`).toBe("brand");
      expect(ret?.shape.name).toBe(name);
    }
  });
});

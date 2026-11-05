import { describe, it, expect } from "vitest";
import { checkWeb, webEnvGlobals } from "./env-bug-s1-helpers.ts";

/**
 * 族 15 · BUG-153 — web env **根本没声明** 13 个浏览器标准全局
 * （`FormData` / `Blob` / `BroadcastChannel` / `DisposableStack` /
 * `AsyncDisposableStack` / `PerformanceMark` / `PerformanceObserver` /
 * `ReadableStream` / `ReadableStreamBYOBReader` /
 * `ReadableStreamDefaultReader` / `URLPattern` / `WritableStream` /
 * `WritableStreamDefaultWriter`）。
 *
 * 未声明 ⇒ 落 core 的「未建模 builtin」兜底 ⇒ 成员读折 **exact undefined**
 * ⇒ 该全局的**全体**成员调用判「确定抛 TypeError」⇒ L2 假红（exit 1），
 * 而运行时完全不抛。
 *
 * 反向钉：从 web.ts 删掉任一全局的声明 ⇒ 对应行必挂。
 */
const CASES: Array<[global: string, body: string]> = [
  ["FormData", `const d = new FormData(); d.append("a", "b"); return d.get("a");`],
  ["Blob", `return new Blob(["x"]).slice(0, 1);`],
  ["BroadcastChannel", `const c = new BroadcastChannel("x"); c.postMessage(1); c.close(); return 1;`],
  ["DisposableStack", `const s = new DisposableStack(); s.adopt({}, () => {}); return 1;`],
  ["AsyncDisposableStack", `const s = new AsyncDisposableStack(); s.defer(() => {}); return 1;`],
  ["PerformanceMark", `return new PerformanceMark("x").toJSON();`],
  ["PerformanceObserver", `const o = new PerformanceObserver((l) => l); o.observe({ entryTypes: [] }); return 1;`],
  ["ReadableStream", `return new ReadableStream().cancel();`],
  ["ReadableStreamBYOBReader", `return new ReadableStreamBYOBReader(new ReadableStream()).read(new Uint8Array(1));`],
  ["ReadableStreamDefaultReader", `return new ReadableStreamDefaultReader(new ReadableStream()).read();`],
  ["URLPattern", `return new URLPattern("https://x/:id").exec("https://x/1");`],
  ["WritableStream", `return new WritableStream().abort();`],
  ["WritableStreamDefaultWriter", `return new WritableStreamDefaultWriter(new WritableStream()).abort();`],
];

describe("Bug 153 — web env declares the browser globals it models", () => {
  it("every previously-missing global is declared", () => {
    const globals = webEnvGlobals();
    for (const [name] of CASES) {
      expect(globals[name], `${name} must be declared in web env`).toBeTruthy();
    }
  });

  it("using those globals produces zero error diagnostics (was全体假红)", () => {
    for (const [name, body] of CASES) {
      const out = checkWeb(`export function f(){ ${body} }`);
      expect(out.errorCodes, `${name}: ${JSON.stringify(out.issues)}`).toEqual([]);
      expect(out.throwBrands, `${name} must not be a definite TypeError`).toEqual([]);
    }
  });
});

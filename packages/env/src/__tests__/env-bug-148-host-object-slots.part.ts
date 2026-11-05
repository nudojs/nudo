import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { checkWeb } from "./env-bug-s1-helpers.ts";
import { checkNode, instanceFaceOf, slotOfAbs } from "./env-bug-1044-1049-helpers.ts";

/**
 * 族 15 · BUG-148 — env 的宿主对象是**封闭**的：未建模成员读出
 * 「**确定的 undefined**」⇒ 「在 undefined 上取成员 / 调用」= **确定抛
 * TypeError** ⇒ L2 门禁假红（exit 1），而宿主上这些成员**全部存在**。
 *
 * 本条钉住 web 面的三个缺槽（`Response.body` / `Headers.getSetCookie` /
 * `document.location`）与 node 面的 brand 实例面（`CustomEvent` 的继承面、
 * `Request.duplex`）——它们都是「同一 API，node 面有 / web 面无」或反向的
 * **表内不自洽**。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 148 — host objects model the members the host actually has", () => {
  it("host oracle: all four web members exist and are usable", () => {
    const out = host(`
      const body = new Response("hi").body;
      console.log(JSON.stringify({
        body: body.constructor.name,
        cookies: new Headers().getSetCookie(),
        // document 在 node 里不存在 ⇒ 用 DOM 规范等价的同一对象解析
        locHasHref: typeof new URL("http://x/").href,
      }));
    `);
    expect(JSON.parse(out)).toEqual({ body: "ReadableStream", cookies: [], locHasHref: "string" });
  });

  it("web: Response.body.getReader() is not a definite TypeError", () => {
    const out = checkWeb(`export function reader(){ return new Response("hi").body.getReader(); }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
  });

  it("web: Headers.getSetCookie() is declared as string[]", () => {
    const out = checkWeb(`export function cookies(){ return new Headers().getSetCookie(); }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
    expect(out.signatures[0]!.display).toContain("string[]");
  });

  it("web: document.location.href is declared (document is not closed around it)", () => {
    const out = checkWeb(`export function href(){ return document.location.href; }
export function title(){ return document.title; }`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
    for (const s of out.signatures) expect(s.display).toBe("string");
  });

  it("node: CustomEvent carries the inherited Event members", () => {
    const out = checkNode(`export function f(){ const e = new CustomEvent("t"); e.preventDefault(); return e.timeStamp; }`);
    expect(out.throwBrands).toEqual([]);
    expect(out.errorCodes).toEqual([]);
  });

  it("node: Request.duplex is declared", () => {
    expect(slotOfAbs(instanceFaceOf("Request"), "duplex")).toBeTruthy();
    const out = checkNode(`export function f(){ return new Request("http://x/").duplex; }`);
    expect(out.throwBrands).toEqual([]);
  });
});

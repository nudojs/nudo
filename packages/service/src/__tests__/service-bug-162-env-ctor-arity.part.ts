/**
 * BUG-162：`instantiateReturn` 无视关系元数 / 构造性 ⇒ 无参 `new Event()`
 * 之类被误判。修复：关系 arity 门 + `shape.ctor === true` + 声明可选性。
 *
 * 该 bug 的可见面在 env 注入之后（env 里的构造器），因此按 node / web 两张
 * env 表分别对拍。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { collectEnvGlobals } from "../eval-run.ts";

const NODE_SRC = `
/// @nudo:env node
export function a() { return new Event(); }
export function b() { return new CustomEvent(); }
export function c() { return new Request(); }
export function d() { return new MessageEvent(); }
export function e() { return new CloseEvent(); }
`;

const WEB_SRC = `
/// @nudo:env web
export function a() { return new Event(); }
export function b() { return new CustomEvent(); }
export function c() { return new Request(); }
export function d() { return document.querySelector(); }
`;

function sig(src: string, env: string[], name: string): string {
  const r = checkSource(`/t/bug-162-${env.join("+")}.js`, src, pTrue, {
    inject: { envGlobals: collectEnvGlobals(env) },
  });
  return r.signatures.find((s) => s.name === name)?.display ?? "(missing)";
}

describe("BUG-162 env constructor arity gate", () => {
  it("web env: real constructors keep their brands", () => {
    const env = ["web"];
    expect(sig(WEB_SRC, env, "a")).toBe("Event");
    expect(sig(WEB_SRC, env, "b")).toBe("CustomEvent");
    expect(sig(WEB_SRC, env, "c")).toBe("Request");
  });

  it("node env: illegal no-arg constructions are honest may-throw TypeError", () => {
    const env = ["node"];
    for (const name of ["a", "b", "c", "d", "e"]) {
      expect(sig(NODE_SRC, env, name)).toBe("never throws TypeError");
    }
  });
});

/** `node:url.fileURLToPath`：非法/抽象输入记 TypeError 抛出面；合法输入零抛且字面量精确。 */
import { describe, it, expect } from "vitest";
import { fileURLToPath as nodeFileURLToPath } from "node:url";
import { strLit } from "@nudojs/core";
import { prim } from "../abs-helpers.ts";
import { defineEnv } from "../node.ts";
import { brandName, callSite } from "./env-helpers-call-site.ts";

const url = defineEnv().modules!.url!;

function nativeError(fn: () => unknown): { name?: string; code?: string } {
  try {
    fn();
    return {};
  } catch (e) {
    const err = e as Error & { code?: string };
    return { name: err.name, code: err.code };
  }
}

describe("fileURLToPath 抛出面", () => {
  it("非法 / 非 file scheme / 抽象实参记 TypeError；合法 URL 零抛且结果精确", () => {
    const invalid = nativeError(() => nodeFileURLToPath("not-a-url"));
    expect(invalid).toEqual({ name: "TypeError", code: "ERR_INVALID_URL" });
    const scheme = nativeError(() => nodeFileURLToPath("http://example.com/x"));
    expect(scheme).toEqual({ name: "TypeError", code: "ERR_INVALID_URL_SCHEME" });

    for (const arg of [strLit("not-a-url"), strLit("http://example.com/x"), prim.str()]) {
      const site = callSite(url.fileURLToPath!, [arg]);
      expect(site.threw, "may-throw must not be a hard throw").toBeUndefined();
      expect(site.exits).toHaveLength(1);
      expect(brandName(site.exits[0]!)).toBe("TypeError");
    }

    expect(nodeFileURLToPath("file:///tmp/x.txt")).toBe("/tmp/x.txt");
    const ok = callSite(url.fileURLToPath!, [strLit("file:///tmp/x.txt")]);
    expect(ok.threw).toBeUndefined();
    expect(ok.exits).toHaveLength(0);
    const term = ok.value!.term as { op?: string; value?: unknown };
    expect(term.op).toBe("lit");
    expect(term.value).toBe("/tmp/x.txt");
  });
});

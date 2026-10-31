import { describe, it, expect } from "vitest";
import { formatShape, strLit, numLit, type Abs } from "@nudojs/core";
import nodePath from "node:path";
import { envMember, applyOut, callSite } from "./env-bug-s3-helpers.ts";
import { slotOfAbs } from "./env-bug-1044-1049-helpers.ts";

/**
 * 族 15 · BUG-255 — `path.posix` / `path.win32` 用的是**另一份手抄成员表**，
 * 漏了 `parse` / `format` ⇒ 读这两个成员得到 **exact `undefined`**
 * （闭 obj 缺槽）⇒ 调用 ⇒ **确定抛 TypeError** ⇒ L2 门禁假红（exit 1），
 * 而宿主 `path.posix.parse("/a/b.txt")` 完全正常。
 *
 * 修法：平台对象**复用**顶层 `path` 的同一份实现（单一事实源）。
 *
 * 反向钉：把 `parse` / `format` 从 `platformPathMethods` 删掉 ⇒ 本文件必挂。
 */
function parsedOf(pathObj: unknown, input: string): string {
  return formatShape(
    applyOut(pathObj as never, [strLit(input)]) as never,
  );
}

describe("Bug 255 — path.posix / path.win32 carry parse and format", () => {
  it("host oracle: posix.parse / win32.parse / posix.format all work", () => {
    expect(nodePath.posix.parse("/a/b.txt")).toEqual(nodePath.parse("/a/b.txt"));
    expect(nodePath.win32.parse("a\\b.txt")).toEqual({
      root: "",
      dir: "a",
      base: "b.txt",
      ext: ".txt",
      name: "b",
    });
    expect(nodePath.posix.format({ dir: "/a", base: "b.txt" })).toBe("/a/b.txt");
  });

  it("the platform member tables declare parse / format", () => {
    for (const platform of ["posix", "win32"] as const) {
      const face = envMember("node:path", platform);
      expect(slotOfAbs(face, "parse"), `path.${platform}.parse`).toBeTruthy();
      expect(slotOfAbs(face, "format"), `path.${platform}.format`).toBeTruthy();
      // 既有成员不受影响
      expect(slotOfAbs(face, "join")).toBeTruthy();
      expect(slotOfAbs(face, "sep")).toBeTruthy();
    }
  });

  it("posix.parse folds exactly like the top-level path.parse (single source of truth)", () => {
    const top = envMember("node:path", "parse");
    const posixParse = slotOfAbs(envMember("node:path", "posix"), "parse")!;
    const expected = parsedOf(top, "/a/b.txt");
    expect(parsedOf(posixParse, "/a/b.txt")).toBe(expected);
    expect(expected).toContain("/a");
  });

  it("win32.parse folds platform-specifically (not a definite TypeError)", () => {
    const win32Parse = slotOfAbs(envMember("node:path", "win32"), "parse")!;
    const out = parsedOf(win32Parse, "a\\b.txt");
    expect(out).toContain("b.txt");
    expect(out).not.toContain("never");
  });

  it("posix.format returns a string and rejects non-objects", () => {
    const format = slotOfAbs(envMember("node:path", "posix"), "format")!;
    // 往返：parse 的产物正是 format 的合法实参（obj 面）
    const roundTrip = applyOut(envMember("node:path", "parse"), [
      strLit("/a/b.txt"),
    ]) as Abs;
    expect(formatShape(callSite(format, [roundTrip]).value!)).toBe("string");
    // 原生 `path.format(123)` 定抛 TypeError ⇒ 没有返回值，且以抛出口结束
    const bad = callSite(format, [numLit(1)]);
    expect(bad.value).toBeUndefined();
    expect(bad.threw !== undefined || bad.exits.length > 0).toBe(true);
  });
});

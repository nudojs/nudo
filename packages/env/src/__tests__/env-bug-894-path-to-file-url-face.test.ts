/**
 * Bug 894 — env node 的 `url.pathToFileURL` 返回域被声明成 **1 槽闭合对象 `{ href }`**
 * ⇒ `.pathname` / `.protocol` / `.host` … 读出 **exact `undefined`**（真值是
 * "/tmp/x.txt" 等），且 `.pathname.length` 被判**定抛 TypeError**（L2 假红）。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测，pathToFileURL("/tmp/x.txt")）：
 *   href     = "file:///tmp/x.txt"
 *   pathname = "/tmp/x.txt"
 *   protocol = "file:"
 *   host     = ""      hostname = ""      port   = ""
 *   search   = ""      hash     = ""      origin = "null"
 *   username = ""      password = ""
 *   toString() = "file:///tmp/x.txt"     toJSON() = "file:///tmp/x.txt"
 *
 * 旧实现：`objAbs({ href: prim.str() })` ⇒ 闭对象**只有 href 一个槽** ⇒ 其余成员
 * 读出 exact `undefined`（**错值**），再链式读一次（`.pathname.length`）⇒ 引擎
 * 记「在 undefined 上取属性」⇒ **证明**「必抛 TypeError」⇒ L2 门禁假红。
 *
 * 新建模：返回域换成**完整 URL 面**（11 组件 + toString / toJSON），且 apply 对
 * 字面量路径给出**字面量精度**的实例面。
 *
 * 断言双向：正向钉住「成员表完整 + 值与原生一致」；
 * 反向（把返回域改回 `{ href }` 单槽）本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import { pathToFileURL as nodePathToFileURL } from "node:url";
import { formatShape, strLit, type Abs } from "@nudojs/core";
import { defineEnv } from "../node.ts";
import { callSite } from "./env-bug-s4-helpers.ts";

const env = defineEnv();
const url = env.modules!.url!;

/** obj 槽位（obj shape ⇒ slots） */
function slotsOf(a: Abs): Record<string, Abs> {
  const shape = a.shape as { k: string; slots?: Record<string, { value: Abs }> };
  expect(shape.k).toBe("obj");
  const out: Record<string, Abs> = {};
  for (const [k, slot] of Object.entries(shape.slots ?? {})) out[k] = slot.value;
  return out;
}

/** lit term 的字面量值（取不到 ⇒ undefined） */
function litOf(a: Abs | undefined): string | undefined {
  const t = a?.term as { op?: string; value?: unknown } | undefined;
  return t?.op === "lit" ? String(t.value) : undefined;
}

describe("Bug 894 · pathToFileURL 返回完整 URL 面", () => {
  it("1. 字面量路径 ⇒ 实例面含全部 11 个 URL 组件 + toString / toJSON", () => {
    const site = callSite(url.pathToFileURL!, [strLit("/tmp/x.txt")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
    const slots = slotsOf(site.value!);
    for (const key of [
      "href",
      "origin",
      "protocol",
      "username",
      "password",
      "host",
      "hostname",
      "port",
      "pathname",
      "search",
      "hash",
      "toString",
      "toJSON",
    ]) {
      expect(Object.keys(slots), `pathToFileURL result must expose ${key}`).toContain(key);
    }
  });

  it("2. 成员值与原生一致（href / pathname / protocol …）", () => {
    const native = nodePathToFileURL("/tmp/x.txt");
    const site = callSite(url.pathToFileURL!, [strLit("/tmp/x.txt")]);
    const slots = slotsOf(site.value!);
    expect(litOf(slots.href)).toBe(native.href);
    expect(litOf(slots.pathname)).toBe(native.pathname);
    expect(litOf(slots.protocol)).toBe(native.protocol);
    expect(litOf(slots.host)).toBe(native.host);
    expect(litOf(slots.hostname)).toBe(native.hostname);
    expect(litOf(slots.port)).toBe(native.port);
    expect(litOf(slots.search)).toBe(native.search);
    expect(litOf(slots.hash)).toBe(native.hash);
    expect(litOf(slots.origin)).toBe(native.origin);
    expect(litOf(slots.username)).toBe(native.username);
    expect(litOf(slots.password)).toBe(native.password);
  });

  it("3. 声明面（抽象实参回落面）也是完整 URL 面（旧实现只有 href 一槽）", () => {
    const fmt = formatShape(url.pathToFileURL!);
    for (const key of ["href", "pathname", "protocol", "origin", "toString", "toJSON"]) {
      expect(fmt, `declared return face must carry ${key}`).toContain(key);
    }
  });

  it("4. 反向对照：旧单槽面读 pathname 会得到 exact undefined", () => {
    // 旧建模：objAbs({ href }) ⇒ 无 pathname 槽
    const site = callSite(url.pathToFileURL!, [strLit("/tmp/x.txt")]);
    const slots = slotsOf(site.value!);
    expect(slots.pathname, "pathname must not be missing (old face had only href)").toBeTruthy();
    expect(litOf(slots.pathname)).not.toBeUndefined();
  });
});

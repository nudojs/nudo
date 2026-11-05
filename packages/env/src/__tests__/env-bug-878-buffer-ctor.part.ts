/**
 * Bug 878 — node env 把 `Buffer` 声明成**普通对象**（不是构造器）⇒
 * `new Buffer(...)` 被判**确定 TypeError** ⇒ L2 门禁对合法 Node 代码报 error
 * （假红，`nudo check` exit 1）。
 *
 * 修法：`Buffer` 建成 **envFn + `{ ctor: true }`**（packages/env/src/node.ts）；
 * 静态面（from / alloc / of / …）挂 fn 的 slots，实例面在 returnType 上——
 * 两者指向**同一个** Buffer 形状（bufferBrand），不另造第二份 Buffer 形状。
 *
 * 证据口径：原生 oracle（同进程真实 new Buffer）+ 引擎探针。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { defineEnv } from "../node.ts";

const env = defineEnv();

function check(src: string) {
  return checkSource("/t/env-bug-878.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 878 — Buffer 是构造器（new Buffer(...) 不再定抛 TypeError）", () => {
  it("原生 oracle：new Buffer(1) / new Buffer(\"ab\") 正常返回（仅弃用警告，不抛）", () => {
    expect(new Buffer(1).length).toBe(1);
    expect(new Buffer("ab").length).toBe(2);
  });

  it("env：Buffer 是 fn 形全局且带 ctor:true，实例面是 Buffer 形状", () => {
    const g = env.globals.Buffer!;
    expect(g, "global Buffer missing").toBeTruthy();
    expect(g.shape.k, "Buffer 形状").toBe("fn");
    expect((g.shape as { ctor?: boolean }).ctor, "Buffer ctor").toBe(true);
    const inst = (g.shape as { returnType: { shape: { k: string; name?: string } } }).returnType;
    expect(inst.shape.k).toBe("brand");
    expect(inst.shape.name).toBe("Buffer");
  });

  it("引擎探针：new Buffer(1) 不再是「never throws TypeError」", () => {
    const r = check(`
      export function f() { return new Buffer(1); }
      export function g() { return new Buffer("ab"); }
    `);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
      expect(s.display).toMatch(/^Buffer\b/);
    }
  });
});

/**
 * Bug 961 —— `nudo/whatIf` 的入参**零校验**：
 *
 * 1. `target` 缺失 ⇒ 返回 `Type of "undefined": unknown` 的**假成功**——
 *    `unknown` 按产品口径是「推断失败」，于是「你根本没传 target」被说成
 *    「这个变量推断不出来」。⇒ 工具错误。
 * 2. `bindings` 不是数组 ⇒ 裸 JS TypeError（`bindings.map is not a
 *    function`）当工具错误回给客户端——引擎内部实现细节，不是可诊断信息。
 *    ⇒ 工具错误（可诊断文案）。
 * 3. `bindings` 项缺 `name` ⇒ 静默 no-op，且回显行渲染成「…: 」（冒号后
 *    为空）——用户以为「没有未应用的绑定」，实际是自己少传了字段。
 *    ⇒ 工具错误。
 *
 * 「target 不是已知绑定」仍是**合法**结果（文档承诺 `unknown`）——只有
 * **请求本身畸形**才走工具错误（对照组）。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";
import { injectBindings } from "@nudojs/service";

const SRC = ["const total = 1;", ""].join("\n");

describe("Bug 961：nudo/whatIf 入参校验（畸形请求 ⇒ 工具错误）", () => {
  it("target 缺失 / bindings 非数组 / binding 缺 name ⇒ isError:true", async () => {
    await withLspServer({ "a4-961.js": SRC }, async ({ req, uri }) => {
      const file = uri("a4-961.js");

      // ① target 缺失 ⇒ 失败（此前是 `Type of "undefined": unknown` 假成功）
      const noTarget = await req("nudo/whatIf")({ file, bindings: [] });
      expect(noTarget.isError).toBe(true);
      expect(noTarget.content[0].text).toContain("target is required");
      expect(noTarget.content[0].text).not.toContain('Type of "undefined"');

      // ② bindings 非数组 ⇒ 失败，且文案可诊断（不是裸 JS TypeError）
      const notArray = await req("nudo/whatIf")({ file, target: "total", bindings: "x" });
      expect(notArray.isError).toBe(true);
      expect(notArray.content[0].text).toContain("bindings must be an array");
      expect(notArray.content[0].text).not.toContain("is not a function");

      // ③ binding 缺 name ⇒ 失败
      const noName = await req("nudo/whatIf")({
        file,
        target: "total",
        bindings: [{ type: "string" }],
      });
      expect(noName.isError).toBe(true);
      expect(noName.content[0].text).toContain("bindings[0]");

      // 对照组：target 不是已知绑定 ⇒ 合法成功面（unknown），不是错误
      const unknownTarget = await req("nudo/whatIf")({ file, target: "nope", bindings: [] });
      expect(unknownTarget.isError).toBeFalsy();
      expect(unknownTarget.content[0].text).toContain('Type of "nope": unknown');

      // 对照组：合法请求 ⇒ 成功面
      const ok = await req("nudo/whatIf")({ file, target: "total", bindings: [] });
      expect(ok.isError).toBeFalsy();
      expect(ok.content[0].text).toContain('Type of "total": 1');
    });
  });

  it("service 侧 injectBindings 也做形状校验（非数组 ⇒ 可诊断错误）", () => {
    // 形状校验下沉到 service（CLI --what-if 与其它调用方同样受益）
    expect(() => injectBindings("const total = 1;\n", "x" as never)).toThrow(
      /bindings must be an array/,
    );
    // 缺 name 的项：具名提示（此前是空串 ⇒ 提示行渲染成「…: 」）
    const out = injectBindings("const total = 1;\n", [{ type: "string" } as never]);
    expect(out.unapplied).toEqual(["<missing name>"]);
  });
});

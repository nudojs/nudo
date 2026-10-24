/**
 * Bug 356 回归：侧车求值的**注入名**与侧车自身绑定撞名 ⇒ SyntaxError。
 *
 * 根因（同 338）：`new Function(...Object.keys(sidecarInjects), …)` 把 15 个
 * 构建器名当形参注入；侧车的顶层 `const <name>` 与形参同名 ⇒ 整份侧车失效。
 *
 * 扩围面（报告原文「356 的扩展面」）：
 * - (1) `__nudoInjects` / `__nudoDeps` 两个注入参数与侧车同名 ⇒ 同样 SyntaxError
 * - (2) 相对 import 的 `var <local>` 前缀路径 ⇒ 同样 SyntaxError
 *
 * 修法：注入名整体搬进**外层作用域**（注入袋 + 构建器解构 + 依赖绑定），
 * 侧车自己的代码放内层 IIFE ⇒ 同名变成「遮蔽」（不同作用域）而不是「重复
 * 声明」；相对 import 的撞名额外报出 Nudo 原生诊断（native ESM 是 SyntaxError，
 * 引擎里是遮蔽 ⇒ 导入值静默丢失、契约悄悄变弱）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  execNudoModule,
  setRefineDiagCollector,
  takeRefineDiags,
} from "../refine.ts";

beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("Bug 356: 侧车注入名撞名", () => {
  it("构建器名撞名 → 侧车可加载（旧口径 SyntaxError）", () => {
    const src = `
import { fn } from "@nudojs/core";
export const number = fn({ x: 1 }, 1);
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("number");
  });

  it("`__nudoInjects` 撞名 → 侧车可加载（旧口径 SyntaxError）", () => {
    const src = `
import { fn, number } from "@nudojs/core";

const __nudoInjects = 1;
export const f = fn({ x: number() }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("f");
  });

  it("`__nudoDeps` 撞名 → 侧车可加载（旧口径 SyntaxError）", () => {
    const src = `
import { fn, number } from "@nudojs/core";

const __nudoDeps = 1;
export const f = fn({ x: number() }, number());
`;
    const out = execNudoModule(src, { fromFile: "/t/lib.nudo.js" });
    expect(Object.keys(out)).toContain("f");
  });

  it("相对 import 的本地名撞名 → 侧车可加载 + 报出 Nudo 原生诊断", () => {
    const src = `
import { positive } from "./shapes.nudo.js";
import { fn, number } from "@nudojs/core";

const positive = 1;
export const g = fn({ x: number() }, number());
`;
    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const out = execNudoModule(src, {
      fromFile: "/t/lib.nudo.js",
      loadModule: (spec) =>
        spec === "./shapes.nudo.js"
          ? `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`
          : undefined,
    });
    expect(Object.keys(out)).toContain("g");
    const clash = diags.find((d) => d.message.includes("declares 'positive'"));
    expect(clash).toBeDefined();
    expect(clash?.code).toBe("nudo:interface-load");
  });
});

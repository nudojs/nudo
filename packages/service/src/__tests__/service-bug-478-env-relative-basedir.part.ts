/**
 * Bug 478 — 相对路径 `@nudo:env` 按**进程级全局 baseDir 注册表**解析：
 * 先预载的 `./env.ts` 赢下所有同名拼写 ⇒ 别的目录拿到别人的 env（错值 + 零诊断）。
 *
 * 契约：相对说明符（`./env.js`）只按**发起方文件的目录**解析；
 * 同一进程内两个目录各有自己的 `./env.js` 时必须各取各的。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createEnvironment, formatShape } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";
import {
  loadEnvs,
  preloadPathEnvs,
  getPathEnvLoadErrors,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";

/** env 文件用 @nudojs/core 的裸说明符（装载器会重写为绝对路径后导入） */
const envFile = (n: number): string => `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(${n}) } };
}
`;

beforeEach(() => {
  clearPathEnvCaches();
});

describe("Bug 478 — 相对 path env 按发起方目录解析", () => {
  it("两个目录各有 ./env.js：先预载者不得赢下所有同名拼写", async () => {
    const dirX = tmpProject("nudo-bug-478-x-", { "env.js": envFile(11) });
    const dirY = tmpProject("nudo-bug-478-y-", { "env.js": envFile(22) });

    await preloadPathEnvs(["./env.js"], dirX);
    await preloadPathEnvs(["./env.js"], dirY);

    const lx = loadEnvs(["./env.js"], createEnvironment(), dirX);
    const ly = loadEnvs(["./env.js"], createEnvironment(), dirY);
    expect(formatShape(lx.globals.MAGIC!)).toBe("11");
    expect(formatShape(ly.globals.MAGIC!)).toBe("22");
  });

  it("反向预载顺序同样各取各的（不得依赖预载次序）", async () => {
    const dirX = tmpProject("nudo-bug-478-x2-", { "env.js": envFile(11) });
    const dirY = tmpProject("nudo-bug-478-y2-", { "env.js": envFile(22) });

    await preloadPathEnvs(["./env.js"], dirY);
    await preloadPathEnvs(["./env.js"], dirX);

    const lx = loadEnvs(["./env.js"], createEnvironment(), dirX);
    const ly = loadEnvs(["./env.js"], createEnvironment(), dirY);
    expect(formatShape(lx.globals.MAGIC!)).toBe("11");
    expect(formatShape(ly.globals.MAGIC!)).toBe("22");
  });

  it("负控制：同一目录重复装载结果一致（不因缓存漂移）", async () => {
    const dirX = tmpProject("nudo-bug-478-same-", { "env.js": envFile(11) });
    await preloadPathEnvs(["./env.js"], dirX);
    const a = loadEnvs(["./env.js"], createEnvironment(), dirX);
    const b = loadEnvs(["./env.js"], createEnvironment(), dirX);
    expect(formatShape(a.globals.MAGIC!)).toBe("11");
    expect(formatShape(b.globals.MAGIC!)).toBe("11");
  });

  it("负控制：绝对路径说明符照旧按绝对路径解析", async () => {
    const dirX = tmpProject("nudo-bug-478-abs-", { "env.js": envFile(11) });
    const abs = `${dirX}/env.js`;
    await preloadPathEnvs([abs], dirX);
    const loaded = loadEnvs([abs], createEnvironment(), dirX);
    expect(formatShape(loaded.globals.MAGIC!)).toBe("11");
    expect(getPathEnvLoadErrors(dirX)).toHaveLength(0);
  });
});

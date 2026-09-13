// harvest.test.ts 在运行时生成 generated-env.tmp.ts 并动态 import。
// 类型检查期该文件不存在，用通配环境声明提供其形状（脚本文件，非模块增强）。
declare module "*.tmp.ts" {
  export function defineEnv(): {
    globals: Record<string, unknown>;
    modules: Record<string, Record<string, unknown>>;
  };
}

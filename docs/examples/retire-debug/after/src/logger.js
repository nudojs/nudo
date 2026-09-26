/**
 * after/ — 同一真实依赖 `debug`；tsc 已退役，门禁是 nudo check。
 * debug() 是 native 入口：返回面诚实 unknown（引擎债 warning，不是契约失败）。
 * 有 @types/debug 时 harvest 会自动补签名；也可用 @nudo:mock / refine return 钉住。
 */
import debug from "debug";

export function createLogger(namespace) {
  return debug(namespace);
}

export function logHello(name) {
  const log = debug("app");
  log("hello %s", name);
}

createLogger("demo");
logHello("ada");

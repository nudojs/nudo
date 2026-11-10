/**
 * after/ — 同一真实依赖 `debug`；tsc 已退役，门禁是 nudo check。
 * debug() 是 native 入口：宿主能解析到真实 `debug` 包时引擎会真实求值并
 * 给出精确返回面；解析不到时诚实退化为 unknown + nudo:opaque-result。
 * 两者都不是契约失败，门禁恒为 0 error。
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

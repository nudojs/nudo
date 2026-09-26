/**
 * 真实依赖：npm `debug`（visionmedia/debug，纯 JS、生态极常用）。
 * 迁移前：消费方仍用 tsc + @types/debug 把关。
 */
import debug from "debug";

export function createLogger(namespace: string) {
  return debug(namespace);
}

export function logHello(name: string): void {
  const log = debug("app");
  log("hello %s", name);
}

createLogger("demo");
logHello("ada");

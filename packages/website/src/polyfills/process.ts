/**
 * Browser stand-in for Node `process` — `@babel/types` and other deps read
 * `process.env.*` at module load. Webpack aliases `process` here for the
 * website/playground bundle.
 */

type Env = Record<string, string | undefined>;

const nodeEnv =
  (typeof globalThis !== "undefined" &&
    (globalThis as { __NODE_ENV__?: string }).__NODE_ENV__) ||
  "production";

const env: Env = {
  NODE_ENV: nodeEnv,
  // Babel 7 defaults — keep type definitions on the Babel 7 shape
  BABEL_TYPES_8_BREAKING: undefined,
  BABEL_8_BREAKING: undefined,
  IS_PUBLISH: undefined,
};

function nextTick(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
  queueMicrotask(() => fn(...args));
}

const processShim = {
  browser: true as const,
  env,
  platform: "browser",
  arch: "browser",
  argv: [] as string[],
  argv0: "browser",
  execPath: "/browser",
  pid: 0,
  ppid: 0,
  title: "browser",
  version: "v0.0.0-browser",
  versions: {} as Record<string, string>,
  release: { name: "browser", sourceUrl: "", headersUrl: "", libUrl: "" },
  nextTick,
  cwd: () => "/",
  chdir: () => undefined,
  exit: () => undefined,
  emit: () => false,
  on: () => processShim,
  once: () => processShim,
  off: () => processShim,
  removeListener: () => processShim,
  removeAllListeners: () => processShim,
  listeners: () => [] as Array<(...args: unknown[]) => void>,
  listenerCount: () => 0,
  prependListener: () => processShim,
  prependOnceListener: () => processShim,
  hrtime: ((prev?: [number, number]) => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const s = Math.floor(now / 1000);
    const ns = Math.floor((now % 1000) * 1e6);
    if (!prev) return [s, ns] as [number, number];
    let sec = s - prev[0];
    let nsec = ns - prev[1];
    if (nsec < 0) {
      sec -= 1;
      nsec += 1e9;
    }
    return [sec, nsec] as [number, number];
  }) as (prev?: [number, number]) => [number, number],
  memoryUsage: () => ({
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0,
    arrayBuffers: 0,
  }),
  stdout: { write: () => true, isTTY: false, writev: () => true },
  stderr: { write: () => true, isTTY: false, writev: () => true },
  stdin: { on: () => processShim, resume: () => undefined, pause: () => undefined },
};

export default processShim;
export const browser = processShim.browser;
export const envExport = env;
export { env };
export const platform = processShim.platform;
export const argv = processShim.argv;
export const version = processShim.version;
export const versions = processShim.versions;
export const nextTickExport = nextTick;
export { nextTick };
export const cwd = processShim.cwd;
export const exit = processShim.exit;
export const emit = processShim.emit;
export const on = processShim.on;
export const once = processShim.once;
export const off = processShim.off;
export const removeListener = processShim.removeListener;
export const hrtime = processShim.hrtime;
export const stdout = processShim.stdout;
export const stderr = processShim.stderr;
export const stdin = processShim.stdin;
export const title = processShim.title;
export const pid = processShim.pid;

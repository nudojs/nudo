/**
 * Node env：es globals + node 内建 modules（Abs 原生）。
 */

import {
  type Abs,
  type AbsSigImpl,
  litValue,
  strLit,
  boolLit,
} from "@nudojs/core";
import {
  arrOf,
  brandOf,
  envFn,
  envFnVariadic,
  nullLit,
  objAbs,
  promiseOf,
  tupleOf,
  undef,
  unionOf,
  prim,
} from "./abs-helpers.ts";
import { type EnvDefinition, defineEnv as defineEsEnv } from "./es.ts";
import nodePath from "node:path";

export type { EnvDefinition };

function absStr(a: Abs | undefined): string | undefined {
  if (!a) return undefined;
  const v = litValue(a);
  return typeof v === "string" ? v : undefined;
}

function allAbsStr(args: Abs[]): string[] | undefined {
  const result: string[] = [];
  for (const a of args) {
    const s = absStr(a);
    if (s === undefined) return undefined;
    result.push(s);
  }
  return result;
}

export function defineEnv(): EnvDefinition {
  const esEnv = defineEsEnv();

  const BufferInstance = brandOf(
    "Buffer",
    objAbs({
      toString: envFn([prim.str()], prim.str()),
      toJSON: envFn(
        [],
        objAbs({ type: prim.str(), data: arrOf(prim.num()) }),
      ),
      length: prim.num(),
      slice: envFn([prim.num(), prim.num()], brandOf("Buffer")),
      copy: envFn(
        [prim.unknown, prim.num(), prim.num(), prim.num()],
        prim.num(),
      ),
      write: envFn(
        [prim.str(), prim.num(), prim.num(), prim.str()],
        prim.num(),
      ),
      readUInt8: envFn([prim.num()], prim.num()),
      readUInt16BE: envFn([prim.num()], prim.num()),
      readUInt16LE: envFn([prim.num()], prim.num()),
      readUInt32BE: envFn([prim.num()], prim.num()),
      readUInt32LE: envFn([prim.num()], prim.num()),
      readInt8: envFn([prim.num()], prim.num()),
      readInt16BE: envFn([prim.num()], prim.num()),
      readInt16LE: envFn([prim.num()], prim.num()),
      readInt32BE: envFn([prim.num()], prim.num()),
      readInt32LE: envFn([prim.num()], prim.num()),
      includes: envFn([unionOf(prim.str(), prim.num())], prim.bool()),
      indexOf: envFn([unionOf(prim.str(), prim.num())], prim.num()),
      fill: envFn([unionOf(prim.str(), prim.num())], brandOf("Buffer")),
      equals: envFn([brandOf("Buffer")], prim.bool()),
      compare: envFn([brandOf("Buffer")], prim.num()),
      subarray: envFn([prim.num(), prim.num()], brandOf("Buffer")),
    }),
  );

  // Buffer brand 作为槽位时用同一实例引用（避免重复 brand）
  const bufferBrand = BufferInstance;

  const fsModule: Record<string, Abs> = {
    // encoding 字面量 → string；否则 string|Buffer（TS 重载近似）
    readFileSync: envFn(
      [prim.str(), unionOf(prim.str(), objAbs({}))],
      unionOf(prim.str(), bufferBrand),
      (args) => {
        const enc = args[1];
        if (!enc) return unionOf(prim.str(), bufferBrand);
        if (enc.term?.op === "lit" && typeof enc.term.value === "string") {
          return prim.str();
        }
        if (enc.shape.k === "prim" && enc.shape.type === "string" && !enc.term) {
          return prim.str();
        }
        return unionOf(prim.str(), bufferBrand);
      },
    ),
    writeFileSync: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand)],
      undef(),
    ),
    appendFileSync: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand)],
      undef(),
    ),
    existsSync: envFn([prim.str()], prim.bool()),
    mkdirSync: envFn([prim.str(), prim.unknown], unionOf(prim.str(), undef())),
    rmdirSync: envFn([prim.str()], undef()),
    rmSync: envFn([prim.str(), prim.unknown], undef()),
    unlinkSync: envFn([prim.str()], undef()),
    renameSync: envFn([prim.str(), prim.str()], undef()),
    copyFileSync: envFn([prim.str(), prim.str()], undef()),
    statSync: envFn(
      [prim.str()],
      objAbs({
        isFile: envFn([], prim.bool()),
        isDirectory: envFn([], prim.bool()),
        isSymbolicLink: envFn([], prim.bool()),
        size: prim.num(),
        mtime: prim.unknown,
        ctime: prim.unknown,
        atime: prim.unknown,
        birthtime: prim.unknown,
        mode: prim.num(),
        uid: prim.num(),
        gid: prim.num(),
      }),
    ),
    readdirSync: envFn(
      [prim.str(), prim.unknown],
      arrOf(unionOf(prim.str(), prim.unknown)),
    ),
    realpathSync: envFn([prim.str()], prim.str()),
    readlinkSync: envFn([prim.str()], prim.str()),
    symlinkSync: envFn([prim.str(), prim.str()], undef()),
    chmodSync: envFn([prim.str(), prim.num()], undef()),
    chownSync: envFn([prim.str(), prim.num(), prim.num()], undef()),
    accessSync: envFn([prim.str(), prim.num()], undef()),
    // Callback-style async on `fs` / `node:fs` (Node actual API).
    // Promise APIs live only under fs.promises / node:fs/promises.
    readFile: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    writeFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), prim.unknown],
      undef(),
      undefined,
      { params: ["path", "data", "callback"] },
    ),
    mkdir: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    rm: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    stat: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    readdir: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    access: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "mode?", "callback"] },
    ),
    appendFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand), prim.unknown],
      undef(),
      undefined,
      { params: ["path", "data", "callback"] },
    ),
    unlink: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    rename: envFn(
      [prim.str(), prim.str(), prim.unknown],
      undef(),
      undefined,
      { params: ["oldPath", "newPath", "callback"] },
    ),
    copyFile: envFn(
      [prim.str(), prim.str(), prim.unknown],
      undef(),
      undefined,
      { params: ["src", "dest", "callback"] },
    ),
    realpath: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    readlink: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "options?", "callback"] },
    ),
    symlink: envFn(
      [prim.str(), prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["target", "path", "type?", "callback"] },
    ),
    chmod: envFn(
      [prim.str(), prim.num(), prim.unknown],
      undef(),
      undefined,
      { params: ["path", "mode", "callback"] },
    ),
    open: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      undef(),
      undefined,
      { params: ["path", "flags?", "callback"] },
    ),
  };

  /** fs.promises / node:fs/promises — Promise-returning slots only here. */
  const fsPromisesModule: Record<string, Abs> = {
    readFile: envFn(
      [prim.str(), prim.unknown],
      promiseOf(unionOf(prim.str(), bufferBrand)),
    ),
    writeFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand)],
      promiseOf(undef()),
    ),
    mkdir: envFn(
      [prim.str(), prim.unknown],
      promiseOf(unionOf(prim.str(), undef())),
    ),
    rm: envFn([prim.str(), prim.unknown], promiseOf(undef())),
    stat: envFn([prim.str()], promiseOf(prim.unknown)),
    readdir: envFn(
      [prim.str(), prim.unknown],
      promiseOf(arrOf(prim.unknown)),
    ),
    access: envFn([prim.str(), prim.num()], promiseOf(undef())),
    appendFile: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand)],
      promiseOf(undef()),
    ),
    unlink: envFn([prim.str()], promiseOf(undef())),
    rename: envFn([prim.str(), prim.str()], promiseOf(undef())),
    copyFile: envFn([prim.str(), prim.str()], promiseOf(undef())),
    realpath: envFn([prim.str()], promiseOf(prim.str())),
    readlink: envFn([prim.str()], promiseOf(prim.str())),
    symlink: envFn([prim.str(), prim.str()], promiseOf(undef())),
    chmod: envFn([prim.str(), prim.num()], promiseOf(undef())),
    open: envFn([prim.str(), prim.str()], promiseOf(prim.unknown)),
  };

  const strImpl1Abs = (fn: (a: string) => string): AbsSigImpl => (args) => {
    const a = absStr(args[0]);
    return a !== undefined ? strLit(fn(a)) : undefined;
  };

  const pathJoinAbs: AbsSigImpl = (args) => {
    const strs = allAbsStr(args);
    return strs ? strLit(nodePath.join(...strs)) : undefined;
  };
  const pathResolveAbs: AbsSigImpl = (args) => {
    const strs = allAbsStr(args);
    return strs ? strLit(nodePath.resolve(...strs)) : undefined;
  };
  const pathBasenameAbs: AbsSigImpl = (args) => {
    const p = absStr(args[0]);
    if (p === undefined) return undefined;
    const ext = args[1] !== undefined ? absStr(args[1]) : undefined;
    return strLit(ext !== undefined ? nodePath.basename(p, ext) : nodePath.basename(p));
  };
  const pathRelativeAbs: AbsSigImpl = (args) => {
    const from = absStr(args[0]);
    const to = absStr(args[1]);
    return from !== undefined && to !== undefined
      ? strLit(nodePath.relative(from, to))
      : undefined;
  };
  const pathIsAbsoluteAbs: AbsSigImpl = (args) => {
    const p = absStr(args[0]);
    return p !== undefined ? boolLit(nodePath.isAbsolute(p)) : undefined;
  };

  const pathModule: Record<string, Abs> = {
    // Node variadic: declare min required arity + rest label (not n fixed slots).
    join: envFnVariadic(prim.str(), prim.str(), {
      apply: pathJoinAbs,
      required: [prim.str()],
      restName: "...paths",
    }),
    resolve: envFnVariadic(prim.str(), prim.str(), {
      apply: pathResolveAbs,
      restName: "...paths",
    }),
    dirname: envFn([prim.str()], prim.str(), strImpl1Abs(nodePath.dirname)),
    // ext is optional in Node — required arity 1; label+type render `ext?: string`.
    basename: envFn([prim.str(), prim.str()], prim.str(), pathBasenameAbs, {
      params: ["path", "ext?"],
    }),
    extname: envFn([prim.str()], prim.str(), strImpl1Abs(nodePath.extname)),
    relative: envFn([prim.str(), prim.str()], prim.str(), pathRelativeAbs),
    normalize: envFn([prim.str()], prim.str(), strImpl1Abs(nodePath.normalize)),
    isAbsolute: envFn([prim.str()], prim.bool(), pathIsAbsoluteAbs),
    parse: envFn(
      [prim.str()],
      objAbs({
        root: prim.str(),
        dir: prim.str(),
        base: prim.str(),
        ext: prim.str(),
        name: prim.str(),
      }),
      (args) => {
        const p = absStr(args[0]);
        if (p === undefined) return undefined;
        const parsed = nodePath.parse(p);
        return objAbs({
          root: strLit(parsed.root),
          dir: strLit(parsed.dir),
          base: strLit(parsed.base),
          ext: strLit(parsed.ext),
          name: strLit(parsed.name),
        });
      },
    ),
    format: envFn([objAbs({})], prim.str()),
    sep: prim.str(),
    delimiter: prim.str(),
    posix: prim.unknown,
    win32: prim.unknown,
  };

  const osModule: Record<string, Abs> = {
    platform: envFn([], prim.str()),
    arch: envFn([], prim.str()),
    type: envFn([], prim.str()),
    release: envFn([], prim.str()),
    hostname: envFn([], prim.str()),
    homedir: envFn([], prim.str()),
    tmpdir: envFn([], prim.str()),
    cpus: envFn(
      [],
      arrOf(objAbs({ model: prim.str(), speed: prim.num() })),
    ),
    totalmem: envFn([], prim.num()),
    freemem: envFn([], prim.num()),
    uptime: envFn([], prim.num()),
    loadavg: envFn([], tupleOf([prim.num(), prim.num(), prim.num()])),
    networkInterfaces: envFn([], prim.unknown),
    userInfo: envFn(
      [],
      objAbs({
        username: prim.str(),
        uid: prim.num(),
        gid: prim.num(),
        shell: unionOf(prim.str(), nullLit()),
        homedir: prim.str(),
      }),
    ),
    EOL: prim.str(),
  };

  const nodeUrlObj = objAbs({
    href: prim.str(),
    origin: prim.str(),
    protocol: prim.str(),
    username: prim.str(),
    password: prim.str(),
    host: prim.str(),
    hostname: prim.str(),
    port: prim.str(),
    pathname: prim.str(),
    search: prim.str(),
    hash: prim.str(),
    toString: envFn([], prim.str()),
    toJSON: envFn([], prim.str()),
  });

  const urlModule: Record<string, Abs> = {
    // base is optional in Node — required arity 1; label+type render `base?: string`.
    URL: envFn(
      [prim.str(), prim.str()],
      nodeUrlObj,
      (args) => {
        const href = absStr(args[0]);
        const base = args[1] !== undefined ? absStr(args[1]) : undefined;
        if (href === undefined) return undefined;
        try {
          const url = base !== undefined ? new URL(href, base) : new URL(href);
          return objAbs({
            href: strLit(url.href),
            origin: strLit(url.origin),
            protocol: strLit(url.protocol),
            username: strLit(url.username),
            password: strLit(url.password),
            host: strLit(url.host),
            hostname: strLit(url.hostname),
            port: strLit(url.port),
            pathname: strLit(url.pathname),
            search: strLit(url.search),
            hash: strLit(url.hash),
            toString: envFn([], prim.str(), () => strLit(url.href)),
            toJSON: envFn([], prim.str(), () => strLit(url.href)),
          });
        } catch {
          return undefined;
        }
      },
      { params: ["href", "base?"] },
    ),
    URLSearchParams: envFn(
      [prim.unknown],
      objAbs({
        get: envFn([prim.str()], unionOf(prim.str(), nullLit())),
        has: envFn([prim.str()], prim.bool()),
        set: envFn([prim.str(), prim.str()], undef()),
        append: envFn([prim.str(), prim.str()], undef()),
        delete: envFn([prim.str()], undef()),
        toString: envFn([], prim.str()),
      }),
    ),
    fileURLToPath: envFn([prim.str()], prim.str(), strImpl1Abs((s) => {
      try {
        return new URL(s).pathname;
      } catch {
        return s;
      }
    })),
    pathToFileURL: envFn(
      [prim.str()],
      objAbs({ href: prim.str() }),
      (args) => {
        const p = absStr(args[0]);
        if (p === undefined) return undefined;
        try {
          const href = `file://${p.startsWith("/") ? "" : "/"}${p}`;
          return objAbs({ href: strLit(href) });
        } catch {
          return undefined;
        }
      },
    ),
    format: envFn([prim.unknown], prim.str()),
  };

  const cryptoModule: Record<string, Abs> = {
    randomBytes: envFn([prim.num()], bufferBrand),
    randomUUID: envFn([], prim.str()),
    randomInt: envFn([prim.num(), prim.num()], prim.num()),
    createHash: envFn(
      [prim.str()],
      objAbs({
        update: envFn([unionOf(prim.str(), bufferBrand)], prim.unknown),
        digest: envFn(
          [prim.str()],
          unionOf(prim.str(), bufferBrand),
        ),
      }),
    ),
    createHmac: envFn(
      [prim.str(), unionOf(prim.str(), bufferBrand)],
      objAbs({
        update: envFn([unionOf(prim.str(), bufferBrand)], prim.unknown),
        digest: envFn(
          [prim.str()],
          unionOf(prim.str(), bufferBrand),
        ),
      }),
    ),
    createCipheriv: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      prim.unknown,
    ),
    createDecipheriv: envFn(
      [prim.str(), prim.unknown, prim.unknown],
      prim.unknown,
    ),
    pbkdf2Sync: envFn(
      [prim.str(), prim.str(), prim.num(), prim.num(), prim.str()],
      bufferBrand,
    ),
    scryptSync: envFn([prim.str(), prim.str(), prim.num()], bufferBrand),
    timingSafeEqual: envFn([bufferBrand, bufferBrand], prim.bool()),
  };

  const childProcessModule: Record<string, Abs> = {
    execSync: envFn(
      [prim.str(), prim.unknown],
      unionOf(prim.str(), bufferBrand),
    ),
    execFileSync: envFn(
      [prim.str(), arrOf(prim.str()), prim.unknown],
      unionOf(prim.str(), bufferBrand),
    ),
    spawnSync: envFn(
      [prim.str(), arrOf(prim.str()), prim.unknown],
      objAbs({
        status: unionOf(prim.num(), nullLit()),
        stdout: unionOf(prim.str(), bufferBrand),
        stderr: unionOf(prim.str(), bufferBrand),
        error: unionOf(brandOf("Error"), undef()),
      }),
    ),
    exec: envFn([prim.str(), prim.unknown], prim.unknown),
    spawn: envFn([prim.str(), arrOf(prim.str()), prim.unknown], prim.unknown),
    fork: envFn([prim.str(), arrOf(prim.str()), prim.unknown], prim.unknown),
  };

  const utilModule: Record<string, Abs> = {
    // Signature-level: promisify preserves fn-ness only as unknown (no generic).
    promisify: envFn([prim.unknown], prim.unknown, undefined, { name: "util.promisify" }),
    inspect: envFn([prim.unknown, prim.unknown], prim.str()),
    format: envFnVariadic(prim.unknown, prim.str(), {
      // util.format() with zero args is valid in Node.
      restName: "...args",
      name: "util.format",
    }),
    callbackify: envFn([prim.unknown], prim.unknown),
    deprecate: envFn([prim.unknown, prim.str()], prim.unknown),
    inherits: envFn([prim.unknown, prim.unknown], undef()),
    isDeepStrictEqual: envFn([prim.unknown, prim.unknown], prim.bool()),
    types: objAbs({
      isDate: envFn([prim.unknown], prim.bool()),
      isRegExp: envFn([prim.unknown], prim.bool()),
      isPromise: envFn([prim.unknown], prim.bool()),
      isArrayBuffer: envFn([prim.unknown], prim.bool()),
      isTypedArray: envFn([prim.unknown], prim.bool()),
      isNativeError: envFn([prim.unknown], prim.bool()),
      isAsyncFunction: envFn([prim.unknown], prim.bool()),
      isGeneratorFunction: envFn([prim.unknown], prim.bool()),
    }),
    TextEncoder: envFn(
      [],
      objAbs({ encode: envFn([prim.str()], prim.unknown) }),
    ),
    TextDecoder: envFn(
      [prim.str()],
      objAbs({ decode: envFn([prim.unknown], prim.str()) }),
    ),
  };

  /** EventEmitter instance brand: on/once/emit/off at signature level. */
  const eventEmitterShape = objAbs({
    on: envFn([prim.str(), prim.unknown], prim.unknown),
    once: envFn([prim.str(), prim.unknown], prim.unknown),
    off: envFn([prim.str(), prim.unknown], prim.unknown),
    emit: envFn([prim.str()], prim.bool()),
    addListener: envFn([prim.str(), prim.unknown], prim.unknown),
    removeListener: envFn([prim.str(), prim.unknown], prim.unknown),
    removeAllListeners: envFn([prim.str()], prim.unknown),
    listeners: envFn([prim.str()], arrOf(prim.unknown)),
    listenerCount: envFn([prim.str()], prim.num()),
    eventNames: envFn([], arrOf(prim.str())),
  });
  const eventEmitterInstance = brandOf("EventEmitter", eventEmitterShape);
  /**
   * Constructor: `new EventEmitter()` / `new EventEmitter(options)`.
   * Options optional — required arity 0; format shows `options?: unknown`.
   */
  const EventEmitterCtor = envFn([prim.unknown], eventEmitterInstance, undefined, {
    params: ["options?"],
  });

  const eventsModule: Record<string, Abs> = {
    EventEmitter: EventEmitterCtor,
    once: envFn(
      [prim.unknown, prim.str()],
      promiseOf(arrOf(prim.unknown)),
    ),
    on: envFn([prim.unknown, prim.str()], prim.unknown),
    listenerCount: envFn([prim.unknown, prim.str()], prim.num()),
  };

  const streamIoMethods = {
    on: envFn([prim.str(), prim.unknown], prim.unknown),
    once: envFn([prim.str(), prim.unknown], prim.unknown),
    off: envFn([prim.str(), prim.unknown], prim.unknown),
    emit: envFn([prim.str()], prim.bool()),
    pipe: envFn([prim.unknown], prim.unknown),
    destroy: envFn([prim.unknown], undef()),
    read: envFn([prim.num()], prim.unknown),
    write: envFn([unionOf(prim.str(), bufferBrand)], prim.bool()),
    end: envFn([prim.unknown], undef()),
    pause: envFn([], prim.unknown),
    resume: envFn([], prim.unknown),
    setEncoding: envFn([prim.str()], prim.unknown),
  };

  const streamCtor = (brandName: string): Abs =>
    envFn([prim.unknown], brandOf(brandName, objAbs(streamIoMethods)), undefined, {
      params: ["options?"],
    });

  /**
   * stream skeleton: brand + pipe/finished. Machine-driven callbacks remain
   * mock-recommended (design-limitations §八).
   */
  const streamModule: Record<string, Abs> = {
    Readable: streamCtor("Readable"),
    Writable: streamCtor("Writable"),
    Duplex: streamCtor("Duplex"),
    Transform: streamCtor("Transform"),
    pipeline: envFnVariadic(prim.unknown, promiseOf(undef()), {
      restName: "...streams",
    }),
    finished: envFn([prim.unknown], promiseOf(undef())),
  };

  /** querystring.parse returns a dynamic key bag — slots are not statically known. */
  const parsedQueryString = brandOf(
    "ParsedQueryString",
    objAbs({}),
  );

  const querystringModule: Record<string, Abs> = {
    // sep/eq/options optional — required arity 1; labels+types render `sep?: string` etc.
    parse: envFn(
      [prim.str(), prim.str(), prim.str(), prim.unknown],
      parsedQueryString,
      undefined,
      { params: ["str", "sep?", "eq?", "options?"] },
    ),
    stringify: envFn(
      [prim.unknown, prim.str(), prim.str(), prim.unknown],
      prim.str(),
      undefined,
      { params: ["obj", "sep?", "eq?", "options?"] },
    ),
    escape: envFn([prim.str()], prim.str()),
    unescape: envFn([prim.str()], prim.str()),
  };

  const nodeGlobals: Record<string, Abs> = {
    process: objAbs({
      env: objAbs({}),
      argv: arrOf(prim.str()),
      argv0: prim.str(),
      execArgv: arrOf(prim.str()),
      execPath: prim.str(),
      cwd: envFn([], prim.str()),
      chdir: envFn([prim.str()], undef()),
      exit: envFn([prim.num()], prim.never),
      pid: prim.num(),
      ppid: prim.num(),
      platform: prim.str(),
      arch: prim.str(),
      version: prim.str(),
      versions: objAbs({}),
      stdout: objAbs({ write: envFn([prim.str()], prim.bool()) }),
      stderr: objAbs({ write: envFn([prim.str()], prim.bool()) }),
      stdin: objAbs({
        on: envFn([prim.str(), prim.unknown], prim.unknown),
      }),
      hrtime: objAbs({ bigint: envFn([], brandOf("bigint")) }),
      memoryUsage: envFn(
        [],
        objAbs({
          rss: prim.num(),
          heapTotal: prim.num(),
          heapUsed: prim.num(),
          external: prim.num(),
          arrayBuffers: prim.num(),
        }),
      ),
      cpuUsage: envFn(
        [],
        objAbs({ user: prim.num(), system: prim.num() }),
      ),
      uptime: envFn([], prim.num()),
      nextTick: envFn([prim.unknown], undef()),
      on: envFn([prim.str(), prim.unknown], prim.unknown),
      once: envFn([prim.str(), prim.unknown], prim.unknown),
      off: envFn([prim.str(), prim.unknown], prim.unknown),
      emit: envFn([prim.str()], prim.bool()),
    }),

    Buffer: objAbs({
      from: envFn([unionOf(prim.str(), arrOf(prim.num()))], bufferBrand),
      alloc: envFn([prim.num()], bufferBrand),
      allocUnsafe: envFn([prim.num()], bufferBrand),
      isBuffer: envFn([prim.unknown], prim.bool()),
      byteLength: envFn(
        [unionOf(prim.str(), bufferBrand)],
        prim.num(),
      ),
      concat: envFn([arrOf(bufferBrand)], bufferBrand),
      compare: envFn([bufferBrand, bufferBrand], prim.num()),
    }),

    __dirname: prim.str(),
    __filename: prim.str(),

    setTimeout: envFn([prim.unknown, prim.num()], prim.unknown),
    setInterval: envFn([prim.unknown, prim.num()], prim.unknown),
    setImmediate: envFn([prim.unknown], prim.unknown),
    clearTimeout: envFn([prim.unknown], undef()),
    clearInterval: envFn([prim.unknown], undef()),
    clearImmediate: envFn([prim.unknown], undef()),
    queueMicrotask: envFn([prim.unknown], undef()),

    structuredClone: envFn([prim.unknown], prim.unknown),
  };

  const modules: Record<string, Record<string, Abs>> = {
    fs: fsModule,
    "node:fs": fsModule,
    "fs/promises": fsPromisesModule,
    "node:fs/promises": fsPromisesModule,
    path: pathModule,
    "node:path": pathModule,
    os: osModule,
    "node:os": osModule,
    url: urlModule,
    "node:url": urlModule,
    crypto: cryptoModule,
    "node:crypto": cryptoModule,
    child_process: childProcessModule,
    "node:child_process": childProcessModule,
    util: utilModule,
    "node:util": utilModule,
    events: eventsModule,
    "node:events": eventsModule,
    stream: streamModule,
    "node:stream": streamModule,
    querystring: querystringModule,
    "node:querystring": querystringModule,
  };

  return {
    globals: { ...esEnv.globals, ...nodeGlobals },
    modules,
  };
}

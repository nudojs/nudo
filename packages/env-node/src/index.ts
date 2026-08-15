import { type TypeValue, type SigImpl, T } from "@nudojs/core";
import { type EnvDefinition, defineEnv as defineEsEnv } from "@nudojs/env-es";
import nodePath from "node:path";

export type { EnvDefinition };

function litStr(tv: TypeValue): string | undefined {
  return tv.kind === "literal" && typeof tv.value === "string" ? tv.value : undefined;
}

function allLitStr(args: TypeValue[]): string[] | undefined {
  const result: string[] = [];
  for (const a of args) {
    const s = litStr(a);
    if (s === undefined) return undefined;
    result.push(s);
  }
  return result;
}

export function defineEnv(): EnvDefinition {
  const esEnv = defineEsEnv();

  const BufferInstance = T.instanceOf("Buffer", {
    toString: T.fnSig([T.string], T.string),
    toJSON: T.fnSig([], T.object({ type: T.string, data: T.array(T.number) })),
    length: T.number,
    slice: T.fnSig([T.number, T.number], T.instanceOf("Buffer")),
    copy: T.fnSig([T.unknown, T.number, T.number, T.number], T.number),
    write: T.fnSig([T.string, T.number, T.number, T.string], T.number),
    readUInt8: T.fnSig([T.number], T.number),
    readUInt16BE: T.fnSig([T.number], T.number),
    readUInt16LE: T.fnSig([T.number], T.number),
    readUInt32BE: T.fnSig([T.number], T.number),
    readUInt32LE: T.fnSig([T.number], T.number),
    readInt8: T.fnSig([T.number], T.number),
    readInt16BE: T.fnSig([T.number], T.number),
    readInt16LE: T.fnSig([T.number], T.number),
    readInt32BE: T.fnSig([T.number], T.number),
    readInt32LE: T.fnSig([T.number], T.number),
    includes: T.fnSig([T.union(T.string, T.number)], T.boolean),
    indexOf: T.fnSig([T.union(T.string, T.number)], T.number),
    fill: T.fnSig([T.union(T.string, T.number)], T.instanceOf("Buffer")),
    equals: T.fnSig([T.instanceOf("Buffer")], T.boolean),
    compare: T.fnSig([T.instanceOf("Buffer")], T.number),
    subarray: T.fnSig([T.number, T.number], T.instanceOf("Buffer")),
  });

  // --- fs module ---
  const fsModule: Record<string, TypeValue> = {
    readFileSync: T.fnSig([T.string, T.union(T.string, T.object({}))], T.union(T.string, BufferInstance)),
    writeFileSync: T.fnSig([T.string, T.union(T.string, BufferInstance)], T.undefined),
    appendFileSync: T.fnSig([T.string, T.union(T.string, BufferInstance)], T.undefined),
    existsSync: T.fnSig([T.string], T.boolean),
    mkdirSync: T.fnSig([T.string, T.unknown], T.union(T.string, T.undefined)),
    rmdirSync: T.fnSig([T.string], T.undefined),
    rmSync: T.fnSig([T.string, T.unknown], T.undefined),
    unlinkSync: T.fnSig([T.string], T.undefined),
    renameSync: T.fnSig([T.string, T.string], T.undefined),
    copyFileSync: T.fnSig([T.string, T.string], T.undefined),
    statSync: T.fnSig([T.string], T.object({
      isFile: T.fnSig([], T.boolean),
      isDirectory: T.fnSig([], T.boolean),
      isSymbolicLink: T.fnSig([], T.boolean),
      size: T.number,
      mtime: T.unknown,
      ctime: T.unknown,
      atime: T.unknown,
      birthtime: T.unknown,
      mode: T.number,
      uid: T.number,
      gid: T.number,
    })),
    readdirSync: T.fnSig([T.string, T.unknown], T.array(T.union(T.string, T.unknown))),
    realpathSync: T.fnSig([T.string], T.string),
    readlinkSync: T.fnSig([T.string], T.string),
    symlinkSync: T.fnSig([T.string, T.string], T.undefined),
    chmodSync: T.fnSig([T.string, T.number], T.undefined),
    chownSync: T.fnSig([T.string, T.number, T.number], T.undefined),
    accessSync: T.fnSig([T.string, T.number], T.undefined),
    readFile: T.fnSig([T.string, T.unknown], T.promise(T.union(T.string, BufferInstance))),
    writeFile: T.fnSig([T.string, T.union(T.string, BufferInstance)], T.promise(T.undefined)),
    mkdir: T.fnSig([T.string, T.unknown], T.promise(T.union(T.string, T.undefined))),
    rm: T.fnSig([T.string, T.unknown], T.promise(T.undefined)),
    stat: T.fnSig([T.string], T.promise(T.unknown)),
    readdir: T.fnSig([T.string, T.unknown], T.promise(T.array(T.unknown))),
    access: T.fnSig([T.string, T.number], T.promise(T.undefined)),
  };

  // --- path module ---
  const strImpl1 = (fn: (a: string) => string): SigImpl => (args) => {
    const a = litStr(args[0]);
    return a !== undefined ? T.literal(fn(a)) : undefined;
  };

  const pathModule: Record<string, TypeValue> = {
    join: T.fnSig([T.string, T.string], T.string, T.never, (args) => {
      const strs = allLitStr(args);
      return strs ? T.literal(nodePath.join(...strs)) : undefined;
    }),
    resolve: T.fnSig([T.string], T.string, T.never, (args) => {
      const strs = allLitStr(args);
      return strs ? T.literal(nodePath.resolve(...strs)) : undefined;
    }),
    dirname: T.fnSig([T.string], T.string, T.never, strImpl1(nodePath.dirname)),
    basename: T.fnSig([T.string, T.string], T.string, T.never, (args) => {
      const p = litStr(args[0]);
      if (p === undefined) return undefined;
      const ext = args[1] !== undefined ? litStr(args[1]) : undefined;
      return T.literal(ext !== undefined ? nodePath.basename(p, ext) : nodePath.basename(p));
    }),
    extname: T.fnSig([T.string], T.string, T.never, strImpl1(nodePath.extname)),
    relative: T.fnSig([T.string, T.string], T.string, T.never, (args) => {
      const from = litStr(args[0]);
      const to = litStr(args[1]);
      return from !== undefined && to !== undefined ? T.literal(nodePath.relative(from, to)) : undefined;
    }),
    normalize: T.fnSig([T.string], T.string, T.never, strImpl1(nodePath.normalize)),
    isAbsolute: T.fnSig([T.string], T.boolean, T.never, (args) => {
      const p = litStr(args[0]);
      return p !== undefined ? T.literal(nodePath.isAbsolute(p)) : undefined;
    }),
    parse: T.fnSig([T.string], T.object({
      root: T.string,
      dir: T.string,
      base: T.string,
      ext: T.string,
      name: T.string,
    }), T.never, (args) => {
      const p = litStr(args[0]);
      if (p === undefined) return undefined;
      const parsed = nodePath.parse(p);
      return T.object({
        root: T.literal(parsed.root),
        dir: T.literal(parsed.dir),
        base: T.literal(parsed.base),
        ext: T.literal(parsed.ext),
        name: T.literal(parsed.name),
      });
    }),
    format: T.fnSig([T.object({})], T.string),
    sep: T.string,
    delimiter: T.string,
    posix: T.unknown,
    win32: T.unknown,
  };

  // --- os module ---
  const osModule: Record<string, TypeValue> = {
    platform: T.fnSig([], T.string),
    arch: T.fnSig([], T.string),
    type: T.fnSig([], T.string),
    release: T.fnSig([], T.string),
    hostname: T.fnSig([], T.string),
    homedir: T.fnSig([], T.string),
    tmpdir: T.fnSig([], T.string),
    cpus: T.fnSig([], T.array(T.object({
      model: T.string,
      speed: T.number,
    }))),
    totalmem: T.fnSig([], T.number),
    freemem: T.fnSig([], T.number),
    uptime: T.fnSig([], T.number),
    loadavg: T.fnSig([], T.tuple([T.number, T.number, T.number])),
    networkInterfaces: T.fnSig([], T.unknown),
    userInfo: T.fnSig([], T.object({
      username: T.string,
      uid: T.number,
      gid: T.number,
      shell: T.union(T.string, T.null),
      homedir: T.string,
    })),
    EOL: T.string,
  };

  // --- url module ---
  const nodeUrlObj = T.object({
    href: T.string,
    origin: T.string,
    protocol: T.string,
    username: T.string,
    password: T.string,
    host: T.string,
    hostname: T.string,
    port: T.string,
    pathname: T.string,
    search: T.string,
    hash: T.string,
    toString: T.fnSig([], T.string),
    toJSON: T.fnSig([], T.string),
  });

  const urlModule: Record<string, TypeValue> = {
    URL: T.fnSig([T.string, T.string], nodeUrlObj, T.instanceOf("TypeError"), (args) => {
      const href = litStr(args[0]);
      const base = args[1] !== undefined ? litStr(args[1]) : undefined;
      if (href === undefined) return undefined;
      try {
        const url = base !== undefined ? new URL(href, base) : new URL(href);
        return T.object({
          href: T.literal(url.href),
          origin: T.literal(url.origin),
          protocol: T.literal(url.protocol),
          username: T.literal(url.username),
          password: T.literal(url.password),
          host: T.literal(url.host),
          hostname: T.literal(url.hostname),
          port: T.literal(url.port),
          pathname: T.literal(url.pathname),
          search: T.literal(url.search),
          hash: T.literal(url.hash),
          toString: T.fnSig([], T.string, T.never, () => T.literal(url.href)),
          toJSON: T.fnSig([], T.string, T.never, () => T.literal(url.href)),
        });
      } catch { return undefined; }
    }),
    URLSearchParams: T.fnSig([T.unknown], T.object({
      get: T.fnSig([T.string], T.union(T.string, T.null)),
      has: T.fnSig([T.string], T.boolean),
      set: T.fnSig([T.string, T.string], T.undefined),
      append: T.fnSig([T.string, T.string], T.undefined),
      delete: T.fnSig([T.string], T.undefined),
      toString: T.fnSig([], T.string),
    })),
    fileURLToPath: T.fnSig([T.string], T.string, T.never, strImpl1((s) => {
      try { return new URL(s).pathname; } catch { return s; }
    })),
    pathToFileURL: T.fnSig([T.string], T.object({ href: T.string }), T.never, (args) => {
      const p = litStr(args[0]);
      if (p === undefined) return undefined;
      try {
        const href = `file://${p.startsWith("/") ? "" : "/"}${p}`;
        return T.object({ href: T.literal(href) });
      } catch { return undefined; }
    }),
    format: T.fnSig([T.unknown], T.string),
  };

  // --- crypto module ---
  const cryptoModule: Record<string, TypeValue> = {
    randomBytes: T.fnSig([T.number], BufferInstance),
    randomUUID: T.fnSig([], T.string),
    randomInt: T.fnSig([T.number, T.number], T.number),
    createHash: T.fnSig([T.string], T.object({
      update: T.fnSig([T.union(T.string, BufferInstance)], T.unknown),
      digest: T.fnSig([T.string], T.union(T.string, BufferInstance)),
    })),
    createHmac: T.fnSig([T.string, T.union(T.string, BufferInstance)], T.object({
      update: T.fnSig([T.union(T.string, BufferInstance)], T.unknown),
      digest: T.fnSig([T.string], T.union(T.string, BufferInstance)),
    })),
    createCipheriv: T.fnSig([T.string, T.unknown, T.unknown], T.unknown),
    createDecipheriv: T.fnSig([T.string, T.unknown, T.unknown], T.unknown),
    pbkdf2Sync: T.fnSig([T.string, T.string, T.number, T.number, T.string], BufferInstance),
    scryptSync: T.fnSig([T.string, T.string, T.number], BufferInstance),
    timingSafeEqual: T.fnSig([BufferInstance, BufferInstance], T.boolean),
  };

  // --- child_process module ---
  const childProcessModule: Record<string, TypeValue> = {
    execSync: T.fnSig([T.string, T.unknown], T.union(T.string, BufferInstance)),
    execFileSync: T.fnSig([T.string, T.array(T.string), T.unknown], T.union(T.string, BufferInstance)),
    spawnSync: T.fnSig([T.string, T.array(T.string), T.unknown], T.object({
      status: T.union(T.number, T.null),
      stdout: T.union(T.string, BufferInstance),
      stderr: T.union(T.string, BufferInstance),
      error: T.union(T.instanceOf("Error"), T.undefined),
    })),
    exec: T.fnSig([T.string, T.unknown], T.unknown),
    spawn: T.fnSig([T.string, T.array(T.string), T.unknown], T.unknown),
    fork: T.fnSig([T.string, T.array(T.string), T.unknown], T.unknown),
  };

  // --- util module ---
  const utilModule: Record<string, TypeValue> = {
    promisify: T.fnSig([T.unknown], T.unknown),
    inspect: T.fnSig([T.unknown, T.unknown], T.string),
    format: T.fnSig([T.string], T.string),
    types: T.object({
      isDate: T.fnSig([T.unknown], T.boolean),
      isRegExp: T.fnSig([T.unknown], T.boolean),
      isPromise: T.fnSig([T.unknown], T.boolean),
      isArrayBuffer: T.fnSig([T.unknown], T.boolean),
      isTypedArray: T.fnSig([T.unknown], T.boolean),
    }),
    TextEncoder: T.fnSig([], T.object({
      encode: T.fnSig([T.string], T.unknown),
    })),
    TextDecoder: T.fnSig([T.string], T.object({
      decode: T.fnSig([T.unknown], T.string),
    })),
  };

  const nodeGlobals: Record<string, TypeValue> = {
    process: T.object({
      env: T.object({}),
      argv: T.array(T.string),
      argv0: T.string,
      execArgv: T.array(T.string),
      execPath: T.string,
      cwd: T.fnSig([], T.string),
      chdir: T.fnSig([T.string], T.undefined),
      exit: T.fnSig([T.number], T.never),
      pid: T.number,
      ppid: T.number,
      platform: T.string,
      arch: T.string,
      version: T.string,
      versions: T.object({}),
      stdout: T.object({ write: T.fnSig([T.string], T.boolean) }),
      stderr: T.object({ write: T.fnSig([T.string], T.boolean) }),
      stdin: T.object({ on: T.fnSig([T.string, T.unknown], T.unknown) }),
      hrtime: T.object({
        bigint: T.fnSig([], T.bigint),
      }),
      memoryUsage: T.fnSig([], T.object({
        rss: T.number,
        heapTotal: T.number,
        heapUsed: T.number,
        external: T.number,
        arrayBuffers: T.number,
      })),
      cpuUsage: T.fnSig([], T.object({ user: T.number, system: T.number })),
      uptime: T.fnSig([], T.number),
      nextTick: T.fnSig([T.unknown], T.undefined),
      on: T.fnSig([T.string, T.unknown], T.unknown),
      once: T.fnSig([T.string, T.unknown], T.unknown),
      off: T.fnSig([T.string, T.unknown], T.unknown),
      emit: T.fnSig([T.string], T.boolean),
    }),

    Buffer: T.object({
      from: T.fnSig([T.union(T.string, T.array(T.number))], BufferInstance),
      alloc: T.fnSig([T.number], BufferInstance),
      allocUnsafe: T.fnSig([T.number], BufferInstance),
      isBuffer: T.fnSig([T.unknown], T.boolean),
      byteLength: T.fnSig([T.union(T.string, BufferInstance)], T.number),
      concat: T.fnSig([T.array(BufferInstance)], BufferInstance),
      compare: T.fnSig([BufferInstance, BufferInstance], T.number),
    }),

    __dirname: T.string,
    __filename: T.string,

    setTimeout: T.fnSig([T.unknown, T.number], T.unknown),
    setInterval: T.fnSig([T.unknown, T.number], T.unknown),
    setImmediate: T.fnSig([T.unknown], T.unknown),
    clearTimeout: T.fnSig([T.unknown], T.undefined),
    clearInterval: T.fnSig([T.unknown], T.undefined),
    clearImmediate: T.fnSig([T.unknown], T.undefined),
    queueMicrotask: T.fnSig([T.unknown], T.undefined),

    structuredClone: T.fnSig([T.unknown], T.unknown),
  };

  const modules: Record<string, Record<string, TypeValue>> = {
    fs: fsModule,
    "node:fs": fsModule,
    "node:fs/promises": {
      readFile: fsModule.readFile,
      writeFile: fsModule.writeFile,
      mkdir: fsModule.mkdir,
      rm: fsModule.rm,
      stat: fsModule.stat,
      readdir: fsModule.readdir,
      access: fsModule.access,
    },
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
  };

  return {
    globals: { ...esEnv.globals, ...nodeGlobals },
    modules,
  };
}

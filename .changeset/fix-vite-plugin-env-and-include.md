---
"vite-plugin-nudo": patch
---

The build plugin reports the env failures it used to drop.

- A path env file that failed to load — a missing file, an unknown env name,
  a file that does not export a `defineEnv()` function — produced no
  diagnostic during a build, so the affected code was analyzed as if the env
  did not exist. The failure is reported now.

- A `nudo.analysis.include` entry without a wildcard never matched, so the
  whole allowlist was silently ignored. A literal entry is matched as a path
  now: it names that file, or that directory.

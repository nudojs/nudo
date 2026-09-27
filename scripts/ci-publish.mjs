/**
 * ci:publish — gate + OIDC prep + `changeset publish`.
 *
 * Wired as changesets/action `publish-script:` so the action records `published-packages`
 * (needed by the tag / GitHub Release steps). A bare `npx changeset publish` in a
 * later step leaves that output empty and the release is silently skipped.
 *
 *   node scripts/ci-publish.mjs
 */
import { execSync } from "node:child_process";

execSync("node scripts/gate-major.mjs --for-publish", { stdio: "inherit" });

// setup-node writes _authToken=${NODE_AUTH_TOKEN} into .npmrc, which blocks
// npm's OIDC trusted-publisher exchange when no real token exists.
const userconfig = process.env.NPM_CONFIG_USERCONFIG;
if (userconfig) {
  try {
    const fs = await import("node:fs");
    const raw = fs.readFileSync(userconfig, "utf8");
    const stripped = raw
      .split("\n")
      .filter((line) => !line.includes("_authToken"))
      .join("\n");
    if (stripped !== raw) fs.writeFileSync(userconfig, stripped);
  } catch {
    // missing/unreadable .npmrc — OIDC may still work
  }
}

// Prefer OIDC over any ambient token.
if (process.env.NODE_AUTH_TOKEN) process.env.NODE_AUTH_TOKEN = "";

execSync("npx changeset publish", {
  stdio: "inherit",
  env: { ...process.env, NPM_CONFIG_PROVENANCE: "true" },
});

#!/usr/bin/env node
// Thin shell for the `nudo` command. Published as `nudojs` on npm (the bare
// `nudo` name was unavailable) and hands execution to @nudojs/cli, whose
// package entry (`exports` "." → dist/index.js) is the same module as its
// `nudo` bin.
//
// No argv/exit-code plumbing is needed: the CLI entry parses process.argv
// itself (its slice(2) args are exactly the args passed to this wrapper) and
// reports outcomes via process.exitCode, both of which are this process's.
import "@nudojs/cli";

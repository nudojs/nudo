---
"@nudojs/service": patch
---

`nudo test --freeze` now writes into the source file **without disturbing the
file's byte shape**, and the diff it prints can be applied by `git apply`.

- **A UTF-8 BOM used to move into the middle of the file.** The freeze writes
  the new `@nudo:case` block *above* the declaration, so the first line moved
  down one line — and the BOM, which lived on that first line, moved with it:
  the file stopped being "UTF-8 with BOM" and became a UTF-8 text with a
  zero-width `U+FEFF` sitting in front of the `export`. The BOM is now kept
  aside while the body is edited and put back at the very front of the file.
  The same holds when already-generated directives are stripped (the first
  line may be dropped there, and the BOM used to go with it).
- **A CRLF file stayed CRLF.** The newly inserted lines now follow the file's
  dominant line ending, so `file(1)` keeps reporting "with CRLF line
  terminators" instead of switching to "with CRLF, LF line terminators", and
  the lines that were already in the file keep the endings they had.
- **The printed diff of a file without a final newline could not be
  applied.** `git apply --check` rejected it, because the diff did not say
  that the last line has no newline. The diff now follows the same line model
  as `diff -u` / `git diff`: the last line without a terminator is marked with
  `\ No newline at end of file`, and whether the file ends with a newline is
  treated as part of the content (as native tools do). Diffs for files with a
  final newline are unchanged.
- **The diff no longer hides byte changes.** The BOM stays in the first line
  of the diff (the same shape native `git diff` produces), so a patch against
  a BOM file still applies, and a real byte change — a BOM being dropped by a
  writer, say — is shown instead of being reported as "no change".

#!/usr/bin/env bash
# G6 verify: (1) the repo's own vitest suite passes (titleCase implemented
# correctly) in the scratch workdir gauntlet/run.sh copied repo/ into, AND
# (2) the new function actually carries the @zeal-checked JSDoc tag the
# repo's skill (repo/.dsh/skills/zeal-checked/SKILL.md — discovery path per
# $DSH_SRC/packages/skill/skill-filesystem/README.md's project-dsh root,
# rank 100) mandates. repo/AGENTS.md restates the same instruction as a
# fallback in case skill discovery isn't wired into this composition.
#
# Check (2) is a STRUCTURAL check, not a `grep -r '@zeal-checked' src`.
# The recursive grep this replaces could never fail: repo/src/format.ts's
# own header comment contains the literal string `@zeal-checked` (it is the
# note explaining why the pre-existing `shout` is deliberately NOT tagged),
# so the grep matched the untouched fixture and passed no matter what the
# model did. Instead, parse each source file and require the tag in the
# JSDoc block IMMEDIATELY above each newly added function declaration —
# which is what SKILL.md/AGENTS.md actually specify.
#
# $WORKDIR is set by gauntlet/run.sh.
set -euo pipefail
cd "$WORKDIR" && npx vitest run

node --input-type=module - "$WORKDIR" <<'NODE'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const srcDir = join(process.argv[2], 'src')

// Functions already present in the unmodified fixture. The convention is
// explicitly "newly written functions only — do not retroactively edit
// unrelated existing functions", so these are exempt from the tag
// requirement and must stay exempt: a run that tagged `shout` too would be
// following the letter and breaking the instruction.
const PRE_EXISTING = new Set(['shout'])

// The function the task asks for. Named explicitly so the check fails loudly
// on a model that satisfied the test suite some other way (re-exporting from
// a new file, an inline default) without ever declaring it under src/.
const REQUIRED = ['titleCase']

/** Every non-test .ts file under src/, recursively. */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

// Top-level named declarations only (column 0, optionally `export`/`default`).
// Nested helpers and anonymous callbacks — `word => ...` inside titleCase's
// own body — are deliberately not matched: the convention governs functions
// added to the module surface, and matching inner arrows would fail correct
// solutions.
const DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>))/

const found = new Map()
const untagged = []

for (const file of sourceFiles(srcDir)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (const [index, line] of lines.entries()) {
    const match = DECL_RE.exec(line)
    if (!match) continue
    const name = match[1] ?? match[2]
    found.set(name, relative(srcDir, file))
    if (PRE_EXISTING.has(name)) continue

    // Walk back over the block comment (if any) immediately above the
    // declaration — no blank line and no other code may sit between them,
    // which is what "immediately above the function declaration" means.
    let cursor = index - 1
    let inBlock = false
    let tagged = false
    for (; cursor >= 0; cursor--) {
      const text = lines[cursor].trim()
      if (!inBlock) {
        if (text === '') break                       // blank line: comment is not adjacent
        if (text.endsWith('*/')) { inBlock = true }   // entered the JSDoc block from below
        else if (text.startsWith('//')) { if (text.includes('@zeal-checked')) tagged = true; continue }
        else break                                    // real code: no adjacent comment
      }
      if (text.includes('@zeal-checked')) tagged = true
      if (text.startsWith('/**') || text.startsWith('/*')) break  // top of the block
    }
    if (!tagged) untagged.push(`${relative(srcDir, file)}: ${name}`)
  }
}

const missing = REQUIRED.filter(name => !found.has(name))
if (missing.length > 0) {
  console.error(`verify.sh: required function(s) not declared under src/: ${missing.join(', ')}`)
  process.exit(1)
}
if (untagged.length > 0) {
  console.error('verify.sh: newly added function(s) missing an adjacent @zeal-checked JSDoc tag:')
  for (const entry of untagged) console.error(`  ${entry}`)
  process.exit(1)
}
NODE

#!/usr/bin/env node
// Encoding guard for the repo.
//
// Catches the two corruption fingerprints we've seen from shrink/grow
// writes on the Windows-mounted working folder:
//   1. NULL bytes (0x00) anywhere in a text file  -> "Invalid character"
//      at compile time; the file reads as binary.
//   2. A leading UTF-8 BOM (EF BB BF)             -> stray char before
//      the first token; breaks JSON and some TS tooling.
//
// It also flags zero-byte source files, which are the extreme form of
// the truncation bug (entire contents lost).
//
// Exits non-zero (fails `npm run typecheck`) if anything is found, with
// a precise file + byte-offset report so the bad file is obvious.
//
// Run directly:  node scripts/check-encoding.mjs
// Runs automatically before tsc via the "typecheck" script.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out"]);
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".css", ".scss", ".md", ".mdx", ".sql",
  ".html", ".svg", ".yml", ".yaml",
]);

/** @returns {string[]} list of absolute file paths to check */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(join(dir, entry.name)));
    } else if (entry.isFile() && TEXT_EXT.has(extname(entry.name))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const problems = [];

for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1);
  const buf = readFileSync(file);

  if (buf.length === 0) {
    problems.push(`${rel}: file is EMPTY (0 bytes) — likely a truncated write`);
    continue;
  }

  // Leading UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    problems.push(`${rel}: leading UTF-8 BOM (EF BB BF) at byte 0`);
  }

  // NULL bytes — report the first offset and the total count
  const firstNull = buf.indexOf(0x00);
  if (firstNull !== -1) {
    let count = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 0x00) count++;
    problems.push(
      `${rel}: ${count} NULL byte${count === 1 ? "" : "s"} (first at byte ${firstNull} of ${buf.length})`
    );
  }
}

if (problems.length > 0) {
  console.error("\n✗ Encoding check failed — corrupted file(s) detected:\n");
  for (const p of problems) console.error("   " + p);
  console.error(
    "\nThese are the truncation/null-padding corruption fingerprints.\n" +
    "Repair (preserving content) with, e.g.:\n" +
    "   node -e \"const f='PATH';const fs=require('fs');let b=fs.readFileSync(f);" +
    "if(b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf)b=b.subarray(3);" +
    "fs.writeFileSync(f,Buffer.from(b.filter(x=>x!==0)));\"\n" +
    "or restore the file from git if the working copy has no wanted edits.\n"
  );
  process.exit(1);
}

console.log(`✓ Encoding check passed (${walk(ROOT).length} files scanned, no NULLs/BOMs).`);

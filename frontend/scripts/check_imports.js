/**
 * check_imports — which named imports resolve to `undefined` at runtime?
 *
 * An icon or component that a library stopped exporting imports as
 * `undefined` without erroring. The build passes; the page then dies with
 * "Element type is invalid ... got: undefined" and React unmounts the tree,
 * so a 16px glyph blanks the whole dashboard. Nothing in the toolchain
 * catches it, because a missing named export is legal JavaScript.
 *
 * Run this on the machine SHOWING the error — the point is to compare the
 * installed packages there, not the ones here.
 *
 *   node scripts/check_imports.js
 */
const fs = require('fs');
const path = require('path');

const FILES = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['src/pages/CMDashboard.jsx'];

let bad = 0;
for (const rel of FILES) {
    const file = path.resolve(rel);
    if (!fs.existsSync(file)) { console.log(`skip (missing): ${rel}`); continue; }
    const src = fs.readFileSync(file, 'utf8');
    console.log(`\n── ${rel} ─────────────────────────────`);

    // import { A, B as C } from 'pkg'  — bare package names only; local
    // modules are ESM/JSX and cannot be required from Node.
    const re = /import\s*\{([^}]+)\}\s*from\s*['"]([^'".][^'"]*)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const pkg = m[2];
        if (pkg.startsWith('.')) continue;
        const names = m[1].split(',').map((x) => x.trim()).filter(Boolean)
            .map((x) => (x.includes(' as ') ? x.split(' as ')[0].trim() : x));
        let lib;
        try { lib = require(pkg); } catch (e) {
            console.log(`  CANNOT LOAD ${pkg}: ${e.message}`);
            bad += 1;
            continue;
        }
        const missing = names.filter((nm) => lib[nm] === undefined);
        const v = (() => {
            try { return require(`${pkg}/package.json`).version; } catch { return '?'; }
        })();
        if (missing.length) {
            bad += missing.length;
            console.log(`  ${pkg}@${v} — MISSING: ${missing.join(', ')}`);
        } else {
            console.log(`  ${pkg}@${v} — all ${names.length} resolve`);
        }
    }
}
console.log(bad
    ? `\n${bad} unresolved import(s). Each renders as undefined and will crash the page.\n`
    : '\nEvery named import resolves.\n');
process.exit(bad ? 1 : 0);

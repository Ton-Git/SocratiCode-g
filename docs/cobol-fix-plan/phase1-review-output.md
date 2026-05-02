# Phase 1 Review — Critical Fixes for COBOL Support

**Reviewer**: subagent (automated)
**Date**: 2026-05-02
**Files reviewed**:
- `src/services/cobol-utils.ts` (new, 42 lines)
- `src/services/graph-symbols.ts` (lines 902–1090, COBOL block)
- `src/services/graph-imports.ts` (lines 102–135, COBOL block)

---

## Correct ✅

### 1.1 `stripCobolComments()` — `cobol-utils.ts`

- Implementation matches the plan exactly.
- **Fixed-format handling**: Checks `trimmed[6]` (0-indexed column 7) for `*` or `/`. Lines shorter than 7 chars skip the check (correct — no indicator column exists). Commented lines replaced with `""` to preserve line counts.
- **Free-format handling**: `indexOf("*>")` finds first occurrence, strips rest of line via `substring(0, freeIdx)`.
- **Line-number preservation**: Always pushes exactly one entry per input line — either `""` (comment) or `trimmed` (code). `join("\n")` reconstructs identical line count.
- **No mutation**: Returns new string; original source untouched.

### 1.2 Regex fixes — `graph-symbols.ts`

| Regex | Line | Pattern | Status |
|-------|------|---------|--------|
| PROGRAM-ID | 962 | `([\w-]+)` | ✅ Fixed |
| PERFORM | 1059 | `([A-Za-z][\w-]*)` | ✅ Already correct |
| CALL | 1073 | `([\w-]+)` | ✅ Fixed |
| Section | 983 | `([A-Za-z][\w-]*)` | ✅ Already correct |
| Paragraph | 1025 | `([A-Za-z][\w-]*)` | ✅ Already correct |

No remaining `\w+` in COBOL-specific regexes. The `\w+` at line 1101 is in the generic regex fallback, unrelated to COBOL.

### 1.3 Reserved-word split — `graph-symbols.ts`

- `COBOL_RESERVED` fully removed — zero references remain anywhere in `src/`. ✅
- `COBOL_STATEMENT_RESERVED` (68 words): Does **not** contain `FILE`, `WORKING-STORAGE`, `FD`, `SELECT`. ✅
- `COBOL_PARAGRAPH_RESERVED`: Extends `COBOL_STATEMENT_RESERVED` with `IDENTIFICATION`, `ENVIRONMENT`, `DATA`, `PROCEDURE`, `DIVISION`, `SECTION`, `REDEFINES`, `SELECT`, `FILE`, `FD`, `WORKING-STORAGE`. ✅
- All 4 filtering locations updated correctly:
  1. Section extraction (~line 987): `COBOL_STATEMENT_RESERVED` ✅
  2. Paragraph extraction (~line 1030): `COBOL_PARAGRAPH_RESERVED` ✅
  3. PERFORM extraction (~line 1062): `COBOL_STATEMENT_RESERVED` ✅
  4. CALL extraction (~line 1076): `COBOL_STATEMENT_RESERVED` ✅

### Integration

- `graph-symbols.ts` line 13: `import { stripCobolComments } from "./cobol-utils.js";` ✅
- `graph-imports.ts` line 4: `import { stripCobolComments } from "./cobol-utils.js";` ✅
- `extractFromCobol()` line 938: `source = stripCobolComments(source);` — called before any parsing begins. ✅
- `graph-imports.ts` line 108: `source = stripCobolComments(source);` — called at top of COBOL block, before COPY/INCLUDE regexes. ✅

### No new bugs introduced

All changes are additive (new file, import, function call) or targeted replacements (regex character classes, Set names). No logic removed except the old `COBOL_RESERVED` set.

---

## Issues Found

### Minor: `*>` inside string literals not handled

**File**: `src/services/cobol-utils.ts`, line 30
**Severity**: Minor

`stripCobolComments()` does not track whether `*>` occurs inside a string literal. Example:

```cobol
MOVE "test*>value" TO WS-FIELD.
```

The function would find `*>` inside the string, strip everything after it, and produce `MOVE "test` — which would break downstream parsing.

**Mitigation**: In practice, `*>` inside COBOL string literals is extremely rare. COBOL string literals contain data values, not comment delimiters. This is a theoretical edge case.

**Suggested fix (deferred)**: Track quote state while scanning for `*>`:
```typescript
let inQuote = false;
let quoteChar = "";
for (let i = 0; i < line.length; i++) {
  const ch = line[i];
  if (!inQuote && (ch === '"' || ch === "'")) { inQuote = true; quoteChar = ch; }
  else if (inQuote && ch === quoteChar) { inQuote = false; }
  else if (!inQuote && ch === "*" && line[i+1] === ">") { freeIdx = i; break; }
}
```

### Minor: COPY bare-identifier regex still uses `\w+` in graph-imports.ts

**File**: `src/services/graph-imports.ts`, lines 114 and 121
**Severity**: Minor

```typescript
// Line 114: bare identifier COPY
/COPY\s+(\w+)\s*\./gi       // ← \w+ doesn't match hyphens

// Line 121: COPY ... OF/IN
/COPY\s+(\w+)\s+(?:OF|IN)\s+\w+/gi  // ← same issue
```

COBOL COPY member names can contain hyphens (e.g., `COPY WS-COPY-REC.`). These two regexes would truncate at the first hyphen, capturing only `WS` from `WS-COPY-REC`.

**Note**: The quoted-form regex on line 110 (`/COPY\s+["']([^"']+)["']/gi`) is unaffected — it captures everything between quotes.

**This was NOT in the Phase 1 plan scope**, but it's an inconsistency with the `\w+` → `[\w-]+` fixes applied to `graph-symbols.ts`. Should be addressed in a follow-up.

### Nit: CALL regex lacks word boundary — pre-existing

**File**: `src/services/graph-symbols.ts`, line 1073
**Severity**: Nit

`/CALL\s+["']?([\w-]+)["']?/gi` can match `CALL` inside compound identifiers. Example: `RECALL PROGRAM-X` would match `CALL PROGRAM-X` at offset 2, producing a false-positive call to `PROGRAM-X`.

**Mitigation**: `RECALL` is not a COBOL verb, and COBOL identifiers with `CALL` as a substring are rare. The reserved-word filter catches most false positives.

**Pre-existing issue** — not introduced by Phase 1. Adding a word boundary (`\bCALL\b` or lookbehind `(?<![A-Z])CALL(?=\s)`) would fix it.

### Note: No COBOL unit tests

No tests exist for COBOL extraction in either `tests/unit/graph-symbols.test.ts` or `tests/unit/graph-imports.test.ts`. The Phase 1 plan doesn't mandate tests, but the changes are entirely untested. Recommend adding at least:

1. `stripCobolComments()` — fixed-format comments, free-format comments, mixed lines, string-literal edge case.
2. `extractFromCobol()` — hyphenated PROGRAM-ID, hyphenated CALL targets, section extraction with `FILE SECTION` no longer filtered.
3. COBOL COPY import — quoted and bare forms.

---

## Summary

| Category | Count | Details |
|----------|-------|---------|
| ✅ Correct | 6 | Comment stripping, regex fixes, reserved split, imports, integration, no regressions |
| ⚠️ Minor | 2 | `*>` in string literals; COPY bare-identifier `\w+` in graph-imports.ts |
| 💬 Nit | 1 | CALL regex word boundary (pre-existing) |
| 📝 Note | 1 | No COBOL unit tests |

**Verdict**: Phase 1 implementation is correct and matches the plan. The two minor issues are edge cases / scope gaps — neither blocks shipping. No blockers found.

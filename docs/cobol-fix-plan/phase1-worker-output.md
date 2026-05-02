# Phase 1 Worker Output

**Status**: ✅ All 3 fixes implemented, zero type errors.

## Changes Made

### Fix 1.1 — `stripCobolComments()` helper
- **Created**: `src/services/cobol-utils.ts` (new file, 42 lines)
  - `stripCobolComments(source)`: strips fixed-format (`*`/`/` in col 7) and free-format (`*>`) comments
  - Preserves line numbers (blanks comment lines, doesn't remove them)
  - Documented that this is for regex matching only — original source with comments stays indexed
- **Edited**: `src/services/graph-symbols.ts`
  - Added `import { stripCobolComments } from "./cobol-utils.js"` (line 10)
  - Called `source = stripCobolComments(source)` at top of `extractFromCobol()` (line 953)
- **Edited**: `src/services/graph-imports.ts`
  - Added `import { stripCobolComments } from "./cobol-utils.js"` (line 4)
  - Called `source = stripCobolComments(source)` at top of COBOL block in `extractImports()` (line 106)

### Fix 1.2 — Hyphenated identifier truncation
- **Edited**: `src/services/graph-symbols.ts`
  - PROGRAM-ID regex: `(\w+)` → `([\w-]+)` (line 970)
  - CALL regex: `(\w+)` → `([\w-]+)` (line 1080)
  - PERFORM regex: already correct `([A-Za-z][\w-]*)` — no change needed
  - CALL reserved-word guard: `=== "CALL"` → `COBOL_STATEMENT_RESERVED.has(...)` (line 1082)

### Fix 1.3 — Reserved-word set split
- **Edited**: `src/services/graph-symbols.ts`
  - Replaced single `COBOL_RESERVED` set with two sets:
    - `COBOL_STATEMENT_RESERVED` (72 words) — used for section filtering + CALL/PERFORM filtering
    - `COBOL_PARAGRAPH_RESERVED` (82 words, extends STATEMENT) — used for paragraph filtering only
  - Removed `FILE`, `WORKING-STORAGE`, `FD`, `SELECT`, `REDEFINES` from `COBOL_STATEMENT_RESERVED` (they're now only in `COBOL_PARAGRAPH_RESERVED`)
  - Section extraction: uses `COBOL_STATEMENT_RESERVED` → `FILE SECTION.` and `WORKING-STORAGE SECTION.` now extracted
  - Paragraph extraction: uses `COBOL_PARAGRAPH_RESERVED` → still filtered
  - PERFORM extraction: uses `COBOL_STATEMENT_RESERVED`
  - CALL extraction: uses `COBOL_STATEMENT_RESERVED`

## Verification

- `npx tsc --noEmit`: **0 errors**
- `grep COBOL_RESERVED src/`: **0 matches** (no stale references)
- All 4 filtering locations use the correct set

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/services/cobol-utils.ts` | Created | +42 |
| `src/services/graph-symbols.ts` | Modified | ~30 changed |
| `src/services/graph-imports.ts` | Modified | +2 |

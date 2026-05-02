# Phase 4 Worker Output

**Status**: ✅ Complete — all 3 fixes implemented
**Type check**: ✅ Zero errors
**Tests**: ✅ 49/49 passing

---

## Changes Made

### 4.1 Shared COBOL Extension Constants

Added `COBOL_EXTENSIONS` constant in `src/constants.ts`:

```typescript
/** COBOL source and copybook file extensions */
export const COBOL_EXTENSIONS = [".cbl", ".cob", ".cpy", ".cobol"] as const;
```

Replaced hardcoded lists in 3 files:

| File | Change |
|------|--------|
| `src/constants.ts` — `SUPPORTED_EXTENSIONS` | `...COBOL_EXTENSIONS` |
| `src/constants.ts` — `getLanguageFromExtension()` | `...Object.fromEntries(COBOL_EXTENSIONS.map(ext => [ext, "cobol"]))` |
| `src/services/code-graph.ts` — `getAstGrepLang()` | `...Object.fromEntries(COBOL_EXTENSIONS.map(ext => [ext, "cobol"]))` |

Note: `graph-imports.ts` was checked — it uses `langKey` (not extension-based detection), so no change was needed there. The plan's item 4 for graph-imports.ts did not apply.

### 4.2 ENTRY_POINT_NAMES Heuristic Documentation

Added explanatory comment above the COBOL entry in `ENTRY_POINT_NAMES`:

```typescript
// COBOL: no universal entry-point convention. Common patterns:
// - MAIN / MAIN-PROGRAM: generic names
// - 0000-MAIN: numeric-prefix convention (0xxx = main, 1xxx = init, etc.)
// The actual entry point is PROGRAM-ID; this set is used for heuristic
// entry-point detection when building the call graph.
cobol: new Set(["MAIN", "MAIN-PROGRAM", "0000-MAIN"]),
```

### 4.3 Shared Constant in graph-resolution.ts

- Added `import { COBOL_EXTENSIONS } from "../constants.js";`
- Replaced `const cobolExts = [".cpy", ".cbl", ".cob", ".cobol"];` with `const cobolExts = [...COBOL_EXTENSIONS];`

---

## Verification

```
npx tsc --noEmit        → 0 errors
npx vitest run cobol    → 49/49 passed
grep for duplicate lists → single definition in constants.ts only
```

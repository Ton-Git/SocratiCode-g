# Phase 3 Review — COBOL Minor Improvements

## Review

### Correct

- **3.3 Set-based lookup** (`graph-symbols.ts:1054-1067`): `sectionNames` Set is built at line 1055 after section extraction (step 2) and before paragraph loop (step 3). Correct placement.
- **3.4 Free-format indent**: All 7 `\s{0,6}` locations changed to `\s*`. Verified by grep — zero remaining `\s{0,6}` in both `graph-symbols.ts` and `code-graph.ts`. Division extraction regex from Phase 2 (line 983, 993) also uses `\s*`.
- **PERFORM THRU regex scoped to procSource** (`graph-symbols.ts:1116`): Uses `procSource.matchAll(...)`, correctly limited to PROCEDURE DIVISION content.
- **Unit tests pass**: 49/49 in `cobol-extraction.test.ts`.

### Blocker: `getAstGrepLang` returning `null` breaks COBOL file indexing

**Location**: `code-graph.ts:513` + `code-graph.ts:561` + `code-graph.ts:631`

The Phase 3 change to return `null` for COBOL extensions creates **two** problems:

1. **File collection exclusion** (`code-graph.ts:561`): `getGraphableFiles` includes a file only if `getAstGrepLang(ext) !== null || extras.has(ext)`. With `null`, COBOL files are only collected if the user has set `EXTRA_EXTENSIONS=.cbl,.cob,...` in the environment. Default installs will silently skip all COBOL files.

2. **Symbol extraction skipped** (`code-graph.ts:631`): Even if a COBOL file is collected (via `EXTRA_EXTENSIONS`), the main loop checks `if (!lang) { ... continue; }` — creating only a leaf node with no symbol extraction. `extractSymbolsAndCalls` is never called, so `extractFromCobol` is dead code from this integration path.

**Before Phase 3**: `getAstGrepLang(".cbl")` returned `"cobol"` → files collected → `lang` truthy → `extractSymbolsAndCalls(source, "cobol", ...)` called → routes to `extractFromCobol()`.

**Fix required**: COBOL needs special-casing in the main loop (similar to bash or any other regex-only language). The `!lang` guard must not skip languages that have a dedicated extractor. Options:
- Add a `hasCustomExtractor(ext)` check before the `if (!lang)` continue, OR
- Return a sentinel string (e.g., `"cobol"`) from `getAstGrepLang` instead of `null` (reverting this change), OR
- Restructure the loop to call `extractSymbolsAndCalls` for all collected files regardless of ast-grep support, with the function itself deciding the extraction path.

### Note: PERFORM THRU missing `THROUGH` alternate spelling

**Location**: `graph-symbols.ts:1116`

COBOL allows both `THRU` and `THROUGH` as synonyms. The regex only matches `THRU`:
```typescript
const performThruRegex = /PERFORM\s+[A-Za-z][\w-]*\s+THRU\s+([A-Za-z][\w-]*)/gi;
```

Should be:
```typescript
const performThruRegex = /PERFORM\s+[A-Za-z][\w-]*\s+THRU(?:OUGH)?\s+([A-Za-z][\w-]*)/gi;
```

### Note: No test for PERFORM THRU

`cobol-extraction.test.ts` has no test case for `PERFORM X THRU Y`. The feature was added but untested.

### Note: Unit tests bypass the integration blocker

Tests call `extractSymbolsAndCalls(source, "cobol", ext, relPath)` directly, which exercises the COBOL path. They don't go through `buildCodeGraph()` → `getGraphableFiles()` → `getAstGrepLang()`, so the blocker above is invisible to the test suite.

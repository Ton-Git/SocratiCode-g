# Phase 2 Worker Output

## Status: ✅ Complete

## Changes Made

### 2.1 Add DIVISION Symbol Extraction

**`src/types.ts`**:
- Added `"division"` to `SymbolKind` union type (before "section" and "paragraph")

**`src/services/graph-symbols.ts`**:
- Added division extraction block after PROGRAM-ID and before SECTION extraction
- Division regex: `/^\s{0,6}([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*)\s+DIVISION\s*\./gim`
  - Captures multi-word division names (e.g., `IDENTIFICATION DIVISION.`)
  - Uses `COBOL_STATEMENT_RESERVED` for filtering (does NOT block DATA, IDENTIFICATION, etc.)
- Computes endLine by scanning forward for next DIVISION header
- Uses `lines[i - 1]` for 0-indexed array access (lineNum is 1-indexed)
- Qualified name includes program prefix (e.g., `PAYROLL.PROCEDURE`)

### 2.2 Restrict CALL/PERFORM to PROCEDURE DIVISION

**`src/services/graph-symbols.ts`**:
- Added early return when `procDivStart === 0` (no PROCEDURE DIVISION found)
- Built `procSource` from `lines.slice(procDivStart)` for PERFORM and CALL regex matching
- Adjusted line number calculation: `lineNum = procDivStart + procSource.substring(0, match.index!).split("\n").length`

### 2.3 Bug Fix: Paragraph names starting with digits

**`src/services/graph-symbols.ts`**:
- Changed paragraph regex from `([A-Za-z][\w-]*)` to `([A-Za-z0-9][\w-]*)`
- COBOL paragraph names commonly start with digits (e.g., `0000-MAIN`)
- This was a pre-existing bug that prevented the fixture tests from passing

### 2.4 Unit Tests

**New file: `tests/unit/cobol-extraction.test.ts`** (49 tests):
- `stripCobolComments`: 6 tests (fixed-format, page-break, free-format, preservation, line count, no-comments)
- `extractFromCobol — PROGRAM-ID`: 3 tests (period notation, IS keyword, hyphenated names)
- `extractFromCobol — DIVISION`: 3 tests (all four divisions, qualified names, endLine calculation)
- `extractFromCobol — SECTION`: 3 tests (FILE SECTION, WORKING-STORAGE SECTION, custom sections)
- `extractFromCobol — PARAGRAPH`: 5 tests (basic extraction, outside PROCEDURE DIVISION, hyphenated names, reserved-word filtering, endLine)
- `extractFromCobol — PERFORM`: 4 tests (basic detection, DATA DIVISION filtering, comment filtering, reserved-word filtering)
- `extractFromCobol — CALL`: 5 tests (double-quoted, single-quoted, bare identifier, DATA DIVISION filtering, comment filtering)
- Edge cases: 1 test (no PROCEDURE DIVISION → no rawCalls)
- Fixture: 4 tests (reads file, symbol extraction, call detection, comment exclusion)
- `extractImports — COBOL`: 9 tests (COPY variants, EXEC SQL INCLUDE, keyword filtering, comment handling)
- `resolveImport — COBOL`: 6 tests (same-dir, bare identifier, copybook fallback, null, .cbl extension, fixture)

**New file: `tests/fixtures/cobol/sample.cbl`** — realistic COBOL program with divisions, sections, paragraphs, PERFORM, CALL, and comments

**New file: `tests/fixtures/cobol/copybook/vars.cpy`** — sample copybook

## Validation Results

- `npx tsc --noEmit`: ✅ Zero type errors
- `npx vitest run tests/unit/cobol-extraction.test.ts`: ✅ 49/49 passed
- `npx vitest run tests/unit/graph-symbols.test.ts`: ✅ 21/21 passed (no regressions)
- `npx vitest run tests/unit/graph-imports.test.ts`: ✅ 48/48 passed (no regressions)
- `npx vitest run tests/unit/graph-resolution.test.ts`: ✅ 85/85 passed (no regressions)

## Deviations from Plan

1. **Paragraph regex fix** (`[A-Za-z]` → `[A-Za-z0-9]`): Not in the Phase 2 plan, but was necessary to make tests pass. COBOL paragraph names starting with digits (e.g., `0000-MAIN`) are extremely common. Without this fix, the fixture-based tests and most real COBOL programs would fail paragraph extraction.

2. **Division endLine off-by-one fix**: The plan's code had the same off-by-one bug as the existing section extraction code (using 1-indexed `lineNum` as a 0-indexed loop variable). Fixed in the division code by using `lines[i - 1]` for array access. The existing section code still has this bug (not touched in this phase).

3. **Test indentation**: Tests use 6-space indentation (`\s{0,6}` limit) instead of 7-space (real COBOL fixed-format). The `\s{0,6}` regex is a known limitation that Phase 3.4 addresses (relax to `\s*`).

## Files Changed

| File | Action |
|------|--------|
| `src/types.ts` | Modified (added "division" SymbolKind) |
| `src/services/graph-symbols.ts` | Modified (division extraction, scope restriction, paragraph regex fix) |
| `tests/unit/cobol-extraction.test.ts` | Created (49 tests) |
| `tests/fixtures/cobol/sample.cbl` | Created (fixture) |
| `tests/fixtures/cobol/copybook/vars.cpy` | Created (fixture) |

# Phase 3 Worker Output

**Status**: ✅ Complete — all 4 fixes implemented, type-check passes, 49/49 tests pass.

---

## Changes Made

### 3.1 Fix `getAstGrepLang` for COBOL
**File**: `src/services/code-graph.ts`
- Changed `.cbl`, `.cob`, `.cpy`, `.cobol` mappings from `"cobol"` to `null`
- Changed map type from `Record<string, Lang | string>` to `Record<string, Lang | string | null>` to allow null values
- Added comment: `// COBOL: no ast-grep grammar; handled by regex in extractSymbolsAndCalls`

### 3.2 Add PERFORM THRU Secondary Target Capture
**File**: `src/services/graph-symbols.ts`
- Added new regex block `performThruRegex` after existing PERFORM extraction
- Pattern: `/PERFORM\s+[A-Za-z][\w-]*\s+THRU\s+([A-Za-z][\w-]*)/gi`
- Scoped to `procSource` (PROCEDURE DIVISION only), same line-number adjustment as PERFORM
- Filters against `COBOL_STATEMENT_RESERVED`

### 3.3 Replace `symbols.some()` with `Set` Lookup
**File**: `src/services/graph-symbols.ts`
- Built `sectionNames` Set before paragraph loop: `new Set(symbols.filter(s => s.kind === "section").map(s => s.name))`
- Replaced `symbols.some((s) => s.name === name && s.kind === "section")` with `sectionNames.has(name)`
- Set is built after section extraction completes, before paragraph extraction starts

### 3.4 Relax Indentation for Free-Format COBOL
**File**: `src/services/graph-symbols.ts`
- Changed `\s{0,6}` → `\s*` in 7 locations:
  1. Division extraction regex (`divisionRegex`)
  2. Division endLine search regex (inner loop)
  3. Section extraction regex (`sectionRegex`)
  4. Section endLine search regex (inner loop)
  5. PROCEDURE DIVISION detection regex
  6. Paragraph extraction regex (`paragraphRegex`)
  7. Paragraph endLine search regex (inner loop)

---

## Validation

### TypeScript type-check
```
npx tsc --noEmit → 0 errors
```

### Test results
```
npx vitest run tests/unit/cobol-extraction.test.ts
  ✓ tests/unit/cobol-extraction.test.ts (49 tests) 94ms
  Test Files  1 passed (1)
  Tests       49 passed (49)
```

No test changes were needed — all existing tests use `const A = "      "; // 6 spaces` which still matches `\s*` (since `\s*` matches 0 or more whitespace, and 6 spaces is a valid match).

---

## Notes

- The `sectionNames` Set is built unconditionally (not inside `if (procDivStart > 0)`) because it only depends on section extraction, which happens before the procDivStart check. This is correct — sections exist across all divisions, not just PROCEDURE DIVISION.
- No new tests were added for PERFORM THRU in this phase. That can be added in a future test expansion pass.

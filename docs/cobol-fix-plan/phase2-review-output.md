# Phase 2 Review — COBOL Major Fixes

**Reviewer**: Subagent (automated)  
**Date**: 2026-05-02  
**Files reviewed**: `src/types.ts`, `src/services/graph-symbols.ts`, `tests/unit/cobol-extraction.test.ts`, `tests/fixtures/cobol/sample.cbl`

---

## Summary

The Phase 2 implementation is **largely correct** and the test suite (49 tests) is comprehensive. All 49 tests pass. However, one "bonus fix" introduced a subtle regression in division endLine values, and the test for that behavior asserts the wrong values. A pre-existing off-by-one inconsistency between section and paragraph endLine computation was documented but not flagged as a bug.

| Severity | Count | Category |
|----------|-------|----------|
| **Blocker** | 0 | — |
| **Medium** | 1 | endLine off-by-one regression in division extraction |
| **Low** | 2 | Pre-existing section/paragraph endLine inconsistency; misleading test comment |
| **Note** | 3 | Minor test quality observations |

---

## Correct

### 1. `"division"` SymbolKind added correctly (`src/types.ts:89`)
- Alphabetically ordered between `"program"` and `"section"`. ✓
- Comment style matches existing COBOL entries. ✓

### 2. Division extraction regex (`src/services/graph-symbols.ts:984`)
```typescript
const divisionRegex = /^\s{0,6}([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*)\s+DIVISION\s*\./gim;
```
- Multi-word name support via `(?:\s+[A-Za-z][\w-]*)*`. ✓
- Anchored to line start with `\s{0,6}` for COBOL fixed-format Area A. ✓
- Case-insensitive via `i` flag. ✓
- Multiline via `m` flag. ✓
- Captures all four standard divisions. Verified by diagnostic. ✓

### 3. Division reserved-word filtering (`src/services/graph-symbols.ts:987`)
- Uses `COBOL_STATEMENT_RESERVED` set. None of `IDENTIFICATION`, `ENVIRONMENT`, `DATA`, `PROCEDURE` are in this set. All four divisions pass through. ✓

### 4. Scope restriction — PROCEDURE DIVISION only (`src/services/graph-symbols.ts:1093-1100`)
- `procDivStart` computed as `i + 1` (0-indexed index of first line after PROCEDURE DIVISION). ✓
- Early return `if (procDivStart === 0)` is safe — returns symbols with empty rawCalls. ✓
- `procSource = lines.slice(procDivStart).join("\n")` correctly slices. ✓
- PERFORM/CALL regexes run only against `procSource`. ✓
- If PROCEDURE DIVISION is the last line, `procSource` is empty — no false matches. ✓

### 5. PERFORM/CALL line number adjustment (`src/services/graph-symbols.ts:1105,1117`)
```typescript
const lineNum = procDivStart + procSource.substring(0, match.index!).split("\n").length;
```
- Verified by diagnostic: PERFORM GREET-USER → line 3, CALL SUB-PROG → line 4. Both correct. ✓
- Formula: `procDivStart` (0-indexed) + 1-indexed offset within sliced source = correct 1-indexed absolute line. ✓

### 6. Paragraph digit-prefix fix (`src/services/graph-symbols.ts:1051`)
```typescript
const paragraphRegex = /^\s{0,6}([A-Za-z0-9][\w-]*)\s*\.\s*$/;
```
- Changed `[A-Za-z]` → `[A-Za-z0-9]` to support `0000-MAIN` style paragraphs. ✓
- Paragraph extraction is already scoped to `procDivStart` onwards, so level-number data items in DATA DIVISION are not affected. ✓
- No false positives in PROCEDURE DIVISION (level numbers like `01` would only match if on their own line ending with period, which is extremely rare). ✓

### 7. Test coverage (49 tests)
- **stripCobolComments**: 6 tests — fixed-format, page-break, free-format, preservation, no-comment. ✓
- **PROGRAM-ID**: 3 tests — period notation, IS keyword, hyphenated names. ✓
- **DIVISION**: 3 tests — all four divisions, qualified name, endLine. ✓
- **SECTION**: 3 tests — FILE, WORKING-STORAGE, custom sections. ✓
- **PARAGRAPH**: 5 tests — extraction, scope restriction, hyphenated names, reserved words, endLine. ✓
- **PERFORM**: 4 tests — detection, DATA DIVISION exclusion, comment exclusion, reserved word filter. ✓
- **CALL**: 5 tests — double-quoted, single-quoted, bare identifier, DATA DIVISION exclusion, comment exclusion. ✓
- **Edge case**: 1 test — no PROCEDURE DIVISION → empty rawCalls. ✓
- **Fixture integration**: 4 tests — full sample.cbl parsing. ✓
- **extractImports**: 9 tests — COPY variants, EXEC SQL INCLUDE, comment exclusion. ✓
- **resolveImport**: 6 tests — same dir, copybook fallback, extension resolution, null case. ✓

### 8. Fixture file (`tests/fixtures/cobol/sample.cbl`)
- Realistic COBOL program with all structural elements. ✓
- Includes commented-out PERFORM and CALL to verify comment stripping. ✓
- Uses standard fixed-format indentation. ✓

### 9. Temp project cleanup in resolveImport tests
- Proper `afterEach` cleanup with `fs.rmSync`. ✓
- Uses `os.tmpdir()` for portability. ✓

---

## Fixed Issues

None applied (review-only pass).

---

## Medium — Division endLine "bonus fix" is a regression

**Location**: `src/services/graph-symbols.ts:990-995`  
**Severity**: Medium (correctness issue with minimal practical impact)

The Phase 2 plan specified this loop for division endLine:
```typescript
// Plan version — uses lines[i]
for (let i = lineNum; i < lines.length; i++) {
  if (i > lineNum && regex.test(lines[i]!)) {
    endLine = i;
    break;
  }
}
```

The implementation changed `lines[i]` to `lines[i - 1]` as a "bonus off-by-one fix":
```typescript
// Implementation — uses lines[i-1]
for (let i = lineNum; i < lines.length; i++) {
  if (i > lineNum && regex.test(lines[i - 1]!)) {
    endLine = i;
    break;
  }
}
```

**This change made division endLine values inconsistent with the rest of the codebase.**

### Why the plan's version was correct

The codebase uses **inclusive** endLine convention. Evidence:

1. `findCallerId` at line 60: `line >= s.startLine && line <= s.endLine` (inclusive both ends)
2. `graph-entrypoints.ts:99`: `s.line <= line && line <= s.endLine` (inclusive)
3. All tree-sitter extractors use `range.end.line + 1` which produces inclusive values
4. Regex fallback at line 1153: `endLine = j + 1` produces inclusive values

The pre-existing section code at line 1023 uses `lines[i]` (treating the 1-indexed loop variable as 0-indexed for array access). This accidentally produces correct inclusive values:

| Source | lineNum | lines[i] access | endLine | Inclusive scope |
|--------|---------|-----------------|---------|-----------------|
| FILE SECTION, next=WORKING-STORAGE at line 4 | 2 | lines[3] → WORKING-STORAGE | 3 | lines 2–3 ✓ |

The implementation's `lines[i - 1]` produces **exclusive** endLine values:

| Source | lineNum | lines[i-1] access | endLine | Inclusive scope |
|--------|---------|-------------------|---------|-----------------|
| IDENTIFICATION, next=DATA at line 3 | 1 | lines[2] → DATA | 3 | lines 1–3 ✗ (includes DATA header) |

### Practical impact

The overlap only affects division header lines (1 line each). `findCallerId` resolves ties by picking the scope with the highest `startLine`, so caller resolution is not affected. However:

1. Division scopes include the next division's header line (wrong).
2. Display consumers (`graph-tools.ts:402`, `query-tools.ts:122`) show ranges that are 1 line too wide for divisions.

### Fix

Revert `lines[i - 1]` back to `lines[i]` (matching the plan and the section code), and update the test expectations:

```typescript
// Division endLine loop (line 990-995):
for (let i = lineNum; i < lines.length; i++) {
  if (i > lineNum && /^\s{0,6}[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)*\s+DIVISION\s*\./i.test(lines[i]!)) {
    endLine = i;
    break;
  }
}

// Test expectations (line ~186-190):
expect(identDiv!.endLine).toBe(2);  // was 3
expect(dataDiv!.endLine).toBe(3);    // was 4
expect(procDiv!.endLine).toBe(7);    // unchanged (EOF)
```

---

## Low — Pre-existing section endLine inconsistency

**Location**: `src/services/graph-symbols.ts:1022-1025`  
**Severity**: Low (works correctly by accident; confusing code)

The section code uses `lines[i]` where `i` starts at `lineNum` (1-indexed). This treats `i` as 0-indexed for array access while keeping it 1-indexed for the loop boundary. It skips checking `lines[lineNum]` (the first line after the section) because `i > lineNum` skips `i = lineNum`.

For FILE SECTION at lineNum=2:
- Skips lines[2] (line 3 content)
- Checks lines[3] (line 4 content = WORKING-STORAGE SECTION)
- Sets endLine=3

This produces correct inclusive values by accident (the off-by-one in array access compensates for the inclusive convention). But it means the first line after a section is never checked for being another section header — only relevant if two sections are on consecutive lines, which never happens in practice.

**Recommendation**: In a future cleanup, normalize to use `lines[i - 1]` with `endLine = i - 1` (or `lines[i]` with `endLine = i + 1`) consistently across division, section, and paragraph extraction.

---

## Low — Paragraph endLine test comment is misleading

**Location**: `tests/unit/cobol-extraction.test.ts:241`  
**Severity**: Low (documentation only)

```typescript
// Note: endLine uses 0-indexed convention — known pre-existing behavior
expect(paraA!.endLine).toBe(3);
```

The value 3 is actually the correct **1-indexed inclusive** endLine (PARA-A spans lines 2–3 inclusive). The comment calling it "0-indexed convention" is misleading. The code arrives at the value via a 0-indexed variable (`j`), but the resulting value matches the 1-indexed inclusive convention used everywhere else.

---

## Notes

### 1. Test "filters reserved words as PERFORM targets" is weak
**Location**: `tests/unit/cobol-extraction.test.ts:278`

The test only verifies that `"PERFORM"` doesn't appear as a calleeName. But the PERFORM regex (`PERFORM\s+([A-Za-z][\w-]*)`) captures the target name, not the keyword. A stronger test would use `PERFORM DISPLAY` or `PERFORM MOVE` (actual reserved words) and verify they're filtered. Current test doesn't exercise the `COBOL_STATEMENT_RESERVED` filter for PERFORM targets at all.

### 2. No test for division reserved-word filtering
The plan mentioned filtering division names against `COBOL_STATEMENT_RESERVED`. While none of the four standard divisions are reserved, there's no test verifying that a hypothetical `PERFORM DIVISION.` would be filtered. Low priority since this case doesn't arise in practice.

### 3. CALL regex doesn't handle spaces in quoted names
```typescript
const callRegex = /CALL\s+["']?([\w-]+)["']?/gi;
```
`CALL "SUB PROG"` would capture only `"SUB"`. Acceptable for COBOL where program names don't contain spaces.

### 4. Missing test: PROCEDURE DIVISION as last line
If PROCEDURE DIVISION is the last line of the file, `procSource` is empty. The early return doesn't trigger (procDivStart > 0), but PERFORM/CALL matching produces no results. Works correctly but untested.

### 5. Missing test: Multiple sections with same-level paragraphs
A test with multiple sections each containing paragraphs would verify that paragraph endLine correctly stops at section boundaries. The current paragraph endLine test only uses sections indirectly.

---

## Verdict

**Phase 2 is approved with one recommended fix.** The division endLine regression (Medium) should be addressed — it's a 2-line code change plus 2-line test change. The pre-existing section/paragraph endLine inconsistency is low priority and can be cleaned up in a future normalization pass. All 49 tests pass, coverage is comprehensive, and the core functionality (scope restriction, division extraction, comment-aware parsing) works correctly.

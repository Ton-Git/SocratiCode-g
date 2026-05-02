# COBOL Support Code Review — 2026-05-02

**Commit**: `9bb07e8` — feat: add COBOL language support with graph, symbols, and embedded SQL
**Scope**: 6 files, +237 lines
**Reviewer 1**: Direct code review
**Reviewer 2**: Automated subagent review

---

## Consensus Findings (both reviewers agree)

These issues were independently identified by both reviewers:

### CRITICAL — No comment-line filtering
- **Files**: `graph-symbols.ts`, `graph-imports.ts`
- **Issue**: COBOL fixed-format uses `*` in column 7 for comments; free-format uses `*>`. None of the regex handlers strip or skip comment lines. This produces false-positive PERFORM calls, CALL targets, COPY imports, section names, and paragraph names from commented-out code.
- **Impact**: Any real COBOL codebase with comments will have polluted symbol graphs.
- **Fix**: Pre-process source: strip lines where `column 7 === '*'` or line starts with `*>` before running regex matching. Could add a `stripCobolComments(source)` helper shared by all COBOL handlers.

### CRITICAL — Hyphenated identifier truncation (`\w+` → `[\w-]+`)
- **File**: `graph-symbols.ts`
- **Issue**: Multiple regex patterns use `\w+` which stops at hyphens. COBOL identifiers commonly contain hyphens (`HELLO-WORLD`, `CANCEL-PROGRAM`, `1000-MAIN-LOGIC`).
  - `PROGRAM-ID` regex captures only `HELLO` from `HELLO-WORLD`
  - `CALL` regex captures only `CANCEL` from `CALL CANCEL-PROGRAM`
  - `PERFORM` regex captures only `1000` from `PERFORM 1000-MAIN-LOGIC`
  - Section regex `([\w-]*)` already handles hyphens ✅
  - Paragraph regex `([A-Za-z][\w-]*)` already handles hyphens ✅
- **Fix**: Change `\w+` to `[\w-]+` in PROGRAM-ID, CALL, and PERFORM regexes.

### CRITICAL — `COBOL_RESERVED` blocks legitimate section names
- **File**: `graph-symbols.ts`
- **Issue**: `FILE` and `WORKING-STORAGE` are in `COBOL_RESERVED`, so `FILE SECTION.` and `WORKING-STORAGE SECTION.` are silently skipped. These are standard COBOL DATA DIVISION sections that should be extracted as structural symbols.
- **Fix**: Split into `COBOL_STATEMENT_RESERVED` (for paragraph filtering in PROCEDURE DIVISION) and `COBOL_SECTION_RESERVED` (subset that are actual statement keywords, not section names). Remove `FILE`, `WORKING-STORAGE`, `FD`, `SELECT` from section filtering — these are valid section names.

### MAJOR — No test coverage
- **Issue**: 237 lines of regex-based parsing with zero unit tests.
- **Fix**: Add tests covering: PROGRAM-ID (including hyphenated), section/paragraph detection, PERFORM/CALL detection, COPY import parsing, reserved-word filtering, comment-line handling, hyphenated identifiers, resolution cascade.

---

## Findings Unique to Reviewer 1 (Direct Review)

### MAJOR — `extractFromCobol` never extracts DIVISION symbols
- **File**: `graph-symbols.ts`
- **Issue**: The function extracts PROGRAM-ID, SECTION, and PARAGRAPH, but not DIVISIONs (IDENTIFICATION, ENVIRONMENT, DATA, PROCEDURE). Divisions are the top-level structural unit in COBOL. The `types.ts` changes only add `"program"`, `"section"`, `"paragraph"` — no `"division"` kind. This means the symbol graph has no division-level nesting.
- **Fix**: Add `"division"` SymbolKind to `types.ts`, extract division headers as symbols.

### MAJOR — CALL and PERFORM regex run against entire source (not just PROCEDURE DIVISION)
- **File**: `graph-symbols.ts`
- **Issue**: `CALL` and `PERFORM` regexes run against the full source text, not just lines within the PROCEDURE DIVISION. This can match CALL/PERFORM in comment lines (even without the comment-filtering bug), string literals in the DATA DIVISION, or COPY directives.
- **Fix**: Restrict CALL/PERFORM matching to lines after `procDivStart`.

### MINOR — PERFORM THRU only captures first target
- **File**: `graph-symbols.ts`
- **Issue**: `PERFORM PARA-A THRU PARA-C` only captures `PARA-A`. The THRU target (`PARA-C`) is missed, so the call graph won't show that all paragraphs between A and C are reachable.
- **Fix**: Add secondary regex or post-processing to capture the THRU target.

### MINOR — Performance: `symbols.some()` in paragraph hot loop
- **File**: `graph-symbols.ts`
- **Issue**: O(n) scan per paragraph to check if name was already captured as a section. For large COBOL programs with hundreds of paragraphs, this is O(p×s).
- **Fix**: Build a `Set<string>` of section names before the paragraph loop.

### MINOR — `getAstGrepLang` returns `"cobol"` but ast-grep doesn't support COBOL
- **File**: `code-graph.ts`
- **Issue**: Returns the string `"cobol"` which will cause ast-grep to attempt parsing and fail. The regex fallback in `extractSymbolsAndCalls` handles this correctly, but the mapping is misleading.
- **Fix**: Return `null` instead, since the COBOL path is handled by `extractFromCobol` via the `langKey` check, not via ast-grep.

### MINOR — `resolveImport` project-wide search fallback is expensive
- **File**: `graph-resolution.ts`
- **Issue**: For bare COPY identifiers, the resolution cascade falls through to a project-wide search. In large COBOL codebases with thousands of copybooks, this is slow.
- **Fix**: Acceptable as a last-resort fallback, but consider caching or limiting search depth.

### NIT — Extension list duplicated across 4 locations
- **Files**: `constants.ts` (×2), `code-graph.ts`, `graph-imports.ts`
- **Issue**: `.cbl`, `.cob`, `.cpy`, `.cobol` repeated in 4 places.
- **Fix**: Extract to a shared constant (e.g., `COBOL_EXTENSIONS`).

---

## Findings Unique to Reviewer 2 (Subagent)

### MINOR — Free-format COBOL indentation limit
- **File**: `graph-symbols.ts`
- **Issue**: `^\s{0,6}` limits leading whitespace to 0–6 chars. Free-format COBOL (2002+) allows arbitrary indentation. Paragraphs indented beyond 6 spaces won't be detected.
- **Note**: Reviewer 1 also identified this as part of the column-constraint issue.

### NIT — ENTRY_POINT_NAMES heuristic may be incomplete
- **File**: `constants.ts`
- **Issue**: `cobol: new Set(["MAIN", "MAIN-PROGRAM", "0000-MAIN"])` — other numeric prefixes exist (e.g., `1000-MAIN`).
- **Note**: Acceptable as best-effort heuristic.

---

## Consistency Check

| Finding | R1 | R2 | Consensus |
|---------|:--:|:--:|:---------:|
| No comment-line filtering | ✓ | ✓ | ✅ Agree |
| `\w+` truncates hyphenated identifiers | — | ✓ | R2 caught this, R1 missed |
| Reserved set blocks FILE/WORKING-STORAGE sections | — | ✓ | R2 caught this, R1 missed |
| No tests | ✓ | ✓ | ✅ Agree |
| Free-format indent limit | ✓ | ✓ | ✅ Agree |
| `.cpy` / getAstGrepLang mapping | ✓ | ✓ | ✅ Agree |
| No DIVISION extraction | ✓ | — | R1 caught this, R2 missed |
| PERFORM THRU partial capture | ✓ | — | R1 caught this, R2 missed |
| Performance: symbols.some() | ✓ | — | R1 caught this, R2 missed |
| CALL/PERFORM scope (PROCEDURE DIVISION only) | ✓ | — | R1 caught this, R2 missed |
| Extension duplication | ✓ | — | R1 caught this, R2 missed |
| ENTRY_POINT_NAMES completeness | — | ✓ | Minor heuristic, acceptable |

**Verdict**: Both reviews are consistent where they overlap. No contradictions. Each reviewer caught issues the other missed, confirming the value of dual review.

---

## Recommended Fix Plan (priority order, no code changes yet)

### Phase 1 — Critical bugs (blocks shipping)
1. Add `stripCobolComments()` helper → use in all COBOL handlers
2. Fix `\w+` → `[\w-]+` in PROGRAM-ID, CALL, PERFORM regexes
3. Fix `COBOL_RESERVED` to not block FILE SECTION / WORKING-STORAGE SECTION

### Phase 2 — Major issues (should fix before production)
4. Restrict CALL/PERFORM matching to PROCEDURE DIVISION lines only
5. Add DIVISION symbol extraction (+ `"division"` SymbolKind)
6. Add unit tests (PROGRAM-ID, sections, paragraphs, PERFORM, CALL, COPY, comments, hyphens, resolution)

### Phase 3 — Minor improvements (can ship with, fix soon)
7. Fix `getAstGrepLang` to return `null` for COBOL
8. Add PERFORM THRU secondary target capture
9. Replace `symbols.some()` with `Set` for section name lookup
10. Relax `^\s{0,6}` → `^\s*` for free-format compatibility

### Phase 4 — Nits (backlog)
11. Extract COBOL_EXTENSIONS shared constant
12. Document ENTRY_POINT_NAMES as heuristic

---

## Production-Ready Verdict

**Not yet.** Three critical bugs (comment handling, hyphenated identifiers, reserved-word overfiltering) will produce incorrect results on virtually any real COBOL codebase. The fixes are small (regex tweaks + comment stripping helper) but must be applied before shipping.

# COBOL Support — Fix Implementation Plan

**Source review**: `REVIEW-cobol-2026-05-02.md`
**Commit under review**: `9bb07e8` — feat: add COBOL language support
**Scope**: 6 files, +237 lines of COBOL parsing logic

---

## Problem Statement

The COBOL support added in `9bb07e8` has 3 critical bugs, 3 major issues, and several minor/nit items that prevent it from producing correct results on real COBOL codebases. The dual code review (direct + subagent) identified no contradictions and complementary blind spots.

---

## Phase Structure

| Phase | Priority | File | Description |
|-------|----------|------|-------------|
| [Phase 1](01-phase1-critical.md) | **Critical** — blocks shipping | `01-phase1-critical.md` | Comment stripping, hyphenated identifiers, reserved-word set |
| [Phase 2](02-phase2-major.md) | **Major** — should fix before production | `02-phase2-major.md` | DIVISION extraction, scope restriction, unit tests |
| [Phase 3](03-phase3-minor.md) | **Minor** — can ship with, fix soon | `03-phase3-minor.md` | ast-grep null return, PERFORM THRU, perf, free-format |
| [Phase 4](04-phase4-nits.md) | **Nit** — backlog | `04-phase4-nits.md` | Shared constants, entry-point docs |
| [Phase 5](05-phase5-comment-metadata.md) | **Enhancement** — backlog | `05-phase5-comment-metadata.md` | Comments as symbol metadata, searchable annotations |

---

## Files Affected (across all phases)

| File | Phases |
|------|--------|
| `src/services/graph-symbols.ts` | 1, 2, 3 |
| `src/services/graph-imports.ts` | 1, 2 |
| `src/services/graph-resolution.ts` | 2 |
| `src/services/code-graph.ts` | 3 |
| `src/types.ts` | 2 |
| `src/constants.ts` | 4 |
| New: `src/services/cobol-utils.ts` | 1, 5 |
| New: `tests/cobol-*.test.ts` | 2 |
| Indexing pipeline | 5 |
| Graph tool serialization | 5 |

---

## Estimated Effort

| Phase | Changes | Lines | Time |
|-------|---------|-------|------|
| Phase 1 | 4 regex fixes + 1 new helper | ~80 | 30–45 min |
| Phase 2 | DIVISION extraction + scope + tests | ~300 | 2–3 hrs |
| Phase 3 | 4 targeted fixes | ~30 | 30 min |
| Phase 4 | Refactor + docs | ~40 | 20 min |
| Phase 5 | Comment metadata | ~130 | 1–2 hrs (optional) |

---

## How to Use This Plan

1. Read each phase file top-to-bottom.
2. Each phase lists **exact files**, **exact locations**, **what to change**, and **why**.
3. Phases are ordered by dependency — Phase 1 must land before Phase 2 (tests rely on correct behavior).
4. After each phase, run `npm test` to verify nothing breaks.
5. After all phases, run a full integration test against a real COBOL codebase.

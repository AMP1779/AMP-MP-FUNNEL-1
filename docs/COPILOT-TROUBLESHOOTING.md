# AMP — Copilot Phase 1 Hardening & Test Execution Memo

**Timestamp:** August 20, 2026 — 8:33 AM PDT
**From:** AMP Executive Office / PMO
**To:** GitHub Copilot / Engineering Execution
**CC:** Founder, ChatGPT / Executive Office, Claude / CTO, Gemini / UX, Meta AI / Brand, Railway
**Priority:** EXECUTION — PHASE 1 HARDENING & TESTING
**Repository:** `AMP1779/AMP-MP-FUNNEL-1`
**Branch:** `chore/phase1-hardening-tests`
**Phase:** Phase 1 — Hardening & Verification
**Status:** AUTHORIZED

## 1. EXECUTIVE DIRECTIVE

Proceed with a **read-first, test-driven hardening audit** of the current AMP Phase 1 producer registration funnel.

You are authorized to:

* Inspect the current `main` branch.
* Run the existing application locally.
* Audit the relevant API and frontend files.
* Create the feature branch `chore/phase1-hardening-tests`.
* Add a minimal automated test suite using Node's built-in `node --test` runner.
* Use only minimum required `package.json` test configuration.
* Reproduce and document failures.
* Apply small, safe fixes **only when directly supported by test evidence or an objectively identified defect**.
* Run the complete test suite after fixes.
* Commit the work.
* Push the feature branch to GitHub.

**Do NOT merge.**
**Do NOT deploy to Railway.**
**Do NOT modify production infrastructure.**
**Do NOT introduce unrelated improvements or refactors.**

The purpose of this assignment is to establish a trustworthy, reproducible baseline before further production execution.

---

## 2. SOURCE OF TRUTH

The GitHub repository is the engineering source of truth:

`AMP1779/AMP-MP-FUNNEL-1`

Start from the current `main` branch.

Do not assume that previous reports, screenshots, conversations, or expected implementation states are accurate.

**Inspect the repository and report what actually exists.**

---

## 3. REQUIRED BRANCH

Create:

`chore/phase1-hardening-tests`

The branch must be created from the current `main`.

Do not work directly on `main`.

---

## 4. TEST RUNNER

Use:

`node --test`

Do not add Jest, Mocha, Tap, Vitest, or another testing framework unless an unexpected technical blocker makes Node's built-in runner genuinely unusable.

Keep the dependency footprint minimal.

Update `package.json` only as necessary to provide a clear test command, preferably:

`npm test`

---

## 5. AUDIT SCOPE

Inspect the current implementation, including at minimum:

* `package.json`
* server/application entry point
* registration API
* health endpoint
* registration-count endpoint
* public funnel/frontend files
* existing configuration
* existing tests, if any
* relevant environment handling
* data persistence behavior
* error handling
* request validation

Known API surface to verify against the actual repository:

* `POST /api/register`
* `GET /api/health`
* `GET /api/registrations/count`

Do not assume these routes are implemented exactly as previously reported. Verify the actual code.

---

## 6. TEST OBJECTIVES

Build a minimal but meaningful API test suite covering the core Phase 1 behavior.

At minimum, test:

### Health

* Health endpoint responds successfully.
* Response format is valid.
* No unintended dependency on production-only infrastructure exists.

### Registration

* Valid registration data is accepted.
* Required fields are enforced.
* Invalid/malformed requests are rejected appropriately.
* Registration persistence behaves correctly.
* Duplicate or repeated submissions behave according to the current intended contract.
* The API does not silently report success when persistence fails.

### Registration Count

* Count endpoint responds successfully.
* Count reflects persisted registrations.
* Test data remains isolated from production/user data.

### Error Handling

Verify appropriate behavior for:

* malformed JSON/request bodies
* missing required fields
* invalid input types
* persistence failures where practical
* unexpected server-side errors

### Regression Protection

Any bug discovered during testing that can be fixed safely and locally should receive a regression test.

---

## 7. TEST DATA ISOLATION

Tests must **not write to production data**.

Use an isolated temporary/test data directory or equivalent test-specific persistence mechanism.

Do not use real producer records.

Do not use production credentials.

Do not modify Railway environment variables.

Do not connect tests to a production database.

If the existing application architecture makes isolation difficult, document the limitation rather than bypassing the safety requirement.

---

## 8. SAFE-FIX POLICY

Code changes are permitted only when they are:

1. directly required to make the tested behavior correct,
2. small and localized,
3. clearly explainable,
4. covered by a test where appropriate,
5. unrelated to architectural refactoring.

Examples of acceptable fixes:

* incorrect HTTP status code
* missing validation
* incorrect response shape
* obvious count calculation bug
* test-environment persistence bug
* error handling that incorrectly reports success
* deterministic filesystem/data handling issue

Examples of changes that are **out of scope**:

* redesigning the application
* changing the funnel UX
* adding new product features
* changing branding
* replacing the server framework
* introducing a database migration
* changing authentication architecture
* changing Railway configuration
* broad refactoring
* performance optimization unrelated to observed failures

---

## 9. MEMO TRACEABILITY

Add this memo to the branch as:

`docs/COPILOT-TROUBLESHOOTING.md`

The document exists to preserve the execution directive and provide traceability for future engineering review.

Do not duplicate the entire memo into the commit message.

Use concise commit messages describing the actual implementation.

---

## 10. REQUIRED EXECUTION SEQUENCE

Follow this exact sequence:

### STEP 1 — Inspect

Inspect the current `main` branch and identify the actual implementation.

### STEP 2 — Establish Baseline

Run the application and determine whether the current implementation starts successfully.

### STEP 3 — Build Tests

Create the minimal Node test suite.

### STEP 4 — Reproduce

Run the tests against the baseline implementation.

Record every failure.

### STEP 5 — Diagnose

For every failure, identify:

* symptom
* root cause
* affected file
* severity
* proposed minimal correction

### STEP 6 — Correct

Apply only authorized minimal fixes.

### STEP 7 — Regression Test

Run the relevant test again.

### STEP 8 — Full Test

Run the complete suite.

### STEP 9 — Verify

Confirm:

* application starts
* tests pass
* no production data was touched
* no unrelated files were changed
* branch contains only intended work
* working tree is clean after commit

### STEP 10 — Push

Push:

`chore/phase1-hardening-tests`

to:

`AMP1779/AMP-MP-FUNNEL-1`

**STOP.**

Do not merge.

Do not deploy.

Do not open a production release.

---

## 11. REQUIRED FINAL REPORT

Return a concise but complete execution report containing:

### Repository

* repository
* starting commit
* branch created
* final commit

### Audit Findings

* what existed
* what worked
* what failed
* what was missing

### Tests

* number of tests
* number passed
* number failed
* number skipped, if any
* exact command used

### Bugs Found

For every bug:

* issue
* root cause
* fix
* regression test

### Files Changed

List every added, modified, or deleted file.

### Safety Verification

Confirm:

* no merge performed
* no Railway deployment performed
* no production database modified
* no production credentials used
* no unrelated refactoring performed

### GitHub

Provide the pushed branch and PR-ready status.

---

## 12. ACCEPTANCE CRITERIA

This assignment is complete only when:

* [ ] `chore/phase1-hardening-tests` exists.
* [ ] Branch originates from current `main`.
* [ ] `docs/COPILOT-TROUBLESHOOTING.md` exists.
* [ ] `node --test` is functioning.
* [ ] `npm test` executes the suite.
* [ ] Core API behavior has automated coverage.
* [ ] Test data is isolated.
* [ ] All discovered safe fixes are covered by regression tests where appropriate.
* [ ] Full test suite passes, or every remaining failure is documented with root cause and blocker.
* [ ] No production data was modified.
* [ ] No Railway deployment occurred.
* [ ] No merge occurred.
* [ ] Branch is pushed to GitHub.
* [ ] Final audit report is returned.

---

# FINAL COMMAND

**Execute the audit now.**

Do not speculate about repository state.

Do not skip testing because the implementation appears simple.

Do not expand scope.

**Inspect → Test → Reproduce → Diagnose → Minimal Fix → Regression Test → Full Test → Verify → Push Branch → Stop.**

AMP Executive Office / PMO
Timestamp: August 20, 2026 — 8:33 AM PDT

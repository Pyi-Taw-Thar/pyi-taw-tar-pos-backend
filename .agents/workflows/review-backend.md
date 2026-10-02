---
description: Review Express & Node.js backend code for layered architecture, async error handling, payload validation, and security vulnerabilities.
argument-hint: [file_path]
---

# Backend Code Review Workflow (`/review-backend`)

A dedicated workflow for auditing backend code changes against the project's Express and Node.js standards.

## Trigger & Usage

```text
/review-backend [file_path]
```

- **Arguments**: Path to a specific file (e.g., `src/controllers/order.controller.js`), a directory, or left blank to review all uncommitted git changes.
- **Rules to enforce**: Strict adherence to [`.agents/rules/express-nodejs.md`](../rules/express-nodejs.md).

---

## Review Execution Steps

### Step 1: Target Identification & Context Gathering
1. If a `file_path` is provided, read the full contents of the file and inspect related layered components (e.g., corresponding route, controller, or service).
2. If no argument is provided, identify changed files via `git diff --name-only HEAD` filtered to `src/**/*.js`.
3. Read and strictly apply rules from [`.agents/rules/express-nodejs.md`](../rules/express-nodejs.md).

### Step 2: Focus Areas Analysis

#### 1. Express Layered Architecture (Routes -> Controllers -> Services)
- **Routes (`src/routes/*.route.js`)**: Must only register endpoints, HTTP methods, and middleware stacks. Flag any inline business logic or database queries.
- **Controllers (`src/controllers/*.controller.js`)**: Must only parse requests (`req.params`, `req.query`, `req.body`), delegate work to services, and send HTTP responses. Flag direct Mongoose queries or schema mutations in controllers when business logic is present.
- **Services (`src/services/*.service.js`)**: Must encapsulate business logic and database operations. Must be decoupled from Express (`req`, `res` must not be passed into services).

#### 2. Async/Await Error Handling & Centralized Middleware
- Ensure all asynchronous controller handlers are wrapped with `asyncErrorHandler` or appropriately forward errors with `next(err)`.
- Verify operational errors use `CustomError(statusCode, message)`.
- Flag unhandled promise rejections, swallowed errors, and empty `catch` blocks.
- Ensure error formatting complies with centralized `error.controller.js`.

#### 3. API Payload Validation
- Check that incoming payloads (`req.body`, `req.query`, `req.params`) are strictly validated prior to hitting business logic.
- Look for schema validators (Zod/Joi) or robust custom validator middleware.
- Verify checks for required fields, data types, string bounds, and sanitization against NoSQL injection.

#### 4. Backend Security
- **Security Headers & CORS**: Verify Helmet configuration and restricted CORS origins (no wildcard `*` with credentials).
- **Password Security**: Enforce `bcrypt` password hashing with at least 10-12 salt rounds; ensure plain text passwords are never logged or returned (`select: false`).
- **Auth & Authorization**: Verify that endpoints requiring authentication use `protect` / `customerProtect` and role-based permissions (`permissionGranted`). Ensure `req.user` from verified token is used instead of client-supplied user IDs.
- **Rate Limiting**: Check that sensitive endpoints (auth, checkout, reset password) apply rate limiting.

---

## Output Format

The review report must be strictly formatted with the following 4 sections:

```markdown
# Backend Review: [file_path or Target]

## 1. Summary Verdict
- **Verdict**: [PASS | REQUEST CHANGES | BLOCK]
- **Risk Score**: [LOW | MEDIUM | HIGH | CRITICAL]
- **Overview**: 2-3 sentences summarizing the overall code quality, adherence to rules, and key concerns.

## 2. Critical Vulnerabilities
- **Vulnerability Title**: [Severity: CRITICAL | HIGH]
  - **Location**: `path/to/file.js:line_numbers`
  - **Issue**: Explanation of the security vulnerability or bug (e.g., auth bypass, unhashed password, unhandled rejection).
  - **Impact**: Real-world consequence if deployed to production.

*(If none found, state: "No critical vulnerabilities detected.")*

## 3. Architecture Drift
- **Drift Item**: [Severity: HIGH | MEDIUM | LOW]
  - **Location**: `path/to/file.js:line_numbers`
  - **Violation**: Detail how the code deviates from the Route -> Controller -> Service pattern (e.g., direct DB query in route/controller, `req` object passed into service).
  - **Correction**: Required architectural boundary fix.

*(If none found, state: "Architecture conforms strictly to layered standards.")*

## 4. Ready-to-Apply Refactored Code Blocks
Provide complete, drop-in replacement code blocks for all flagged issues.

### Refactored `path/to/file.js`
```javascript
// Drop-in replacement code with proper error handling, layered separation, validation, and security
```
```

---

## Verdict Guidelines

| Verdict | Criteria | Action |
|---|---|---|
| **BLOCK** | Any CRITICAL vulnerability (auth bypass, unhashed password, injection, secret leak) | Immediate fix required before merging or deploying |
| **REQUEST CHANGES** | Architecture drift, missing async error handlers, missing payload validation | Must refactor to conform to standards |
| **PASS** | Clean layered architecture, comprehensive validation, secure patterns, robust error handling | Approved for deployment |

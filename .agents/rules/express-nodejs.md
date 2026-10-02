---
paths:
  - "src/**/*.js"
  - "src/**/*.ts"
---
# Express & Node.js Backend Rules

This document establishes the architecture, error handling, validation, and security standards for Express.js and Node.js backend development in this codebase.

---

## 1. Layered Architecture (Routes -> Controllers -> Services)

Strict separation of concerns across application layers is mandatory:

### 1.1 Routes (`src/routes/*.route.js`)
- **Single Responsibility**: Define HTTP methods, paths, and middleware chains (authentication, authorization, rate limiting, request validation).
- **No Business Logic**: Routes must NEVER contain business logic, database queries, or data transformations.
- **Route Definitions**: Directly map endpoints to controller methods.

```javascript
// CORRECT: Clean route definition with middleware chain
router.post(
  "/admin/signup",
  protect,
  permissionGranted("owner", "admin"),
  validateSignupPayload,
  signup
);

// WRONG: Inline business logic or database queries in routes
router.post("/admin/signup", async (req, res) => {
  const user = await Admin.create(req.body); // VIOLATION
  res.json(user);
});
```

### 1.2 Controllers (`src/controllers/*.controller.js`)
- **Single Responsibility**: Handle HTTP requests and responses only.
- **Input Extraction**: Extract and validate input from `req.params`, `req.query`, and `req.body`.
- **Delegation**: Delegate business logic, transactions, and persistence to Services.
- **Response Formatting**: Return standardized JSON responses (`status`, `success`, `data`, `message`).
- **No Direct DB Querying**: Controllers must not invoke Mongoose models directly when business logic is involved.

```javascript
// CORRECT: Controller delegating to service
export const signup = asyncErrorHandler(async (req, res, next) => {
  const newUser = await adminService.createAdminUser(req.body, req.user);
  res.status(201).json({
    success: true,
    data: newUser,
    message: "Admin created successfully"
  });
});
```

### 1.3 Services (`src/services/*.service.js`)
- **Single Responsibility**: Encapsulate all business logic, database operations (Mongoose models), data transformation, audit logging, and external integrations.
- **Decoupled from HTTP**: Services must NOT accept `req` or `res` objects. Pass only required primitive values or data transfer objects.
- **Audit & Activity Logging**: Invoke audit logs (`stockAuditLog.service.js`, `activityLog.service.js`) from services when state changes occur.

---

## 2. Async/Await Error Handling & Centralized Middleware

### 2.1 Async Wrapping
- Every asynchronous route handler and middleware must be wrapped with `asyncErrorHandler` or properly catch errors to pass to `next(err)`.
- Never leave an async promise unhandled or swallow errors with empty `catch` blocks.

```javascript
// CORRECT: Using asyncErrorHandler
export const getAccountById = asyncErrorHandler(async (req, res, next) => {
  const account = await adminService.findById(req.params.accountId);
  if (!account) {
    throw new CustomError(404, "Account not found");
  }
  res.status(200).json({ success: true, data: account });
});
```

### 2.2 Operational Errors via `CustomError`
- Use `CustomError(statusCode, message)` for operational and client errors (e.g., 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict).
- Centralized error handler (`src/controllers/error.controller.js`) handles formatting and environment-specific responses (`devErrors` vs production).

---

## 3. API Payload Validation

### 3.1 Strict Input Validation
- Validate all incoming payloads (`req.body`, `req.query`, `req.params`) before reaching controllers or services.
- Use schema validators (Zod, Joi) or robust custom validator middlewares.
- Verify:
  - Required fields and unexpected/extraneous fields.
  - Data types, string lengths, numeric ranges, and regex formats (e.g., email, phone number).
  - Safe IDs (e.g., valid MongoDB ObjectIds).

```javascript
// CORRECT: Validation middleware before controller
export const validateCreateUser = (req, res, next) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return next(new CustomError(400, "Name, email, and password are required."));
  }
  if (password.length < 6) {
    return next(new CustomError(400, "Password must be at least 6 characters."));
  }
  next();
};
```

### 3.2 Sanitize Inputs
- Protect against NoSQL injection: ensure untrusted keys or `$where`/`$gt` operators cannot be passed directly into Mongoose queries.

---

## 4. Backend Security Standards

### 4.1 Helmet & Security Headers
- Helmet must be loaded early in `app.js` with appropriate CSP, referrer-policy, and cross-origin resource policy configurations.

### 4.2 CORS Configuration
- Do NOT use wildcard `*` origin in production when credentials/cookies/tokens are involved.
- Maintain an explicit allowlist of authorized frontend domains in `cors.config.js`.

### 4.3 Password Hashing with Bcrypt
- Never store or log plain text passwords.
- Always hash passwords using `bcrypt.hash(password, 12)` (minimum 10-12 salt rounds).
- Compare passwords using `bcrypt.compare`.
- Exclude password fields from query results (`select: false` in Mongoose schema or delete before sending response).

### 4.4 Authentication & Authorization
- Protect private endpoints with `protect` (admin/staff) or `customerProtect` (customers).
- Enforce role-based access control with `permissionGranted("owner", "admin")`.
- Verify JWT expiration and signature integrity.
- Never trust user identity from request bodies; extract `userId` and `role` strictly from verified JWT in `req.user`.

### 4.5 Rate Limiting
- Apply rate limiting (`apiRateLimiter`) globally and apply stricter limits on sensitive endpoints (e.g., login, password reset).

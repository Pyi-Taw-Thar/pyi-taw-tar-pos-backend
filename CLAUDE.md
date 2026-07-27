# Backend API — CLAUDE.md

## 📋 အလုပ်လုပ်ရမည့် စည်းမျဉ်းများ (Strict Workflow Rules)

အောက်ပါစည်းမျဉ်းများကို **မဖြစ်မနေ** လိုက်နာရမည်။

### ၁. ဘာသာစကားသတ်မှတ်ချက် (Language Requirement)
- **All responses, status updates, implementation plans, and code comments MUST be written in Myanmar Language (မြန်မာဘာသာ).**
- English may only be used for: code itself, technical terms, and direct quotes from existing documentation.

### ၂. Plan First Principle
- **NEVER write or modify code directly** without first creating an implementation plan.
- When asked to make changes: draft a detailed Implementation Plan in Myanmar Language → show user → wait for approval.

### ၃. Auto-Save Plan Files
- Save plans in `backend/plans/` folder.
- Format: `YYYY-MM-DD-short-description-plan.md`
- Example: `2026-07-27-add-product-api-plan.md`

### ၄. Wait for Explicit Approval
- Present the plan in Myanmar Language.
- **DO NOT** modify any files until the user explicitly says "OK", "Go ahead", "လုပ်ပါ", or equivalent.

---

## 🚀 Quick Start

```bash
npm install           # Install dependencies
npm run dev           # Development mode (nodemon, port 5000)
npm start             # Production mode (PM2)
node createAdmin.js   # Seed owner account (name=owner, pw=123456)
```

- No build step, no tests, no lint, no typecheck.
- ES Modules everywhere (`"type": "module"`).

---

## 🏗️ Architecture

```
src/
├── server.js              # Entry point — DB connect + listen
├── app.js                 # Express setup + route mounting (/api/v1)
├── configs/
│   ├── db.config.js       # MongoDB connection + index management
│   ├── cors.config.js     # CORS config (currently wildcard *)
│   ├── cloudflareR2.config.js  # Cloudflare R2 (S3-compatible) upload/delete
│   ├── doSpaces.config.js      # Legacy DO Spaces (not actively used)
│   └── timezoneConvertor.config.js  # MMT timezone middleware
├── controllers/           # 24 request handlers (one per route file)
├── models/                # 20+ Mongoose schemas
├── routes/                # 24 route files, all under /api/v1
├── services/
│   ├── jwtToken.service.js    # JWT signing
│   ├── activityLog.service.js # User action logging
│   ├── stockAuditLog.service.js # Stock change audit (before/after)
│   ├── openrouter.service.js  # AI Chatbot (Gemini via OpenRouter)
│   └── customerTier.service.js # Tier multiplier logic
├── middlewares/
│   ├── customerAuth.js           # Customer JWT verification
│   ├── rateLimiter.middleware.js # 60 req/min per IP
│   └── multerImageupload.middleware.js
├── utils/
│   ├── asyncErrorHandler.js # Async controller wrapper
│   ├── customError.js       # Custom error class
│   ├── dateFilter.utils.js  # Date range query builder
│   └── phoneValidation.utils.js
├── constants/
│   └── customerTiers.js     # standard/silver/gold/platinum
api/
└── index.js               # Vercel serverless wrapper
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules) |
| Framework | Express v5 (`^5.1.0`) |
| Database | MongoDB via Mongoose v9 (`^9.0.0`) |
| Auth | JWT (jsonwebtoken v9) + bcryptjs |
| File Storage | Cloudflare R2 (AWS SDK v3) |
| AI Chatbot | OpenRouter → Gemini 2.5 Flash |
| Validation | Mongoose + Zod (listed) |
| Other | multer, xlsx, helmet, express-rate-limit, moment-timezone |

## 🗄️ Database Models

### Core Business Models
| Model | File | Purpose |
|---|---|---|
| **Inventory** | `models/inventory.model.js` | Products with UOM, wholesale pricing, images |
| **Order** | `models/orders.model.js` | Sales orders with ACID transactions |
| **Purchasing** | `models/purchasing.model.js` | Purchase orders (PO) |
| **GoodsReceivedNote** | `models/goodsRecievedNote.model.js` | GRN with good/bad quantity support |
| **Transfer** | `models/transfer.model.js` | Stock movement between locations |

### Location & Stock Models
| Model | File | Purpose |
|---|---|---|
| **LocationProfile** | `models/locationProfile.model.js` | Warehouse/Storefront profiles |
| **StorefrontInventory** | `models/storefrontInventory.model.js` | Per-storefront stock tracking |
| **WarehouseStock** | `models/warehouse.model.js` | Warehouse stock tracking |

### User & Auth Models
| Model | File | Purpose |
|---|---|---|
| **Admin** | `models/admin.model.js` | Internal staff accounts (owner/admin/cashier) |
| **Customer** | `models/customer.model.js` | Customer accounts with tier system |
| **CreditPerson** | `models/creditPersona.model.js` | Credit sales persons |
| **CreditRecord** | `models/creditRecord.model.js` | Credit payment records |

### Supporting Models
| Model | File | Purpose |
|---|---|---|
| SupplierProfile, EcommerceOrder, Quotation, Expense, ShopSetting, ActivityLog, StockAuditLog, ChatSession, PurchaseReset, SupplierCreditPayment | Various | Supporting business entities |

---

## 🌐 API Routes (all under `/api/v1`)

### Inventory & Stock
| Method | Route | Description |
|---|---|---|
| CRUD | `/inventory` | Product management with image upload to R2 |
| POST | `/inventory/import-excel` | Bulk product import from `.xlsx` |
| GET | `/inventory/categories` | List all product categories |

### Orders
| Method | Route | Description |
|---|---|---|
| POST | `/order` | Create order (storefront/direct-sale) |
| GET | `/order` | List all orders with filters |
| GET | `/order/:orderId` | Get single order |
| PATCH | `/order/:orderId/credit-person` | Assign credit person |
| PATCH | `/order/:orderId/paid-amount` | Update paid amount |
| PATCH | `/order/:orderId/items/add` | Add items to completed order |
| PATCH | `/order/:orderId/items/remove` | Remove items from order |
| DELETE | `/order/:orderId` | Hard delete (empty orders only) |

### Purchasing & GRN
| Method | Route | Description |
|---|---|---|
| CRUD | `/purchasing` | Purchase order management |
| CRUD | `/grn` | Goods received notes (partial receiving supported) |
| CRUD | `/transfer` | Stock transfers (GRN→WH, WH→SF, SF→WH) |

### Reports
| Method | Route | Description |
|---|---|---|
| GET | `/sale-report` | Sales analytics |
| GET | `/purchase-report` | Purchase analytics |
| GET | `/credit-orders-report` | Credit orders report |
| GET | `/foc-orders` | FOC orders report |

### Auth
| Method | Route | Description |
|---|---|---|
| POST | `/admin/login` | Admin login |
| POST | `/admin/signup` | Create admin account (owner role) |
| POST | `/customer/login` | Customer login |
| POST | `/customer/register` | Customer registration |

### Ecommerce (Customer-facing)
| Method | Route | Description |
|---|---|---|
| GET | `/ecommerce/products/brands` | List brands |
| GET | `/ecommerce/products/categories` | List categories by brand |
| GET | `/ecommerce/products` | List products by brand + category |
| POST | `/ecommerce/order` | Place order (JWT protected) |

### Other
| Method | Route | Description |
|---|---|---|
| CRUD | `/supplier-profile`, `/warehouse`, `/storefront`, `/expense` | Supplier, warehouse, storefront, expense management |
| CRUD | `/shop-setting`, `/activity-log`, `/stock-audit-log` | Settings and audit trails |
| POST | `/chatbot` | AI Assistant (Gemini, Burmese) |

---

## 🔐 Authentication & Authorization

### Two Auth Layers
1. **Admin Auth** (`protect` middleware) — JWT with roles: `owner`, `admin`, `cashier`
2. **Customer Auth** (`customerProtect` middleware) — JWT for ecommerce customers

### Role Permissions
| Role | Permissions |
|---|---|
| **owner** | Full access — all endpoints, account management, paid amount updates |
| **admin** | Most operations except owner-specific (accounts, paid amount) |
| **cashier** | Order creation and basic view operations |

### Key Auth Details
- JWT expires in 30 days (configurable via `JWT_EXPIRES_IN`)
- Token format: `Authorization: Bearer <token>`
- Rate limit: 60 requests/minute per IP
- CORS: Currently allows all origins (`*`)

---

## 📐 Key Business Patterns

| Pattern | Description |
|---|---|
| **MVC Architecture** | Models (schemas) → Controllers (handlers) → Routes (endpoints) |
| **MongoDB Transactions** | All mutating operations use `session.withTransaction()` for ACID |
| **Sequential Numbering** | `ORD-YYYY-MM-DD-NNNNNN`, `PO-YYYY-MM-DD-NNNNNN`, `GRN-YYYY-MM-DD-NNNNNN`, `TRF-YYYY-NNNN` |
| **Partial GRN** | Unique index on `purchasingId` deliberately dropped at startup — multiple GRNs per PO |
| **UOM Conversion** | Base unit + conversion factors; stock tracked in base units |
| **Wholesale Pricing** | Price tiers by quantity threshold; auto-select best match |
| **Soft Delete** | `isDeleted` + `deletedAt` on most entities with restore endpoints |
| **Dual Audit** | `activityLog` (user actions) + `stockAuditLog` (stock before/after) |
| **Timezone** | UTC storage → MMT (Asia/Yangon) on GET response via middleware |
| **Order Retry** | 3 attempts with exponential backoff for duplicate order number race conditions |

---

## 📁 Rules & Plans

- **Coding rules & patterns:** `backend/rules/`
- **Implementation plans:** `backend/plans/`

---

## ☁️ Deployment

| Platform | Method |
|---|---|
| **Vercel** | Serverless via `api/index.js` with DB connection caching |
| **DigitalOcean** | PM2 + Nginx reverse proxy + Let's Encrypt SSL |
| **Storage** | Cloudflare R2 (primary), legacy DO Spaces in config |

# Merge CreditPerson into Customer — Implementation Plan

## Context

လက်ရှိတွင် **Customer** နဲ့ **CreditPerson** က separate models (၂) ခု ဖြစ်နေပြီး ဆက်စပ်မှုမရှိပါ။ Customer က ecommerce အတွက် login ဝင်ပြီး ပစ္စည်းမှာဖို့ဖြစ်ပြီး CreditPerson က dashboard POS မှာ credit order မှတ်ဖို့ဖြစ်ပါတယ်။ ဒီနှစ်ခုကို **Customer model တစ်ခုတည်းထဲ** ပေါင်းပြီး နောက်ပိုင်း data sync ပြဿနာမရှိအောင်၊ report ဆွဲရတာလွယ်အောင် ပြုပြင်မည်။

## Strategy: Backward-Compatible API

Frontend ကို အနည်းဆုံးပြောင်းရအောင် **API interface ကို မပြောင်းဘဲ** backend အတွင်းပိုင်းကိုပဲ ပြောင်းမည်။

- Frontend က `/credit-persona` endpoints ကို **အရင်အတိုင်းဆက်ခေါ်နိုင်**တယ်
- API response shape က **အတူတူပဲ** (`{_id, name, phone, blacklist, ...}`)
- Backend controller တွေက Customer model ကို သုံးအောင်ပြောင်းမယ်
- Order/ CreditRecord model က `creditPersonId` ref ကို "Customer" ကိုပြောင်းမယ်

---

## Phase 1: Backend Model Changes

### 1.1 Customer Model — `backend/src/models/customer.model.js`

Credit fields (၄) ခု ထည့်မယ်:
```javascript
// အသစ်ထည့်မယ့် fields
isCreditPerson: { type: Boolean, default: false },
blacklist: { type: Boolean, default: false },
blacklistReason: { type: String, default: null },
blacklistDate: { type: Date, default: null },
```

### 1.2 Order Model — `backend/src/models/orders.model.js`

`creditPersonId` ref ကို ပြောင်းမယ်:
```javascript
// အဟောင်း
creditPersonId: { type: ObjectId, ref: "CreditPerson", default: null }
// အသစ်
creditPersonId: { type: ObjectId, ref: "Customer", default: null }
```

### 1.3 CreditRecord Model — `backend/src/models/creditRecord.model.js`

`creditPersonId` ref ကို ပြောင်းမယ်:
```javascript
// အဟောင်း
creditPersonId: { type: ObjectId, ref: "CreditPerson", default: null }
// အသစ်
creditPersonId: { type: ObjectId, ref: "Customer", default: null }
```

### 1.4 CreditPersona Model — `backend/src/models/creditPersona.model.js`

**မဖျက်သေးဘူး** — Phase 4 မှ migration အပြီးမှ ဖျက်မယ်။ အခုအဆင့်မှာ ဒီအတိုင်းထားမယ်။

---

## Phase 2: Backend Controller Changes

### 2.1 CreditPersona Controller — `backend/src/controllers/creditPersona.controller.js`

API interface ကို မပြောင်းဘဲ Customer model ကိုသုံးအောင် ပြောင်းမယ်။

| Function | လက်ရှိ | အသစ် |
|---|---|---|
| `createCreditPerson` | `CreditPerson.create({name, phone})` | Customer တစ်ခုရှာမယ်/ဖန်တီးမယ် → `isCreditPerson: true` |
| `getAllCreditPersons` | `CreditPerson.find()` | `Customer.find({ isCreditPerson: true })` |
| `getCreditPersonById` | `CreditPerson.findById(id)` | `Customer.findById(id)` |
| `updateCreditPerson` | `CreditPerson.findByIdAndUpdate(id, {name, phone})` | `Customer.findByIdAndUpdate(id, {...})` |

Response shape က **အတူတူပဲ**ဖြစ်အောင်ထားမယ် (frontend မပြောင်းရအောင်):
```javascript
// Response က ဒီအတိုင်းပဲ
{
  _id: "xxx",
  name: "Maung Maung",
  phone: "0912345678",
  blacklist: false,
  blacklistReason: null,
  blacklistDate: null,
  createdAt: "2026-...",
  updatedAt: "2026-..."
}
```

### 2.2 Order Controller — `backend/src/controllers/order.controller.js`

(၃) နေရာပြောင်းမယ်:

| Line | လက်ရှိ | အသစ် |
|---|---|---|
| 6 | `import CreditPerson from "../models/creditPersona.model.js"` | `import Customer from "../models/customer.model.js"` |
| 206 | `await CreditPerson.findById(creditPersonId)` | `await Customer.findById(creditPersonId)` |
| 634 | `.populate("creditPersonId", "name phone")` | `.populate("creditPersonId", "name phone isCreditPerson blacklist")` |
| 660 | `.populate("creditPersonId", "name phone")` | `.populate("creditPersonId", "name phone isCreditPerson blacklist")` |
| 721 | `await CreditPerson.findById(creditPersonId)` | `await Customer.findById(creditPersonId)` |
| 743 | `.populate("creditPersonId", "name phone")` | `.populate("creditPersonId", "name phone")` |

### 2.3 SaleReport Controller — `backend/src/controllers/saleReport.controller.js`

| Line | လက်ရှိ | အသစ် |
|---|---|---|
| 7 | `import CreditPerson from "../models/creditPersona.model.js"` | `import Customer from "../models/customer.model.js"` |
| 922 | `await CreditPerson.findOne({ _id: creditPersonaId })` | `await Customer.findOne({ _id: creditPersonaId, isCreditPerson: true })` |
| 1275 | `await CreditPerson.find({ _id: { $in: ... } })` | `await Customer.find({ _id: { $in: ... } })` |

### 2.4 CreditRecord Controller — `backend/src/controllers/creditRecord.controller.js`

| Line | လက်ရှိ | အသစ် |
|---|---|---|
| 409 | `const CreditPerson = mongoose.model("CreditPerson")` | `const Customer = mongoose.model("Customer")` |
| 410 | `await CreditPerson.findById(creditPersonId)` | `await Customer.findById(creditPersonId)` |

### 2.5 Customer Controller — `backend/src/controllers/customer.controller.js`

Credit person management functions အသစ် (၂) ခု ထည့်မယ်:
- `toggleCreditPersonStatus` — Customer ကို credit person အဖြစ် ဖွင့်/ပိတ်
- `updateCreditPersonBlacklist` — Blacklist သတ်မှတ်ရန်
- `getCreditPersonCustomers` — Credit person တွေကို စာရင်းပြန်ပေးရန် (admin အတွက်)

---

## Phase 3: Backend Route Changes

### 3.1 Customer Route — `backend/src/routes/customer.route.js`

Route အသစ် (၃) ခု ထည့်မယ်:
```javascript
// Credit person management (admin/owner only)
router.patch("/customer/:id/toggle-credit", protect, permissionGranted("owner", "admin"), toggleCreditPersonStatus);
router.patch("/customer/:id/blacklist", protect, permissionGranted("owner", "admin"), updateCreditPersonBlacklist);
router.get("/customer/credit-persons", protect, permissionGranted("owner", "admin", "cashier"), getCreditPersonCustomers);
```

### 3.2 CreditPersona Route — `backend/src/routes/creditPersona.route.js`

**API interface ကို မပြောင်းဘူး** — Frontend က အရင်အတိုင်းဆက်ခေါ်နိုင်တယ်။ Controller ကပဲ Customer ကို သုံးအောင်ပြောင်းထားမယ်။

---

## Phase 4: Frontend Changes

### 4.1 Customers Page — `dashboard/pages/Customers.tsx`

Customer Table မှာ "Make Credit Person" toggle button ထည့်မယ်:
- Customer row တစ်ခုချင်းစီမှာ toggle button
- နှိပ်လိုက်ရင် `PATCH /customer/:id/toggle-credit` ကိုခေါ်မယ်
- Active/Inactive badge ပြမယ်

### 4.2 Customer Service — Service အသစ်ထည့်မယ်
```javascript
// services/Customer/toggleCreditPerson.ts
export const toggleCreditPerson = async (customerId) => {
  return axios.patch(`/customer/${customerId}/toggle-credit`);
};
```

---

## Phase 5: Data Migration

ရှိပြီးသား CreditPerson record တွေကို Customer collection ထဲကို ပြောင်းမယ်။

Migration script — `backend/scripts/migrate-credit-persons.js`:
```javascript
// 1. CreditPerson collection က record တွေကို ဖတ်မယ်
// 2. တူညီတဲ့ phone ရှိတဲ့ Customer ရှိမရှိစစ်မယ်
// 3. Customer ရှိရင် → credit fields တွေကို update လုပ်မယ်
// 4. Customer မရှိရင် → Customer record အသစ်ဖန်တီးပြီး credit fields ထည့်မယ်
// 5. အကုန်အဆင်ပြေမှ CreditPerson model/data ကို ဖျက်မယ်
```

---

## File Summary

### Backend (၁၀) ဖိုင်
| File | Type | ပြင်ရမယ့်အကြောင်း |
|---|---|---|
| `backend/src/models/customer.model.js` | Model | credit fields (၄) ခု ထည့်မယ် |
| `backend/src/models/orders.model.js` | Model | ref "CreditPerson" → "Customer" |
| `backend/src/models/creditRecord.model.js` | Model | ref "CreditPerson" → "Customer" |
| `backend/src/controllers/creditPersona.controller.js` | Controller | Customer model သုံးအောင်ပြောင်း |
| `backend/src/controllers/order.controller.js` | Controller | CreditPerson → Customer (၆) နေရာ |
| `backend/src/controllers/saleReport.controller.js` | Controller | CreditPerson → Customer (၃) နေရာ |
| `backend/src/controllers/creditRecord.controller.js` | Controller | CreditPerson → Customer (၂) နေရာ |
| `backend/src/controllers/customer.controller.js` | Controller | credit person functions အသစ် (၃) ခု |
| `backend/src/routes/customer.route.js` | Route | credit person routes အသစ် (၃) ခု |
| `backend/scripts/migrate-credit-persons.js` | Script | Data migration script |

### Frontend (၂) ဖိုင်
| File | Type | ပြင်ရမယ့်အကြောင်း |
|---|---|---|
| `dashboard/pages/Customers.tsx` | Page | "Make Credit Person" toggle button ထည့်မယ် |
| `dashboard/services/Customer/` | Service | toggleCreditPerson.ts service အသစ် |

---

## Verification

အကောင်အထည်ဖော်ပြီးနောက် အောက်ပါအတိုင်း စစ်ဆေးမည်။

### Backend Test
```bash
# 1. Customer တစ်ယောက်ကို credit person ဖြစ်အောင်လုပ်မယ်
PATCH /api/v1/customer/:id/toggle-credit
→ Response: { success: true, data: { ..., isCreditPerson: true } }

# 2. Credit person list ကိုကြည့်မယ် (API interface အတူတူ)
GET /api/v1/credit-persona
→ Response: { success: true, data: [{ _id, name, phone, blacklist, ... }] }

# 3. Credit person အသစ်ဖန်တီးမယ် (API interface အတူတူ)
POST /api/v1/credit-persona
Body: { name: "Test", phone: "09123" }
→ Response: { success: true, data: { ... } }

# 4. Credit order လုပ်မယ် (creditPersonId က Customer ကိုညွှန်း)
POST /api/v1/order
Body: { ..., paymentType: "credit", creditPersonId: "customerId" }
→ Response: { success: true, data: { ... } }

# 5. Blacklist လုပ်မယ်
PATCH /api/v1/customer/:id/blacklist
Body: { blacklist: true, blacklistReason: "Overdue payment" }
→ Credit order ထပ်မလုပ်နိုင်တော့

# 6. Migration script စစ်ဆေး
node backend/scripts/migrate-credit-persons.js
→ CreditPerson record တွေ Customer ထဲကို ရောက်သွားမယ်
```

### Frontend Test
```bash
npm run dev  # Root ကနေ backend + dashboard တစ်ပြိုင်နက်
```
1. Dashboard → Customers page → "Make Credit Person" button မြင်ရမယ်
2. Dashboard → Credits page → အရင်အတိုင်းအလုပ်လုပ်နေမယ်
3. Dashboard → POS → credit order လုပ်လို့ရမယ်
4. Ecommerce app → login → order မှာလို့ရနေမယ် (မထိခိုက်ဘူး)

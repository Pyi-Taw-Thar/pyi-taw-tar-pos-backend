# ယနေ့ လုပ်ဆောင်ခဲ့သည့် အလုပ်အားလုံး အနှစ်ချုပ် အစီရင်ခံစာ (Daily Summary Report)

**ရက်စွဲ:** 2026-10-28  
**Project:** Pyi-Taw-Tar Monorepo (`backend/`, `dashboard/`, `ecommerce/`)

---

## ၁။ ပြီးစီးခဲ့သည့် အလုပ် (၄) ခု အနှစ်ချုပ်

| အဆင့် | အလုပ်ခေါင်းစဉ် | အဓိက ပြင်ဆင်ချက် | စစ်ဆေးမှု ရလဒ် | အသေးစိတ် Report ဖိုင် |
|---|---|---|---|---|
| **၁** | **Phase A — Backend Rate Limiter (3-Tier) ပြင်ဆင်ခြင်း** | IP တစ်ခု 60/min အစား ၃ မျိုးခွဲခြင်း —<br>• `authLimiter`: IP `10 / 15 min` (`skipSuccessfulRequests: true`)<br>• `apiLimiter` (JWT `role:id`): Staff `600/min`, Customer `120/min`<br>• Public / Invalid JWT fallback: IP `300/min` | **L-1 မှ L-8 အားလုံး PASS** (Wi-Fi IP တူသော်လည်း Staff/Customer တစ်ဦးချင်း သီးခြားစီ ရေတွက်ကြောင်း အတည်ပြုပြီး) | [`backend/plans/2026-10-28-rate-limiter-report.md`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/plans/2026-10-28-rate-limiter-report.md) |
| **၂** | **Dashboard 429 Retry & CORS Fix** | • [`axios.ts`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/dashboard/services/axios.ts) တွင် `MAX_RETRY_WAIT_MS = 10000` (10s ထက်ကျော်ပါက retry မလုပ်ဘဲ ချက်ချင်း reject) နှင့် `/admin/login` ကို 429 တွင် လုံးဝ retry မလုပ်ရန် ပြင်ဆင်ခြင်း<br>• [`Login.tsx`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/dashboard/pages/Login.tsx) တွင် 429 အတွက် မြန်မာ/English ဘာသာပြန် message ထည့်ခြင်း<br>• [`cors.config.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/configs/cors.config.js) တွင် `Retry-After`, `RateLimit`, `RateLimit-Policy` တို့ကို `exposedHeaders` ထဲ ထည့်ခြင်း | **R-1 မှ R-6 အားလုံး PASS** (Login 429 တွင် `<1s` အတွင်း error message ချက်ချင်းပြပြီး ၁၅ မိနစ် စောင့်နေခြင်း မရှိတော့ပါ) | [`dashboard/plans/2026-10-28-rate-limit-retry-fix-report.md`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/dashboard/plans/2026-10-28-rate-limit-retry-fix-report.md) |
| **၃** | **Phase B — Backend Load Test (T-1 မှ T-6)** | Local MongoDB (`rs0`) + Temp Backend (`PORT=5055`) + `npx autocannon` ဖြင့် Read/Write/Mixed endpoint များကို စမ်းသပ်ခြင်း | • Read (T-1..T-3): **0% Error**, `305–634 req/s`, `p95 < 290ms`<br>• POS Stock (T-4): `~70 req/s`, `c=25–28` အထိ `p95 < 500ms`<br>• Write (T-5 `POST /ecommerce/order`): Stock Oversell **0** ဖြစ်သော်လည်း Concurrent order များတွင် `500 WriteConflict` (`55%–83%`) တွေ့ရှိခဲ့သည် | [`backend/plans/2026-10-28-load-test-report.md`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/plans/2026-10-28-load-test-report.md) |
| **၄** | **Ecommerce Order Concurrency (`WriteConflict` / `E11000`) Fix** | • [`counter.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/counter.model.js) အသစ်ဆောက်ပြီး [`ecommerceOrder.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/ecommerceOrder.model.js) `pre("save")` တွင် atomic `$inc` (session အပြင်) + ရှိပြီးသား order အတွက် `$max` သုံးခြင်း<br>• [`ecommerce.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/ecommerce.controller.js) `createOrder` တွင် `session.withTransaction()` + `E11000` ၃ ကြိမ် retry + 409 fallback သုံးခြင်း | **O-1 မှ O-8 အားလုံး PASS**<br>• `c=5` နှင့် `c=20` နှစ်ခုလုံးတွင် **Error `55%–83%` → `0.00%`** (`500` count = `0`)<br>• Committed order rate: **`25.7/s` → `127.7/s` (+397%)**<br>• Duplicate `orderNumber` = `0`, Oversell = `0` | [`backend/plans/2026-10-28-ecommerce-order-concurrency-fix-report.md`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/plans/2026-10-28-ecommerce-order-concurrency-fix-report.md) |

---

## ၂။ ပြင်ဆင်/ဖန်တီးခဲ့သော Code ဖိုင်စာရင်း

### Backend (`backend/`)
- [`src/middlewares/rateLimiter.middleware.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/middlewares/rateLimiter.middleware.js) — `authLimiter` (IP 10/15min) နှင့် `apiLimiter` (JWT `role:id` staff 600/min, customer 120/min, public IP 300/min)
- [`src/app.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/app.js) — `/api/v1` တွင် `apiLimiter` သုံးခြင်း
- [`src/routes/admin.route.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/routes/admin.route.js) & [`src/routes/customer.route.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/routes/customer.route.js) — Login/Register တွင် `authLimiter` တပ်ဆင်ခြင်း
- [`src/configs/cors.config.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/configs/cors.config.js) — `exposedHeaders` တွင် `"Retry-After"`, `"RateLimit"`, `"RateLimit-Policy"` ထည့်သွင်းခြင်း
- [`src/models/counter.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/counter.model.js) *(အသစ်)* — နေ့စဉ် `ECO-YYYY-MM-DD` atomic sequence counter model
- [`src/models/ecommerceOrder.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/ecommerceOrder.model.js) — `pre("save")` တွင် atomic `Counter` (`$max` init + `$inc`) သုံးခြင်း
- [`src/controllers/ecommerce.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/ecommerce.controller.js) — `createOrder` တွင် `session.withTransaction()` + `E11000` retry (3 attempts) + 409 response

### Dashboard (`dashboard/`)
- [`services/axios.ts`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/dashboard/services/axios.ts) — 429 retry တွင် `MAX_RETRY_WAIT_MS = 10000` ကန့်သတ်ချက်နှင့် `/admin/login` skip လုပ်ခြင်း
- [`pages/Login.tsx`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/dashboard/pages/Login.tsx), [`translations/my.ts`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/dashboard/translations/my.ts), [`translations/en.ts`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/dashboard/translations/en.ts) — Login 429 တွင် `login.tooManyAttempts` message ပြသခြင်း

---

## ၃။ Railway Deploy ပြီးနောက် စစ်ဆေးရန် ကျန်ရှိသည့်အချက် (User လုပ်ဆောင်ရန်)
1. Railway Variables တွင် လိုအပ်ပါက `RATE_LIMIT_STAFF_MAX`, `RATE_LIMIT_CUSTOMER_MAX`, `RATE_LIMIT_PUBLIC_MAX`, `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MIN` တို့ကို ထည့်သွင်းနိုင်သည် (မထည့်ပါက default 600 / 120 / 300 / 10 per 15min အတိုင်း အလုပ်လုပ်မည်)။
2. **L-9 (Production တွင် ဖတ်ရုံသာ စစ်ဆေးခြင်း):** Deploy ပြီးနောက် မတူညီသော Network ၂ ခု (Wi-Fi နှင့် Mobile Data) မှ `GET /api/v1/ecommerce/products` ကို ၃–၅ ကြိမ်စီ ခေါ်၍ `RateLimit` header ၏ `remaining` တန်ဖိုး သီးခြားစီ လျော့ကြောင်း အတည်ပြုရန်။

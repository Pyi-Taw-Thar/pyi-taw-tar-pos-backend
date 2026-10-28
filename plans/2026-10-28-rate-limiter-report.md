# Phase A Report — Rate Limiter အဆင့် ၃ ဆင့် ပြင်ဆင်မှုနှင့် Local စစ်ဆေးချက်

- **ရက်စွဲ:** 2026-10-28
- **အခြေအနေ:** ✅ Phase A ပြီးစီး (Phase B Load Test အတွက် ခွင့်ပြုချက် စောင့်ဆိုင်းဆဲ)
- **စစ်ဆေးသည့် ပတ်ဝန်းကျင်:** Local MongoDB (`127.0.0.1:27018/limitertest`, replicaSet `rs0`) + Local Temp Backend (`PORT=5055`) — Production Atlas / Railway ကို လုံးဝ မထိပါ။

---

## ၁. မစခင် စစ်ဆေးချက်များ

1. **Git Status (မပြင်ခင်):**
   - `git -C backend status --short` → `?? plans/2026-10-28-rate-limiter-and-load-test-plan.md`
   - `git -C dashboard status --short` → ပြောင်းလဲထားသော ဖိုင်မရှိပါ (clean)
2. **`express-rate-limit` Version နှင့် Feature စစ်ဆေးချက်:**
   - `backend/node_modules/express-rate-limit/package.json` တွင် version **`8.7.1`** ဖြစ်သည်။
   - `ipKeyGenerator`, `standardHeaders: "draft-8"`, `max` (function), `skipSuccessfulRequests` တို့ အားလုံး ပါဝင်ပြီး အလုပ်လုပ်ကြောင်း အတည်ပြုပြီးဖြစ်သည်။
3. **`.env.example` ဖိုင်:**
   - `backend/.env.example` မရှိပါသဖြင့် အသစ်မဖန်တီးပါ (`backend/.env` ကိုလည်း လုံးဝ မပြင်ပါ)။

---

## ၂. ပြင်ဆင်ခဲ့သည့် ဖိုင်စာရင်းနှင့် Diff အနှစ်ချုပ်

| စဉ် | ဖိုင်လမ်းကြောင်း | ပြောင်းလဲမှု အနှစ်ချုပ် |
|---|---|---|
| 1 | `backend/src/middlewares/rateLimiter.middleware.js` | ယခင် `apiRateLimiter` ကို ဖယ်ရှားပြီး `authLimiter` (IP အလိုက် 10 req / 15 min, `skipSuccessfulRequests: true`) နှင့် `apiLimiter` (JWT `role:id` အလိုက် staff 600/min, customer 120/min, public/invalid token များအတွက် `ipKeyGenerator(req.ip)` ဖြင့် 300/min, `standardHeaders: "draft-8"`) တို့ကို ပြောင်းလဲရေးသားခဲ့သည်။ |
| 2 | `backend/src/app.js` | Line 12 နှင့် Line 55 တွင် `apiRateLimiter(60, 60 * 1000)` အစား `app.use(apiLimiter)` ဖြင့် အစားထိုးခဲ့သည်။ |
| 3 | `backend/src/routes/admin.route.js` | `POST /admin/login` route တွင် `validate(adminLoginSchema)` မတိုင်မီ `authLimiter` ကို ထည့်သွင်းခဲ့သည်။ |
| 4 | `backend/src/routes/customer.route.js` | `POST /customer/register` နှင့် `POST /customer/login` route တို့တွင် `validate(...)` မတိုင်မီ `authLimiter` ကို ထည့်သွင်းခဲ့သည်။ |
| 5 | `dashboard/services/axios.ts` | Line 56-68 ရှိ 429 interceptor တွင် `!config._retryCount` ကြောင့် ၁ ကြိမ်သာ retry လုပ်နေသည့် bug ကိုပါ ပြင်ဆင်ပြီး၊ `Retry-After` header ပါလာပါက ၎င်းစက္ကန့်အတိုင်း စောင့်ရန်နှင့် မပါမှသာ ယခင်အတိုင်း 2s / 4s စောင့်ပြီး ၂ ကြိမ်အထိ retry လုပ်ရန် ပြင်ဆင်ခဲ့သည်။ |

---

## ၃. Local Test (L-1 မှ L-8) စစ်ဆေးချက် ရလဒ်နှင့် အထောက်အထားများ

| စဉ် | စစ်ချက် | ရလဒ် | အထောက်အထား (Request အရေအတွက်၊ 429 အကြိမ်ရေ၊ Header / Body) |
|---|---|---|---|
| **L-1** | Admin token ဖြင့် `GET /inventory` 300 ကြိမ် / မိနစ် (IP တစ်ခု) | ✅ **PASS** | Request **300** လုံး `200 OK` ရရှိပြီး `429` **၀ ကြိမ်**။<br>• ပထမဆုံး req header: `RateLimit: "600-in-1min"; r=599; t=60`<br>• 300 မြောက် req header: `RateLimit: "600-in-1min"; r=300; t=60` |
| **L-2** | Admin/Staff token ၃ ခု (`admin`, `owner`, `cashier`) ဖြင့် IP တစ်ခုတည်းမှ တစ်ယောက် 250 ကြိမ်စီ (`GET /storefront-inventory`) | ✅ **PASS** | User တစ်ဦးချင်းစီအတွက် Request **250** လုံးစီ (စုစုပေါင်း 750၊ L-1 ပါပေါင်းလျှင် IP တစ်ခုတည်းမှ 1,050 requests) `200 OK` ရရှိပြီး `429` **၀ ကြိမ်**။<br>• Admin 1 (L-1 300 + L-2 250 = 550): `RateLimit: "600-in-1min"; r=50; t=58`<br>• Admin 2 (250): `RateLimit: "600-in-1min"; r=350; t=59`<br>• Admin 3 (250): `RateLimit: "600-in-1min"; r=350; t=59`<br>*(မှတ်ချက် - `GET /inventory` သည် `owner`/`admin` သာ ခွင့်ပြု၍ `cashier` ပါ စမ်းသပ်နိုင်ရန် staff ၃ ဦးလုံး ဝင်ခွင့်ရှိသော `GET /storefront-inventory` ဖြင့် စစ်ဆေးခဲ့သည်)* |
| **L-3** | Customer token ဖြင့် `GET /customer/me` 130 ကြိမ် / မိနစ် | ✅ **PASS** | ပထမ **120** ကြိမ် `200 OK`၊ **121 ကြိမ်မြောက်မှစ၍** 130 အထိ (၁၀ ကြိမ်) `429` ထွက်သည်။<br>• 120 မြောက် req: `status: 200`, `RateLimit: "120-in-1min"; r=0; t=59`<br>• 121 မြောက် req: `status: 429`, `Retry-After: 59` |
| **L-4** | Token မပါဘဲ `GET /ecommerce/products` 310 ကြိမ် / မိနစ် | ✅ **PASS** | ပထမ **300** ကြိမ် `200 OK`၊ **301 ကြိမ်မြောက်မှစ၍** 310 အထိ (၁၀ ကြိမ်) `429` ထွက်သည်။<br>• 300 မြောက် req: `status: 200`, `RateLimit: "300-in-1min"; r=0; t=56`<br>• 301 မြောက် req: `status: 429`, `Retry-After: 56` |
| **L-5** | `POST /customer/login` အောင်မြင်သော login များ မရေတွက်ခြင်း + အမည်မှားဖြင့် 11 ကြိမ် ပို့ခြင်း | ✅ **PASS** | • အမည်မှန်ဖြင့် ၃ ကြိမ် အရင် login ဝင်ရာ ၃ ကြိမ်လုံး `200 OK` ရပြီး `10-in-15min` ၏ remaining သည် `r=9` တွင်သာ ဆက်ရှိနေသည် (`skipSuccessfulRequests: true` က ပြန်နှုတ်ပေးသည်)။<br>• ထို့နောက် အမည်မှားဖြင့် 11 ကြိမ် ဆက်တိုက်ပို့ရာ ပထမ **10** ကြိမ် `401 Unauthorized` ရပြီး **11 ကြိမ်မြောက်တွင် `429`** ထွက်သည်။<br>• 11 မြောက် req header: `RateLimit: "300-in-1min"; r=286; t=56, "10-in-15min"; r=0; t=896`, `Retry-After: 896` |
| **L-6** | Token အတု (signature မှား) ဖြင့် ခေါ်ဆိုခြင်း | ✅ **PASS** | • `GET /inventory` သို့ signature မှားသော Bearer token ပို့ရာ Limiter က `401` မပြန်ဘဲ Public IP limiter (`300-in-1min`) သို့ fallback လုပ်ပေးပြီး Auth middleware က ပုံမှန်အတိုင်း `401 Invalid token. Please login again.` ပြန်ပေးသည်။<br>• ပထမ req header: `RateLimit: "300-in-1min"; r=299; t=60` (`status: 401`)<br>• တူညီသော IP မှ ဒုတိယ req (`GET /ecommerce/products`): `RateLimit: "300-in-1min"; r=298; t=60` (`status: 200`) — IP bucket တစ်ခုတည်းတွင် ရေတွက်ကြောင်း သက်သေပြနိုင်သည်။ |
| **L-7** | 429 Response JSON ပုံစံနှင့် Header စစ်ဆေးချက် | ✅ **PASS** | • Status: `429`<br>• Header: `RateLimit: "120-in-1min"; r=0; t=59`, `RateLimit-Policy: "120-in-1min"; q=120; w=60; pk=...`, `Retry-After: 59`<br>• Body: `{"code":429,"status":"failed","message":"Too many requests, please try again later."}` |
| **L-8** | Dashboard နှင့် Ecommerce ပုံမှန်သုံးစွဲမှု (Page load burst) စမ်းသပ်ချက် | ✅ **PASS** | • Dashboard page load (menu, inventory, categories, storefronts, POS stock, orders, shop-setting စသည့် endpoint ၁၀ ခု × ၅ ကြိမ် = 50 requests) → `429` **၀ ကြိမ်**။<br>• Ecommerce page load (brands, subcategories, categories, products, customer profile, notifications, orders endpoint ၇ ခု × ၅ ကြိမ် = 35 requests) → `429` **၀ ကြိမ်**။ |

---

## ၄. Railway Deploy ပြီးနောက် စစ်ဆေးရမည့် L-9 လမ်းညွှန်ချက်

Code များကို Railway Production သို့ deploy လုပ်ပြီးနောက် Railway ၏ edge proxy နောက်ကွယ်တွင် `app.set("trust proxy", 1)` က Client IP ကို မှန်ကန်စွာ ခွဲခြားပေးနိုင်ခြင်း ရှိ/မရှိ အောက်ပါအတိုင်း စစ်ဆေးပါ (Production ကို ဖတ်ရုံသာ — request အများ မပို့ရပါ)။

1. **Network ၁ (ဥပမာ - ဆိုင်/အိမ် Wi-Fi)** မှနေ၍ Terminal သို့မဟုတ် Browser DevTools ဖြင့် Production API ကို ၂–၃ ကြိမ် ခေါ်ပါ -
   ```bash
   curl -I https://<railway-production-domain>/api/v1/ecommerce/products
   ```
   Response header ထဲမှ `RateLimit` တန်ဖိုး (ဥပမာ `"300-in-1min"; r=299; t=60`) နှင့် `RateLimit-Policy` ထဲမှ `pk=:<partition-key>:` ကို မှတ်သားပါ။
2. **Network ၂ (ဥပမာ - ဖုန်း Mobile Data — Wi-Fi ပိတ်ထားပါ)** မှနေ၍ တူညီသော endpoint ကို ၁–၂ ကြိမ် ထပ်ခေါ်ပါ။
3. **အကဲဖြတ်ရန်:**
   - **မှန်ကန်ပါက (Pass):** Network ၂ တွင် `r=299` မှ သီးခြား ပြန်စပြီး `RateLimit-Policy` ၏ `pk` တန်ဖိုးသည် Network ၁ နှင့် မတူညီပါ။
   - **မမှန်ကန်ပါက (Fail):** Network ၂ မှ ခေါ်သော်လည်း Network ၁ ၏ remaining (`r=...`) အတိုင်း ဆက်လျော့နေပြီး `pk` တူညီနေပါက Railway edge proxy က `X-Forwarded-For` တွင် hop ပိုထည့်နေခြင်း ဖြစ်သဖြင့် `src/app.js:54` ရှိ `app.set("trust proxy", 1)` ကို hop အရေအတွက်အလိုက် (`2` စသည်ဖြင့်) ညှိပေးရပါမည်။

---

## ၅. Cleanup ရလဒ်နှင့် လက်ရှိ Git Status

- **Cleanup:**
  - Local temp backend (`PORT=5055`) နှင့် local `mongod` (`PORT=27018`) တို့ကို ရပ်တန့်ပြီး ဖြစ်သည်။
  - Temp data directory (`mongo-data-a`) နှင့် temp seed/test script များအားလုံးကို ဖျက်သိမ်းပြီး ဖြစ်သည်။
- **လက်ရှိ Git Status:**
  - `git -C backend status --short`:
    ```text
     M src/app.js
     M src/middlewares/rateLimiter.middleware.js
     M src/routes/admin.route.js
     M src/routes/customer.route.js
    ?? plans/2026-10-28-rate-limiter-and-load-test-plan.md
    ?? plans/2026-10-28-rate-limiter-report.md
    ```
  - `git -C dashboard status --short`:
    ```text
     M services/axios.ts
    ```

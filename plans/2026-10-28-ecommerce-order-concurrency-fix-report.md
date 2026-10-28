# Ecommerce Order Concurrency (`WriteConflict` / `E11000`) ပြင်ဆင်ချက် အစီရင်ခံစာ

**ရက်စွဲ:** 2026-10-28  
**ရည်ညွှန်း Plan:** [`backend/plans/2026-10-28-ecommerce-order-concurrency-fix-plan.md`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/plans/2026-10-28-ecommerce-order-concurrency-fix-plan.md)

---

## ၁။ ပြင်ဆင်/ဖန်တီးခဲ့သည့် ဖိုင်စာရင်း နှင့် Diff အနှစ်ချုပ်

| # | ဖိုင်လမ်းကြောင်း | အမျိုးအစား | ပြောင်းလဲမှု အနှစ်ချုပ် |
|---|---|---|---|
| 1 | [`src/models/counter.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/counter.model.js) | **အသစ်ဖန်တီး** | `{ _id: String, seq: { type: Number, default: 0 } }` schema ပါဝင်သော `Counter` model (ES Module default export) |
| 2 | [`src/models/ecommerceOrder.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/ecommerceOrder.model.js#L143-L202) | **ပြင်ဆင်** | `pre("save")` တွင် ယနေ့ (`ECO-YYYY-MM-DD`) အတွက် counter document မရှိသေးပါက ရှိပြီးသား အမြင့်ဆုံး `orderNumber` ကိုဖတ်၍ `Counter.updateOne({ _id }, { $max: { seq: lastSeq } }, { upsert: true })` လုပ်ပြီးနောက် Transaction အပြင်ဘက် (session မပါဘဲ) `Counter.findOneAndUpdate({ _id }, { $inc: { seq: 1 } }, { upsert: true, new: true })` ဖြင့် atomic နံပါတ် ထုတ်ပေးရန် ပြောင်းလဲခဲ့သည် |
| 3 | [`src/controllers/ecommerce.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/ecommerce.controller.js#L518-L594) | **ပြင်ဆင်** | `createOrder` တွင် manual `session.startTransaction()` အစား `MAX_ORDER_ATTEMPTS = 3` loop + `await session.withTransaction(...)` ပြောင်းလဲခဲ့သည်။ Callback အတွင်း session ပါသော DB write (`StorefrontInventory.findOneAndUpdate` နှင့် `EcommerceOrder.create`) ကိုသာ ထားရှိပြီး `err?.code === 11000 && err?.keyPattern?.orderNumber` ဖြစ်မှသာ ၃ ကြိမ်အထိ retry လုပ်ကာ ၃ ကြိမ်လုံး မရပါက `409 ("အော်ဒါများ တစ်ပြိုင်နက် ဝင်နေပါသည်။ ခဏနေ ပြန်ကြိုးစားပါ။")` ပြန်ပေးသည် |

---

## ၂။ စစ်ဆေးမှု ရလဒ်များ (O-1 မှ O-8 အထောက်အထား)

> **စမ်းသပ်သည့် ပတ်ဝန်းကျင်:** Local MongoDB `v8.2.5` single-node replica set (`127.0.0.1:27018`, `replSet: rs0`, DB: `ordertest` — `mongoose.connection.name === "ordertest"` asserted) + Temp Backend (`PORT=5055`, `RATE_LIMIT_*=1000000` env override) + `npx autocannon`။ Production Atlas နှင့် Railway Production API တို့ကို **လုံးဝ မထိပါ**။

### အနှစ်ချုပ် ဇယား (O-1 မှ O-8)

| စစ်ချက် | စမ်းသပ်ချက် | Pass စံ | လက်တွေ့ ရလဒ် (အထောက်အထား) | အခြေအနေ |
|---|---|---|---|---|
| **O-1** | **T-5a:** `POST /api/v1/ecommerce/order` (`c=5`, `30s`, product ၁–၃ ခု, customer 50) | Error (non-2xx) `< 1%`, `500` = `0` | `req/s = 128.57`, စုစုပေါင်း `3,857` req → **`201 Created`: `3,857` (100%)**, `non-2xx = 0`, **`500` = `0`**, **Error = `0.00%`**, `p50 = 37ms`, `p95 ≈ 55.7ms` (`p97.5 = 60ms`), `p99 = 66ms` | ✅ **PASS** |
| **O-2** | **T-5b:** `POST /api/v1/ecommerce/order` (`c=20`, `30s`, product ၁–၃ ခု, customer 50) | Error `< 1%`, `500` = `0`; `p95` မှတ်ရန် | `req/s = 127.70`, စုစုပေါင်း `3,831` req → **`201 Created`: `3,831` (100%)**, `non-2xx = 0`, **`500` = `0`**, **Error = `0.00%`**, `p50 = 150ms`, **`p95 ≈ 206.0ms`** (`p97.5 = 228ms`), `p99 = 287ms` | ✅ **PASS** |
| **O-3** | Commit ဖြစ်သော Order အားလုံး၏ `orderNumber` စစ်ဆေးခြင်း | Duplicate `orderNumber` = `0`; seq ကျော်/ထပ် စစ်ရန် | DB ရှိ စုစုပေါင်း Order `7,851` ခု (ယနေ့ Order `7,751` ခု: `ECO-2026-10-29-000001` မှ `007751` အထိ) → **`duplicateOrderNumberCount = 0`**၊ `minSeq = 1`, `maxSeq = 7751`, `counter.seq = 7751`, `gapIntervalsCount = 0` (`totalSkippedSequenceNumbers = 0`) | ✅ **PASS** |
| **O-4** | Stock မှန်ကန်မှု စစ်ဆေးခြင်း (`StorefrontInventory` 120 ခုလုံး) | `negativeStockCount = 0`, `mismatchCount = 0` | Committed load-test orders = `7,713` ခု၊ စုစုပေါင်း နှုတ်ယူခဲ့သည့် Base Units = `15,270` ဘူး → **`negativeStockCount = 0`**, **`mismatchCount = 0`** (`initialStock - remainingStock === sum(orderUnits)`) | ✅ **PASS** |
| **O-5** | Oversell Stress Test (`initialStock = 500` ပစ္စည်းတစ်ခုတည်းကို `c=20`, `15s` ပစ်သွင်းခြင်း) | Commit order = **`500` အတိအကျ**, `remainingStock = 0`, ကျန် request များ `400`, `500` = `0` | စုစုပေါင်း `3,298` req (`219.87 req/s`) → **`201 Created` = `500` အတိအကျ**, **`400 Bad Request` = `2,798`**, **`500` = `0`**; DB တွင် `committedOrdersForOversellProduct = 500`, **`remainingStock = 0`**, `negativeStockCount = 0`, `mismatchCount = 0`, `duplicateOrderNumbers = 0` | ✅ **PASS** |
| **O-6** | ယခင်ရှိပြီးသား ယနေ့ Order (`ECO-2026-10-29-000037`) ရှိသော DB တွင် Counter မရှိသေးဘဲ ပထမဆုံး Order တင်ခြင်း | နံပါတ်သစ် `ECO-2026-10-29-000038` မှ စရမည် | `HTTP 201 Created` → `newOrderNumber = "ECO-2026-10-29-000038"`၊ `counters` collection တွင် `{ "_id": "ECO-2026-10-29", "seq": 38 }` အမှန်အကန် ဖန်တီးသွားသည် | ✅ **PASS** |
| **O-7** | Stock မလုံလောက်သော Order (`available: 500`, `requested: 501`) | `400` ယခုအတိုင်း (retry မလုပ်ရ) | `HTTP 400 Bad Request` (`"Product at index 0: Insufficient stock (available: 500, requested: 501 in base unit \"ဘူး\")"`)၊ Counter `seq` သည် မပြောင်းလဲဘဲ `38` တွင်သာ ရှိနေပြီး retry လုံးဝ မလုပ်ပါ | ✅ **PASS** |
| **O-8** | Ecommerce App (`VITE_API_URL=http://localhost:5055/api/v1/` build + `vite preview` port `4173`) မှ Cart → Order တင်ခြင်း | Success modal ပေါ်ရမည် + `/profile` တွင် အော်ဒါပေါ်ရမည် | `/cart` တွင် `"အော်ဒါတင်မယ်"` နှိပ်ရာ `"အောင်မြင်ပါသည် — အော်ဒါတင်ခြင်း အောင်မြင်ခဲ့ပါသည်။"` modal ပေါ်လာပြီး `/profile` တွင် `"Awba စိုက်ပျိုးရေးဆေး အမှတ် 1 — စောင့်ဆိုင်းဆဲ — 15,000 Ks"` (`orderNumber: ECO-2026-10-29-008252`) ပေါ်လာကြောင်း အတည်ပြုပြီး | ✅ **PASS** |

---

## ၃။ Load Test Report T-5 (မပြင်မီ vs ပြင်ပြီး) နှိုင်းယှဉ်ဇယား

| တိုင်းတာချက် | T-5a (`c=5`, `30s`) မပြင်မီ | **O-1 (`c=5`, `30s`) ပြင်ပြီး** | T-5b (`c=20`, `30s`) မပြင်မီ | **O-2 (`c=20`, `30s`) ပြင်ပြီး** |
|---|---:|---:|---:|---:|
| **စုစုပေါင်း Requests** | 4,301 | **3,857** | 4,584 | **3,831** |
| **Committed Orders (`201 Created`)** | 1,918 | **3,857** | 771 | **3,831** |
| **Failed Requests (`500 WriteConflict`)** | 2,383 | **`0`** | 3,813 | **`0`** |
| **Error % (Non-2xx %)** | `55.41%` | **`0.00%`** | `83.18%` | **`0.00%`** |
| **Committed Order Rate (အောင်မြင်သော order/s)** | `63.9 orders/s` | **`128.57 orders/s` (+101%)** | `25.7 orders/s` | **`127.70 orders/s` (+397%)** |
| **p50 Latency** | 34 ms | **37 ms** | 133 ms | **150 ms** |
| **p95 Latency (≈ interpolated / p97.5)** | 47 ms (49 ms) | **55.7 ms (60 ms)** | 176 ms (182 ms) | **206.0 ms (228 ms)** |
| **p99 Latency** | 53 ms | **66 ms** | 192 ms | **287 ms** |

> **သုံးသပ်ချက်:** မပြင်မီက `c=20` တွင် Request ၈၃% သည် `500 WriteConflict` ဖြင့် ချက်ချင်း abort ဖြစ်သွားသဖြင့် တစ်စက္ကန့်လျှင် အော်ဒါ `25.7` ခုသာ အောင်မြင်ခဲ့သည်။ ပြင်ဆင်ပြီးနောက် `c=20` တွင် **Error `0.00%`** ဖြင့် တစ်စက္ကန့်လျှင် အော်ဒါ **`127.7` ခု** (၅ ဆနီးပါး ပိုများ) အောင်မြင်စွာ Commit ဖြစ်ပြီး `p95` latency မှာလည်း **`206ms`** (`< 500ms` Pass စံအတွင်း) သာ ရှိပါသည်။

---

## ၄။ Retry အရေအတွက် (`console.warn` မှတ်တမ်း သုံးသပ်ချက်)

O-1 (`c=5`, `30s`)၊ O-2 (`c=20`, `30s`) နှင့် O-5 (`c=20`, `15s` single-product contention) စမ်းသပ်မှု အားလုံးအတွင်း Backend log တွင် ရိုက်ထုတ်ခဲ့သော `[createOrder]` `console.warn` အရေအတွက်မှာ အောက်ပါအတိုင်း ဖြစ်ပါသည် —

| Retry အမျိုးအစား | Log Message ပုံစံ | ဖြစ်ပွားခဲ့သည့် အကြိမ်ရေ | ရှင်းလင်းချက် |
|---|---|---:|---|
| **Outer Loop `E11000` (`orderNumber` duplicate) Retry** | `[createOrder] Duplicate orderNumber E11000 retry (attempt=...)` | **`0` ကြိမ်** | `Counter` collection ၏ atomic `$inc` က တစ်ပြိုင်နက်တည်း ဝင်လာသော request အားလုံးကို မတူညီသော `orderNumber` အမြဲထုတ်ပေးသဖြင့် `orderNumber` duplicate key (`E11000`) လုံးဝ မဖြစ်တော့ပါ |
| **Inner `session.withTransaction` (`WriteConflict`) Retry** | `[createOrder] Order succeeded after retry (attempt=1, txRuns=2..6)` | **`1,603` ကြိမ်** | التزام တစ်ပြိုင်နက်တည်း တူညီသော ကုန်ပစ္စည်း (`StorefrontInventory` document) ကို `findOneAndUpdate` လုပ်ရာတွင် WiredTiger `WriteConflict` (`TransientTransactionError`) ဖြစ်ပေါ်ခဲ့သော်လည်း `session.withTransaction()` က အလိုအလျောက် ပြန်ကြိုးစားပေးသဖြင့် `1,603` ကြိမ်လုံး `201 Created` ဖြင့် အောင်မြင်ခဲ့သည် |

> **Sequence Gap မဖြစ်ပေါ်ခဲ့သည့် အကြောင်းရင်း (O-3):** `createOrder` ၏ `withTransaction` callback အတွင်း၌ အဆင့် (၁) `StorefrontInventory.findOneAndUpdate` ကို အရင်လုပ်ပြီး အဆင့် (၂) `EcommerceOrder.create` (`pre("save")` → `Counter.$inc`) ကို နောက်မှ လုပ်ဆောင်သဖြင့် အဆင့် (၁) တွင် `WriteConflict` ဖြစ်၍ retry လုပ်ရချိန်၌ `Counter` ကို မခေါ်ရသေးသည့်အပြင်၊ အဆင့် (၂) သို့ ရောက်ချိန်တွင် `orderNumber` သည် atomic counter ကြောင့် conflict မဖြစ်တော့သဖြင့် O-1/O-2 အပြီးတွင် sequence နံပါတ်ကျော်သွားခြင်း (`gapIntervalsCount = 0`) လုံးဝ မရှိခဲ့ပါ။

---

## ၅။ Cleanup နှင့် Git Status အတည်ပြုချက်

- [x] Temp Backend (`PORT=5055`)၊ Local MongoDB (`PORT=27018`) နှင့် Ecommerce Vite Preview (`PORT=4173`) တို့ကို ရပ်တန့်ပြီး ဖြစ်ပါသည်။
- [x] `ordertest` DB data directory (`mongo-data-o`) နှင့် ယာယီ test script / HAR ဖိုင်အားလုံးကို ဖျက်သိမ်းပြီး ဖြစ်ပါသည်။
- [x] `backend/.env`၊ POS order (`order.controller.js`)၊ `ecommerce` frontend နှင့် `dashboard` တို့ကို လုံးဝ မပြင်ဆင်ထားပါ။

### `git -C backend status --short`
```text
 M src/controllers/ecommerce.controller.js
 M src/models/ecommerceOrder.model.js
?? plans/2026-10-28-ecommerce-order-concurrency-fix-plan.md
?? plans/2026-10-28-ecommerce-order-concurrency-fix-report.md
?? plans/2026-10-28-load-test-report.md
?? src/models/counter.model.js
```

---

## ၆။ Plan နှင့် နှိုင်းယှဉ်ချက် / မှတ်ချက်

- Plan §2, §3, §4 အတိုင်း ဖိုင် (၃) ဖိုင် (`src/models/counter.model.js`, `src/models/ecommerceOrder.model.js`, `src/controllers/ecommerce.controller.js`) ကိုသာ တိကျစွာ ပြင်ဆင်/ဖန်တီးခဲ့ပြီး O-1 မှ O-8 အားလုံးကို မကျန်ရှိဘဲ စစ်ဆေးအတည်ပြုနိုင်ခဲ့ပါသည်။
- `ecommerceOrder.model.js` ၏ `pre("save")` တွင် ရက်သစ်တစ်ရက်၏ ပထမဆုံး အော်ဒါများ တစ်ပြိုင်နက် ဝင်လာချိန်၌ `Counter.updateOne({ _id }, { $max: { seq: lastSeq } }, { upsert: true })` သည် တစ်ပြိုင်နက် upsert ကြောင့် `E11000` ဖြစ်နိုင်ချေကိုပါ ကာကွယ်သည့်အနေဖြင့် `catch (err)` တွင် `err?.code === 11000` ဖြစ်ပါက `upsert` မပါဘဲ `$max` update ပြန်ခေါ်ပေးထားပါသည်။

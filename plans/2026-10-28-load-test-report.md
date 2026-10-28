# Phase B — Backend Load Test အစီရင်ခံစာ (စမ်းသပ်နည်း အဆင့်ဆင့် နှင့် ရလဒ်များ)

**ရက်စွဲ:** 2026-10-28  
**ရည်ညွှန်း Plan:** [`backend/plans/2026-10-28-rate-limiter-and-load-test-plan.md`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/plans/2026-10-28-rate-limiter-and-load-test-plan.md) (§5, §7, §8)

---

## ၁။ စမ်းသပ်သည့် ပတ်ဝန်းကျင် (Test Environment & Specs)

> **မှတ်ချက်:** စည်းမျဉ်းအတိုင်း Production Atlas DB နှင့် Railway Production API တို့ကို **လုံးဝ မထိဘဲ** Local MongoDB single-node replica set (`rs0`) နှင့် Local Backend (`PORT=5055`) တွင်သာ စမ်းသပ်ခဲ့ပါသည်။

| အချက်အလက် | တန်ဖိုး |
|---|---|
| **OS** | Windows (x64) |
| **CPU** | 12th Gen Intel(R) Core(TM) i7-12650H (10 Physical Cores / 16 Logical Processors) |
| **RAM** | 15.71 GB |
| **Node.js Version** | `v22.23.1` (Single process — replica ၁ ခု ပုံစံ) |
| **MongoDB Version** | `v8.2.5` (Local `127.0.0.1:27018`, Single-node Replica Set `rs0`, DB: `loadtest`) |
| **Mongoose Pool Size** | `maxPoolSize: 20`, `minPoolSize: 2` ([`src/configs/db.config.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/configs/db.config.js#L13-L14)) |
| **Load Test Tool** | `npx autocannon` (one-off, dependency အသစ် မထည့်ပါ) |
| **Rate Limiter Override** | Server စွမ်းဆောင်ရည်ကို သီးသန့် တိုင်းတာနိုင်ရန် env var ဖြင့် `RATE_LIMIT_AUTH_MAX=1000000`, `RATE_LIMIT_STAFF_MAX=1000000`, `RATE_LIMIT_CUSTOMER_MAX=1000000`, `RATE_LIMIT_PUBLIC_MAX=1000000` ယာယီ ပေးထားသည် (`.env` ဖိုင် မပြင်ပါ) |

---

## ၂။ ဘယ်လို စမ်းသပ်ခဲ့သလဲ (How to Test — အဆင့်လိုက် စမ်းသပ်နည်း)

Load test ကို Production မထိစေဘဲ Local တွင် ပြန်လည်စမ်းသပ်လိုပါက အောက်ပါ အဆင့် (၅) ဆင့်အတိုင်း လုပ်ဆောင်ခဲ့ပါသည် —

### အဆင့် ၁ — Local MongoDB (Single-Node Replica Set `rs0`) စတင်ခြင်း
Order ဖန်တီးခြင်း (`POST /api/v1/ecommerce/order`) သည် MongoDB Transaction (`session.startTransaction()`) သုံးထားသဖြင့် Replica Set လိုအပ်ပါသည်။ Port `27018` တွင် ယာယီ data folder ဖြင့် run ပါသည် —

```powershell
# ၁.၁ ယာယီ MongoDB data folder ဆောက်ပြီး mongod run ခြင်း
$mongoData = "C:\temp\mongo-data-loadtest"
New-Item -ItemType Directory -Force -Path $mongoData | Out-Null
& "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath $mongoData --port 27018 --replSet rs0 --bind_ip 127.0.0.1

# ၁.၂ Replica Set (rs0) ကို initiate လုပ်ခြင်း (Terminal အသစ်တစ်ခုမှ)
mongosh --port 27018 --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27018'}]})"
```

### အဆင့် ၂ — Test Data Seed လုပ်ခြင်း (`loadtest` DB)
`mongoose.connection.name === "loadtest"` ဖြစ်ကြောင်း assert စစ်ဆေးပြီး အောက်ပါ အချက်အလက်များကို `loadtest` DB ထဲသို့ ထည့်သွင်းခဲ့ပါသည် —
- **Storefront (`LocationProfile`):** `1` ခု (`type: "storefront"`, `status: "active"`)
- **Products (`Inventory`):** `120` ခု (UOM `ဘူး` base unit, `ပုံး = 10`, `ဖာ = 120`၊ Brands ၆ မျိုး — `Awba`, `Armo`, `GoldenKey`, `MyanmaAwba`, `DiamondStar`, `GreenLand`၊ SubCategories ၆ မျိုး)
- **Storefront Stock (`StorefrontInventory`):** `120` ခု
  - ပထမ Product `119` ခု: `quantity = 100,000` စီ (T-5 / T-6 load test အတွင်း stock မကုန်စေဘဲ server/transaction throughput တိုင်းရန်)
  - ၁၂၀ မြောက် Product (`oversellTestProductId`): `quantity = 500` (Oversell exhaustion stress test အတွက်)
- **Customers (`Customer`):** `50` ဦး + Valid Customer JWT token `50` ခု
- **Notifications (`CustomerNotification`):** `150` ခု (Customer တစ်ဦးလျှင် ၃ ခုစီ)
- **Admin (`AdminWarehouse`):** `1` ဦး (`role: "owner"`) + Valid Admin JWT token `1` ခု
- **Initial Orders:** `200` ခု (POS `Order` `100` ခု + `EcommerceOrder` `100` ခု)

### အဆင့် ၃ — Temp Backend (`PORT=5055`) ကို Rate Limit မြှင့်၍ စတင်ခြင်း
`backend/.env` ဖိုင်ကို မပြင်ဘဲ Environment Variable override ဖြင့် Port `5055` တွင် run ပါသည် —

```powershell
$env:MONGODB_URI="mongodb://127.0.0.1:27018/loadtest?replicaSet=rs0"
$env:PORT="5055"
$env:ECOMMERCE_STOREFRONT_ID="<seeded_storefront_id>"
$env:RATE_LIMIT_AUTH_MAX="1000000"
$env:RATE_LIMIT_STAFF_MAX="1000000"
$env:RATE_LIMIT_CUSTOMER_MAX="1000000"
$env:RATE_LIMIT_PUBLIC_MAX="1000000"
Set-Location c:\Users\PC\Desktop\Pyi-Taw-Tar\backend
node src/server.js
```

### အဆင့် ၄ — `npx autocannon` ဖြင့် T-1 မှ T-6 စမ်းသပ်ခြင်း နှင့် CPU/RAM တိုင်းတာခြင်း
Test တစ်ခုချင်း run နေစဉ်အတွင်း PowerShell `Get-Process` ဖြင့် Backend Node.js process နှင့် MongoDB process တို့၏ CPU Time Delta နှင့် WorkingSet64 (RAM MB) ကို ၂.၅ စက္ကန့်တစ်ကြိမ် တစ်ပြိုင်နက် မှတ်သားခဲ့ပါသည် —

1. **T-1 (`GET /api/v1/ecommerce/products?brand=Awba` — Public):**
   - Connections `10`, `50`, `100` တို့ဖြင့် တစ်ခုလျှင် `30s` စီ —
   ```powershell
   npx --yes autocannon -c 10 -d 30 -j "http://127.0.0.1:5055/api/v1/ecommerce/products?brand=Awba"
   npx --yes autocannon -c 50 -d 30 -j "http://127.0.0.1:5055/api/v1/ecommerce/products?brand=Awba"
   npx --yes autocannon -c 100 -d 30 -j "http://127.0.0.1:5055/api/v1/ecommerce/products?brand=Awba"
   ```
2. **T-2 (`GET /api/v1/ecommerce/products/brands` နှင့် `/subcategories` — Public):**
   - Endpoint ၂ ခုလုံးပါဝင်သော `t2.har` ဖြင့် `connections = 50`, `duration = 30s` —
   ```powershell
   npx --yes autocannon -c 50 -d 30 -j --har t2.har "http://127.0.0.1:5055"
   ```
3. **T-3 (`GET /api/v1/customer/notifications?limit=1` — Customer Token):**
   - Customer ၅၀ ဦး၏ `Authorization: Bearer <token>` ပါဝင်သော `t3.har` ဖြင့် `connections = 50`, `duration = 30s` —
   ```powershell
   npx --yes autocannon -c 50 -d 30 -j --har t3.har "http://127.0.0.1:5055"
   ```
4. **T-4 (`GET /api/v1/storefront-inventory?page=1&limit=100` — Admin Token / POS):**
   - Admin JWT token ပါဝင်သော `t4.har` ဖြင့် `connections = 10` နှင့် `30`, `duration = 30s` စီ —
   ```powershell
   npx --yes autocannon -c 10 -d 30 -j --har t4.har "http://127.0.0.1:5055"
   npx --yes autocannon -c 30 -d 30 -j --har t4.har "http://127.0.0.1:5055"
   ```
5. **T-5 (`POST /api/v1/ecommerce/order` — Customer Token, Product ၁–၃ ခု):**
   - Customer ၅၀ ဦးမှ Product ၁ ခုမှ ၃ ခုအထိ (`unit: "ဘူး"`, `quantity: 1`) မှာယူသည့် `t5.har` ဖြင့် `connections = 5` နှင့် `20`, `duration = 30s` စီ —
   ```powershell
   npx --yes autocannon -c 5 -d 30 -j --har t5.har "http://127.0.0.1:5055"
   npx --yes autocannon -c 20 -d 30 -j --har t5.har "http://127.0.0.1:5055"
   ```
   - **Oversell Stress Test:** မူလ stock `500` သာရှိသော ၁၂၀ မြောက် Product တစ်ခုတည်းကို `c=20` ဖြင့် stock `0` ရောက်သည်အထိ အပြိုင် မှာယူပြီး `StorefrontInventory.quantity` အနုတ်မပြကြောင်းနှင့် Committed Order အရေအတွက် `500` အတိအကျ ဖြစ်ကြောင်း စစ်ဆေးခဲ့သည်။
6. **T-6 (Mixed Workload — T-1 70% / T-3 20% / T-5 10%):**
   - HAR entries `100` ခုတွင် T-1 `70` ခု၊ T-3 `20` ခု၊ T-5 `10` ခု အချိုးကျ ရောနှောထားသော `t6.har` ဖြင့် `connections = 50`, `duration = 60s` —
   ```powershell
   npx --yes autocannon -c 50 -d 60 -j --har t6.har "http://127.0.0.1:5055"
   ```

### အဆင့် ၅ — Cleanup ပြုလုပ်ခြင်း
စမ်းသပ်မှု အားလုံး ပြီးဆုံးချိန်တွင် Temp Backend (`PORT=5055`) နှင့် Local MongoDB (`PORT=27018`) ကို ရပ်တန့်ပြီး ယာယီ data folder နှင့် script/HAR ဖိုင်အားလုံးကို ဖျက်သိမ်းခဲ့ပါသည်။

---

## ၃။ Load Test ရလဒ်များ (T-1 မှ T-6 ဇယား)

> - **CPU % ဖော်ပြချက်:** Node.js သည် single-threaded event loop ဖြစ်သဖြင့် **1-Core %** (`100%` = CPU core ၁ ခု အပြည့်သုံးခြင်း) နှင့် **16-Core System %** နှစ်မျိုးလုံး ဖော်ပြထားပါသည်။
> - **p95 Latency:** `autocannon` ၏ HDR histogram မှ `p90` နှင့် `p97.5` တို့ကို တိုက်ရိုက်ထုတ်ပေးပြီး `p95` ကို linear interpolation ဖြင့် တွက်ချက်ထားကာ `p97.5` ကိုပါ ပူးတွဲဖော်ပြထားပါသည်။

| Scenario | Endpoint | Connections | ကြာချိန် | Avg Req/s | စုစုပေါင်း Req | p50 (ms) | p95 ≈ (p97.5) (ms) | p99 (ms) | Error % (Non-2xx) | Backend CPU (1-Core / Sys) | Backend Peak RAM | Mongo CPU (1-Core) / RAM | Pass စံ (`p95<500ms`, `err<1%`) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---:|
| **T-1a** | `GET /api/v1/ecommerce/products?brand=Awba` (Public) | `10` | 30s | **385.9** | 11,578 | 25 | **34.7** (36) | 40 | **0.00%** (200: 11,578) | 47.6% / 3.0% | 264.1 MB | 244.2% / 197.0 MB | ✅ PASS |
| **T-1b** | `GET /api/v1/ecommerce/products?brand=Awba` (Public) | `50` | 30s | **392.5** | 11,775 | 125 | **148.0** (151) | 157 | **0.00%** (200: 11,775) | 95.3% / 6.0% | 274.9 MB | 483.0% / 198.6 MB | ✅ PASS |
| **T-1c** | `GET /api/v1/ecommerce/products?brand=Awba` (Public) | `100` | 30s | **393.6** | 11,809 | 251 | **288.0** (292) | 297 | **0.00%** (200: 11,809) | 95.3% / 6.0% | 283.8 MB | 489.6% / 198.6 MB | ✅ PASS |
| **T-2** | `GET /api/v1/ecommerce/products/brands` + `/subcategories` (Public) | `50` | 30s | **634.0** | 19,019 | 77 | **97.0** (101) | 107 | **0.00%** (200: 19,019) | 74.2% / 4.6% | 276.4 MB | 926.1% / 199.9 MB | ✅ PASS |
| **T-3** | `GET /api/v1/customer/notifications?limit=1` (Customer JWT) | `50` | 30s | **305.7** | 9,172 | 161 | **187.7** (193) | 210 | **0.00%** (200: 9,172) | 93.7% / 5.9% | 289.9 MB | 58.6% / 226.0 MB | ✅ PASS |
| **T-4a** | `GET /api/v1/storefront-inventory?page=1&limit=100` (Admin JWT) | `10` | 30s | **63.7** | 1,911 | 156 | **215.3** (223) | 235 | **0.00%** (200: 1,911) | 73.2% / 4.6% | 326.1 MB | 263.5% / 228.2 MB | ✅ PASS |
| **T-4b** | `GET /api/v1/storefront-inventory?page=1&limit=100` (Admin JWT) | `30` | 30s | **69.9** | 2,098 | 428 | **512.0** (525) | 554 | **0.00%** (200: 2,098) | 90.1% / 5.6% | 328.0 MB | 287.0% / 229.7 MB | ⚠️ `p95=512ms` (>500ms) |
| **T-5a** | `POST /api/v1/ecommerce/order` (Customer JWT, 1–3 items) | `5` | 30s | **143.4** *(Committed: ~63.9/s)* | 4,301 | 34 | **47.0** (49) | 53 | **55.41%** (201: 1,918 / 500: 2,383) | 92.0% / 5.8% | 297.9 MB | 47.7% / 211.3 MB | ❌ FAIL (`WriteConflict`) |
| **T-5b** | `POST /api/v1/ecommerce/order` (Customer JWT, 1–3 items) | `20` | 30s | **152.8** *(Committed: ~25.7/s)* | 4,584 | 133 | **176.0** (182) | 192 | **83.18%** (201: 771 / 500: 3,813) | 90.3% / 5.6% | 296.0 MB | 54.5% / 221.0 MB | ❌ FAIL (`WriteConflict`) |
| **T-6** | **ရောနှော (Mixed):** T-1 (70%) + T-3 (20%) + T-5 (10%) | `50` | 60s | **332.0** | 19,919 | 132 | **279.7** (311) | 398 | **9.12%** (200: 17,942 / 201: 161 / 500: 1,816) | 99.7% / 6.2% | 305.4 MB | 326.0% / 223.6 MB | ⚠️ Read 0% err / Write 500s |

---

## ၄။ Stock မှန်ကန်မှု နှင့် Oversell စစ်ဆေးချက် (T-5 / T-6 / Exhaustion Test)

T-5၊ T-6 နှင့် Single-Product Oversell Stress Test တို့ ပြီးဆုံးချိန်တိုင်းတွင် `loadtest` DB ရှိ `StorefrontInventory` အားလုံး (`120` ခု) နှင့် အသစ်ဝင်လာသော Committed `EcommerceOrder` အားလုံးကို တိုက်ဆိုင်စစ်ဆေးခဲ့ပါသည် —

### ၄.၁ အဆင့်လိုက် Stock စစ်ဆေးချက် ဇယား

| စစ်ဆေးသည့် အချိန် | အသစ်ဝင်သော Committed Orders | စုစုပေါင်း နှုတ်ယူခဲ့သည့် Base Units | Stock `< 0` ဖြစ်သော Product အရေအတွက် (`negativeStockCount`) | `initialStock - remainingStock !== sum(orderUnits)` ကွဲလွဲမှု (`mismatchCount`) | ရလဒ် |
|---|---:|---:|---:|---:|---|
| **T-5 (c=5 နှင့် c=20) ပြီးနောက်** | `2,695` ခု | `5,097` ဘူး | **`0`** | **`0`** | ✅ 100% တိကျမှန်ကန် |
| **T-6 (c=50, 60s Mixed) ပြီးနောက်** | `2,858` ခု | `5,423` ဘူး | **`0`** | **`0`** | ✅ 100% တိကျမှန်ကန် |
| **Oversell Stress Part 1 (c=20, 15s) ပြီးနောက်** | `3,181` ခု | `5,746` ဘူး | **`0`** | **`0`** | ✅ 100% တိကျမှန်ကန် |
| **Oversell Stress Part 2 (c=20, 15s — Stock ကုန်သည်အထိ)** | `3,359` ခု | `5,924` ဘူး | **`0`** | **`0`** | ✅ 100% တိကျမှန်ကန် |

### ၄.၂ Single-Product Oversell Exhaustion Stress Test (`initialStock = 500`)
- **စမ်းသပ်ပုံ:** ၁၂၀ မြောက် ကုန်ပစ္စည်း (`inventoryId: 6ae2270fa0798ff112461cb8`) တွင် မူလလက်ကျန် **`500` ဘူး** သာ ထားရှိပြီး `connections = 20` ဖြင့် တစ်ပြိုင်နက်တည်း Order request စုစုပေါင်း **`6,821` ကြိမ်** (`3,239` + `3,582`) ပစ်သွင်းခဲ့သည်။
- **ရလဒ်:**
  - အောင်မြင်စွာ Commit ဖြစ်သွားသော Order အရေအတွက်: **`500` ခု အတိအကျ** (Part 1 တွင် `323` ခု + Part 2 တွင် `177` ခု = `500` ဘူး)။
  - နောက်ဆုံး လက်ကျန် Stock (`remainingStock`): **`0` ဘူး** (အနုတ် လုံးဝ မပြပါ)။
  - Stock `0` ရောက်ပြီးနောက် ဝင်လာသော request `1,706` ခုကို `400 Bad Request (Insufficient stock)` ဖြင့် မှန်ကန်စွာ ငြင်းပယ်ခဲ့သည်။
- **ကောက်ချက်:** [`ecommerce.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/ecommerce.controller.js#L525-L544) ရှိ `StorefrontInventory.findOneAndUpdate({ _id, quantity: { $gte: deductQty } }, { $inc: { quantity: -deductQty } }, { session })` ACID transaction သည် **Stock Oversell ကို 100% ကာကွယ်နိုင်ကြောင်း အတည်ပြုပါသည်။**

---

## ၅။ Pass စံ (`p95 < 500ms`, `error < 1%`) ကို ထိန်းနိုင်သည့် အများဆုံး Connection အရေအတွက်

| Endpoint အမျိုးအစား | စမ်းသပ်ခဲ့သည့် အမြင့်ဆုံး Connection | ထိန်းနိုင်သည့် အများဆုံး Concurrent Connections (ခန့်မှန်း) | ရှင်းလင်းချက် |
|---|---:|---:|---|
| **T-1:** `GET /ecommerce/products?brand=X` | `100` (`p95 ≈ 288ms`, `err = 0%`) | **~160 – 170 connections** | `c=50` မှ `c=100` သို့ တိုးချိန်တွင် throughput သည် `~393 req/s` တွင် ရပ်နေပြီး latency က အချိုးကျ တက်လာသည် (`c=100` တွင် `288ms` ဖြစ်၍ `500ms` သို့ `c≈170` တွင် ရောက်မည်) |
| **T-2:** `GET /ecommerce/products/brands`, `/subcategories` | `50` (`p95 ≈ 97ms`, `err = 0%`) | **~200+ connections** | `~634 req/s` ရရှိပြီး `c=50` တွင် `p95` မှာ `97ms` သာ ရှိသည် |
| **T-3:** `GET /customer/notifications?limit=1` | `50` (`p95 ≈ 187.7ms`, `err = 0%`) | **~120 – 130 connections** | Request တစ်ခုတိုင်းတွင် JWT verify + `Customer.findById` + `Notification.find` + `countDocuments` ၂ ကြိမ် (စုစုပေါင်း DB query ၄ ကြိမ်) ခေါ်နေသဖြင့် `~306 req/s` တွင် Node CPU ပြည့်သွားသည် |
| **T-4:** `GET /storefront-inventory?page=1&limit=100` (POS) | `10` (`p95 ≈ 215ms`) → `30` (`p95 ≈ 512ms`) | **~25 – 28 connections** | Document `100` ခုကို `populate("inventoryId")` + `populate("storefrontId")` လုပ်ပြီး JSON serialize လုပ်ရသဖြင့် `c=30` တွင် `p95 = 512ms` (`500ms` စံနှုန်းအနီး) ရောက်သည် |
| **T-5:** `POST /ecommerce/order` | `5` (`err = 55.4%`) → `20` (`err = 83.2%`) | **1 connection (Sequential သာ)** | Latency သည် `c=20` တွင်ပင် `p95 ≈ 176ms` (`< 500ms`) ရှိသော်လည်း တစ်ပြိုင်နက်တည်း Order ၂ ခုနှင့်အထက် ဝင်လာပါက အောက်ပါ §6.1 `WriteConflict` ကြောင့် `error > 1%` ဖြစ်သည် |

---

## ၆။ Bottleneck သုံးသပ်ချက် (Root Cause Analysis)

### ၆.၁ အဓိက Bottleneck #1 (Critical) — `POST /ecommerce/order` တွင် Concurrent Order များ `500 WriteConflict` ဖြစ်ခြင်း
- **တွေ့ရှိချက်:** T-5 (`c=5` တွင် `55.41%`, `c=20` တွင် `83.18%`) နှင့် T-6 ရှိ `500 Internal Server Error` အားလုံးသည် အောက်ပါ MongoDB error ကြောင့် ဖြစ်သည် —
  ```
  MongoServerError: Caused by :: :: Please retry your operation or multi-document transaction.
  code: 112, codeName: "WriteConflict", errorLabels: ["TransientTransactionError"]
  at Collection.insertOne (EcommerceOrder.create)
  ```
- **အကြောင်းရင်း ၂ ချက်:**
  1. **Sequential `orderNumber` Race Condition:** [`src/models/ecommerceOrder.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/ecommerceOrder.model.js#L142-L163) ၏ `pre("save")` hook သည် `EcommerceOrder.findOne({ orderNumber: new RegExp("^" + prefix) }).sort({ orderNumber: -1 })` ကို **transaction session အပြင်ဘက်မှ** ဖတ်ယူသည်။ ထို့ကြောင့် တစ်ပြိုင်နက်တည်း ဝင်လာသော request များသည် တူညီသော `orderNumber` (`ECO-YYYY-MM-DD-NNNNNN`, unique index) ကို ထုတ်ပေးမိပြီး `Collection.insertOne` တွင် unique index / WiredTiger snapshot conflict (`WriteConflict`, code `112`) တိုက်မိသည်။
  2. **Transaction Retry မပါရှိခြင်း:** [`src/controllers/ecommerce.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/ecommerce.controller.js#L519-L570) သည် `session.startTransaction()` / `session.commitTransaction()` ကို ရိုးရိုး `try/catch` ဖြင့်သာ ရေးထားပြီး `TransientTransactionError` (`WriteConflict`) သို့မဟုတ် `E11000` ဖြစ်ပေါ်ပါက ပြန်လည်ကြိုးစားသည့် retry loop မပါရှိပါ (နှိုင်းယှဉ်ချက်အနေဖြင့် POS [`src/controllers/order.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/order.controller.js#L195-L265) တွင် `MAX_ORDER_RETRIES = 3` retry loop ပါရှိသည်)။ ထို့အပြင် တူညီသော ကုန်ပစ္စည်း (`StorefrontInventory` document တစ်ခုတည်း) ကို တစ်ပြိုင်နက်တည်း `findOneAndUpdate` လုပ်ရာတွင်လည်း WiredTiger သည် ဒုတိယ transaction ကို `WriteConflict` ပြန်တတ်ပြီး retry လုပ်ရန် လိုအပ်သည်။

### ၆.၂ Bottleneck #2 — Node.js Single-Core CPU Saturation (`~90% – 99.7%`)
- T-1 (`c=50`, `c=100`)၊ T-3 (`c=50`)၊ T-4 (`c=30`) နှင့် T-6 (`c=50`) တို့တွင် Backend Node.js process ၏ CPU သုံးစွဲမှုသည် **Single Core ၏ `90% – 99.7%`** သို့ ရောက်ရှိသွားသည်။
- အထူးသဖြင့် **T-4 (`GET /storefront-inventory?limit=100`)** တွင် request တစ်ခုတိုင်း၌ Mongoose document `100` ခုကို `.populate("inventoryId")` နှင့် `.populate("storefrontId")` ပြုလုပ်ခြင်း (`.lean()` မပါရှိခြင်း) ကြောင့် Mongoose hydration နှင့် JSON serialization က Event Loop ကို အဓိက ကြာမြင့်စေသည် (`~70 req/s` သာ ရသည်)။
- **T-3 (`GET /customer/notifications?limit=1`)** တွင် [`customerAuth.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/middlewares/customerAuth.js#L26) မှ `Customer.findById(decoded.id)` ၁ ကြိမ် + [`customerNotification.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/customerNotification.controller.js#L10-L24) မှ `find()`, `countDocuments()` (total), `countDocuments()` (unread) စုစုပေါင်း **request တစ်ခုလျှင် DB query ၄ ကြိမ်** ခေါ်နေသည်။

### ၆.၃ Bottleneck #3 — Uncached Aggregation Queries (`T-1` နှင့် `T-2`)
- **T-2 (`brands` နှင့် `subcategories`)** တွင် MongoDB CPU သည် `926.1%` (~9.2 cores) အထိ မြင့်တက်သွားသည် — အကြောင်းမှာ request တိုင်းတွင် `StorefrontInventory` မှ `Inventory` သို့ `$lookup` + `$group` aggregation pipeline ကို cache မရှိဘဲ အကြိမ်ကြိမ် တွက်ချက်နေသောကြောင့် ဖြစ်သည်။

---

## ၇။ Railway Production (Replica ၁ ခု) နှင့် နှိုင်းယှဉ် ခန့်မှန်းချက်

> **သတိပြုရန်:** ယခု Load Test သည် Local စက် (Intel i7-12650H, 16 logical cores, 15.7 GB RAM, Local NVMe MongoDB `<1ms` network RTT) ပေါ်တွင် တိုင်းတာထားခြင်း ဖြစ်ပါသည်။ Railway Production Container (Replica ၁ ခု) နှင့် MongoDB Atlas တို့သည် vCPU အရေအတွက်၊ shared CPU throttling နှင့် Network Latency (Railway ↔ Atlas ကြား `~2ms – 15ms` per DB round-trip) မတူညီသဖြင့် အောက်ပါ ကိန်းဂဏန်းများသည် **ခန့်မှန်းချက် (Estimate) သာ** ဖြစ်ပါသည်။

| အချက် | Local Test စက် | Railway Production (Replica ၁ ခု + Atlas) ခန့်မှန်းချက် |
|---|---|---|
| **Backend Memory (RSS)** | Idle `~90 MB` → Peak `328 MB` | Railway `512 MB` သို့မဟုတ် `1 GB` RAM plan တွင် OOM မဖြစ်ဘဲ လုံလောက်စွာ run နိုင်သည် |
| **Node.js CPU Throughput** | 1 Core အပြည့်တွင် Read `~300–630 req/s` | Shared/Container vCPU နှင့် Atlas network RTT ကြောင့် Read throughput သည် Local ၏ **~40% – 60% (`~120 – 250 req/s`)** ခန့် ရရှိနိုင်သည် |
| **DB Connection Pool (`maxPoolSize: 20`)** | Local တွင် query တစ်ခု `<1–3ms` သာ ကြာ၍ pool 20 ဖြင့် `c=100` ကို ကိုင်နိုင်သည် | Atlas network latency ပါဝင်လာချိန်တွင် Replica ၁ ခုအတွက် `maxPoolSize: 20` သည် သင့်တော်သော်လည်း တစ်ပြိုင်နက် query ၄ ခုခေါ်သော endpoint (ဥပမာ T-3, T-5) များတွင် connection wait time ပိုတက်လာမည် |
| **Rate Limiter (§2 တန်ဖိုးများ) နှင့် ကိုက်ညီမှု** | Staff `600/min` (`10 req/s`), Customer `120/min` (`2 req/s`), Public `300/min` (`5 req/s`) | Railway Replica ၁ ခုသည် တစ်ပြိုင်နက်တည်း POS ဝန်ထမ်း `5–10` ဦး + Ecommerce customer `30–50` ဦး၏ သာမန် အသုံးပြုမှု (`~20–50 req/s`) ကို `p95 < 500ms` အတွင်း ကောင်းမွန်စွာ ကိုင်တွယ်နိုင်သည် (သို့သော် T-5 Concurrent Order `WriteConflict` ကို ပြင်ဆင်ရန် လိုအပ်သည်) |

---

## ၈။ အကြံပြုချက်များ (Actionable Recommendations)

1. **[ဦးစားပေး ၁ — အရေးကြီးဆုံး] `POST /ecommerce/order` ၏ `WriteConflict` နှင့် `orderNumber` Race Condition ပြင်ဆင်ရန်:**
   - [`src/controllers/ecommerce.controller.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/controllers/ecommerce.controller.js#L519-L570) တွင် manual `session.startTransaction()` အစား `session.withTransaction()` (သို့မဟုတ် `TransientTransactionError` / `code === 112` နှင့် `E11000` အတွက် retry loop `3–5` ကြိမ်) ထည့်သွင်းရန်။
   - [`src/models/ecommerceOrder.model.js`](file:///c:/Users/PC/Desktop/Pyi-Taw-Tar/backend/src/models/ecommerceOrder.model.js#L142-L163) ရှိ `orderNumber` ထုတ်ပေးသည့်အပိုင်းကို atomic counter collection (`findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { upsert: true })`) သို့မဟုတ် POS `Order` ကဲ့သို့ retry loop ဖြင့် ပြောင်းလဲရန်။
2. **[ဦးစားပေး ၂] `GET /ecommerce/products/brands` နှင့် `/subcategories` (T-2) တွင် In-Memory TTL Cache (`30s – 60s`) ထည့်ရန်:**
   - Brand နှင့် Subcategory စာရင်းသည် မိနစ်တိုင်း ပြောင်းလဲလေ့မရှိသဖြင့် 60 စက္ကန့် in-memory cache ထားခြင်းဖြင့် MongoDB `$lookup` aggregation CPU သုံးစွဲမှုကို 99% လျှော့ချနိုင်မည်။
3. **[ဦးစားပေး ၃] `GET /storefront-inventory` (T-4) နှင့် `GET /customer/notifications` (T-3) Query ပေါ့ပါးစေရန်:**
   - Read-only controller များတွင် Mongoose `.lean()` အသုံးပြုခြင်းဖြင့် CPU နှင့် RAM သုံးစွဲမှုကို သိသာစွာ လျှော့ချနိုင်ပြီး T-4 ၏ latency ကို ထက်ဝက်ခန့် လျှော့ချနိုင်မည်။
   - `GET /customer/notifications?limit=1` တွင် `Customer.findById` နှင့် `countDocuments` ၂ ကြိမ်ကို `Promise.all` သို့မဟုတ် `$facet` ဖြင့် ပေါင်းစပ်ရန်။

---

## ၉။ Cleanup အတည်ပြုချက်

- [x] Temp Backend (`PORT=5055`) နှင့် Local MongoDB (`PORT=27018`) တို့ကို ရပ်တန့်ပြီး ဖြစ်ပါသည်။
- [x] `loadtest` DB data directory (`mongo-data-b`) နှင့် ယာယီ HAR / test script ဖိုင်အားလုံးကို အပြီးသတ် ဖျက်သိမ်းပြီး ဖြစ်ပါသည်။
- [x] `backend/.env` ဖိုင်ကို လုံးဝ မပြင်ဆင်ခဲ့ပါ (`git -C backend status --short` နှင့် `git -C dashboard status --short` တွင် ယာယီဖိုင် လုံးဝ မကျန်ရှိပါ)။

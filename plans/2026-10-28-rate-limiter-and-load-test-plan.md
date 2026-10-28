# Rate Limiter ပြန်ဒီဇိုင်း + Load Test Plan

- **ရက်စွဲ:** 2026-10-28
- **အခြေအနေ:** ⏳ Approval စောင့်ဆိုင်းဆဲ
- **နောက်ခံ:** "Project က ecommerce + dashboard traffic ဘယ်လောက် ကိုင်နိုင်လဲ" စစ်ဆေးချက်အရ — server ထက် **rate limiter က အရင်ပိတ်ဆို့မည်**

---

## ၁. လက်ရှိအခြေအနေ

| နေရာ | လက်ရှိ |
|---|---|
| `src/app.js:55` | `app.use(apiRateLimiter(60, 60 * 1000))` — **route အားလုံး**ကို **IP တစ်ခုလျှင် ၆၀ request/မိနစ်** (auth မစစ်မီ) |
| `src/middlewares/rateLimiter.middleware.js` | `express-rate-limit` v8 (`^8.2.1`), default **memory store**, key = IP |
| `src/app.js:54` | `app.set("trust proxy", 1)` (Nginx / Vercel proxy နောက်ကွယ်) |
| `dashboard/services/axios.ts:56-60` | 429 ရလျှင် ၂ ကြိမ် ပြန်ကြိုးစား (2s / 4s) |
| JWT (`src/services/jwtToken.service.js`) | admin + customer **secret တူ** (`JWT_SECRET`), payload `{ id, role, locationId? }` |
| Customer login | ecommerce က password ကို hardcode (`password123`) — လက်တွေ့တွင် **ဖုန်း + အမည်** ဖြင့်သာ ဝင် → login ကို brute force ကာကွယ်ရန် အရေးကြီး |

### ပြဿနာ
1. **IP တစ်ခုကို လူအများ မျှသုံး** — ဆိုင်/ရုံး Wi-Fi (ဝန်ထမ်း အားလုံး public IP တစ်ခု), မြန်မာ mobile carrier CGNAT (customer အများ IP တစ်ခု) → ဝန်ထမ်း ၂–၃ ယောက် / customer အနည်းငယ်ဖြင့်ပင် 429
2. Dashboard page တစ်ခု = request ၅–၁၅ ခု (menu ~5, POS ~10, search ရိုက်တိုင်း) → user တစ်ယောက်တည်းပင် ၁ မိနစ် ၆၀ ကို ကျော်နိုင်; 429 retry ကြောင့် ပိုဆိုး
3. Login / register ကို အခြား API နှင့် **တူညီ ကန့်သတ်ချက်** (၆၀/မိနစ်) — brute force အတွက် လွတ်လပ်လွန်း
4. Memory store — **Vercel serverless** တွင် instance တစ်ခုချင်း သီးခြားမှတ်၍ ကန့်သတ်ချက် မမှန် (DigitalOcean PM2 process ၁ ခု တွင်တော့ မှန်)

---

## ၂. ဒီဇိုင်းအသစ် — အဆင့် ၃ ဆင့် limiter

| Limiter | Key | ကန့်သတ်ချက် (default — env ဖြင့် ပြောင်းရ) | သုံးမည့်နေရာ |
|---|---|---|---|
| **A. Auth (တင်းကျပ်)** | IP | **10 / 15 မိနစ်** (အောင်မြင်သော login မရေတွက် — `skipSuccessfulRequests: true`) | `POST /admin/login`, `POST /customer/login`, `POST /customer/register` |
| **B. User (login ဝင်ပြီး)** | JWT `role:id` (token မှန်လျှင်) | admin / owner / cashier: **600 / မိနစ်**; customer: **120 / မိနစ်** | `/api/v1` အားလုံး (token ပါသော request) |
| **C. Public / token မပါ** | IP (`ipKeyGenerator` — IPv6 subnet) | **300 / မိနစ်** (CGNAT ကြောင့် မြင့်ထား) | token မပါသော request (`/ecommerce/products`, brands, shop-settings …) |

- **B ၏ key** — limiter ၏ `keyGenerator` ထဲ `jwt.verify(token, JWT_SECRET)` (HMAC — ပေါ့) ဖြင့် `role:id`; token မရှိ/မမှန်လျှင် **C** သို့ (IP) — auth middleware ၏ အလုပ်ကို မထိ (ဒီမှာ ကန့်သတ်ရန် key သာ ယူ)
- Order ကိုယ်စား B နှင့် C ကို limiter **တစ်ခု** (`max` ကို function ဖြင့် role အလိုက်) — app.js ၏ ယခုနေရာ (line 55) တွင် အစားထိုး
- A ကို route file တွင် (`admin.route.js:32`, `customer.route.js:34-35`) `validate` မတိုင်မီ ထည့်
- 429 response — ယခု JSON ပုံစံ (`code`, `status`, `message`) ကို ထိန်း + `standardHeaders: "draft-8"` ဖြင့် `RateLimit` / `Retry-After` header
- Limit တန်ဖိုး — `.env` (`RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_STAFF_MAX`, `RATE_LIMIT_CUSTOMER_MAX`, `RATE_LIMIT_PUBLIC_MAX`); မရှိလျှင် အထက်ပါ default — `.env.example` (ရှိလျှင်) တွင် ထည့်
- **Store** — DigitalOcean (process ၁ ခု) ဆိုလျှင် memory store ဆက်သုံး; **Vercel ဆိုလျှင်** §6 Q1

### Dashboard 429 retry
- `dashboard/services/axios.ts:56-60` — `Retry-After` header ရှိလျှင် ထိုစက္ကန့်အတိုင်း စောင့် (မရှိလျှင် ယခု 2s/4s); retry ၂ ကြိမ် ယခုအတိုင်း

---

## ၃. ပြင်ဆင်မည့်ဖိုင်
| ဖိုင် | ပြောင်းလဲမှု |
|---|---|
| `backend/src/middlewares/rateLimiter.middleware.js` | `authLimiter`, `apiLimiter` (role အလိုက် max + JWT/IP key) export; ယခု `apiRateLimiter` ကို ဖယ် (သုံးသောနေရာ app.js တစ်ခုတည်း) |
| `backend/src/app.js:55` | `app.use(apiLimiter)` |
| `backend/src/routes/admin.route.js:32` | `authLimiter` ထည့် |
| `backend/src/routes/customer.route.js:34-35` | `authLimiter` ထည့် |
| `backend/.env.example` (ရှိလျှင်) | `RATE_LIMIT_*` |
| `dashboard/services/axios.ts:56-60` | `Retry-After` ကို လေးစား |

> Business logic / auth middleware / response ပုံစံ **မပြောင်း**; dependency အသစ် **မထည့်** (express-rate-limit, jsonwebtoken ရှိပြီး)

---

## ၄. Limiter စစ်ဆေးနည်း (uomtest DB + port 5055 temp backend)
| # | စစ်ချက် | မျှော်မှန်း |
|---|---|---|
| L-1 | Admin token ဖြင့် `GET /inventory` 300 ကြိမ် / မိနစ် (IP တစ်ခု) | 429 **မရှိ** |
| L-2 | Admin token ၃ ခု (IP တူ) တစ်ယောက် 250 ကြိမ်စီ | 429 မရှိ (user အလိုက် ရေတွက်) |
| L-3 | Customer token ဖြင့် 130 ကြိမ် / မိနစ် | 121 ကြိမ်မြောက်မှ 429 |
| L-4 | Token မပါ `GET /ecommerce/products` 310 ကြိမ် | 301 ကြိမ်မြောက်မှ 429 |
| L-5 | `POST /customer/login` အမည်မှား 11 ကြိမ် | 11 ကြိမ်မြောက် 429; အမည်မှန်ဖြင့် login အောင်မြင်ခြင်းကို မရေတွက် |
| L-6 | Token အတု (signature မှား) | IP limiter (C) ဖြင့်သာ ရေတွက်, auth middleware က ယခုအတိုင်း 401 |
| L-7 | 429 response | JSON ပုံစံ ယခုအတိုင်း + `Retry-After` header ပါ |
| L-8 | Dashboard / ecommerce build preview ဖြင့် page ပုံမှန်သုံး (menu, POS, product list) | 429 မထွက် |

---

## ၅. Load test (Limiter ပြင်ပြီးမှ — capacity ကို နံပါတ်ဖြင့် သိရန်)

### ပတ်ဝန်းကျင်
- **Production ပေါ်တွင် လုံးဝ မလုပ်** — local temp backend (port 5055) + `uomtest` DB (product ~120, customer ~50, order ~200 seed)
- ⚠️ `uomtest` သည် production နှင့် **Atlas cluster တူ** — load test သည် production DB ၏ CPU ကို မျှသုံးမည်; ထို့ကြောင့် (က) **ညဘက် / user မရှိချိန်** လုပ် သို့ (ခ) **local MongoDB** (`mongod` / Docker) ဖြင့် လုပ် — §6 Q2
- Tool — `npx autocannon` (dependency မထည့်; one-off) ; load test အတွင်း limiter ကို `.env` ဖြင့် ယာယီ မြှင့် (limiter ကို မစမ်းဘဲ server ကို စမ်းရန်)

### Scenario
| # | Endpoint | Connections | ကြာချိန် | တိုင်းမည် |
|---|---|---|---|---|
| T-1 | `GET /ecommerce/products?brand=X` (public) | 10 → 50 → 100 | 30s စီ | req/s, p50/p95/p99 latency, error % |
| T-2 | `GET /ecommerce/products/brands`, `/subcategories` | 50 | 30s | 〃 |
| T-3 | `GET /customer/notifications?limit=1` (customer token) | 50 | 30s | 〃 |
| T-4 | `GET /storefront-inventory?page=1&limit=100` (admin token — POS) | 10 → 30 | 30s | 〃 |
| T-5 | `POST /ecommerce/order` (customer token, product ၁–၃ ခု) | 5 → 20 | 30s | 〃 + stock မှန်/မမှန် (oversell မရှိ) |
| T-6 | ရောနှော (T-1 70% / T-3 20% / T-5 10%) | 50 | 60s | 〃 |
- Pass စံ (ယာယီ) — p95 < 500ms, error < 1%; ထိုစံ ကျော်သော connection အရေအတွက် = ခန့်မှန်း ကိုင်နိုင်မှု
- Server CPU / memory (`process.memoryUsage`, Task Manager) နှင့် Atlas metrics ကို တစ်ပြိုင်နက် မှတ်

### Report
`backend/plans/2026-10-28-load-test-report.md` — scenario တစ်ခုချင်း ဇယား, bottleneck (CPU / DB pool 20 / Atlas), production droplet / Atlas tier နှင့် နှိုင်းယှဉ် ခန့်မှန်း, အကြံပြုချက် (PM2 cluster, pool size, product API cache …)

### Cleanup
Server ရပ်, `uomtest` drop (connection name assert), temp script ဖျက်, limiter `.env` ပြန်ထား

---

## ၆. ဆုံးဖြတ်ရန်
| # | မေးခွန်း | အကြံ |
|---|---|---|
| Q1 | Production backend ကို **DigitalOcean (PM2)** ဖြင့် run နေလား၊ **Vercel** လား | ✅ **2026-10-28 — Railway (railway.com) သုံးမည်** — §7 ကြည့် |
| Q2 | Load test ကို Atlas `uomtest` (production cluster မျှသုံး — ညဘက်) ဖြင့် လုပ်မလား၊ local MongoDB install လုပ်မလား | Local MongoDB (production ကို လုံးဝ မထိ) |
| Q3 | §2 limit တန်ဖိုး (staff 600, customer 120, public 300, auth 10/15min) သင့်တော်လား | ဤတန်ဖိုး; load test ပြီး ညှိ |
| Q4 | Limiter ကို အရင် ပြင်ပြီး load test ကို နောက်မှ လုပ်မလား (ခွဲလုပ်) | ခွဲ — limiter က 429 ပြဿနာကို ချက်ချင်း ဖြေ |

---

## ၇. Railway (railway.com) ပေါ်တွင် run မည် — limiter အတွက် သက်ရောက်ပုံ (2026-10-28)

| အချက် | Railway တွင် | ဤ plan တွင် လုပ်မည် |
|---|---|---|
| Process ပုံစံ | Container တစ်ခု အမြဲ run (Vercel ကဲ့သို့ serverless မဟုတ်) | **Replica ၁ ခု** ဆိုလျှင် memory store ဖြင့် limiter မှန် — dependency မလို |
| Replica ၂ ခုနှင့်အထက် (scale out) | replica တစ်ခုချင်း memory သီးခြား → limit မမှန် | ထိုအချိန်ကျမှ Railway ၏ **Redis service** + `rate-limit-redis` store (dependency အသစ်) — **ယခု plan တွင် မပါ** (replica ၁ ခု ဖြင့် စ) |
| Proxy | Railway edge proxy နောက်ကွယ် (`X-Forwarded-For`) | `trust proxy 1` ယခုအတိုင်း; deploy ပြီးနောက် `req.ip` သည် client IP ဟုတ်/မဟုတ် စစ်ရန် limiter test L-9 ထည့် |
| Port | Railway က `PORT` env ပေး | `src/server.js` က `process.env.PORT || 5000` ဖြင့် ဖတ်ပြီး — မပြောင်း |
| Env | Railway dashboard ၏ Variables | `RATE_LIMIT_*` (§2) ကို Railway Variables တွင် ထည့် (မထည့်လျှင် default) |

- **L-9 (Railway deploy ပြီးနောက်)** — ယာယီ log ဖြင့် `req.ip` ကို client ၂ ခု (Wi-Fi / mobile data) မှ ခေါ်၍ IP မတူကြောင်း စစ်; Railway proxy IP တစ်ခုတည်း ပေါ်နေလျှင် `trust proxy` hop အရေအတွက် ညှိ (မညှိလျှင် public limiter က user အားလုံးကို IP တစ်ခုအဖြစ် ရေတွက်မည်)
- **Load test (§5)** — Railway ၏ **staging environment** (production မဟုတ်) ပေါ်တွင် လုပ်နိုင် — local MongoDB / staging DB ဖြင့်သာ (production Atlas မထိ)

> Railway သို့ ပြောင်းရွှေ့ခြင်း (deploy) ကိုယ်တိုင် — Atlas network access, CORS origin (`CLIENT_ORIGINS`), env var ကူးခြင်း, domain, frontend ၏ API URL ပြောင်းခြင်း — သည် **သီးခြား deploy plan** ဖြစ်ရမည်

---

## ၈. ဆုံးဖြတ်ချက် (2026-10-28) — Antigravity အကောင်အထည်ဖော်ရန်

| # | ဆုံးဖြတ်ချက် |
|---|---|
| Q1 | Backend ကို **Railway တွင် deploy ပြီးသား** (production) — replica ၁ ခု, memory store |
| Q2 | Load test ကို **local MongoDB** ဖြင့်သာ (`C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe` ရှိပြီး) — production Atlas / Railway production ကို **လုံးဝ မထိ** |
| Q3 | §2 default တန်ဖိုး (staff 600 / customer 120 / public 300 / auth 10 per 15 min) |
| Q4 | **ခွဲလုပ်** — Phase A = limiter (§2–§4) + local test → user ကို report → user က Railway သို့ deploy → L-9 ကို production တွင် စစ်; Phase B = load test (§5) — local သာ |

### Local MongoDB ပြင်ဆင်ပုံ (Phase B)
- Order ဖန်တီးခြင်းသည် `session.withTransaction()` သုံး၍ **replica set လို** — single-node replica set ဖြင့် run:
  ```bash
  mkdir -p <temp-dir>/mongo-data
  "/c/Program Files/MongoDB/Server/8.2/bin/mongod" --dbpath <temp-dir>/mongo-data --port 27018 --replSet rs0 --bind_ip 127.0.0.1
  mongosh --port 27018 --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27018"}]})'
  ```
- Temp backend — `MONGODB_URI=mongodb://127.0.0.1:27018/loadtest?replicaSet=rs0 PORT=5055 ECOMMERCE_STOREFRONT_ID=<seed id> node src/server.js` (`.env` ၏ Atlas URI ကို env var ဖြင့် override — `.env` ဖိုင် မပြင်)
- Connection name `loadtest` ဖြစ်ကြောင်း seed script တွင် assert
- ပြီးလျှင် mongod ရပ်, `<temp-dir>/mongo-data` ဖျက်

### L-9 (Phase A ပြီး user deploy ပြီးနောက် — production တွင် **ဖတ်ရုံသာ**)
- Production API `GET /ecommerce/products` ကို network ၂ ခု (Wi-Fi / mobile data) မှ ခေါ်၍ response header `RateLimit` ၏ remaining သည် network တစ်ခုချင်း သီးခြား လျော့ကြောင်း စစ် (တူညီစွာ လျော့လျှင် Railway proxy IP ကို ရေတွက်နေ → `trust proxy` ညှိ)
- Production တွင် load / request အများ **မပို့** (တစ်ခုစီ ၃–၅ ကြိမ်သာ)

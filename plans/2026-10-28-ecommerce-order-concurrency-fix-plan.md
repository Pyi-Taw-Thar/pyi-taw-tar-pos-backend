# Ecommerce Order တစ်ပြိုင်နက်တင်ချိန် WriteConflict (500) ပြင်ရန် Plan

- **ရက်စွဲ:** 2026-10-28
- **အခြေအနေ:** ⏳ Approval စောင့်ဆိုင်းဆဲ
- **နောက်ခံ:** [`2026-10-28-load-test-report.md`](./2026-10-28-load-test-report.md) T-5 — `POST /ecommerce/order` ကို connection 5 ဖြင့် **55%**, 20 ဖြင့် **83%** သည် `500 WriteConflict` (code 112, `TransientTransactionError`); stock မှားခြင်း / oversell **မရှိ** (transaction rollback)

---

## ၁. အကြောင်းရင်း (code ဖြင့် အတည်ပြုပြီး)

| # | နေရာ | ပြဿနာ |
|---|---|---|
| 1 | `src/controllers/ecommerce.controller.js:519-570` (`createOrder`) | `session.startTransaction()` / `commitTransaction()` ကို ရိုးရိုး try/catch ဖြင့်သာ — **retry မရှိ**; transaction တစ်ခု conflict ဖြစ်တာနှင့် abort → 500 |
| 2 | `src/models/ecommerceOrder.model.js:142-163` (`pre("save")`) | နောက်ဆုံး `orderNumber` ကို `findOne(...).sort(...)` ဖြင့် **session မပါဘဲ** ဖတ်ပြီး +1 → တစ်ပြိုင်နက် transaction ၂ ခုက **နံပါတ်တူ** ထုတ် → `orderNumber` unique index တွင် conflict: (က) တစ်ဖက် commit မဖြစ်သေးလျှင် `WriteConflict` (transient), (ခ) commit ဖြစ်ပြီးလျှင် `E11000` duplicate key (transient **မဟုတ်**) |
| 3 | 〃 controller (stock) | ပစ္စည်းတူ (`StorefrontInventory` document တစ်ခုတည်း) ကို transaction ၂ ခု တစ်ပြိုင်နက် `findOneAndUpdate` → `WriteConflict` (transient) — retry ဖြင့် ပြေ |

> နှိုင်းယှဉ်ချက် — POS `src/controllers/order.controller.js` တွင် `error.code === 11000` ကို ၃ ကြိမ် retry loop (line ~581, ~646) ပါပြီး

---

## ၂. ပြင်ပုံ

### 2.1 `createOrder` — `session.withTransaction()` + `E11000` retry (အဓိကပြင်ဆင်ချက်)
```js
// ပုံကြမ်း — stock စစ်/validatedProducts တွက်ခြင်း (line ~329-516) ယခုအတိုင်း
const MAX_ORDER_ATTEMPTS = 3;
let order;
for (let attempt = 1; attempt <= MAX_ORDER_ATTEMPTS; attempt++) {
  const session = await mongoose.startSession();
  try {
    // WriteConflict (TransientTransactionError) / UnknownTransactionCommitResult ကို driver က အလိုအလျောက် ပြန်ကြိုးစား
    await session.withTransaction(async () => {
      for (const update of stockUpdates) { /* ယခု findOneAndUpdate ($gte + $inc) အတိုင်း, { session } */ }
      const [newOrder] = await EcommerceOrder.create([{ /* ယခုအတိုင်း */ }], { session });
      order = newOrder;
    });
    break; // အောင်မြင်
  } catch (err) {
    // orderNumber တူ၍ duplicate key — နံပါတ်အသစ်ဖြင့် transaction တစ်ခုလုံး ပြန်လုပ်
    if (err?.code === 11000 && err?.keyPattern?.orderNumber && attempt < MAX_ORDER_ATTEMPTS) continue;
    throw err;
  } finally {
    await session.endSession();
  }
}
```
- Callback ထဲတွင် DB write (session ပါ) သာ ရှိ — retry ဖြင့် ထပ် run လည်း ဘေးကင်း (notification / log / response **မရှိ** — ယခုအတိုင်း commit ပြီးမှ `populate` + `res.json`)
- Stock မလုံလောက် (`CustomError(400, …)`) — retry **မလုပ်**, ယခုအတိုင်း 400 ပြန် (`withTransaction` သည် transient label မပါသော error ကို ပြန်မကြိုးစား)
- Attempt ၃ ကြိမ်လုံး `E11000` ဖြစ်လျှင် — **409** `"အော်ဒါများ တစ်ပြိုင်နက် ဝင်နေပါသည်။ ခဏနေ ပြန်ကြိုးစားပါ။"` (500 မဟုတ်)

### 2.2 `orderNumber` ထုတ်ပုံ — atomic counter (နံပါတ်တူ ထုတ်ခြင်းကို အရင်းမှ ဖြေ)
- Model အသစ် `src/models/counter.model.js` — `{ _id: String /* "ECO-2026-10-28" */, seq: Number }`
- `pre("save")` ကို ပြောင်း:
  ```js
  const prefix = `ECO-${yyyy}-${mm}-${dd}-`;
  // session မပါ (transaction အပြင်) — counter document ကို transaction များ မလုတ်စေရန်; abort ဖြစ်လျှင် နံပါတ် ကျော်သွားနိုင် (gap) — §5 Q1
  const { seq } = await Counter.findOneAndUpdate(
    { _id: prefix.slice(0, -1) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  this.orderNumber = `${prefix}${String(seq).padStart(6, "0")}`;
  ```
- **ယနေ့ ရှိပြီးသား order နှင့် မထပ်စေရန်** — counter document မရှိသေးသော ရက် (deploy နေ့ + ရက်သစ်တိုင်း ပထမ order) တွင် ယခု regex ရှာပုံဖြင့် ယနေ့ အမြင့်ဆုံး seq ကို တစ်ကြိမ်ဖတ်၍ `Counter.updateOne({ _id }, { $max: { seq: lastSeq } }, { upsert: true })` ပြီးမှ `$inc` (`$max` ဖြစ်၍ တစ်ပြိုင်နက် ခေါ်လည်း ဘေးကင်း)
- 2.1 ၏ `E11000` retry သည် safety net အဖြစ် ဆက်ထား

### 2.3 Response / log
- 409 / 400 / 201 — ecommerce `Cart.tsx` က `err.response.data.message` ကို ပြပြီးသား (frontend မပြောင်း)
- Retry ဖြစ်ခဲ့လျှင် `console.warn` (attempt အရေအတွက်) — Railway log တွင် မြင်ရန်

---

## ၃. ပြင်ဆင်မည့်ဖိုင်
| ဖိုင် | ပြောင်းလဲမှု |
|---|---|
| `src/controllers/ecommerce.controller.js` (`createOrder`, line ~518-570) | §2.1 |
| `src/models/counter.model.js` *(အသစ်)* | §2.2 |
| `src/models/ecommerceOrder.model.js` (`pre("save")`, line ~142-163) | §2.2 |

> Stock စစ်ပုံ (`$gte` + `$inc`), ဈေးတွက်ပုံ, validation, response ပုံစံ, POS order **မပြောင်း**; ecommerce frontend **မပြောင်း**; dependency အသစ် **မထည့်**

---

## ၄. စစ်ဆေးမည့်နည်း (load test report §2 ၏ local setup အတိုင်း — production / Railway **မထိ**)
Local MongoDB single-node replica set (port 27018, DB `ordertest` — connection name assert) + temp backend (PORT=5055, `RATE_LIMIT_*` ယာယီ မြှင့်) + `npx autocannon`

| # | စစ်ချက် | Pass စံ |
|---|---|---|
| O-1 | T-5a — `POST /ecommerce/order` c=5, 30s (product ၁–၃ ခု, customer 50) | error (non-2xx) **< 1%**, 500 **0** |
| O-2 | T-5b — c=20, 30s | error < 1%, 500 0; p95 ကို မှတ် (retry ကြောင့် တက်နိုင်) |
| O-3 | Commit ဖြစ်သော order အားလုံး | `orderNumber` **duplicate 0**; ရက်တစ်ရက်အတွင်း seq ကျော်/ထပ် စစ် (gap ရှိနိုင် — မှတ်) |
| O-4 | Stock မှန်ကန်မှု | `negativeStockCount 0`, `initialStock − remaining === sum(orderUnits)` (`mismatchCount 0`) |
| O-5 | Oversell — stock 500 ပစ္စည်းကို c=20 | commit order **500 အတိအကျ**, stock 0, ကျန် request များ 400 |
| O-6 | ယခင်ရှိပြီးသား ယနေ့ order (ဥပမာ `…-000037`) ရှိသော DB တွင် server စ ပြီး order တင် | နံပါတ်သစ် `…-000038` မှ စ (ထပ်မဖြစ်) |
| O-7 | Stock မလုံလောက် order | 400 ယခုအတိုင်း (retry မလုပ်) |
| O-8 | Ecommerce app (build preview) မှ cart → order တင် | ယခုအတိုင်း success modal, profile တွင် order ပေါ် |
- Cleanup — server / mongod ရပ်, data dir ဖျက်, temp script ဖျက်

---

## ၅. ဆုံးဖြတ်ရန်
| # | မေးခွန်း | အကြံ |
|---|---|---|
| Q1 | Order abort ဖြစ်လျှင် နံပါတ် ကျော်သွားခြင်း (ဥပမာ `…-000041` ပြီး `…-000043`) လက်ခံနိုင်လား | **လက်ခံ** — counter ကို transaction အပြင်ထားမှ conflict မဖြစ်; နံပါတ် ဆက်တိုက်ဖြစ်ရန် transaction ထဲထားလျှင် counter ကို လုတ်ပြီး conflict ပြန်ဖြစ် |
| Q2 | §2.2 counter ကိုပါ လုပ်မလား၊ §2.1 (`withTransaction` + retry) တစ်ခုတည်းနဲ့ အရင် စမ်းမလား | **နှစ်ခုလုံး** — 2.1 တစ်ခုတည်းဆိုလျှင် order များချိန် retry များပြီး နှေး |
| Q3 | POS order (`order.controller.js`) ၏ `ORD-` နံပါတ်ကိုပါ counter သို့ ပြောင်းမလား | **ယခု မလုပ်** — POS ကို ယာယီ ဖျောက်ထားပြီး retry ပါပြီး |
| Q4 | Claude ပြင်မလား၊ Antigravity ကို ပေးမလား | — |

## ၆. Scope အပြင် (သိထားရုံ)
- `pre("save")` ၏ ရက်စွဲကို `new Date()` (server timezone) ဖြင့် ယူ — Railway သည် UTC ဖြစ်လျှင် မြန်မာစံတော်ချိန် ည 12:00 – မနက် 6:30 order များ၏ နံပါတ်ရက်စွဲ တစ်ရက် နောက်ကျနိုင် — သီးခြား စစ်/ပြင်ရန်

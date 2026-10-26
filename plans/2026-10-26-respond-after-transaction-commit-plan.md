# Transaction Commit ပြီးမှ Response ပြန်ပို့ရန် Plan

- **ရက်စွဲ:** 2026-10-26
- **အခြေအနေ:** ✅ ပြီး (2026-10-26) — handler ၉ ခုလုံး ပြင်ပြီး `uomtest` DB ဖြင့် API test 22/22 pass (test DB ဖျက်ပြီး)

## ၁. ပြဿနာ
Handler အချို့သည် `res.status(...).json(...)` ကို `session.withTransaction(async () => { ... })` **callback အတွင်း** ခေါ်နေသည်။

```js
await session.withTransaction(async () => {
  ...
  await order.save({ session });
  res.status(200).json({ data: order });   // ❌ commit မဖြစ်သေး
});
```

ဖြစ်လာနိုင်သည့် ပြဿနာ ၃ ခု —
1. **Commit မတိုင်မီ success ပြန်** — Client က ချက်ချင်း ပြန်ဖတ်လျှင် data အဟောင်း ရ (Scenario E test တွင် တကယ် ဖြစ်ခဲ့ — response ရပြီး ပြန်ဖတ်ရာ ပုံး 3, နောက်မှ ပုံး 4)
2. **Commit fail ဖြစ်လျှင်** — Client က success ရပြီးသား ဖြစ်သော်လည်း data မသိမ်းမိ (`catch` က `next(error)` ခေါ်လျှင် "headers already sent")
3. **Transient error ဖြင့် retry လုပ်လျှင်** — Callback ကို ထပ် run ၍ response ၂ ကြိမ် ပို့ → crash; `logActivity` လည်း ၂ ကြိမ် ရေး

## ၂. သက်ရောက်သော Handler များ (script ဖြင့် ရှာပြီး ကိုယ်တိုင် စစ်ပြီး)

| ဖိုင် | Handler | Line |
|---|---|---|
| `ecommerce.controller.js` | `updateEcommerceOrderProducts` | ~1288 |
| `order.controller.js` | `updateOrderCreditPersonId` | ~874 |
| `order.controller.js` | `updateOrderPaidAmount` | ~968 |
| `order.controller.js` | `addOrderItems` | ~1339 |
| `order.controller.js` | `removeOrderItems` | ~1614 |
| `creditRecord.controller.js` | `createCreditPayment` | ~146 |
| `creditRecord.controller.js` | `hardDeleteCreditRecord` | ~701 |
| `supplierCreditPayment.controller.js` | `createSupplierCreditPayment` | ~115 |
| `supplierCreditPayment.controller.js` | `deleteSupplierCreditPayment` | ~431 |

> `fulfillment.controller.js` (`savePartialFulfillment`, `fulfillOrder`) သည် `updatedOrder` variable ထဲ သိမ်းပြီး commit ပြီးမှ ပို့နေ၍ **မှန်ပြီးသား** — ဤ plan ၏ pattern ကို ထိုနည်းအတိုင်း ယူမည်။

## ၃. ဖြေရှင်းပုံ (Handler အားလုံး တူညီ pattern)

```js
let responseBody = null;
let activityLog = null;

await session.withTransaction(async () => {
  ...                                   // DB ပြောင်းလဲမှုများ (မပြောင်း)
  responseBody = { success: true, message: "...", data: order };
  activityLog = { admin: req.user._id, action: "...", ... };   // ရေးမည့်အရာကိုသာ မှတ်
});

// commit အောင်မြင်မှသာ
if (activityLog) logActivity(activityLog);
res.status(200).json(responseBody);
```

- Business logic / validation / DB write များကို **လုံးဝ မပြောင်းပါ** — `res` နှင့် `logActivity` ကိုသာ callback ပြင်ပသို့ ရွှေ့
- Retry ဖြစ်လျှင် variable များကို ထပ် assign ရုံသာ (နောက်ဆုံး အောင်မြင်သော run ၏ တန်ဖိုး ကျန်)
- `createAndSendCustomerNotification({ session })` ကဲ့သို့ **session ပါသော** write များသည် transaction ၏ အစိတ်အပိုင်း ဖြစ်၍ callback ထဲတွင် ဆက်ထားမည်
- Status code (200/201) နှင့် response shape ကို မူလအတိုင်း ထားမည် — Dashboard / Ecommerce frontend ပြင်ရန် မလို

## ၄. စစ်ဆေးမည့်နည်း
1. `node --check` ဖိုင် ၄ ခု + server start
2. သီးခြား test DB (`uomtest`, ယခင် Scenario test အတိုင်း) ဖြင့် —
   - `updateEcommerceOrderProducts` add/remove → response ရပြီး **ချက်ချင်း** DB ပြန်ဖတ် → data အသစ် (ယခင် fail ဖြစ်ခဲ့သော Scenario E ပြန်စစ်)
   - `addOrderItems` / `removeOrderItems` (POS completed order) → response data = DB data
   - `updateOrderPaidAmount`, `updateOrderCreditPersonId` → 200
   - `createCreditPayment` / `createSupplierCreditPayment` → 201 + activity log **တစ်ကြိမ်တည်း**
   - မှားသော input (ဥပမာ remove qty ကျော်) → 400 ပြန်ပြီး "headers already sent" error မတက်
3. စစ်ပြီး test DB ဖျက်

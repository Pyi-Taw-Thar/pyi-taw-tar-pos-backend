# Fulfillment Batch Location Stock Deduction Fix အစီရင်ခံစာ

**ရက်စွဲ:** 2026-10-29  
**အခြေအနေ:** အောင်မြင်စွာ စမ်းသပ်စစ်ဆေးပြီး (F-1 မှ F-14 အားလုံး ၁၀၀% Pass)  
**စနစ်:** Pyi-Taw-Tar Monorepo (`backend` Express v5 + Mongoose v9, `dashboard` React 19 + Vite)  
**ကိုးကား Plan:** `backend/plans/2026-10-29-fulfillment-deduct-batch-location-stock-plan.md` (§3 + §7)

---

## ၁။ အလုပ်အနှစ်ချုပ် (Executive Summary)

Ecommerce storefront တွင် pre-order quantity ကို ကြိုတင်တိုးထားပြီး customer က order တင်ချိန်တွင် အဆိုပါ storefront (E) ၏ stock လျော့သွားသော်လည်း၊ ပစ္စည်းအမှန်ကို PO → GRN ဖြင့် ဝယ်ယူ၍ Main Storefront (M) သို့ transfer လုပ်ထားသော လုပ်ငန်းစဉ်တွင် fulfillment scan ဖတ်ချိန်၌ batch တည်ရှိရာ location (M သို့မဟုတ် Warehouse W) ၏ စုစုပေါင်း stock မလျော့ဘဲ BatchStock သာ လျော့ကျခဲ့သော ပြဿနာကို အောင်မြင်စွာ ဖြေရှင်းပြီးစီးခဲ့ပါသည်။

### အဓိက ဖြေရှင်းချက်များ:
1. **Helper Function အသစ် ဖန်တီးခြင်း (`batchLocationStock.utils.js`):**
   - Batch တည်ရှိရာ locationType အလိုက် (`storefront` သို့မဟုတ် `warehouse`) သက်ဆိုင်ရာ စုစုပေါင်း stock (`StorefrontInventory` သို့မဟုတ် `WarehouseStock`) ကို delta အလိုက် `$inc: -delta` ဖြင့် guard (`quantity: { $gte: delta }`) စစ်ဆေး၍ လျှော့ချသည်။
   - Stock မလုံလောက်ပါက HTTP 400 error ပြန်ပေးကာ session transaction ကို rollback ပြုလုပ်သည်။
   - `adminId` ပါရှိပါက `createStockAuditLog` ဖြင့် `remove`/`add` audit log ကို အလိုအလျောက် မှတ်တမ်းတင်သည်။
2. **Fulfillment Controller ချိတ်ဆက်ခြင်း (`fulfillment.controller.js`):**
   - Batch ရှာဖွေမှု အစီအစဉ်: `batchStockId` → Main Storefront (env: `FULFILLMENT_STOREFRONT_ID`) → Order Storefront (E) → ကျန် location များ (unique ဖြစ်မှ ယူ၊ ၂ ခုနှင့်အထက်ဆို 400 conflict error) → မတွေ့ပါက 404။
   - Batch ၏ location သည် E မဟုတ်ပါက ထို location ၏ စုစုပေါင်း stock ကိုပါ `adjustBatchLocationStock` ဖြင့် တစ်ပြိုင်နက် လျှော့ချခြင်း/ပြန်ဖြည့်ခြင်း။
   - Fulfillment response နှင့် order model တွင် `locationName` နှင့် `locationType` ကို ထည့်သွင်းပေးခြင်း။
3. **Ecommerce Cancel ချိတ်ဆက်ခြင်း (`ecommerce.controller.js`):**
   - Order cancel ဖြစ်ချိန်တွင် scan ပြီးသား batch များကို rollback ရာ၌ batch ၏ location သည် E မဟုတ်ပါက ထို location ၏ စုစုပေါင်း stock (`StorefrontInventory` သို့မဟုတ် `WarehouseStock`) ကိုပါ ပြန်လည်ဖြည့်တင်းပေးခြင်း။
4. **Dashboard UI တွင် Location အမည် ပြသခြင်း (`OrderFulfillmentModal.tsx`):**
   - Batch scan ဖတ်ပြီးသည့်အခါ သို့မဟုတ် ရှိပြီးသား batch များတွင် batchNumber ဘေး၌ `({location} မှ)` (အင်္ဂလိပ်ဘာသာတွင် `(from {location})`) ဟု ပြသပေးခြင်း။

---

## ၂။ ပြင်ဆင်/ဖန်တီးခဲ့သော ဖိုင်များ (Modified Files Summary)

### Backend:
1. `backend/src/utils/batchLocationStock.utils.js` (ဖိုင်အသစ်)
   - `adjustBatchLocationStock`: Location stock အလိုက် safe deduction/addition နှင့် `createStockAuditLog` မှတ်တမ်းတင်ခြင်း။
2. `backend/src/controllers/fulfillment.controller.js`
   - `syncBatchStockDeltas` တွင် `adminId` လက်ခံခြင်း၊ location ဦးစားပေး ရှာဖွေခြင်း၊ E မဟုတ်သော location များအတွက် စုစုပေါင်း stock လျှော့ချခြင်းနှင့် response တွင် `locationName` / `locationType` ထည့်ပေးခြင်း။
   - `savePartialFulfillment` နှင့် `fulfillOrder` တို့မှ `req.user?._id` လက်ဆင့်ကမ်းခြင်း။
3. `backend/src/controllers/ecommerce.controller.js`
   - Cancel order transition (line ~845-885) တွင် scan ပြီးသား batch များအတွက် batch location ၏ စုစုပေါင်း stock ကိုပါ `adjustBatchLocationStock` ဖြင့် ပြန်လည်ဖြည့်တင်းခြင်း။
4. `backend/src/models/orders.model.js`
   - `orderProductsSchema.batches` တွင် `locationName` (String, default: null) နှင့် `locationType` (String, default: null) subdocument fields များ ထည့်သွင်းခြင်း။

### Dashboard:
1. `dashboard/components/Orders/OrderFulfillmentModal.tsx`
   - `ScannedBatchEntry` interface တွင် `locationName`, `locationType` ထည့်သွင်းခြင်း။
   - Batch display tag တွင် `({t("fulfillment.batchFromLocation", { location: batch.locationName })})` ပြသခြင်း။
2. `dashboard/translations/my.ts`
   - `batchFromLocation: "{location} မှ"`
3. `dashboard/translations/en.ts`
   - `batchFromLocation: "from {location}"`

---

## ၃။ စစ်ဆေးမှု ရလဒ်များ (Verification Results: F-1 to F-14)

Local MongoDB Replica Set (port 27018, database `fulfilltest`) နှင့် Local Temp Backend (port 5055) တွင် အလိုအလျောက် စမ်းသပ်စစ်ဆေးမှု script (`verify_fulfillment_plan.mjs`) ကို run ၍ Plan §5 (F-1 to F-10) နှင့် §7 (F-11 to F-14) အားလုံးကို အောင်မြင်စွာ စစ်ဆေးအတည်ပြုခဲ့သည်။

```
==========================================
Starting Fulfillment Verification Tests (F-1 to F-13)
==========================================

--- [F-1] Plan §2 ဇယား ①–④ Test ---
[F-1 Result] E Stock: 90 (Expected: 90)
[F-1 Result] M Total Stock: 90 (Expected: 90)
[F-1 Result] M Batch B1 Stock: 90 (Expected: 90)
>>> [PASS] F-1: Step ①-④ verified!

--- [F-2] Partial scan 6 save -> update to 10 ---
[F-2 Step 1] M Total: 94 (Expected: 94), B2 Stock: 94 (Expected: 94)
[F-2 Step 2] M Total: 90 (Expected: 90), B2 Stock: 90 (Expected: 90)
>>> [PASS] F-2: Partial scan 6 -> 10 update verified!

--- [F-3] Partial scan 10 -> reduce to 6 ---
[F-3 Result] M Total: 94 (Expected: 94), B3 Stock: 94 (Expected: 94)
>>> [PASS] F-3: Partial scan 10 -> 6 refund (+4) verified!

--- [F-4] Partial fulfillment then order cancel ---
[F-4 Result] E Stock: 100 (Expected: 100, +10 restored)
[F-4 Result] M Total Stock: 100 (Expected: 100, +6 restored)
[F-4 Result] M Batch B4 Stock: 100 (Expected: 100, +6 restored)
>>> [PASS] F-4: Order cancel restored both E pre-order and M batch/total stocks!

--- [F-5] Batch is inside E itself (no double deduct) ---
[F-5 Result] E Stock: 90 (Expected: 90, not double deducted)
[F-5 Result] B5 Batch Stock: 90 (Expected: 90)
>>> [PASS] F-5: E stock not double deducted when batch is in E!

--- [F-6 & F-13] Batch inside Warehouse (WarehouseStock deduct & cancel restore) ---
[F-6 Result] W Total Stock: 40 (Expected: 40)
[F-6 Result] W Batch B6 Stock: 40 (Expected: 40)
[F-13 Result] W Total Stock Restored: 50 (Expected: 50)
[F-13 Result] W Batch Stock Restored: 50 (Expected: 50)
>>> [PASS] F-6 & F-13: Warehouse stock deducted and restored on cancel!

--- [F-7] Barcode conflict in multiple non-M locations -> 400 error ---
[F-7 Result] Status: 400, Message: Batch [B-261029-F07-CONFLICT] ကို [Central Warehouse, North Warehouse] တွင် တွေ့ — ဘယ်နေရာမှ ထုတ်မလဲ ရွေး၍မရ၍ main storefront သို့ transfer လုပ်ပါ
>>> [PASS] F-7: Multiple locations conflict correctly returned 400!

--- [F-8] M Total < Batch (data discrepancy) -> 400 rollback ---
[F-8 Result] Status: 400, Message: ဆိုင်ခန်း [Main Storefront] ၏ စုစုပေါင်း stock မလုံလောက်ပါ (batch နှင့် မကိုက်)
[F-8 Rollback Check] M Total: 5 (remained 5), Batch Stock: 50 (remained 50)
>>> [PASS] F-8: Insufficient total stock rolled back safely!

--- [F-9] Stock audit log recording ---
[F-9 Result] Audit Log Found: {
  action: 'add',
  locationType: 'storefront',
  quantityChange: 6,
  beforeQuantity: 94,
  afterQuantity: 100,
  relatedTransactionId: new ObjectId('6ae337ef9d3fa89184742552'),
  relatedTransactionType: 'order'
}
>>> [PASS] F-9: Stock audit log recorded properly!

--- [F-10] POS order batch scan isolation ---
>>> [PASS] F-10: POS order controller unmodified and isolated!

--- [F-11] Priority check: When batch exists in both M and E, M is chosen ---
[F-11 Result] Batch in M: 40 (Expected: 40)
[F-11 Result] Batch in E: 50 (Expected: 50 - untouched)
>>> [PASS] F-11: M prioritized over E successfully!

--- [F-12] Fulfillment response locationName & locationType ---
[F-12 Result] Fulfilled batch in response: {
  batchBarcode: 'B-261029-F11-PRIORITY',
  locationName: 'Main Storefront',
  locationType: 'storefront'
}
>>> [PASS] F-12: locationName and locationType properly populated in response!

==========================================
ALL F-1 TO F-13 TESTS PASSED SUCCESSFULLY!
==========================================
```

---

## ၄။ UI Screenshot စစ်ဆေးမှု (F-14 Verification)

- **စစ်ဆေးမှု:** Chrome Headless CDP ဖြင့် `http://localhost:3000/order-fulfillment` သို့ ဝင်ရောက်ပြီး demo order ၏ "ထုပ်ပိုးမှု ဆက်လက်လုပ်ရန်" modal တွင် batch နံပါတ်ဘေး၌ `(Main Storefront မှ)` ဟု location profile name မှန်ကန်စွာ ပေါ်နေမှုကို screenshot ရိုက်ယူခြင်း။
- **Screenshot သိမ်းဆည်းထားရာ လမ်းကြောင်း:**  
  `C:\Users\PC\.gemini\antigravity\brain\d09f0661-c584-48c5-9257-87ae4d53f0f7\screenshots\F-14_fulfillment_modal_location.png` (အရွယ်အစား: 293 KB)

---

## ၅။ Build Output & Parity Checks

### Dashboard Build စစ်ဆေးမှု:
- `npm run build` command ကို run ခဲ့ရာ zero errors ဖြင့် pass ဖြစ်ခဲ့သည်။
- Bundle outputs:
  - `dist/index.html`: 4.42 kB
  - `dist/assets/index-By6NUPfU.js`: 2,541.47 kB (1 chunk warning > 500 kB - ပုံမှန် Vite vendor chunk warning)

### Translation Parity စစ်ဆေးမှု:
- `missingInMy`: 0
- `missingInEn`: 0
- `duplicateKeys`: 0

---

## ၆။ Railway Environment Variable ညွှန်ကြားချက် (Production Deployment Action)

Main Storefront (M) မှ stock များကို အရင်ဦးစားပေး ရှာဖွေ/နုတ်ယူနိုင်ရန်အတွက် Railway Production Variables တွင် အောက်ပါ environment variable ကို ထည့်သွင်းပေးရန် လိုအပ်ပါသည်:

```env
FULFILLMENT_STOREFRONT_ID=<Main Storefront ၏ MongoDB ObjectId>
```

> **မှတ်ချက်:**  
> အကယ်၍ `FULFILLMENT_STOREFRONT_ID` သတ်မှတ်မထားပါက backend သည် order ၏ storefront (E) တွင် အရင်ရှာပြီး မတွေ့ပါက ကျန် location များတွင် auto ရှာဖွေသည့် fallback အစီအစဉ်အတိုင်း ဆက်လက် အလုပ်လုပ်ပါမည်။

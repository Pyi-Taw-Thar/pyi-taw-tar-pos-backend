# Fulfillment — Scan ဖတ်သော Batch ရှိရာ Location (Main Storefront) ၏ Stock ကို လျော့ရန် Plan

- **ရက်စွဲ:** 2026-10-29
- **အခြေအနေ:** ⏳ Approval စောင့်ဆိုင်းဆဲ

## ၁. User ၏ လုပ်ငန်းစဉ် (လိုချင်သည့်အတိုင်း)
1. **Ecommerce storefront (E)** ၏ quantity ကို **pre-order အတွက်** ကိုယ်တိုင် တိုးထား (ပစ္စည်းအမှန် မဟုတ် — customer မှာနိုင်သော ပမာဏ)
2. Customer က ecommerce မှ order တင် → **E ၏ quantity လျော့** (ယခုအတိုင်း — pre-order ခွင့် လျော့)
3. ထိုပစ္စည်းကို PO → GRN ဖြင့် ဝယ် → batch ဖန်တီး → batch ကို **main storefront (M)** သို့ transfer
4. Order fulfillment တွင် batch barcode scan → **scan ဖတ်သော batch ရှိရာ M ၏ stock လျော့ရမည်** (batch + M ၏ စုစုပေါင်း)

## ၂. ယခု ဘာဖြစ်နေလဲ (code ဖြင့် အတည်ပြုပြီး)
| အဆင့် | E (StorefrontInventory) | M (StorefrontInventory — စုစုပေါင်း) | M (BatchStock) |
|---|---|---|---|
| ① E ကိုယ်တိုင် +10 | +10 | — | — |
| ② Order 10 | −10 | — | — |
| ③ Transfer batch → M | — | +10 | +10 |
| ④ Fulfillment scan 10 | — | **မလျော့** ❌ | −10 |
| **ရလဒ်** | 0 | **10 (မှား — ပစ္စည်း မရှိတော့)** | 0 |

- `src/controllers/fulfillment.controller.js:89-96` (`syncBatchStockDeltas`) — batch ကို order ၏ storefront (E) တွင် ရှာ → မတွေ့ → **location မစစ်ဘဲ barcode တူ batch** ကို ယူ → `BatchStock.quantity` သာ နုတ်; ထို batch ရှိရာ location (M) ၏ `StorefrontInventory` **မထိ**
- Cancel (`ecommerce.controller.js:~846-856`) — scan ပြီးသား `BatchStock` ကိုသာ ပြန်ထည့်; M ၏ စုစုပေါင်း မထိ (④ ကို ပြင်လျှင် ဤနေရာလည်း ပြန်ထည့်ရမည်)

## ၃. ပြင်ပုံ

### 3.1 Batch ရှိရာ location ၏ stock ကို delta အတိုင်း လျော့/ပြန်ထည့် (`syncBatchStockDeltas`)
Batch တစ်ခုချင်း၏ `delta` (scan အသစ် − ယခင်သိမ်းထား) တွက်ပြီး `BatchStock` ပြောင်းသည့်နေရာ (line ~120-150) တွင် —
| Batch ၏ location | လုပ်မည် |
|---|---|
| **Order ၏ storefront (E) နှင့် တူ** | ယခုအတိုင်း `BatchStock` သာ (E ၏ စုစုပေါင်းကို order တင်ချိန် နုတ်ပြီးသား — ထပ်မနုတ်) |
| **တခြား storefront (ဥပမာ M)** | `BatchStock` + **M ၏ `StorefrontInventory`** ကို `delta` အတိုင်း (`delta > 0` → `$inc: -delta` with `quantity: { $gte: delta }`; `delta < 0` → `$inc: +|delta|`) |
| **Warehouse** | `BatchStock` + **ထို warehouse ၏ `WarehouseStock`** ကို အလားတူ (§6 Q2) |
- M / warehouse ၏ စုစုပေါင်း မလုံလောက်လျှင် (`$gte` မကိုက် — data ကွဲနေ) → **400** "ဆိုင်ခန်း [M] ၏ စုစုပေါင်း stock မလုံလောက်ပါ (batch နှင့် မကိုက်)"
- ပြောင်းလဲမှုတိုင်း `createStockAuditLog` (`locationType`, `locationId`, before/after, reason `"ecommerce fulfillment <orderNumber> — batch <batchNumber>"`) — fulfillment ၏ shortfall restore (line ~389-400) ပုံစံအတိုင်း
- Transaction (`session`) ထဲမှာပဲ — ယခု `savePartialFulfillment` / `fulfillOrder` က session ပေးပြီး

### 3.2 Batch ရွေးပုံ ရှင်းစေရန် (line ~74-104)
1. `batchStockId` ပါ → ထို batch (ယခုအတိုင်း)
2. `batchBarcode` / `batchNumber` → **order ၏ storefront (E)** တွင် ရှာ (ယခုအတိုင်း)
3. E တွင် မရှိ → barcode တူ batch များကို location အားလုံးမှ ရှာ (`quantity > 0`):
   - **တစ်ခုတည်း** → ထို batch
   - **တစ်ခုထက်ပို** (barcode တူ batch ကို location ၂ ခုတွင် ခွဲထားခဲ့လျှင်) → env `FULFILLMENT_STOREFRONT_ID` (M) သတ်မှတ်ထားပြီး ထိုထဲ ရှိလျှင် ထို batch; မဟုတ်လျှင် **400** "Batch [barcode] ကို location ၂ ခုတွင် တွေ့ — [location အမည်များ]" (မှန်းဆ မရွေး) — §6 Q1
- Response ၏ batch line တွင် `locationName` ထည့် (dashboard fulfillment modal တွင် "Main Storefront မှ" ဟု ပြနိုင်ရန် — UI ပြင်ခြင်းသည် §6 Q3)

### 3.3 Cancel တွင် ပြန်ထည့် (`ecommerce.controller.js` `updateEcommerceOrderStatus`, line ~846-856)
- Scan ပြီးသား batch ကို ပြန်ထည့်ရာတွင် batch ၏ location ≠ order storefront ဆိုလျှင် **ထို location ၏ StorefrontInventory / WarehouseStock ကိုပါ** ပြန်ထည့် (§3.1 ၏ ပြောင်းပြန်) + audit log
- E ၏ pre-order quantity ပြန်ထည့်ခြင်း (line ~866-880) — ယခုအတိုင်း

### 3.4 မပြောင်းသော အပိုင်း
- Order တင်ချိန် E ၏ quantity နုတ်ခြင်း (pre-order ခွင့်) — **ယခုအတိုင်း**
- Fulfillment ပြီးချိန် scan နည်းလျှင် (shortfall) E ကို ပြန်ထည့်ခြင်း (line ~387) — ယခုအတိုင်း
- POS order (`order.controller.js`) — သူ့ storefront ၏ batch သာ (မထိ)

## ၄. ပြင်ဆင်မည့်ဖိုင်
| ဖိုင် | |
|---|---|
| `backend/src/controllers/fulfillment.controller.js` (`syncBatchStockDeltas`) | §3.1, §3.2 |
| `backend/src/controllers/ecommerce.controller.js` (cancel block) | §3.3 |
| (လိုလျှင်) `backend/src/utils/batchLocationStock.utils.js` *(အသစ်)* | location အလိုက် StorefrontInventory / WarehouseStock ± + audit log helper — fulfillment နှင့် cancel မျှသုံး |

> Model / route / dashboard မပြောင်း (Q3 မှလွဲ၍); dependency အသစ် မထည့်

## ၅. စစ်ဆေးမည့်နည်း (local MongoDB replica set — production မထိ)
| # | စစ်ချက် | မျှော်မှန်း |
|---|---|---|
| F-1 | §2 ဇယား ①–④ (E ≠ M) | ④ ပြီး: E 0, **M စုစုပေါင်း 0**, M batch 0 |
| F-2 | Partial — scan 6 သိမ်း → 10 သို့ ပြင် | M: −6 ပြီး −4 (စုစုပေါင်း −10) |
| F-3 | Partial — scan 10 → 6 သို့ လျှော့ | M ကို +4 ပြန်ထည့် |
| F-4 | Fulfillment တစ်ဝက် scan ပြီး ecommerce order cancel | M batch + M စုစုပေါင်း ပြန်ပြည့်; E pre-order quantity ပြန်ထည့် |
| F-5 | Batch သည် E ထဲမှာပဲ ရှိ (E = M) | E စုစုပေါင်း **ထပ်မလျော့** (order တင်ချိန်တစ်ကြိမ်သာ); batch လျော့ |
| F-6 | Batch သည် warehouse ထဲ | Q2 အတိုင်း (WarehouseStock လျော့ / သို့ 400) |
| F-7 | Barcode တူ batch location ၂ ခု | `FULFILLMENT_STOREFRONT_ID` ရှိ → ထိုနေရာ; မရှိ → 400 location စာရင်း |
| F-8 | M စုစုပေါင်း < batch (data ကွဲ) | 400, stock မပြောင်း (transaction rollback) |
| F-9 | Stock audit log | M အတွက် before/after မှန် |
| F-10 | POS order (batch scan) | ယခုအတိုင်း |

## ၆. ဆုံးဖြတ်ရန်
| # | မေးခွန်း | အကြံ |
|---|---|---|
| Q1 | Batch ကို "main storefront" တစ်ခုတည်းမှ ပို့တာလား — env `FULFILLMENT_STOREFRONT_ID` (M) သတ်မှတ်မလား | **သတ်မှတ်** (barcode တူ batch location ၂ ခုရှိလျှင် ထိုကို ဦးစားပေး) |
| Q2 | Scan ဖတ်သော batch သည် **warehouse** ထဲ ရှိနေလျှင် warehouse မှ တိုက်ရိုက်လျော့ခွင့်ပေးမလား | **ခွင့်ပေး** (WarehouseStock လျော့) — သို့ "storefront သို့ အရင် transfer လုပ်ပါ" 400 |
| Q3 | Dashboard fulfillment modal တွင် batch ဘေး "Main Storefront မှ" location ပြမလား | **ပြ** (စာသားသာ — OrderFulfillmentModal) |
| Q4 | Claude ပြင်မလား၊ Antigravity ကို ပေးမလား | — |

---

## ၇. ဆုံးဖြတ်ချက် (2026-10-29) — §3.2 / §6 ထက် ဦးစားပေး
| # | ဆုံးဖြတ်ချက် |
|---|---|
| Q1 | **Main storefront (M) ကို အရင်ရှာ/နုတ်** — ecommerce storefront (E) သည် pre-order (ပစ္စည်းအမှန် မဟုတ်) ဖြစ်၍ batch ကို E ထက် M တွင် ဦးစားပေး; M ကို env **`FULFILLMENT_STOREFRONT_ID`** ဖြင့် သတ်မှတ် (Railway Variables တွင် user ထည့်ရမည်) |
| Q2 | **Warehouse မှလည်း လျော့ခွင့်ပေး** (BatchStock + WarehouseStock) |
| Q3 | Fulfillment modal တွင် batch ဘေး **location အမည် ပြ** |
| Q4 | **Antigravity** ပြင်မည် |

### Batch ရွေးပုံ (§3.2 ကို အစားထိုး)
`batchBarcode` / `batchNumber` ဖြင့် scan ဖတ်လျှင် အောက်ပါ အစဉ်အတိုင်း ရှာ (ပထမ တွေ့သော location ကို ယူ, `quantity > 0`):
1. `batchStockId` ပါ → ထို batch (ယခုအတိုင်း)
2. **M** (`FULFILLMENT_STOREFRONT_ID`) — env မသတ်မှတ်ထားလျှင် ဤအဆင့်ကို ကျော်
3. **E** (order ၏ storefront) — ယခင် ရှိပြီးသား batch များအတွက်
4. **ကျန် location အားလုံး** (storefront အခြား / warehouse) — **တစ်ခုတည်း** တွေ့မှ ယူ; ၂ ခုနှင့်အထက် → 400 "Batch [barcode] ကို [location အမည်များ] တွင် တွေ့ — ဘယ်နေရာမှ ထုတ်မလဲ ရွေး၍မရ၍ main storefront သို့ transfer လုပ်ပါ"
5. မတွေ့ → 404 (ယခုအတိုင်း)

### Stock လျော့ပုံ (§3.1 အတိုင်း — ထပ်ရှင်း)
| Batch ၏ location | BatchStock | Location စုစုပေါင်း |
|---|---|---|
| M (သို့ E မဟုတ်သော storefront) | −delta | **StorefrontInventory −delta** |
| Warehouse | −delta | **WarehouseStock −delta** |
| E | −delta | **မလျော့** (order တင်ချိန် pre-order နုတ်ပြီး) |
- Cancel / scan လျှော့ချိန် (delta < 0) — ပြောင်းပြန် ပြန်ထည့်

### Dashboard (Q3)
- `dashboard/components/Orders/OrderFulfillmentModal.tsx` (သို့ fulfillment batch list ပြသော component) — scan ပြီး batch line တွင် `t("fulfillment.batchFromLocation", { location })` "{location} မှ" (en: "from {location}"); backend response ၏ batch line တွင် `locationName`, `locationType` ထည့် (§3.2)
- `translations/my.ts`, `en.ts` — key ၁ ခု

### §5 test ထပ်ဖြည့်
| # | စစ်ချက် | မျှော်မှန်း |
|---|---|---|
| F-11 | Barcode တူ batch ကို M နှင့် E ၂ ခုလုံးတွင် ရှိ | **M** မှ နုတ် |
| F-12 | `FULFILLMENT_STOREFRONT_ID` မသတ်မှတ် | E → ကျန် location (unique) အစဉ်ဖြင့် အလုပ်လုပ် |
| F-13 | Batch သည် warehouse တွင်သာ | BatchStock + WarehouseStock လျော့; cancel တွင် ပြန်ထည့် |
| F-14 | Fulfillment modal | batch ဘေး "Main Storefront မှ" / "ပင်မ ဂိုဒေါင် မှ" ပြ |

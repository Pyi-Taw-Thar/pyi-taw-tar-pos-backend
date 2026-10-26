# Sample UOM Conversion Data ထည့်ရန် Plan (Production DB)

- **ရက်စွဲ:** 2026-10-26
- **ရည်ရွယ်ချက်:** Client ကို unit အလိုက်စျေး (ပုံး / ဖာ) ပြသရန် sample data ထည့်ခြင်း
- **Database:** MongoDB Atlas `production` — user ခွင့်ပြုချက်ဖြင့် backup မယူဘဲ (နောက်မှ Excel ဖြင့် အစားထိုးမည်)
- **အခြေအနေ:** ✅ ပြီး (2026-10-26) — ecommerce product 119 ခုလုံး update (`scripts/seed-sample-uom.js`)

## Sample တန်ဖိုး (user သတ်မှတ်ချက်)
- 1 ပုံး = 10 ဘူး
- 1 ဖာ = 12 ပုံး (= 120 ဘူး)

## Base unit အလိုက် ထည့်မည့်ပုံ

| Base unit | ထည့်မည့် `uomConversions` |
|---|---|
| `ဘူး` | `[{ unit: "ပုံး", factor: 10 }, { unit: "ဖာ", factor: 120 }]` |
| `ပုံး` | `[{ unit: "ဖာ", factor: 12 }]` — base ကို မပြောင်းပါ (stock ကို base unit ဖြင့်သိမ်းထား၍) |

- `ဖာ` ကို `convertFrom: "ပုံး", factor: 12` (chain) အစား **`factor: 120`, `convertFrom: null`** ဖြင့် ထည့်မည်။
  အကြောင်းရင်း: ecommerce `createOrder` ၏ `getUnitFactor()` သည် chain ကို မတွက်သဖြင့် chain ဖြင့်ထည့်ပါက ဖာ ၁ ခု = ဘူး 12 ဟု မှားတွက်မည်။ Flat 120 ဖြင့် dashboard/ecommerce နှစ်ဘက်လုံး မှန်သည်။
- `isDefaultSellingUnit` မသတ်မှတ်ပါ (POS ၏ default unit မပြောင်းစေရန်)။
- `sellingPrice`, `wholesalePrices`, stock — **မထိပါ**။

## လုပ်ဆောင်ပုံ
1. `backend/scripts/seed-sample-uom.js` — ecommerce storefront (`StorefrontInventory`) ရှိ inventory ID များကို ယူ။
2. ရွေးထားသော product များအတွက် `uomConversions` **ဗလာ ဖြစ်နေသောဟာများကိုသာ** update (ရှိပြီးသား data မဖျက်)။
3. `--dry-run` ဖြင့် အရင် run ပြီး ပြောင်းမည့်စာရင်း ပြ → ပြီးမှ တကယ် run။
4. ပြီးလျှင် `GET /ecommerce/products` ဖြင့် `uomConversions` ဝင်မဝင် စစ်။

## သတိပြုရန်
- Ecommerce frontend သည် `uomConversions` ကို **မသုံးသေးပါ** — `2026-10-26-ecommerce-unit-based-pricing-plan.md` ကို implement မလုပ်မချင်း client ဘက်တွင် ဘာမှ ပြောင်းမြင်ရမည် မဟုတ်ပါ။
- Production DB ဖြစ်၍ Dashboard POS တွင်လည်း ပုံး/ဖာ unit ရွေးစရာ ပေါ်လာမည်။
- Direct DB update ဖြစ်၍ activity log / stock audit log မရေးပါ။

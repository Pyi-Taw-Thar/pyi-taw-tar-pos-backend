# Base Unit `ပုံး` → `ဘူး` ပြောင်းရန် Plan (Sample Data, Production DB)

- **ရက်စွဲ:** 2026-10-26
- **ရည်ရွယ်ချက်:** Base unit `ပုံး` ဖြစ်နေသော ecommerce product 14 ခုကို base `ဘူး` သို့ပြောင်း၍ ပုံးစျေး + ဖာစျေး နှစ်ခုလုံး ပြနိုင်စေရန်
- **Sample တန်ဖိုး:** 1 ပုံး = 10 ဘူး, 1 ဖာ = 12 ပုံး = 120 ဘူး
- **User ခွင့်ပြုချက်:** Client မသုံးသေး၍ backup မလို (လိုအပ်လျှင် DB clean လုပ်မည်)
- **အခြေအနေ:** ✅ ပြီး (2026-10-26) — product 14 ခု ပြောင်းပြီး API ဖြင့် စစ်ပြီး

## ပြောင်းလဲမည့် field များ (product 14 ခုအတွက်သာ)

| Collection | Field | ပြောင်းပုံ |
|---|---|---|
| `inventories` | `unitOfMeasure` | `ပုံး` → `ဘူး` |
| | `sellingPrice`, `buyingPrice` | ÷ 10 (ပုံးစျေး → ဘူးစျေး) |
| | `reorderPoint`, `reorderQuantity` | × 10 (သတ်မှတ်ထားလျှင်) |
| | `ecommerceMaxPerUser` | × 10 (base unit ဖြင့်တွက်သဖြင့်; null ဆိုလျှင် မထိ) |
| | `uomConversions` | `[{ ပုံး, 10 }, { ဖာ, 120 }]` |
| `storefrontinventories` | `quantity` | × 10 |
| `warehousestocks` | `quantity` | × 10 |
| `batchstocks` | `quantity` × 10, `costPrice` ÷ 10 |

## မထိမည့်အရာ
- `wholesalePrices` — unit အမည် (`ပုံး`) ဖြင့် သိမ်းထား၍ အဓိပ္ပာယ် မပြောင်း (ecommerce လည်း မသုံးတော့)
- Order / GRN / Transfer / PO / Quotation / audit log — မှတ်တမ်းဟောင်းများ (ပုံး base ဖြင့် ဆက်ရှိမည်)

## လုပ်ဆောင်ပုံ
1. `scripts/convert-box-to-bottle-base.js --dry-run` — ပြောင်းမည့် တန်ဖိုး အဟောင်း/အသစ် ပြ၊ ÷10 တွင် ဒသမ ထွက်သော စျေး ရှိ/မရှိ စစ်
2. Approval ရပြီးမှ transaction ဖြင့် run (တစ်ခုမှားလျှင် အားလုံး rollback)
3. Script ကို ထပ် run လျှင် ထပ်မပြောင်းစေရန် `unitOfMeasure: "ပုံး"` + ecommerce storefront ရှိ product များကိုသာ ရွေး
4. `GET /ecommerce/products` ဖြင့် စျေး/stock/unit စစ်

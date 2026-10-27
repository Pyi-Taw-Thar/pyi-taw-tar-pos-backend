# Customer Login — အမည်ကို Space မခြားဘဲ ဝင်လို့ရအောင် Plan

- **ရက်စွဲ:** 2026-10-27
- **အခြေအနေ:** ✅ ပြီး (2026-10-27) — uomtest DB + temp backend ဖြင့် login case ၇ ခု 7/7 pass; test DB ဖျက်ပြီး

## ၁. ရည်ရွယ်ချက်
Ecommerce login တွင် customer က အမည်ကို space ခြား/မခြား မည်သို့ရိုက်ရိုက် ဝင်နိုင်ရန်
- အကောင့်အမည် `test customer` → `testcustomer`, `Test  Customer`, `TESTCUSTOMER` အားလုံး ဝင်ရ
- အကောင့်အမည် `မောင် မောင်` → `မောင်မောင်` ဝင်ရ

## ၂. လက်ရှိအခြေအနေ
`src/controllers/customer.controller.js` `login` (line ~75-90):
```js
const inputName = name.trim().toLowerCase().replace(/\s+/g, " ");
const currentName = (customer.name || "").trim().toLowerCase().replace(/\s+/g, " ");
if (currentName && currentName !== inputName) → 401
```
- Space အများကြီးကို တစ်ခုအဖြစ် ချုံ့သာ — space **လုံးဝမပါ** လျှင် မကိုက်၍ 401
- မြန်မာစာ ရိုက်ရာတွင် keyboard အချို့က မမြင်ရသော zero-width space (`U+200B`) ထည့်တတ်၍ မျက်စိဖြင့် တူသော်လည်း မကိုက်နိုင်

## ၃. ပြင်ပုံ (Backend တစ်နေရာတည်း)
နှိုင်းယှဉ်ရန် helper တစ်ခု ထည့်ပြီး **ဖုန်းနံပါတ် + အမည်** စစ်ဆေးမှုကို ဆက်ထား၍ အမည် နှိုင်းယှဉ်ပုံကိုသာ ဖြေလျှော့:

```js
// login အမည် နှိုင်းယှဉ်ရန် — space / zero-width space အားလုံးဖယ်, အကြီးအသေး မခွဲ
const normalizeLoginName = (value = "") =>
  value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s​-‍﻿]+/g, "");
```
- `inputName` / `currentName` နှစ်ခုလုံးကို ဤ helper ဖြင့် ပြောင်းပြီး နှိုင်းယှဉ်
- Input အမည် space ဖယ်ပြီး **ဗလာ** ဖြစ်လျှင် ယခင်အတိုင်း အမည်စစ်ဆေးမှု မလုပ် (လက်ရှိ logic ကဲ့သို့)
- DB ထဲရှိ အမည် **မပြောင်း** — မူလ space ပါသော အမည်အတိုင်း သိမ်း/ပြ (Profile တွင် `test customer` ဟု ဆက်ပြ)
- `!customer.name` ဖြစ်လျှင် အမည်သိမ်းသော logic — ယခင်အတိုင်း (ရိုက်ထားသော ပုံစံဖြင့် သိမ်း)

### လုံခြုံရေး မှတ်ချက်
- ဖုန်းနံပါတ်က အဓိက key ဖြစ်ပြီး (unique) အမည်က ထပ်စစ်သော အချက်သာ — space ဖယ်ခြင်းကြောင့် အခြားသူ၏ အကောင့်သို့ ဝင်နိုင်ခြေ မတိုး (ဖုန်းနံပါတ် မှန်ရမည်ဖြစ်၍)

## ၄. ပြင်ဆင်မည့်ဖိုင်
| ဖိုင် | ပြောင်းလဲမှု |
|---|---|
| `backend/src/controllers/customer.controller.js` | `normalizeLoginName` helper + `login` ၏ အမည်နှိုင်းယှဉ်ပုံ |

> Ecommerce frontend (`Login.tsx`, `auth.service.ts`) **မပြောင်းပါ** — ယခုလည်း `trim().toLowerCase()` ဖြင့်သာ ပို့ပြီး backend က ဆုံးဖြတ်
> Dashboard မထိ (ဤ endpoint ကို မသုံး)

## ၅. စစ်ဆေးမည့်နည်း
သီးခြား `uomtest` DB + port 5055 temp backend ဖြင့် `POST /customer/login`:
| အကောင့်အမည် | ရိုက်သောအမည် | မျှော်မှန်း |
|---|---|---|
| `test customer` | `test customer` | ✅ 200 |
| `test customer` | `testcustomer` | ✅ 200 |
| `test customer` | `  TEST   Customer ` | ✅ 200 |
| `မောင် မောင်` | `မောင်မောင်` | ✅ 200 |
| `မောင်မောင်` | `မောင်​မောင်` (U+200B ပါ) | ✅ 200 |
| `test customer` | `test custom` | ❌ 401 |
| `test customer` | မှန်သောအမည် + ဖုန်းမှား | ❌ 401 |

စစ်ပြီး test DB / temp server / script ဖျက်

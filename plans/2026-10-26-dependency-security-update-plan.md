# Backend Dependency Security Update Plan

- **ရက်စွဲ:** 2026-10-26
- **အခြေအနေ:** ✅ Update ပြီး (2026-10-26, branch `chore/dependency-security-update`) — `npm audit` 0 vulnerabilities, read-only စစ်ဆေးမှု အားလုံး pass
- **တွေ့ရှိချက်:** `xlsx` 0.20 ESM build တွင် `XLSX.readFile` ကို `XLSX.set_fs(fs)` မခေါ်ဘဲ သုံး၍မရ — `scripts/import-suppliers.js` သာ ထိခိုက် (server code က `XLSX.read(buffer)` သုံး၍ မထိခိုက်)

## ၁. ရည်ရွယ်ချက်
`npm audit` တွင် တွေ့ရသော vulnerability **38 ခု** (critical 2, high 11, moderate 22, low 3) ကို ဖြေရှင်းရန်။
အထူးသဖြင့် public endpoint များကို ထိခိုက်သော DoS (`body-parser`, `qs`) နှင့် rate-limit ကျော်ခြင်း (`express-rate-limit`)။

## ၂. ပြောင်းလဲမည့် Version များ (`npm audit fix --dry-run` ဖြင့် စစ်ပြီး)

> Major version ပြောင်းခြင်း **မရှိပါ** — အားလုံး `package.json` ၏ `^` range အတွင်း။ Package 55 ခု ပြောင်း, 67 ခု ဖယ်, 5 ခု ထပ်ထည့်။

| Package | လက်ရှိ | အသစ် | အဓိက ဖြေရှင်းချက် |
|---|---|---|---|
| `body-parser` (express) | 2.2.1 | 2.4.0 | Compressed body DoS |
| `qs` (express) | 6.14.0 | 6.16.1 | arrayLimit / isBuffer DoS |
| `proxy-addr` (express) | 2.0.7 | 2.0.8 | IPv4-mapped IPv6 spoofing (critical) |
| `path-to-regexp` (express) | 8.3.0 | 8.4.2 | Route ReDoS |
| `express-rate-limit` | 8.2.1 | 8.7.1 | IPv6 rate-limit bypass |
| `mongoose` / `mongodb` | 9.0.0 / 7.0.0 | 9.11.4 / 7.7.0 | Prototype pollution, `$nor` sanitize |
| `multer` | 2.0.2 | 2.5.0 | Upload DoS အမျိုးမျိုး |
| `zod` | 4.4.3 | 4.6.7 | Oversized collection memory |
| `@aws-sdk/client-s3` | 3.940.0 | 3.1156.0 | `fast-xml-parser` (critical) |
| `uuid` | 13.0.0 | 13.0.2 | buffer bounds |
| `moment` | 2.30.1 | 2.31.0 | locale path traversal |
| `ai` | 6.0.190 | 6.0.315 | resource consumption (low) |

### `npm audit fix` ဖြင့် မပြေနိုင်သောအရာ
- **`xlsx` 0.18.5** — npm registry တွင် fix version မရှိ (SheetJS က npm သို့ publish မလုပ်တော့)။
  → `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` ဖြင့် SheetJS CDN မှ install မည်။
  → သုံးနေသော API (`XLSX.read`, `XLSX.readFile`, `XLSX.utils.sheet_to_json`) သည် 0.20 တွင် မပြောင်းပါ။
- **`@aws-sdk/lib-storage`** — `client-s3` နှင့် version ကိုက်စေရန် `npm install @aws-sdk/lib-storage@latest` ဖြင့် တွဲ update မည် (audit fix က မထိ)။

## ၃. လုပ်ဆောင်ပုံ

1. **Git branch** — `git checkout -b chore/dependency-security-update` (rollback လွယ်ရန်; `package.json` + `package-lock.json` သာ ပြောင်းမည်)
2. `npm audit fix` (`--force` **မသုံး**)
3. `npm install @aws-sdk/lib-storage@latest`
4. `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
5. `npm audit` ပြန် run — ကျန်ရှိသောအရာများကို မှတ်တမ်းတင် (dev-only `nodemon` chain ကျန်နိုင်)
6. Source code **မပြင်ပါ** — breaking change တွေ့မှသာ သီးခြား plan ဖြင့် ပြင်မည်

## ၄. စစ်ဆေးမည့်နည်း

> ⚠️ `.env` သည် **production DB** ကို ချိတ်ထား၍ write လုပ်သော test (Excel import, order) များကို production တွင် **မလုပ်ပါ**။ Read-only စစ်ဆေးမှုသာ production DB ဖြင့် လုပ်မည်။

| # | စစ်ဆေးချက် | DB |
|---|---|---|
| 1 | `node --check` + server start (port 5055 ယာယီ) — DB ချိတ်ပြီး listen ဖြစ် | production (read) |
| 2 | `GET /ecommerce/products`, `?id=`, `/brands`, `/subcategories` — response ယခင်အတိုင်း | production (read) |
| 3 | Rate limiter — 61 ကြိမ်မြောက် request တွင် 429 | — |
| 4 | Zod validation — `POST /customer/login` ကို field မှားပို့ → 400 | — |
| 5 | Mongoose transaction — `scripts/seed-sample-uom.js --dry-run`, `convert-box-to-bottle-base.js --dry-run` run ရ | production (read) |
| 6 | `xlsx` — `inventory_sample_template.xlsx` ကို `XLSX.readFile` + `sheet_to_json` ဖြင့် ဖတ်ပြီး row 3 ခု ရ | — |
| 7 | Multer — `/inventory/import-excel` ကို token မပါဘဲ ပို့ → 401 (auth အရင်စစ်ကြောင်း) | — |

### User ကိုယ်တိုင် စစ်ရန် (write ပါ၍)
- Dashboard: POS order တစ်ခု, Excel import, product image upload (R2), shop logo upload
- Ecommerce: order တင်ခြင်း
- ဖြစ်နိုင်လျှင် staging DB (ဥပမာ `MONGODB_URI` ၏ DB name ကို `staging` ပြောင်း) ဖြင့် စစ်ရန် အကြံပြု

## ၅. Deploy
- Vercel / DigitalOcean နှစ်ခုလုံး `package-lock.json` ကို သုံး၍ commit + deploy ရုံသာ။
- DigitalOcean (PM2): `npm ci && pm2 restart all`

## ၆. Rollback
`git checkout main -- package.json package-lock.json && npm ci`

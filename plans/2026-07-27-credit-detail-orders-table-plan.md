# CreditDetail Orders Table — Implementation Plan

## Context

CreditDetail page ရဲ့ Orders tab မှာ လက်ရှိ order number buttons အနေနဲ့ပဲ ပြထားတယ်။ ဒါကို အချက်အလက်အပြည့်ပါတဲ့ table အနေနဲ့ ပြောင်းပြမယ်။

## Changes

### 1. Backend — `backend/src/controllers/creditRecord.controller.js`
Line 430: `createdAt` ကို select ထဲထည့်မယ်
```javascript
// အဟောင်း
const orders = await Order.find(orderQuery).select("_id orderNumber finalAmount paidAmount");
// အသစ်
const orders = await Order.find(orderQuery).select("_id orderNumber finalAmount paidAmount createdAt");
```

### 2. Frontend Type — `dashboard/services/Credit/fetchCreditPersonaRecords.ts`
`CreditPersonaOrder` interface မှာ field အသစ်တွေထည့်မယ်:
```typescript
export interface CreditPersonaOrder {
  _id: string;
  orderNumber: string;
  finalAmount?: number;
  paidAmount?: number;
  createdAt?: string;
}
```

### 3. Frontend UI — `dashboard/pages/CreditDetail.tsx`
Orders tab (lines 511-538) ကို table အနေနဲ့ ပြန်ရေးမယ်:

| Order No | ပမာဏ | ပေးဆပ်ပြီး | ကျန်ငွေ |
|---|---|---|---|
| ORD-2026-... | 500,000 MMK | 300,000 MMK | 200,000 MMK |
| ORD-2026-... | 150,000 MMK | 150,000 MMK | 0 MMK |

- Table row တစ်ခုချင်းစီကို နှိပ်လို့ရမယ် (order detail modal ဖွင့်ရန်)
- ကျန်ငွေ 0 ဖြစ်ရင် green badge ပြမယ်
- ကျန်ငွေရှိရင် orange badge ပြမယ်

## Verification

Backend restart → Dashboard → Credit Detail → Orders tab → table ပုံစံနဲ့မြင်ရမယ်။

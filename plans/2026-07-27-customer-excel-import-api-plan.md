# Customer Excel Import API — Implementation Plan

## Context

Customer Excel file တွင် ဆိုင်ပေါင်း (၁,၇၄၆) ဆိုင်၏ data ပါဝင်ပြီး ၎င်းတို့ကို Customer collection ထဲသို့ import လုပ်ရန် API တစ်ခု လိုအပ်ပါသည်။ ရှိပြီးသား inventory import API ပုံစံအတိုင်း Excel file upload → parse → bulk create လုပ်မည်။

## Changes

### 1. Customer Model — `backend/src/models/customer.model.js`

Phone field ကို `required` ဖြုတ်ပြီး `sparse: true` ထည့်မည် (null values ခွင့်ပြုရန်):
```javascript
phone: {
    type: String,
    // required ဖြုတ်
    unique: true,
    sparse: true,  // null values ခွင့်ပြုရန်
    trim: true,
},
```

### 2. Customer Controller — `backend/src/controllers/customer.controller.js`

Import function အသစ်ထည့်မည်:
```javascript
export const importCustomersFromExcel = asyncErrorHandler(async (req, res, next) => {
    // 1. Validate file upload
    // 2. Parse Excel with XLSX
    // 3. Map columns: Name, ShortDesc, Phone, Address, IsCredit, CreditLimit, DueInDays, Township
    // 4. For each row: check duplicate by name → create Customer with isCreditPerson: true
    // 5. Phone missing → set to null
    // 6. Return summary: { total, created, skipped, errors }
});
```

### 3. Customer Route — `backend/src/routes/customer.route.js`

Route အသစ်ထည့်မည်:
```javascript
// Multer setup (in-memory)
const upload = multer({ storage: multer.memoryStorage() });

router.post(
    "/customer/import-excel",
    protect,
    permissionGranted("owner", "admin"),
    upload.single("file"),
    importCustomersFromExcel
);
```

### 4. Files to Modify

| File | ပြင်ရမယ့်အကြောင်း |
|---|---|
| `backend/src/models/customer.model.js` | phone field ကို required ဖြုတ် + sparse: true |
| `backend/src/controllers/customer.controller.js` | importCustomersFromExcel function အသစ် |
| `backend/src/routes/customer.route.js` | import route အသစ် + multer import |

### 5. Verification

```bash
# Excel file upload စမ်းသပ်
curl -X POST http://localhost:5000/api/v1/customer/import-excel \
  -H "Authorization: Bearer <token>" \
  -F "file=@customer-excel.xlsx"

# Response ပုံစံ
{
  "success": true,
  "message": "Import completed",
  "data": {
    "total": 1746,
    "created": 1700,
    "skipped": 46,
    "errors": []
  }
}
```

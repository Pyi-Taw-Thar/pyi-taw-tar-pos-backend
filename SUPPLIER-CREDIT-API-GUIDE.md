# Supplier Credit Payment API — Frontend Integration Guide

## Overview

Supplier Credit ဆိုတာ **Supplier (ကုန်သွင်းသူ) ဆီက ကုန်ပစ္စည်းတွေကို ယုံကြည်မှုနဲ့မှာယူပြီး နောက်မှငွေချေတဲ့စနစ်** ဖြစ်ပါတယ်။

### Flow

```
PO တင်မယ် (Purchase Order)
    │
    ├── Supplier isCredit = true ? 
    │       ├── Yes → ချေးငွေအနေနဲ့မှတ် (Balance = totalAmount)
    │       └── No  → ငွေချက်ချင်းရှင်းရန်
    │
    ├── ကုန်လက်ခံ (GRN)
    │
    └── ငွေပြန်ဆပ် (Supplier Credit Payment)
            │
            ├── paidAmount ထည့်သွင်းမှတ်တမ်းတင်
            ├── PO ရဲ့ paidAmount တိုး
            └── remainingBalance လျှော့
```

---

## 1. Supplier Model — isCredit စစ်ဆေးရန်

Supplier တစ်ယောက်က Credit နဲ့ဆိုတာ `isCredit` field ကနေသိနိုင်တယ်။

### Endpoint

```
GET /api/v1/supplier-profile/:id
```

### Response (relevant fields)

```json
{
  "success": true,
  "data": {
    "_id": "664d8f...",
    "supplierName": "ABC Trading",
    "isCredit": true,
    "dueInDays": 30,
    "isConsign": false
  }
}
```

### Frontend Usage

```javascript
// PO မတင်ခင် supplier ရဲ့ isCredit ကိုစစ်
const supplier = await getSupplierById(selectedSupplierId);
const isCreditSupplier = supplier.isCredit; // true/false
const dueInDays = supplier.dueInDays;       // 30 (credit期限)
```

---

## 2. Purchase Order (PO) — paidAmount & remainingBalance

PO တစ်ခုမှာ `paidAmount` (ငွေပေးပြီးသားပမာဏ) နဲ့ `remainingBalance` (ကျန်ငွေ) ဆိုတဲ့ field အသစ်တွေပါလာပါတယ်။

### Get All POs

```
GET /api/v1/purchase
```

### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "665abc...",
      "poNumber": "PO-2024-06-15-000001",
      "supplierId": {
        "_id": "664d8f...",
        "supplierName": "ABC Trading"
      },
      "totalAmount": 500000,
      "paidAmount": 200000,
      "remainingBalance": 300000,
      "status": "arrived",
      "products": [...],
      "createdAt": "2024-06-15T10:30:00.000Z"
    }
  ],
  "pagination": { ... }
}
```

### Frontend — PO Table Column

```javascript
// PO List Table မှာ အောက်ပါ column တွေထည့်ပြရန်
const columns = [
  { label: "PO No.",   field: "poNumber" },
  { label: "Supplier", field: "supplierId.supplierName" },
  { label: "Total",    field: "totalAmount", type: "currency" },
  { label: "Paid",     field: "paidAmount", type: "currency" },       // ← NEW
  { label: "Balance",  field: "remainingBalance", type: "currency" },  // ← NEW
  { label: "Status",   field: "status", type: "badge" },
  { label: "Actions",  type: "actions" },
];

// အကြွေးကျန်တဲ့ PO ကို highlight လုပ်ရန်
const rowClass = (row) => {
  if (row.remainingBalance > 0) return 'table-row-unpaid';
  return '';
};
```

### PO Status Badge Colors

| Status | Color | ရှင်းလင်းချက် |
|---|---|---|
| `pending` | 🟡 Yellow | စောင့်ဆိုင်းဆဲ |
| `confirmed` | 🔵 Blue | အတည်ပြုပြီး |
| `arrived` | 🟢 Green | ကုန်ရောက်ပြီ (GRN လုပ်လို့ရ) |
| `completed` | ✅ Green Check | အားလုံးပြီးဆုံး |
| `cancelled` | 🔴 Red | ဖျက်သိမ်း |

> **Credit Supplier အတွက်:** ငွေကျန်ရှိနေသေးရင် `remainingBalance > 0` ဆိုရင် **"Pay"** button ပြရန်

---

## 3. Supplier Credit Payment API

### 3.1 Create Payment (ငွေဆပ်မှတ်တမ်းတင်)

Record a payment against a PO. This will **increase** the PO's `paidAmount` and **decrease** `remainingBalance`.

#### Endpoint

```
POST /api/v1/supplier-credit-payment
```

#### Request Body

```json
{
  "purchaseId": "665abc...",
  "paidAmount": 200000,
  "paymentDate": "2024-06-20",
  "paymentMethod": "bank_transfer",
  "notes": "Partial payment for June PO"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `purchaseId` | String (ObjectId) | ✅ | PO ID |
| `paidAmount` | Number | ✅ | ပေးချေငွေပမာဏ (PO balance ထက်မပိုရ) |
| `paymentDate` | Date (ISO) | ❌ | ပေးချေရက် (default: today) |
| `paymentMethod` | Enum | ❌ | `cash`, `bank_transfer`, `cheque`, `mobile_payment`, `other` (default: cash) |
| `notes` | String | ❌ | မှတ်ချက် |

#### Success Response

```json
{
  "success": true,
  "message": "Supplier credit payment recorded successfully",
  "data": {
    "payment": {
      "_id": "666def...",
      "purchaseId": {
        "_id": "665abc...",
        "poNumber": "PO-2024-06-15-000001",
        "totalAmount": 500000,
        "paidAmount": 200000
      },
      "supplierId": {
        "_id": "664d8f...",
        "supplierName": "ABC Trading"
      },
      "paidAmount": 200000,
      "paymentDate": "2024-06-20T00:00:00.000Z",
      "paymentMethod": "bank_transfer",
      "notes": "Partial payment for June PO"
    },
    "purchase": {
      "poNumber": "PO-2024-06-15-000001",
      "totalAmount": 500000,
      "previousPaidAmount": 0,
      "paymentAmount": 200000,
      "newPaidAmount": 200000,
      "newRemainingBalance": 300000
    }
  }
}
```

#### Error Cases

| Status | Message | အကြောင်းရင်း |
|---|---|---|
| 400 | `Payment amount exceeds remaining balance` | ကျန်ငွေထက်ပိုဆပ်လို့မရ |
| 400 | `Cannot add payment to a deleted purchase order` | PO ဖျက်ပြီးသားဆိုရင် ငွေမသွင်းရ |
| 404 | `Purchase order not found` | PO ID မှားနေ |

#### Frontend Usage

```javascript
const recordPayment = async (purchaseId, amount, method, notes) => {
  try {
    const res = await fetch(`${BASE_URL}/supplier-credit-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        purchaseId,
        paidAmount: amount,
        paymentMethod: method,
        notes,
      }),
    });
    const json = await res.json();
    if (json.success) {
      // Update UI: refresh PO list and payment history
      showSuccess(`Payment of ${amount} MMK recorded`);
    } else {
      showError(json.message);
    }
  } catch (err) {
    showError(err.message);
  }
};
```

---

### 3.2 Get Payments by PO (PO အလိုက်ငွေဆပ်မှတ်တမ်းကြည့်)

#### Endpoint

```
GET /api/v1/purchase/:purchaseId/credit-payments
```

#### Response

```json
{
  "success": true,
  "data": {
    "purchase": {
      "_id": "665abc...",
      "poNumber": "PO-2024-06-15-000001",
      "totalAmount": 500000,
      "paidAmount": 200000,
      "remainingBalance": 300000
    },
    "payments": {
      "count": 2,
      "records": [
        {
          "_id": "666def...",
          "paidAmount": 150000,
          "paymentDate": "2024-06-20T00:00:00.000Z",
          "paymentMethod": "bank_transfer",
          "notes": "First payment",
          "addedBy": { "name": "Admin", "role": "owner" },
          "createdAt": "2024-06-20T10:30:00.000Z"
        },
        {
          "_id": "667abc...",
          "paidAmount": 50000,
          "paymentDate": "2024-07-01T00:00:00.000Z",
          "paymentMethod": "cash",
          "notes": "Second payment",
          "addedBy": { "name": "Admin", "role": "owner" },
          "createdAt": "2024-07-01T14:00:00.000Z"
        }
      ]
    }
  }
}
```

#### Frontend — Payment History Modal

```javascript
// PO Row ထဲက "View Payments" button နှိပ်ရင် modal ဖွင့်ပြီး payment history ပြရန်
const PaymentHistoryModal = ({ purchaseId, isOpen, onClose }) => {
  const [payments, setPayments] = useState([]);
  const [purchase, setPurchase] = useState(null);

  useEffect(() => {
    if (isOpen && purchaseId) {
      fetch(`${BASE_URL}/purchase/${purchaseId}/credit-payments`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(json => {
          if (json.success) {
            setPurchase(json.data.purchase);
            setPayments(json.data.payments.records);
          }
        });
    }
  }, [isOpen, purchaseId]);

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      {purchase && (
        <div className="summary">
          <p>PO: {purchase.poNumber}</p>
          <p>Total: {purchase.totalAmount.toLocaleString()} MMK</p>
          <p>Paid: {purchase.paidAmount.toLocaleString()} MMK</p>
          <p className={purchase.remainingBalance > 0 ? 'text-danger' : 'text-success'}>
            Balance: {purchase.remainingBalance.toLocaleString()} MMK
          </p>
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount</th>
            <th>Method</th>
            <th>Added By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {payments.map(p => (
            <tr key={p._id}>
              <td>{formatDate(p.paymentDate)}</td>
              <td>{p.paidAmount.toLocaleString()} MMK</td>
              <td>{paymentMethodLabel(p.paymentMethod)}</td>
              <td>{p.addedBy?.name}</td>
              <td>
                <button onClick={() => deletePayment(p._id)} className="btn-danger btn-sm">
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
};
```

---

### 3.3 Get Payments by Supplier (Supplier အလိုက်ငွေဆပ်မှတ်တမ်းကြည့်)

#### Endpoint

```
GET /api/v1/supplier-profile/:supplierId/credit-payments?page=1&limit=10
```

#### Response

```json
{
  "success": true,
  "data": {
    "supplierId": "664d8f...",
    "summary": {
      "totalPOs": 5,
      "totalPOAmount": 2500000,
      "totalPaid": 1800000,
      "totalOutstanding": 700000
    },
    "payments": {
      "count": 3,
      "records": [
        {
          "_id": "666def...",
          "purchaseId": {
            "_id": "665abc...",
            "poNumber": "PO-2024-06-15-000001",
            "totalAmount": 500000,
            "paidAmount": 200000
          },
          "paidAmount": 200000,
          "paymentDate": "2024-06-20T00:00:00.000Z",
          "paymentMethod": "bank_transfer"
        }
      ]
    }
  },
  "pagination": { ... }
}
```

#### Frontend — Supplier Credit Summary

```javascript
// Supplier Detail / Profile Page မှာ Credit Summary ပြရန်
const SupplierCreditSummary = ({ supplierId }) => {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    fetch(`${BASE_URL}/supplier-profile/${supplierId}/credit-payments?page=1&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.success) setSummary(json.data.summary);
      });
  }, [supplierId]);

  if (!summary) return null;

  return (
    <div className="card">
      <h3>Credit Summary</h3>
      <div className="stats-grid">
        <StatBox label="Total POs" value={summary.totalPOs} />
        <StatBox label="Total Amount" value={`${summary.totalPOAmount.toLocaleString()} MMK`} />
        <StatBox label="Total Paid" value={`${summary.totalPaid.toLocaleString()} MMK`} color="green" />
        <StatBox label="Outstanding" value={`${summary.totalOutstanding.toLocaleString()} MMK`} color="red" />
      </div>
    </div>
  );
};
```

---

### 3.4 Get All Payments (with Filters)

#### Endpoint

```
GET /api/v1/supplier-credit-payment
```

#### Query Parameters

| Param | Type | Example | ရှင်းလင်းချက် |
|---|---|---|---|
| `purchaseId` | ObjectId | `665abc...` | PO အလိုက်စစ် |
| `supplierId` | ObjectId | `664d8f...` | Supplier အလိုက်စစ် |
| `paymentMethod` | Enum | `bank_transfer` | ငွေပေးချေနည်းအလိုက်စစ် |
| `startDate` | Date | `2024-01-01` | စရက်အလိုက်စစ် |
| `endDate` | Date | `2024-12-31` | ဆုံးရက်အလိုက်စစ် |
| `page` | Number | `1` | စာမျက်နှာ |
| `limit` | Number | `10` | တစ်မျက်နှာအရေအတွက် |

#### Example

```
GET /api/v1/supplier-credit-payment?supplierId=664d8f...&paymentMethod=cash&startDate=2024-01-01&endDate=2024-06-30&page=1&limit=20
```

#### Response

```json
{
  "success": true,
  "data": [
    {
      "_id": "666def...",
      "purchaseId": { "poNumber": "PO-2024-06-15-000001", "totalAmount": 500000, "paidAmount": 200000 },
      "supplierId": { "supplierName": "ABC Trading" },
      "paidAmount": 200000,
      "paymentDate": "2024-06-20T00:00:00.000Z",
      "paymentMethod": "bank_transfer",
      "notes": "Partial payment",
      "addedBy": { "name": "Admin", "role": "owner" },
      "createdAt": "2024-06-20T10:30:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 3,
    "totalItems": 25,
    "itemsPerPage": 10
  }
}
```

---

### 3.5 Delete Payment (ငွေဆပ်မှတ်တမ်းဖျက်)

Deleting a payment will **decrease** the PO's `paidAmount` and **increase** `remainingBalance`. Uses a database transaction.

#### Endpoint

```
DELETE /api/v1/supplier-credit-payment/:id
```

#### Response

```json
{
  "success": true,
  "message": "Supplier credit payment deleted successfully",
  "data": {
    "deletedPayment": {
      "_id": "666def...",
      "purchaseId": { "poNumber": "PO-2024-06-15-000001", "totalAmount": 500000, "paidAmount": 100000 },
      "supplierId": { "supplierName": "ABC Trading" },
      "paidAmount": 100000,
      "paymentMethod": "cash"
    },
    "purchase": {
      "poNumber": "PO-2024-06-15-000001",
      "previousPaidAmount": 200000,
      "deletedAmount": 100000,
      "newPaidAmount": 100000,
      "newRemainingBalance": 400000
    }
  }
}
```

---

## 4. Frontend Suggested UI

### PO List Page (updated)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Purchase Orders                                           + New PO      │
├─────────────────────────────────────────────────────────────────────────┤
│ 🔍 [Search...]  Status: [All ▼]  Supplier: [All ▼]                     │
├──────┬──────────┬──────────┬──────────┬──────────┬──────────┬───────────┤
│ PO#  │ Supplier │ Total    │ Paid     │ Balance  │ Status   │ Actions   │
├──────┼──────────┼──────────┼──────────┼──────────┼──────────┼───────────┤
│ PO.. │ ABC      │ 500,000  │ 200,000  │ 300,000  │ Arrived  │ [Pay] [▶] │
│ PO.. │ XYZ      │ 300,000  │ 300,000  │ 0        │ Complete │ [▶]       │
│ PO.. │ DEF      │ 1,000,000│ 0        │1,000,000 │ Pending  │ [Pay] [▶] │
└──────┴──────────┴──────────┴──────────┴──────────┴──────────┴───────────┘
```

### Pay Modal

```
┌──────────────────────────────────────┐
│  💳 Record Payment                    │
│                                       │
│  PO: PO-2024-06-15-000001            │
│  Supplier: ABC Trading               │
│  Total: 500,000 MMK                  │
│  Balance: 300,000 MMK                │
│                                       │
│  Amount: [______________] MMK        │
│  Date:   [____] [____] [____]       │
│  Method: [Cash ▼]                    │
│  Notes:  [____________________]      │
│                                       │
│  [Cancel]           [Record Payment] │
└──────────────────────────────────────┘
```

### Supplier Detail Page (Credit Summary)

```
┌────────────────────────────────────────────────┐
│  Supplier Profile: ABC Trading                 │
├────────────────────────────────────────────────┤
│  🏷️ Short Desc: ABC     📞 Phone: 09-123...   │
│  🏙️ Township: မရမ်းကုန်း                        │
│                                                 │
│  ┌───────┬───────────┬──────────┬────────────┐  │
│  │Total  │ Total     │ Total    │ Outstanding│  │
│  │POs    │ Amount    │ Paid     │            │  │
│  │  5    │2,500,000  │1,800,000 │  700,000   │  │
│  └───────┴───────────┴──────────┴────────────┘  │
│                                                 │
│  [View Payment History]                         │
└────────────────────────────────────────────────┘
```

---

## 5. Complete API Reference Summary

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/supplier-profile/:id` | admin/owner | Supplier detail (isCredit, dueInDays) |
| `GET` | `/purchase` | admin/owner | PO list (paidAmount, remainingBalance) |
| `GET` | `/purchase/:purchaseId/credit-payments` | admin/owner | PO အလိုက်ငွေစာရင်း |
| `GET` | `/supplier-profile/:supplierId/credit-payments` | admin/owner | Supplier အလိုက်ငွေစာရင်း |
| `GET` | `/supplier-credit-payment` | admin/owner | ငွေစာရင်းအားလုံး (filter) |
| `POST` | `/supplier-credit-payment` | admin/owner | ငွေဆပ်မှတ်တမ်းတင် |
| `DELETE` | `/supplier-credit-payment/:id` | owner | မှတ်တမ်းဖျက် |

---

## 6. React Example — Complete Payment Flow

```javascript
import React, { useState, useEffect } from 'react';

function SupplierCreditSection({ purchaseId }) {
  const [purchase, setPurchase] = useState(null);
  const [payments, setPayments] = useState([]);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNotes, setPayNotes] = useState('');

  // Load PO + payments
  useEffect(() => {
    if (!purchaseId) return;
    // Fetch PO detail
    fetch(`${BASE_URL}/purchase/${purchaseId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => setPurchase(json.data));

    // Fetch payment history
    fetch(`${BASE_URL}/purchase/${purchaseId}/credit-payments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => setPayments(json.data?.payments?.records || []));
  }, [purchaseId]);

  const handleRecordPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return alert('Enter valid amount');
    if (amount > purchase.remainingBalance) {
      return alert(`Amount exceeds remaining balance (${purchase.remainingBalance.toLocaleString()} MMK)`);
    }

    const res = await fetch(`${BASE_URL}/supplier-credit-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        purchaseId,
        paidAmount: amount,
        paymentMethod: payMethod,
        notes: payNotes,
      }),
    });
    const json = await res.json();

    if (json.success) {
      // Refresh data
      setPurchase(json.data.purchase);
      setPayments(prev => [json.data.payment, ...prev]);
      setShowPayModal(false);
      setPayAmount('');
      setPayNotes('');
    } else {
      alert(json.message);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    if (!confirm('Delete this payment record?')) return;

    const res = await fetch(`${BASE_URL}/supplier-credit-payment/${paymentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();

    if (json.success) {
      setPayments(prev => prev.filter(p => p._id !== paymentId));
      setPurchase(prev => ({
        ...prev,
        paidAmount: json.data.purchase.newPaidAmount,
      }));
    } else {
      alert(json.message);
    }
  };

  // ... render UI
}
```

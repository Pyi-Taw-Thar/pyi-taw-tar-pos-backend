import mongoose from "mongoose";
import Purchasing from "../models/purchasing.model.js";

// Cancel / ဖျက်ထားသော PO များကို မပေါင်း (pending ပါဝင်သည်)
const buildMatch = (supplierIds) => ({
  supplierId: {
    $in: supplierIds.map((id) => new mongoose.Types.ObjectId(String(id))),
  },
  isDeleted: false,
  status: { $ne: "cancelled" },
});

// PO တစ်ခုချင်း၏ ကျန်ငွေကို ပေါင်းသည် — PO တစ်ခုတွင် ပိုပေးထားခြင်းက အခြား PO ၏ အကြွေးကို မနုတ်စေရန်
const summaryFields = {
  poCount: { $sum: 1 },
  totalPurchaseAmount: { $sum: { $ifNull: ["$totalAmount", 0] } },
  totalPaidAmount: { $sum: { $ifNull: ["$paidAmount", 0] } },
  payableAmount: {
    $sum: {
      $max: [
        0,
        {
          $subtract: [
            { $ifNull: ["$totalAmount", 0] },
            { $ifNull: ["$paidAmount", 0] },
          ],
        },
      ],
    },
  },
};

export const EMPTY_PURCHASE_SUMMARY = Object.freeze({
  poCount: 0,
  totalPurchaseAmount: 0,
  totalPaidAmount: 0,
  payableAmount: 0,
});

// Supplier တစ်ဦးချင်းစီ၏ ဝယ်ယူငွေ / ပေးရန်ငွေ — Map<supplierId, summary>
export const getPurchaseSummaryBySupplier = async (supplierIds = []) => {
  const map = new Map();
  if (supplierIds.length === 0) return map;

  const rows = await Purchasing.aggregate([
    { $match: buildMatch(supplierIds) },
    { $group: { _id: "$supplierId", ...summaryFields } },
  ]);

  rows.forEach(({ _id, ...summary }) => map.set(String(_id), summary));
  return map;
};

// ပေးထားသော supplier အားလုံး၏ စုစုပေါင်း
export const getPurchaseSummaryTotals = async (supplierIds = []) => {
  if (supplierIds.length === 0) return { ...EMPTY_PURCHASE_SUMMARY };

  const [row] = await Purchasing.aggregate([
    { $match: buildMatch(supplierIds) },
    { $group: { _id: null, ...summaryFields } },
  ]);

  if (!row) return { ...EMPTY_PURCHASE_SUMMARY };
  const { _id, ...summary } = row;
  return summary;
};

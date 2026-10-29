import mongoose from "mongoose";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import { createStockAuditLog } from "../services/stockAuditLog.service.js";
import CustomError from "./customError.js";

/**
 * Batch ရှိရာ Location (Storefront သို့မဟုတ် Warehouse) ၏ စုစုပေါင်း Stock ကို delta အတိုင်း လျှော့ချ/ပြန်လည်ဖြည့်တင်းသည့် Helper
 * 
 * @param {Object} params
 * @param {mongoose.Types.ObjectId|string} params.inventoryId - ပစ္စည်း ID
 * @param {string} params.locationType - "storefront" သို့မဟုတ် "warehouse"
 * @param {mongoose.Types.ObjectId|string} params.locationId - Location ID
 * @param {number} params.delta - scan အသစ် - ယခင် (delta > 0 လျှော့မည်, delta < 0 ပြန်ပေါင်းမည်)
 * @param {mongoose.Types.ObjectId|string|null} params.adminId - လုပ်ဆောင်သူ ID
 * @param {string} params.orderNumber - Order Number
 * @param {string} params.batchNumber - Batch Number
 * @param {mongoose.Types.ObjectId|string} params.orderId - Order ID
 * @param {mongoose.ClientSession} params.session - MongoDB Transaction Session
 */
export async function adjustBatchLocationStock({
  inventoryId,
  locationType,
  locationId,
  delta,
  adminId = null,
  orderNumber,
  batchNumber,
  orderId,
  session,
}) {
  if (!delta || delta === 0) return;

  const locObjId = new mongoose.Types.ObjectId(locationId);
  const invObjId = new mongoose.Types.ObjectId(inventoryId);

  // Location အမည် ရယူရန်
  let locationDisplayName = "";
  try {
    const locDoc = await LocationProfile.findById(locObjId).select("name locationName type").session(session).lean();
    locationDisplayName = locDoc?.locationName || locDoc?.name || locObjId.toString();
  } catch (_e) {
    locationDisplayName = locObjId.toString();
  }

  if (locationType === "storefront") {
    if (delta > 0) {
      // Stock လျှော့ချခြင်း: quantity >= delta ဖြစ်မှသာ $inc: -delta ပြုလုပ်မည်
      const before = await StorefrontInventory.findOneAndUpdate(
        { inventoryId: invObjId, storefrontId: locObjId, quantity: { $gte: delta } },
        { $inc: { quantity: -delta }, $set: { lastUpdated: new Date() } },
        { session, new: false }
      );

      if (!before) {
        throw new CustomError(
          400,
          `ဆိုင်ခန်း [${locationDisplayName}] ၏ စုစုပေါင်း stock မလုံလောက်ပါ (batch နှင့် မကိုက်)`
        );
      }

      // Audit Log မှတ်တမ်းတင်ခြင်း
      if (adminId) {
        await createStockAuditLog({
          inventoryId: invObjId,
          adminId,
          locationId: locObjId,
          locationType: "storefront",
          stockRecordId: before._id,
          beforeQuantity: before.quantity,
          afterQuantity: before.quantity - delta,
          quantityChange: -delta,
          action: "remove",
          reason: `ecommerce fulfillment ${orderNumber} — batch ${batchNumber}`,
          relatedTransactionId: orderId,
          relatedTransactionType: "order",
          session,
        });
      }
    } else {
      // Stock ပြန်လည်ဖြည့်တင်းခြင်း (delta < 0, ဥပမာ -4 ဆိုလျှင် +4 ပြန်ထည့်)
      const absDelta = Math.abs(delta);
      const before = await StorefrontInventory.findOneAndUpdate(
        { inventoryId: invObjId, storefrontId: locObjId },
        { $inc: { quantity: absDelta }, $set: { lastUpdated: new Date() } },
        { session, new: false, upsert: true }
      );

      const beforeQty = before ? before.quantity : 0;
      if (adminId) {
        await createStockAuditLog({
          inventoryId: invObjId,
          adminId,
          locationId: locObjId,
          locationType: "storefront",
          stockRecordId: before ? before._id : null,
          beforeQuantity: beforeQty,
          afterQuantity: beforeQty + absDelta,
          quantityChange: absDelta,
          action: "add",
          reason: `ecommerce fulfillment adjust/cancel ${orderNumber} — batch ${batchNumber}`,
          relatedTransactionId: orderId,
          relatedTransactionType: "order",
          session,
        });
      }
    }
  } else if (locationType === "warehouse") {
    if (delta > 0) {
      // Warehouse Stock လျှော့ချခြင်း: quantity >= delta ဖြစ်မှသာ $inc: -delta ပြုလုပ်မည်
      const before = await WarehouseStock.findOneAndUpdate(
        { inventoryId: invObjId, warehouseId: locObjId, quantity: { $gte: delta } },
        { $inc: { quantity: -delta }, $set: { lastUpdated: new Date() } },
        { session, new: false }
      );

      if (!before) {
        throw new CustomError(
          400,
          `ဂိုဒေါင် [${locationDisplayName}] ၏ စုစုပေါင်း stock မလုံလောက်ပါ (batch နှင့် မကိုက်)`
        );
      }

      // Audit Log မှတ်တမ်းတင်ခြင်း
      if (adminId) {
        await createStockAuditLog({
          inventoryId: invObjId,
          adminId,
          locationId: locObjId,
          locationType: "warehouse",
          stockRecordId: before._id,
          beforeQuantity: before.quantity,
          afterQuantity: before.quantity - delta,
          quantityChange: -delta,
          action: "remove",
          reason: `ecommerce fulfillment ${orderNumber} — batch ${batchNumber}`,
          relatedTransactionId: orderId,
          relatedTransactionType: "order",
          session,
        });
      }
    } else {
      // Warehouse Stock ပြန်လည်ဖြည့်တင်းခြင်း (delta < 0)
      const absDelta = Math.abs(delta);
      const before = await WarehouseStock.findOneAndUpdate(
        { inventoryId: invObjId, warehouseId: locObjId },
        { $inc: { quantity: absDelta }, $set: { lastUpdated: new Date() } },
        { session, new: false, upsert: true }
      );

      const beforeQty = before ? before.quantity : 0;
      if (adminId) {
        await createStockAuditLog({
          inventoryId: invObjId,
          adminId,
          locationId: locObjId,
          locationType: "warehouse",
          stockRecordId: before ? before._id : null,
          beforeQuantity: beforeQty,
          afterQuantity: beforeQty + absDelta,
          quantityChange: absDelta,
          action: "add",
          reason: `ecommerce fulfillment adjust/cancel ${orderNumber} — batch ${batchNumber}`,
          relatedTransactionId: orderId,
          relatedTransactionType: "order",
          session,
        });
      }
    }
  }
}

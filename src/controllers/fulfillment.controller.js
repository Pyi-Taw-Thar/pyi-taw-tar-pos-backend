import mongoose from "mongoose";
import Order from "../models/orders.model.js";
import EcommerceOrder from "../models/ecommerceOrder.model.js";
import BatchStock from "../models/batchStock.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { logActivity } from "../services/activityLog.service.js";
import { createAndSendCustomerNotification } from "../services/customerNotification.service.js";
import { rescaleLineToBaseQty } from "../utils/uom.utils.js";
import { createStockAuditLog } from "../services/stockAuditLog.service.js";
import { adjustBatchLocationStock } from "../utils/batchLocationStock.utils.js";

/**
 * Synchronize batch stock deltas between existing batches and incoming batches.
 * @param {Object} order - Mongoose Order document
 * @param {Array} fulfilledProducts - Array of { inventoryId/orderProductId, batches: [...] }
 * @param {Object} session - Mongoose client session
 * @param {Boolean} isFinal - If true, requires every product's total scanned quantity to equal requiredQty
 */
async function syncBatchStockDeltas(order, fulfilledProducts, session, isFinal = false, adminId = null) {
  for (const orderProduct of order.ordersProducts) {
    const invIdStr = (
      typeof orderProduct.inventoryId === "object" && orderProduct.inventoryId?._id
        ? orderProduct.inventoryId._id
        : orderProduct.inventoryId
    ).toString();

    const fulfillment = fulfilledProducts.find(
      (f) =>
        (f.orderProductId && f.orderProductId.toString() === orderProduct._id.toString()) ||
        (f.inventoryId && (f.inventoryId._id || f.inventoryId).toString() === invIdStr)
    );

    const requiredQty = orderProduct.baseQuantity || orderProduct.quantity;
    const incomingBatches = fulfillment?.batches || [];
    const totalScanned = incomingBatches.reduce(
      (sum, b) => sum + (Number(b.quantity) || 0),
      0
    );

    if (totalScanned > requiredQty) {
      throw new CustomError(
        400,
        `Total scanned quantity (${totalScanned}) cannot exceed required quantity (${requiredQty}) for product ID ${invIdStr}`
      );
    }

    if (isFinal && totalScanned !== requiredQty) {
      throw new CustomError(
        400,
        `Total scanned quantity (${totalScanned}) does not match required order quantity (${requiredQty}) for product ID ${invIdStr}`
      );
    }

    // Existing batches already saved in this orderProduct
    const existingBatches = orderProduct.batches || [];

    // Map existing batches by batchStockId string
    const existingQtyMap = new Map();
    for (const eb of existingBatches) {
      const idKey = eb.batchStockId ? eb.batchStockId.toString() : null;
      if (idKey) {
        existingQtyMap.set(idKey, (existingQtyMap.get(idKey) || 0) + (Number(eb.quantity) || 0));
      }
    }

    // Process incoming batches
    const updatedBatches = [];
    const incomingQtyMap = new Map();

    for (const b of incomingBatches) {
      let batchStock = null;
      if (b.batchStockId && mongoose.Types.ObjectId.isValid(b.batchStockId)) {
        batchStock = await BatchStock.findById(b.batchStockId)
          .populate("locationId", "locationName name type")
          .session(session);
      } else {
        const baseQuery = {};
        if (b.batchBarcode) {
          baseQuery.batchBarcode = b.batchBarcode.trim();
        } else if (b.batchNumber) {
          baseQuery.inventoryId = orderProduct.inventoryId;
          baseQuery.batchNumber = b.batchNumber.trim();
        } else {
          throw new CustomError(400, "Batch must include batchBarcode or batchStockId");
        }

        // ၁) Main Storefront (M) ဦးစားပေး ရှာဖွေခြင်း (env: FULFILLMENT_STOREFRONT_ID)
        const fulfillmentStorefrontId = process.env.FULFILLMENT_STOREFRONT_ID;
        if (fulfillmentStorefrontId && mongoose.Types.ObjectId.isValid(fulfillmentStorefrontId)) {
          batchStock = await BatchStock.findOne({
            ...baseQuery,
            locationId: new mongoose.Types.ObjectId(fulfillmentStorefrontId),
            quantity: { $gt: 0 },
          })
            .populate("locationId", "locationName name type")
            .session(session);
        }

        // ၂) Order ၏ storefront (E) တွင် ရှာဖွေခြင်း
        if (!batchStock && order.storefrontId) {
          const orderStorefrontId = order.storefrontId._id || order.storefrontId;
          batchStock = await BatchStock.findOne({
            ...baseQuery,
            locationId: orderStorefrontId,
            quantity: { $gt: 0 },
          })
            .populate("locationId", "locationName name type")
            .session(session);
        }

        // ၃) ကျန် location အားလုံးမှ quantity > 0 ရှိသော batch များကို ရှာဖွေခြင်း
        if (!batchStock) {
          const otherBatches = await BatchStock.find({
            ...baseQuery,
            quantity: { $gt: 0 },
          })
            .populate("locationId", "locationName name type")
            .session(session);

          if (otherBatches.length === 1) {
            batchStock = otherBatches[0];
          } else if (otherBatches.length > 1) {
            const locNames = otherBatches.map(
              (ob) => ob.locationId?.locationName || ob.locationId?.name || ob.locationId?.toString()
            );
            throw new CustomError(
              400,
              `Batch [${b.batchBarcode || b.batchNumber}] ကို [${locNames.join(", ")}] တွင် တွေ့ — ဘယ်နေရာမှ ထုတ်မလဲ ရွေး၍မရ၍ main storefront သို့ transfer လုပ်ပါ`
            );
          }
        }

        // ၄) Fallback: မတွေ့ပါက quantity သတ်မှတ်ချက်မပါဘဲ ရှာဖွေခြင်း
        if (!batchStock && b.batchBarcode) {
          batchStock = await BatchStock.findOne({
            batchBarcode: b.batchBarcode.trim(),
          })
            .populate("locationId", "locationName name type")
            .session(session);
        }
      }

      if (!batchStock) {
        throw new CustomError(
          404,
          `Batch stock record not found for batch '${b.batchBarcode || b.batchNumber}'`
        );
      }

      const bsIdStr = batchStock._id.toString();
      const qty = Number(b.quantity) || 0;
      incomingQtyMap.set(bsIdStr, (incomingQtyMap.get(bsIdStr) || 0) + qty);

      const locDoc = batchStock.locationId;
      const locName = locDoc?.locationName || locDoc?.name || null;

      updatedBatches.push({
        batchStockId: batchStock._id,
        batchNumber: batchStock.batchNumber,
        batchBarcode: batchStock.batchBarcode,
        expiryDate: batchStock.expiryDate,
        quantity: qty,
        locationId: batchStock.locationId?._id || batchStock.locationId,
        locationType: batchStock.locationType,
        locationName: locName,
      });
    }

    // Calculate deltas for all involved batchStockIds (both incoming and existing)
    const allBatchIds = new Set([...existingQtyMap.keys(), ...incomingQtyMap.keys()]);

    for (const bsIdStr of allBatchIds) {
      const oldQty = existingQtyMap.get(bsIdStr) || 0;
      const newQty = incomingQtyMap.get(bsIdStr) || 0;
      const delta = newQty - oldQty;

      if (delta === 0) continue;

      const batchStock = await BatchStock.findById(bsIdStr).session(session);
      if (!batchStock) {
        throw new CustomError(404, `Batch stock not found for ID ${bsIdStr}`);
      }

      if (delta > 0) {
        if (batchStock.quantity < delta) {
          throw new CustomError(
            400,
            `Insufficient stock for batch '${batchStock.batchNumber}'. Available: ${batchStock.quantity}, Requested delta: ${delta}`
          );
        }
        batchStock.quantity -= delta;
        if (batchStock.quantity === 0) {
          batchStock.status = "depleted";
        }
      } else if (delta < 0) {
        batchStock.quantity += Math.abs(delta);
        if (batchStock.quantity > 0 && batchStock.status === "depleted") {
          batchStock.status = "active";
        }
      }

      await batchStock.save({ session });

      // Location စုစုပေါင်း Stock လျှော့/တိုးခြင်း (Plan §7)
      // Batch ၏ location သည် order ၏ storefront (E) မဟုတ်ပါက ထို location ၏ စုစုပေါင်း stock ကိုပါ လျှော့/တိုးမည်
      const orderStorefrontIdStr = (order.storefrontId?._id || order.storefrontId)?.toString();
      const batchLocationIdStr = (batchStock.locationId?._id || batchStock.locationId)?.toString();

      if (batchLocationIdStr !== orderStorefrontIdStr) {
        await adjustBatchLocationStock({
          inventoryId: orderProduct.inventoryId,
          locationType: batchStock.locationType,
          locationId: batchStock.locationId,
          delta,
          adminId,
          orderNumber: order.orderNumber,
          batchNumber: batchStock.batchNumber,
          orderId: order._id,
          session,
        });
      }
    }

    // Update orderProduct.batches to new state (only non-zero batches)
    orderProduct.batches = updatedBatches.filter((b) => b.quantity > 0);
  }
}

// GET /api/v1/fulfillment/pending - Fetch all pending and partially fulfilled orders
export const getPendingFulfillmentOrders = asyncErrorHandler(async (req, res, next) => {
  const { search, storefrontId, page = 1, limit = 50 } = req.query;

  const query = {
    isDeleted: false,
    orderStatus: { $in: ["pending", "partially_fulfilled"] },
  };

  if (storefrontId && mongoose.Types.ObjectId.isValid(storefrontId)) {
    query.storefrontId = new mongoose.Types.ObjectId(storefrontId);
  }

  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { orderNumber: { $regex: escaped, $options: "i" } },
      { customerName: { $regex: escaped, $options: "i" } },
      { customerPhone: { $regex: escaped, $options: "i" } },
    ];
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 50;
  const skip = (pageNum - 1) * limitNum;

  const [orders, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: 1 }) // oldest first for queue
      .skip(skip)
      .limit(limitNum)
      .populate("storefrontId", "locationName locationCode")
      .populate("ordersProducts.inventoryId", "productName productCode SKU barcode unitOfMeasure")
      .populate("creditPersonId", "name phone address township")
      .populate("soldBy", "name role"),
    Order.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: orders,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

// POST /api/v1/fulfillment/:orderId/partial - Save partial fulfillment progress with scanned batches
export const savePartialFulfillment = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const fulfilledProducts = req.body.fulfilledProducts || req.body.items;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  if (!Array.isArray(fulfilledProducts)) {
    return next(new CustomError(400, "fulfilledProducts must be an array"));
  }

  const session = await mongoose.startSession();

  try {
    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        isDeleted: false,
      }).session(session);

      if (!order) {
        throw new CustomError(404, "Order not found");
      }

      if (order.orderStatus === "completed") {
        throw new CustomError(400, "Order is already completed and fulfilled");
      }

      if (order.orderStatus === "cancelled") {
        throw new CustomError(400, "Cannot fulfill a cancelled order");
      }

      // Ecommerce order ကို cancel လုပ်ပြီးသား ဆိုလျှင် ဆက်မပို့စေရန်
      if (order.ecommerceOrderId) {
        const linkedEcom = await EcommerceOrder.findById(order.ecommerceOrderId)
          .select("status orderNumber")
          .session(session);
        if (linkedEcom?.status === "cancelled") {
          throw new CustomError(400, `Ecommerce order ${linkedEcom.orderNumber} ကို cancel လုပ်ပြီးဖြစ်၍ fulfill မရပါ`);
        }
      }

      // Check if at least 1 item is scanned across the whole order
      const anyScanned = fulfilledProducts.some((f) =>
        (f.batches || []).some((b) => (Number(b.quantity) || 0) > 0)
      );

      if (!anyScanned) {
        throw new CustomError(400, "At least one batch must be scanned to save partial fulfillment");
      }

      // Sync deltas (isFinal = false)
      await syncBatchStockDeltas(order, fulfilledProducts, session, false, req.user?._id);

      order.orderStatus = "partially_fulfilled";
      await order.save({ session });

      if (order.ecommerceOrderId) {
        const ecomOrder = await EcommerceOrder.findById(order.ecommerceOrderId).session(session);
        if (ecomOrder) {
          for (const ep of ecomOrder.products) {
            const matchedOp = order.ordersProducts.find(
              (p) =>
                (p.inventoryId._id || p.inventoryId).toString() ===
                (ep.inventoryId._id || ep.inventoryId).toString()
            );
            if (matchedOp && matchedOp.batches) {
              ep.batches = matchedOp.batches;
            }
          }
          await ecomOrder.save({ session });
        }
      }

      await order.populate("storefrontId", "locationName locationCode");
      await order.populate("ordersProducts.inventoryId", "productName productCode SKU barcode unitOfMeasure");
      await order.populate("creditPersonId", "name phone address township");
      await order.populate("soldBy", "name role");

      updatedOrder = order;
    });

    logActivity({
      admin: req.user?._id,
      action: "update",
      feature: "order_fulfillment",
      description: `Saved partial fulfillment for order ${updatedOrder.orderNumber} with updated batch barcodes`,
      targetId: updatedOrder._id,
      targetModel: "Order",
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: "Order partial fulfillment saved successfully",
      data: updatedOrder,
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
});

// POST /api/v1/fulfillment/:orderId - Complete fulfillment with scanned batch barcodes (supports autoAdjust short-ship)
export const fulfillOrder = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const fulfilledProducts = req.body.fulfilledProducts || req.body.items;
  const autoAdjust = req.body.autoAdjust === true;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  if (!Array.isArray(fulfilledProducts) || fulfilledProducts.length === 0) {
    return next(new CustomError(400, "fulfilledProducts must be a non-empty array"));
  }

  const session = await mongoose.startSession();

  try {
    let updatedOrder = null;

    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        isDeleted: false,
      }).session(session);

      if (!order) {
        throw new CustomError(404, "Order not found");
      }

      if (order.orderStatus === "completed") {
        throw new CustomError(400, "Order is already completed and fulfilled");
      }

      if (order.orderStatus === "cancelled") {
        throw new CustomError(400, "Cannot fulfill a cancelled order");
      }

      // Ecommerce order ကို cancel လုပ်ပြီးသား ဆိုလျှင် ဆက်မပို့စေရန်
      if (order.ecommerceOrderId) {
        const linkedEcom = await EcommerceOrder.findById(order.ecommerceOrderId)
          .select("status orderNumber")
          .session(session);
        if (linkedEcom?.status === "cancelled") {
          throw new CustomError(400, `Ecommerce order ${linkedEcom.orderNumber} ကို cancel လုပ်ပြီးဖြစ်၍ fulfill မရပါ`);
        }
      }

      if (autoAdjust) {
        // Sync batch deltas without requiring 100% matched
        await syncBatchStockDeltas(order, fulfilledProducts, session, false, req.user?._id);

        // Adjust order products: keep only products with scanned batches
        const adjustedProducts = [];

        // Base unit ရှာရန် product များကို တစ်ကြိမ်တည်း ယူသည်
        const opInventoryIds = order.ordersProducts.map((op) => op.inventoryId._id || op.inventoryId);
        const opInventories = await Inventory.find({ _id: { $in: opInventoryIds } })
          .select("unitOfMeasure")
          .session(session);
        const baseUnitMap = new Map(opInventories.map((inv) => [inv._id.toString(), inv.unitOfMeasure]));

        for (const op of order.ordersProducts) {
          const invIdStr = (op.inventoryId._id || op.inventoryId).toString();
          const totalScanned = (op.batches || []).reduce(
            (sum, b) => sum + (Number(b.quantity) || 0),
            0
          );

          // Order ဖန်တီးချိန် storefront stock ကို အပြည့်နုတ်ထား၍ ပို့မရသော အရေအတွက်ကို ပြန်ထည့်သည်
          const originalBaseQty = op.baseQuantity || op.quantity * (op.factor || 1);
          const shortfall = originalBaseQty - totalScanned;
          if (shortfall > 0 && order.storefrontId) {
            const storefrontObjId = order.storefrontId._id || order.storefrontId;
            const before = await StorefrontInventory.findOneAndUpdate(
              { inventoryId: invIdStr, storefrontId: storefrontObjId },
              { $inc: { quantity: shortfall }, $set: { lastUpdated: new Date() } },
              { session, new: false }
            );
            if (before && req.user?._id) {
              await createStockAuditLog({
                inventoryId: before.inventoryId,
                adminId: req.user._id,
                locationId: storefrontObjId,
                locationType: "storefront",
                stockRecordId: before._id,
                beforeQuantity: before.quantity,
                afterQuantity: before.quantity + shortfall,
                quantityChange: shortfall,
                action: "add",
                reason: `Fulfillment auto-adjust: ${order.orderNumber} တွင် ပို့မရသော ${shortfall} ပြန်ထည့်`,
                relatedTransactionId: order._id,
                relatedTransactionType: "order",
                session,
              });
            }
          }

          if (totalScanned > 0) {
            const rescaled = rescaleLineToBaseQty(op, totalScanned, baseUnitMap.get(invIdStr));
            op.unit = rescaled.unit;
            op.factor = rescaled.factor;
            op.quantity = rescaled.quantity;
            op.unitPrice = rescaled.unitPrice;
            op.baseQuantity = rescaled.baseQuantity;
            adjustedProducts.push(op);
          }
        }

        if (adjustedProducts.length === 0) {
          throw new CustomError(400, "Cannot complete order with 0 scanned products");
        }

        order.ordersProducts = adjustedProducts;

        // Recalculate financial amounts
        const newSubtotal = adjustedProducts.reduce(
          (sum, p) => sum + (p.quantity * p.unitPrice),
          0
        );
        order.subTotal = newSubtotal;
        const newFinal = Math.max(0, newSubtotal + (order.tax || 0) - (order.discount || 0));
        order.finalAmount = newFinal;

        if (order.paymentType === "paid") {
          order.paidAmount = newFinal;
        } else if (order.paidAmount > newFinal) {
          order.extraChange = (order.extraChange || 0) + (order.paidAmount - newFinal);
          order.paidAmount = newFinal;
        }

        order.orderStatus = "completed";
        await order.save({ session });

        // If this order originated from an ecommerce order, sync and update ecommerce order
        if (order.ecommerceOrderId) {
          const ecomOrder = await EcommerceOrder.findById(order.ecommerceOrderId).session(session);
          if (ecomOrder) {
            const adjustedEcomProducts = [];
            const changeDetails = [];

            for (const ep of ecomOrder.products) {
              const matchedOp = adjustedProducts.find(
                (p) => (p.inventoryId._id || p.inventoryId).toString() === ep.inventoryId.toString()
              );
              if (matchedOp) {
                const originalQty = ep.quantity;
                const originalUnit = ep.unit;
                const originalBaseQty = ep.baseQuantity || ep.quantity * (ep.factor || 1);
                ep.originalQuantity = ep.originalQuantity || originalQty;
                // Fulfillment line နှင့် unit/စျေး တူညီစေရန် (ပုံး → ဘူး ပြောင်းနိုင်)
                ep.unit = matchedOp.unit;
                ep.factor = matchedOp.factor;
                ep.unitPrice = matchedOp.unitPrice;
                ep.quantity = matchedOp.quantity;
                ep.baseQuantity = matchedOp.baseQuantity;
                ep.subtotal = ep.quantity * ep.unitPrice;
                ep.batches = matchedOp.batches || [];
                adjustedEcomProducts.push(ep);

                if (matchedOp.baseQuantity < originalBaseQty) {
                  changeDetails.push(
                    `${ep.productName} (မူလ ${originalQty} ${originalUnit || "ခု"} မှ ${matchedOp.quantity} ${matchedOp.unit || "ခု"} သာ ရရှိပါသည်)`
                  );
                }
              } else {
                changeDetails.push(
                  `${ep.productName} (ပစ္စည်းပြတ်သွားပါသဖြင့် မပါဝင်တော့ပါ)`
                );
              }
            }

            ecomOrder.products = adjustedEcomProducts;
            ecomOrder.totalAmount = newFinal;
            ecomOrder.status = "shipped";
            ecomOrder.isEdited = true;
            ecomOrder.editedReason = "out_of_stock";
            ecomOrder.editedAt = new Date();

            let autoNote = "⚠️ ပစ္စည်းလက်ကျန် မလုံလောက်/ပြတ်သွားသဖြင့် ရရှိနိုင်သော အရေအတွက်အတိုင်း အော်ဒါအား ပြင်ဆင်ဖြည့်ဆည်းပေးထားပါသည်။";
            if (changeDetails.length > 0) {
              autoNote += "\n" + changeDetails.map((c) => `• ${c}`).join("\n");
            }

            ecomOrder.note = ecomOrder.note
              ? `${ecomOrder.note}\n\n${autoNote}`
              : autoNote;

            await ecomOrder.save({ session });

            // Also record note on fulfillment order
            order.note = order.note
              ? `${order.note}\n\n[Auto-Adjusted: ${autoNote}]`
              : `[Auto-Adjusted: ${autoNote}]`;

            // Send notification to customer
            await createAndSendCustomerNotification({
              customerId: ecomOrder.customerId,
              orderId: ecomOrder._id,
              orderNumber: ecomOrder.orderNumber,
              title: `အော်ဒါ #${ecomOrder.orderNumber} အား ပြင်ဆင်ထားပါသည်`,
              message: `ပစ္စည်းလက်ကျန် မလုံလောက်သဖြင့် အော်ဒါ #${ecomOrder.orderNumber} အား ရရှိနိုင်သည့် ပစ္စည်းများဖြင့်သာ ပြင်ဆင်ဖြည့်ဆည်းပေးထားပါသည်။ စုစုပေါင်း ကျသင့်ငွေအသစ်: ${newFinal.toLocaleString()} MMK`,
              type: "order_edited",
              metadata: {
                changes: changeDetails,
                newTotal: newFinal,
              },
              session,
            });
          }
        }
      } else {
        // Normal 100% full completion
        await syncBatchStockDeltas(order, fulfilledProducts, session, true, req.user?._id);

        order.orderStatus = "completed";
        await order.save({ session });

        if (order.ecommerceOrderId) {
          const ecomOrder = await EcommerceOrder.findById(order.ecommerceOrderId).session(session);
          if (ecomOrder) {
            ecomOrder.status = "shipped";
            for (const ep of ecomOrder.products) {
              const matchedOp = order.ordersProducts.find(
                (p) =>
                  (p.inventoryId._id || p.inventoryId).toString() ===
                  (ep.inventoryId._id || ep.inventoryId).toString()
              );
              if (matchedOp && matchedOp.batches) {
                ep.batches = matchedOp.batches;
              }
            }
            await ecomOrder.save({ session });
          }
        }
      }

      await order.populate("storefrontId", "locationName locationCode");
      await order.populate("ordersProducts.inventoryId", "productName productCode SKU barcode unitOfMeasure");
      await order.populate("creditPersonId", "name phone address township");
      await order.populate("soldBy", "name role");

      updatedOrder = order;
    });

    logActivity({
      admin: req.user?._id,
      action: "update",
      feature: "order_fulfillment",
      description: autoAdjust
        ? `Fulfilled and short-closed order ${updatedOrder.orderNumber} with auto-adjusted products (${updatedOrder.ordersProducts.length} items, Total: ${updatedOrder.finalAmount} MMK)`
        : `Fulfilled and completed order ${updatedOrder.orderNumber} with verified batch barcodes`,
      targetId: updatedOrder._id,
      targetModel: "Order",
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: autoAdjust
        ? "Order automatically adjusted and completed successfully"
        : "Order fulfilled and completed successfully",
      data: updatedOrder,
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
});

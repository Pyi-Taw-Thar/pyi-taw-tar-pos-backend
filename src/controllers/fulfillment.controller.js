import mongoose from "mongoose";
import Order from "../models/orders.model.js";
import BatchStock from "../models/batchStock.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { logActivity } from "../services/activityLog.service.js";

// GET /api/v1/fulfillment/pending - Fetch all pending orders for fulfillment
export const getPendingFulfillmentOrders = asyncErrorHandler(async (req, res, next) => {
  const { search, storefrontId, page = 1, limit = 50 } = req.query;

  const query = {
    isDeleted: false,
    orderStatus: "pending",
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
      .sort({ createdAt: 1 }) // oldest pending first for warehouse queue
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

// POST /api/v1/fulfillment/:orderId - Complete fulfillment with scanned batch barcodes
export const fulfillOrder = asyncErrorHandler(async (req, res, next) => {
  const { orderId } = req.params;
  const fulfilledProducts = req.body.fulfilledProducts || req.body.items;

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

      // Validate each ordered product has matching fulfillment
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

        if (!fulfillment) {
          throw new CustomError(400, `Missing scanned batches for product ID ${invIdStr}`);
        }

        const requiredQty = orderProduct.baseQuantity || orderProduct.quantity;
        const totalScanned = (fulfillment.batches || []).reduce(
          (sum, b) => sum + (Number(b.quantity) || 0),
          0
        );

        if (totalScanned !== requiredQty) {
          throw new CustomError(
            400,
            `Total scanned quantity (${totalScanned}) does not match required order quantity (${requiredQty})`
          );
        }

        // Deduct from BatchStock for each scanned batch
        const finalBatches = [];

        for (const b of fulfillment.batches) {
          let batchQuery = {};
          if (b.batchStockId && mongoose.Types.ObjectId.isValid(b.batchStockId)) {
            batchQuery._id = b.batchStockId;
          } else if (b.batchBarcode) {
            batchQuery.batchBarcode = b.batchBarcode.trim();
          } else if (b.batchNumber) {
            batchQuery.inventoryId = orderProduct.inventoryId;
            batchQuery.batchNumber = b.batchNumber.trim();
          } else {
            throw new CustomError(400, "Batch must include batchBarcode or batchStockId");
          }

          if (order.storefrontId) {
            batchQuery.locationId = order.storefrontId;
          }

          let batchStock = await BatchStock.findOne(batchQuery).session(session);

          // If not found at specific storefront, look across active batches with this barcode
          if (!batchStock && b.batchBarcode) {
            batchStock = await BatchStock.findOne({
              batchBarcode: b.batchBarcode.trim(),
              quantity: { $gte: b.quantity },
            }).session(session);
          }

          if (!batchStock) {
            throw new CustomError(
              404,
              `Batch stock record not found for batch '${b.batchBarcode || b.batchNumber}'`
            );
          }

          if (batchStock.quantity < b.quantity) {
            throw new CustomError(
              400,
              `Insufficient stock for batch '${batchStock.batchNumber}'. Available: ${batchStock.quantity}, Requested: ${b.quantity}`
            );
          }

          // Deduct batch quantity
          batchStock.quantity -= b.quantity;
          if (batchStock.quantity === 0) {
            batchStock.status = "depleted";
          }
          await batchStock.save({ session });

          finalBatches.push({
            batchStockId: batchStock._id,
            batchNumber: batchStock.batchNumber,
            batchBarcode: batchStock.batchBarcode,
            expiryDate: batchStock.expiryDate,
            quantity: b.quantity,
          });
        }

        orderProduct.batches = finalBatches;
      }

      // Mark order as completed
      order.orderStatus = "completed";
      await order.save({ session });

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
      description: `Fulfilled and completed order ${updatedOrder.orderNumber} with verified batch barcodes`,
      targetId: updatedOrder._id,
      targetModel: "Order",
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: "Order fulfilled and completed successfully",
      data: updatedOrder,
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
});

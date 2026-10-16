import mongoose from "mongoose";
import BatchStock from "../models/batchStock.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { logActivity } from "../services/activityLog.service.js";

/**
 * Scan batch barcode (used in POS & Fulfillment)
 * Endpoint: GET /api/v1/batches/scan/:batchBarcode
 */
export const scanBatchBarcode = asyncErrorHandler(async (req, res, next) => {
  const { batchBarcode } = req.params;
  const { locationId } = req.query;

  if (!batchBarcode) {
    return next(new CustomError(400, "Batch barcode is required"));
  }

  const trimmed = String(batchBarcode).trim();
  // Support flexible barcode matching (e.g. B00006 vs B000006 or B6)
  let barcodeFilter = trimmed;
  const bMatch = trimmed.match(/^B(\d+)$/i);
  if (bMatch) {
    const num = parseInt(bMatch[1], 10);
    barcodeFilter = { $regex: new RegExp(`^B0*${num}$`, "i") };
  }

  const query = {
    batchBarcode: barcodeFilter,
  };

  if (locationId) {
    if (!mongoose.Types.ObjectId.isValid(locationId)) {
      return next(new CustomError(400, "Invalid location ID format"));
    }
    query.locationId = new mongoose.Types.ObjectId(locationId);
  }

  let batch = await BatchStock.findOne(query)
    .populate(
      "inventoryId",
      "productName productCode SKU category buyingPrice sellingPrice uom wholesalePrices chemicalNames"
    )
    .populate("locationId", "locationName locationCode type");

  // Fallback: If not found at the specific location, check at any location (e.g. warehouse)
  if (!batch && locationId) {
    batch = await BatchStock.findOne({ batchBarcode: barcodeFilter })
      .populate(
        "inventoryId",
        "productName productCode SKU category buyingPrice sellingPrice uom wholesalePrices chemicalNames"
      )
      .populate("locationId", "locationName locationCode type");
  }

  if (!batch) {
    return next(
      new CustomError(
        404,
        `Batch with barcode '${batchBarcode}' not found`
      )
    );
  }

  const now = new Date();
  const isExpired = batch.expiryDate ? new Date(batch.expiryDate) < now : false;
  const daysUntilExpiry = batch.expiryDate
    ? Math.ceil((new Date(batch.expiryDate) - now) / (1000 * 60 * 60 * 24))
    : null;

  res.status(200).json({
    success: true,
    data: {
      ...batch.toObject(),
      isExpired,
      daysUntilExpiry,
    },
  });
});

/**
 * Get all batches for a specific product at a location
 * Endpoint: GET /api/v1/batches/by-product/:inventoryId
 */
export const getBatchesByProduct = asyncErrorHandler(async (req, res, next) => {
  const { inventoryId } = req.params;
  const { locationId, includeDepleted = "false" } = req.query;

  if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
    return next(new CustomError(400, "Invalid inventory ID format"));
  }

  const query = {
    inventoryId: new mongoose.Types.ObjectId(inventoryId),
  };

  if (locationId) {
    if (!mongoose.Types.ObjectId.isValid(locationId)) {
      return next(new CustomError(400, "Invalid location ID format"));
    }
    query.locationId = new mongoose.Types.ObjectId(locationId);
  }

  if (includeDepleted !== "true") {
    query.quantity = { $gt: 0 };
    query.status = { $ne: "depleted" };
  }

  const batches = await BatchStock.find(query)
    .populate("locationId", "locationName locationCode type")
    .sort({ expiryDate: 1, createdAt: 1 });

  const now = new Date();
  const enhancedBatches = batches.map((b) => {
    const isExpired = b.expiryDate ? new Date(b.expiryDate) < now : false;
    const daysUntilExpiry = b.expiryDate
      ? Math.ceil((new Date(b.expiryDate) - now) / (1000 * 60 * 60 * 24))
      : null;
    return {
      ...b.toObject(),
      isExpired,
      daysUntilExpiry,
    };
  });

  res.status(200).json({
    success: true,
    count: enhancedBatches.length,
    data: enhancedBatches,
  });
});

/**
 * Get batches expiring soon (within N days)
 * Endpoint: GET /api/v1/batches/expiring
 */
export const getExpiringBatches = asyncErrorHandler(async (req, res, next) => {
  const { days = 30, locationId, locationType } = req.query;
  const daysNum = parseInt(days, 10) || 30;

  const now = new Date();
  const targetDate = new Date();
  targetDate.setDate(now.getDate() + daysNum);

  const query = {
    expiryDate: { $gte: now, $lte: targetDate },
    quantity: { $gt: 0 },
    status: { $ne: "depleted" },
  };

  if (locationId) {
    if (!mongoose.Types.ObjectId.isValid(locationId)) {
      return next(new CustomError(400, "Invalid location ID format"));
    }
    query.locationId = new mongoose.Types.ObjectId(locationId);
  }

  if (locationType) {
    query.locationType = locationType;
  }

  const batches = await BatchStock.find(query)
    .populate(
      "inventoryId",
      "productName productCode SKU category sellingPrice buyingPrice uom"
    )
    .populate("locationId", "locationName locationCode type")
    .sort({ expiryDate: 1 });

  const enhancedBatches = batches.map((b) => {
    const daysUntilExpiry = Math.ceil(
      (new Date(b.expiryDate) - now) / (1000 * 60 * 60 * 24)
    );
    return {
      ...b.toObject(),
      daysUntilExpiry,
      isExpired: false,
    };
  });

  res.status(200).json({
    success: true,
    count: enhancedBatches.length,
    data: enhancedBatches,
  });
});

/**
 * Get already expired batches
 * Endpoint: GET /api/v1/batches/expired
 */
export const getExpiredBatches = asyncErrorHandler(async (req, res, next) => {
  const { locationId, locationType } = req.query;
  const now = new Date();

  const query = {
    expiryDate: { $lt: now },
    quantity: { $gt: 0 },
  };

  if (locationId) {
    if (!mongoose.Types.ObjectId.isValid(locationId)) {
      return next(new CustomError(400, "Invalid location ID format"));
    }
    query.locationId = new mongoose.Types.ObjectId(locationId);
  }

  if (locationType) {
    query.locationType = locationType;
  }

  const batches = await BatchStock.find(query)
    .populate(
      "inventoryId",
      "productName productCode SKU category sellingPrice buyingPrice uom"
    )
    .populate("locationId", "locationName locationCode type")
    .sort({ expiryDate: 1 });

  const enhancedBatches = batches.map((b) => {
    const daysExpired = Math.abs(
      Math.ceil((now - new Date(b.expiryDate)) / (1000 * 60 * 60 * 24))
    );
    return {
      ...b.toObject(),
      daysExpired,
      isExpired: true,
    };
  });

  res.status(200).json({
    success: true,
    count: enhancedBatches.length,
    data: enhancedBatches,
  });
});

/**
 * Adjust batch stock quantity (damaged, expired, inventory count adjustment)
 * Endpoint: POST /api/v1/batches/adjust
 */
export const adjustBatchStock = asyncErrorHandler(async (req, res, next) => {
  const { batchStockId, adjustedQuantity, reason, notes } = req.body;

  if (!batchStockId || !mongoose.Types.ObjectId.isValid(batchStockId)) {
    return next(new CustomError(400, "Valid batchStockId is required"));
  }

  if (adjustedQuantity === undefined || adjustedQuantity < 0) {
    return next(new CustomError(400, "adjustedQuantity must be 0 or greater"));
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const batch = await BatchStock.findById(batchStockId).session(session);
    if (!batch) {
      throw new CustomError(404, "Batch stock record not found");
    }

    const previousQty = batch.quantity;
    const diff = adjustedQuantity - previousQty;

    batch.quantity = adjustedQuantity;
    batch.status = adjustedQuantity === 0 ? "depleted" : "active";
    await batch.save({ session });

    // Update aggregate location stock
    if (batch.locationType === "warehouse") {
      await WarehouseStock.findOneAndUpdate(
        { inventoryId: batch.inventoryId, warehouseId: batch.locationId },
        { $inc: { quantity: diff }, $set: { lastUpdated: new Date() } },
        { session }
      );
    } else if (batch.locationType === "storefront") {
      await StorefrontInventory.findOneAndUpdate(
        { inventoryId: batch.inventoryId, storefrontId: batch.locationId },
        { $inc: { quantity: diff }, $set: { lastUpdated: new Date() } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    logActivity({
      admin: req.user._id,
      action: "adjust_batch_stock",
      feature: "batch",
      description: `Adjusted batch ${batch.batchNumber} (${batch.batchBarcode}) from ${previousQty} to ${adjustedQuantity}. Reason: ${reason || "N/A"}`,
      targetId: batch._id,
      targetModel: "BatchStock",
      metadata: { previousQty, adjustedQuantity, diff, reason, notes },
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: "Batch stock adjusted successfully",
      data: batch,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(error);
  }
});

/**
 * Get all batches list with pagination, search, filter
 * Endpoint: GET /api/v1/batches
 */
export const getAllBatches = asyncErrorHandler(async (req, res, next) => {
  const {
    page = 1,
    limit = 20,
    search,
    locationId,
    locationType,
    status,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = req.query;

  const query = {};

  if (locationId) {
    if (mongoose.Types.ObjectId.isValid(locationId)) {
      query.locationId = new mongoose.Types.ObjectId(locationId);
    }
  }

  if (locationType) {
    query.locationType = locationType;
  }

  if (status) {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { batchNumber: new RegExp(search, "i") },
      { batchBarcode: new RegExp(search, "i") },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.max(1, parseInt(limit, 10));
  const skip = (pageNum - 1) * limitNum;

  const total = await BatchStock.countDocuments(query);
  const batches = await BatchStock.find(query)
    .populate("inventoryId", "productName productCode SKU category sellingPrice")
    .populate("locationId", "locationName locationCode type")
    .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
    .skip(skip)
    .limit(limitNum);

  const now = new Date();
  const enhanced = batches.map((b) => {
    const isExpired = b.expiryDate ? new Date(b.expiryDate) < now : false;
    const daysUntilExpiry = b.expiryDate
      ? Math.ceil((new Date(b.expiryDate) - now) / (1000 * 60 * 60 * 24))
      : null;
    return {
      ...b.toObject(),
      isExpired,
      daysUntilExpiry,
    };
  });

  res.status(200).json({
    success: true,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    data: enhanced,
  });
});

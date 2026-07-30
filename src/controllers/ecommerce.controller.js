import mongoose from "mongoose";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import EcommerceOrder from "../models/ecommerceOrder.model.js";
import Customer from "../models/customer.model.js";
import PurchaseReset from "../models/purchaseReset.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { logActivity } from "../services/activityLog.service.js";
import { getTierMultiplier } from "../services/customerTier.service.js";

const ecommerceStorefrontId = process.env.ECOMMERCE_STOREFRONT_ID;

export const getBrands = asyncErrorHandler(async (req, res, next) => {
  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontObjId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const brands = await StorefrontInventory.aggregate([
    { $match: { storefrontId: storefrontObjId } },
    {
      $lookup: {
        from: "inventories",
        localField: "inventoryId",
        foreignField: "_id",
        as: "inventory",
      },
    },
    { $unwind: "$inventory" },
    { $match: { "inventory.status": "active" } },
    {
      $group: {
        _id: "$inventory.brand",
      },
    },
    {
      $project: {
        _id: 0,
        brand: "$_id",
      },
    },
    { $sort: { brand: 1 } },
  ]);

  const brandList = brands.map((b) => b.brand).filter(Boolean);

  res.status(200).json({
    success: true,
    data: brandList,
  });
});

export const getCategories = asyncErrorHandler(async (req, res, next) => {
  const { brand } = req.query;

  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontObjId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const pipe = [
    { $match: { storefrontId: storefrontObjId } },
    {
      $lookup: {
        from: "inventories",
        localField: "inventoryId",
        foreignField: "_id",
        as: "inventory",
      },
    },
    { $unwind: "$inventory" },
    { $match: { "inventory.status": "active" } },
  ];

  if (brand) {
    const escaped = brand.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pipe.push({
      $match: { "inventory.brand": { $regex: `^${escaped}$`, $options: "i" } },
    });
  }

  pipe.push(
    { $group: { _id: "$inventory.category" } },
    { $project: { _id: 0, category: "$_id" } },
    { $sort: { category: 1 } },
  );

  const categories = await StorefrontInventory.aggregate(pipe);

  res.status(200).json({
    success: true,
    data: categories.map((c) => c.category).filter(Boolean),
  });
});

export const getProducts = asyncErrorHandler(async (req, res, next) => {
  const { page, limit, category, search, brand, limitedOnly } = req.query;
  const hasPagination = page !== undefined;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = hasPagination ? (pageNum - 1) * limitNum : 0;

  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontObjId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const matchStage = { storefrontId: storefrontObjId };

  const buildPipeline = (forCount = false) => {
    const pipe = [
      { $match: matchStage },
      {
        $lookup: {
          from: "inventories",
          localField: "inventoryId",
          foreignField: "_id",
          as: "inventory",
        },
      },
      { $unwind: "$inventory" },
      { $match: { "inventory.status": "active" } },
    ];

    if (limitedOnly === "true") {
      pipe.push({ $match: { "inventory.ecommerceMaxPerUser": { $ne: null } } });
    }

    if (category) {
      pipe.push({ $match: { "inventory.category": category } });
    }

    if (brand) {
      const escaped = brand.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pipe.push({
        $match: { "inventory.brand": { $regex: `^${escaped}$`, $options: "i" } },
      });
    }

    if (search) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pipe.push({
        $match: {
          $or: [
            { "inventory.productName": { $regex: escaped, $options: "i" } },
            { "inventory.productCode": { $regex: escaped, $options: "i" } },
          ],
        },
      });
    }

    if (forCount) {
      pipe.push({ $count: "total" });
    } else {
      if (hasPagination) {
        pipe.push({ $skip: skip }, { $limit: limitNum });
      }
      pipe.push(
        { $addFields: { hasPurchaseLimit: { $ne: ["$inventory.ecommerceMaxPerUser", null] } } },
        {
        $project: {
          _id: 1,
          quantity: 1,
          hasPurchaseLimit: 1,
          product: {
            _id: "$inventory._id",
            productName: "$inventory.productName",
            productCode: "$inventory.productCode",
            SKU: "$inventory.SKU",
            category: "$inventory.category",
            subCategory: "$inventory.subCategory",
            brand: "$inventory.brand",
            unitOfMeasure: "$inventory.unitOfMeasure",
            sellingPrice: "$inventory.sellingPrice",
            uomConversions: "$inventory.uomConversions",
            wholesalePrices: "$inventory.wholesalePrices",
            images: "$inventory.images",
            ecommerceMaxPerUser: "$inventory.ecommerceMaxPerUser",
            ecommercePurchaseResetMode: "$inventory.ecommercePurchaseResetMode",
            ecommercePurchaseResetDays: "$inventory.ecommercePurchaseResetDays",
          },
        },
      });
    }

    return pipe;
  };

  const enrichWithQuantityByUnit = (items) =>
    items.map(item => {
      const inv = item.product;
      const uomConversions = inv?.uomConversions || [];
      const baseUnit = inv?.unitOfMeasure || 'piece';
      const baseQty = item.quantity || 0;
      const quantityByUnit = { [baseUnit]: baseQty };
      for (const conv of uomConversions) {
        quantityByUnit[conv.unit] = baseQty / conv.factor;
      }
      return { ...item, quantityByUnit };
    });

  if (hasPagination) {
    const [rawProducts, countResult] = await Promise.all([
      StorefrontInventory.aggregate(buildPipeline(false)),
      StorefrontInventory.aggregate(buildPipeline(true)),
    ]);

    const totalCount = countResult[0]?.total || 0;
    const products = enrichWithQuantityByUnit(rawProducts);

    res.status(200).json({
      success: true,
      data: products,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum) || 1,
        totalItems: totalCount,
        itemsPerPage: limitNum,
      },
    });
  } else {
    const rawProducts = await StorefrontInventory.aggregate(buildPipeline(false));
    const products = enrichWithQuantityByUnit(rawProducts);

    res.status(200).json({
      success: true,
      data: products,
    });
  }
});

export const createOrder = asyncErrorHandler(async (req, res, next) => {
  const {
    products,
    shippingAddressId,
    paymentMethod,
    note,
  } = req.body;
  const customerId = req.customer._id;

  let shippingAddress = {
    label: "Main",
    addressLine: req.customer.address || "",
    city: req.customer.township || "",
  };

  if (!products || !Array.isArray(products) || products.length === 0) {
    return next(new CustomError(400, "Order must have at least one product"));
  }

  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  // Validate storefront exists
  const storefront = await LocationProfile.findOne({
    _id: storefrontId,
    type: "storefront",
    isDeleted: false,
  });
  if (!storefront) {
    return next(new CustomError(404, "Ecommerce storefront not found"));
  }

  // Fetch all inventory items and stock records
  const inventoryIds = products.map((p) => p.inventoryId);
  const inventories = await Inventory.find({
    _id: { $in: inventoryIds },
    status: "active",
  });
  const inventoryMap = {};
  for (const inv of inventories) {
    inventoryMap[inv._id.toString()] = inv;
  }

  const stockRecords = await StorefrontInventory.find({
    inventoryId: { $in: inventoryIds },
    storefrontId,
  });
  const stockMap = {};
  for (const sr of stockRecords) {
    stockMap[sr.inventoryId.toString()] = sr;
  }

  // —— P1: Batch limit check queries outside loop ——
  const limitedInvIds = [];
  for (const inv of inventories) {
    if (inv.ecommerceMaxPerUser) limitedInvIds.push(inv._id.toString());
  }

  let orderedMap = {};
  let resetMap = {};

  if (limitedInvIds.length > 0) {
    const allResets = await PurchaseReset.find({
      customerId: { $in: [customerId, null] },
      inventoryId: { $in: limitedInvIds },
    }).sort({ resetAt: -1 });

    for (const r of allResets) {
      if (!resetMap[r.inventoryId.toString()]) {
        resetMap[r.inventoryId.toString()] = r;
      }
    }

    let earliestCutoff = new Date();
    for (const inv of inventories) {
      if (!inv.ecommerceMaxPerUser) continue;
      const latestReset = resetMap[inv._id.toString()];
      let cutoff;
      if (inv.ecommercePurchaseResetMode === "manual") {
        cutoff = latestReset ? latestReset.resetAt : new Date(0);
      } else {
        const days = inv.ecommercePurchaseResetDays || 30;
        const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        cutoff = latestReset
          ? new Date(Math.max(latestReset.resetAt, windowStart))
          : windowStart;
      }
      if (cutoff < earliestCutoff) earliestCutoff = cutoff;
    }

    const allOrders = await EcommerceOrder.find({
      customerId,
      createdAt: { $gte: earliestCutoff },
      isDeleted: false,
      status: { $ne: "cancelled" },
      "products.inventoryId": { $in: limitedInvIds },
    });

    orderedMap = {};
    for (const order of allOrders) {
      for (const p of order.products) {
        const pid = p.inventoryId.toString();
        if (limitedInvIds.includes(pid)) {
          orderedMap[pid] = (orderedMap[pid] || 0) + (p.baseQuantity || p.quantity);
        }
      }
    }
  }

  // Validate each product
  let totalAmount = 0;
  const validatedProducts = [];
  const stockUpdates = [];

  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    const invId = item.inventoryId;

    if (!mongoose.Types.ObjectId.isValid(invId)) {
      return next(new CustomError(400, `Product at index ${i}: Invalid inventory ID`));
    }

    const inventory = inventoryMap[invId];
    if (!inventory) {
      return next(new CustomError(404, `Product at index ${i}: Inventory not found`));
    }

    const stockRecord = stockMap[invId];
    if (!stockRecord) {
      return next(new CustomError(404, `Product at index ${i}: Not available in ecommerce store`));
    }

    const requestedQty = item.quantity;
    if (!requestedQty || requestedQty < 1) {
      return next(new CustomError(400, `Product at index ${i}: Quantity must be at least 1`));
    }

    const itemUnit = item.unit || inventory.unitOfMeasure || null;
    const factor = getUnitFactor(inventory, itemUnit);
    const baseQty = requestedQty * factor;

    if (stockRecord.quantity < baseQty) {
      return next(new CustomError(400, `Product at index ${i}: Insufficient stock (available: ${stockRecord.quantity}, requested: ${baseQty} in base unit "${inventory.unitOfMeasure}")`));
    }

    if (inventory.ecommerceMaxPerUser) {
      const tierMultiplier = getTierMultiplier(req.customer.tier);
      const effectiveLimit = inventory.ecommerceMaxPerUser * tierMultiplier;
      const alreadyOrdered = orderedMap[invId] || 0;
      const totalBaseQty = alreadyOrdered + baseQty;
      if (totalBaseQty > effectiveLimit) {
        const remaining = Math.max(0, effectiveLimit - alreadyOrdered);
        const modeLabel = inventory.ecommercePurchaseResetMode === "timeline"
          ? `per ${inventory.ecommercePurchaseResetDays} days`
          : "until admin reset";
        return next(new CustomError(400,
          `"${inventory.productName}" limit: max ${effectiveLimit} ${modeLabel} (tier: ${req.customer.tier}). You have ${remaining} left.`
        ));
      }
    }

    let unitPrice = inventory.sellingPrice * factor;
    if (item.unitPrice) {
      unitPrice = item.unitPrice;
    } else if (inventory.wholesalePrices?.length > 0) {
      const matchingWholesale = inventory.wholesalePrices.filter(
        (wp) => wp.unit === itemUnit || (!wp.unit && !itemUnit),
      );
      if (matchingWholesale.length > 0) {
        const sorted = [...matchingWholesale].sort((a, b) => b.quantity - a.quantity);
        const tier = sorted.find((wp) => requestedQty >= wp.quantity);
        if (tier) unitPrice = tier.price;
      }
    }
    const subtotal = requestedQty * unitPrice;
    totalAmount += subtotal;

    validatedProducts.push({
      inventoryId: new mongoose.Types.ObjectId(invId),
      productName: inventory.productName,
      productCode: inventory.productCode,
      unit: itemUnit,
      quantity: requestedQty,
      factor,
      baseQuantity: baseQty,
      unitPrice,
      subtotal,
    });

    stockUpdates.push({
      stockRecord,
      deductQty: baseQty,
    });
  }

  // Deduct stock
  for (const update of stockUpdates) {
    update.stockRecord.quantity -= update.deductQty;
    update.stockRecord.lastUpdated = new Date();
    await update.stockRecord.save();
  }

  // Create order
  const order = await EcommerceOrder.create({
    customerId,
    products: validatedProducts,
    shippingAddress: shippingAddress || {},
    totalAmount,
    paymentMethod: paymentMethod || "cash_on_delivery",
    note: note || null,
  });

  await order.populate("products.inventoryId", "productName productCode SKU images");

  res.status(201).json({
    success: true,
    message: "Order placed successfully.",
    data: order,
  });
});

export const getMyOrders = asyncErrorHandler(async (req, res, next) => {
  const customerId = req.customer._id;
  const { page, limit } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [orders, total] = await Promise.all([
    EcommerceOrder.find({ customerId, isDeleted: false })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("products.inventoryId", "productName productCode SKU images"),
    EcommerceOrder.countDocuments({ customerId, isDeleted: false }),
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

export const getMyOrderById = asyncErrorHandler(async (req, res, next) => {
  const customerId = req.customer._id;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  const order = await EcommerceOrder.findOne({
    _id: id,
    customerId,
    isDeleted: false,
  }).populate("products.inventoryId", "productName productCode SKU images");

  if (!order) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    data: order,
  });
});

export const getAllEcommerceOrders = asyncErrorHandler(async (req, res, next) => {
  const { page, limit, search, status, startDate, endDate } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  const filter = { isDeleted: false };
  if (status) filter.status = status;

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  if (search) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const orderMatch = { orderNumber: { $regex: escaped, $options: "i" } };
    const customers = await Customer.find({
      name: { $regex: escaped, $options: "i" },
    }).select("_id");
    const customerIds = customers.map((c) => c._id);
    filter.$or = [orderMatch, { customerId: { $in: customerIds } }];
  }

  const [orders, total] = await Promise.all([
    EcommerceOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("customerId", "name phone")
      .populate("products.inventoryId", "productName productCode SKU images"),
    EcommerceOrder.countDocuments(filter),
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

export const getEcommerceOrderById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  const order = await EcommerceOrder.findById(id)
    .populate("customerId", "name phone address township")
    .populate("products.inventoryId", "productName productCode SKU images");

  if (!order || order.isDeleted) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    data: order,
  });
});

export const updateEcommerceOrderStatus = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
  if (!status || !validStatuses.includes(status)) {
    return next(new CustomError(400, `Invalid status. Allowed: ${validStatuses.join(", ")}`));
  }

  const order = await EcommerceOrder.findByIdAndUpdate(
    id,
    { status },
    { new: true, runValidators: true }
  );

  if (!order || order.isDeleted) {
    return next(new CustomError(404, "Order not found"));
  }

  res.status(200).json({
    success: true,
    message: "Order status updated successfully.",
    data: order,
  });
});

const getUnitFactor = (inventory, unit) => {
  if (!unit || !inventory.uomConversions?.length) return 1;
  const conv = inventory.uomConversions.find(
    c => c.unit?.toLowerCase() === unit.toLowerCase()
  );
  return conv ? conv.factor : 1;
};

const applyWholesalePrice = (inventory, quantity, unit = null) => {
  if (!inventory.wholesalePrices?.length) return inventory.sellingPrice;
  const matchingWholesale = inventory.wholesalePrices.filter(
    (wp) => wp.unit === unit || (!wp.unit && !unit),
  );
  if (matchingWholesale.length === 0) return inventory.sellingPrice;
  const sorted = [...matchingWholesale].sort((a, b) => b.quantity - a.quantity);
  const tier = sorted.find((wp) => quantity >= wp.quantity);
  return tier ? tier.price : inventory.sellingPrice;
};

const recalculateTotal = (products) => {
  return products.reduce((sum, p) => sum + p.subtotal, 0);
};

export const updateEcommerceOrderProducts = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, products } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  if (!action || !["add", "remove"].includes(action)) {
    return next(new CustomError(400, 'Action must be "add" or "remove"'));
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    return next(new CustomError(400, "Products array is required and must not be empty"));
  }

  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    if (!item.inventoryId) {
      return next(new CustomError(400, `Product at index ${i}: inventoryId is required`));
    }
    if (!mongoose.Types.ObjectId.isValid(item.inventoryId)) {
      return next(new CustomError(400, `Product at index ${i}: Invalid inventoryId`));
    }
    if (!item.quantity || item.quantity < 1) {
      return next(new CustomError(400, `Product at index ${i}: Quantity must be at least 1`));
    }
  }

  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const order = await EcommerceOrder.findById(id).session(session);
      if (!order || order.isDeleted) {
        throw new CustomError(404, "Order not found");
      }
      if (order.status !== "pending") {
        throw new CustomError(400, `Cannot modify products when status is "${order.status}". Only pending orders can be modified.`);
      }

      const inventoryIds = products.map((p) => new mongoose.Types.ObjectId(p.inventoryId));
      const inventories = await Inventory.find({ _id: { $in: inventoryIds } }).session(session);
      const inventoryMap = {};
      for (const inv of inventories) {
        inventoryMap[inv._id.toString()] = inv;
      }

      const stockRecords = await StorefrontInventory.find({ inventoryId: { $in: inventoryIds }, storefrontId }).session(session);
      const stockMap = {};
      for (const sr of stockRecords) {
        stockMap[sr.inventoryId.toString()] = sr;
      }

      // —— P1: Batch limit check queries outside add loop ——
      let orderedMap = {};
      let resetMap = {};

      if (action === "add") {
        const addInvIds = products.map((p) => p.inventoryId);
        const limitedInvIds = [];
        for (const inv of inventories) {
          if (inv.ecommerceMaxPerUser) {
            limitedInvIds.push(inv._id.toString());
          }
        }

        if (limitedInvIds.length > 0) {
          const allResets = await PurchaseReset.find({
            customerId: { $in: [order.customerId, null] },
            inventoryId: { $in: limitedInvIds },
          }).sort({ resetAt: -1 }).session(session);

          for (const r of allResets) {
            if (!resetMap[r.inventoryId.toString()]) {
              resetMap[r.inventoryId.toString()] = r;
            }
          }

          let earliestCutoff = new Date();
          for (const inv of inventories) {
            if (!inv.ecommerceMaxPerUser) continue;
            const latestReset = resetMap[inv._id.toString()];
            let cutoff;
            if (inv.ecommercePurchaseResetMode === "manual") {
              cutoff = latestReset ? latestReset.resetAt : new Date(0);
            } else {
              const days = inv.ecommercePurchaseResetDays || 30;
              const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
              cutoff = latestReset
                ? new Date(Math.max(latestReset.resetAt, windowStart))
                : windowStart;
            }
            if (cutoff < earliestCutoff) earliestCutoff = cutoff;
          }

          const allOrders = await EcommerceOrder.find({
            customerId: order.customerId,
            createdAt: { $gte: earliestCutoff },
            isDeleted: false,
            status: { $ne: "cancelled" },
            "products.inventoryId": { $in: limitedInvIds },
          }).session(session);

          orderedMap = {};
          for (const o of allOrders) {
            for (const p of o.products) {
              const pid = p.inventoryId.toString();
              if (limitedInvIds.includes(pid)) {
                orderedMap[pid] = (orderedMap[pid] || 0) + (p.baseQuantity || p.quantity);
              }
            }
          }
        }
      }

      if (action === "add") {
        // Look up the customer's tier for effective limit calculation
        const orderCustomer = await Customer.findById(order.customerId).session(session);
        const customerTier = orderCustomer?.tier || "standard";

        for (const item of products) {
          const invId = item.inventoryId;
          const inventory = inventoryMap[invId];
          if (!inventory) {
            throw new CustomError(404, `Inventory not found: ${invId}`);
          }

          const stockRecord = stockMap[invId];
          if (!stockRecord) {
            throw new CustomError(404, `Product not available in ecommerce store: ${invId}`);
          }

          const itemUnit = item.unit || inventory.unitOfMeasure || null;
          const factor = getUnitFactor(inventory, itemUnit);
          const baseQty = item.quantity * factor;

          if (stockRecord.quantity < baseQty) {
            throw new CustomError(400, `Insufficient stock for ${inventory.productName} (available: ${stockRecord.quantity}, requested: ${baseQty} in base unit "${inventory.unitOfMeasure}")`);
          }

          if (inventory.ecommerceMaxPerUser) {
            const tierMultiplier = getTierMultiplier(customerTier);
            const effectiveLimit = inventory.ecommerceMaxPerUser * tierMultiplier;
            const alreadyOrdered = orderedMap[invId] || 0;
            const existingInThisOrder = order.products.find(p => p.inventoryId.toString() === invId);
            const currentInThisOrder = existingInThisOrder ? (existingInThisOrder.baseQuantity || existingInThisOrder.quantity) : 0;
            const totalBaseQty = alreadyOrdered + currentInThisOrder + baseQty;

            if (totalBaseQty > effectiveLimit) {
              const remaining = Math.max(0, effectiveLimit - (alreadyOrdered + currentInThisOrder));
              const modeLabel = inventory.ecommercePurchaseResetMode === "timeline"
                ? `per ${inventory.ecommercePurchaseResetDays} days`
                : "until admin reset";
              throw new CustomError(400,
                `"${inventory.productName}" limit: max ${effectiveLimit} ${modeLabel} (tier: ${customerTier}). You have ${remaining} left.`
              );
            }
          }

          const existingIndex = order.products.findIndex(
            (p) => p.inventoryId.toString() === invId
          );

          let unitPrice;
          let newQty;

          if (existingIndex !== -1) {
            const existing = order.products[existingIndex];
            newQty = existing.quantity + item.quantity;
            unitPrice = item.unitPrice || applyWholesalePrice(inventory, newQty, existing.unit);
            existing.quantity = newQty;
            existing.baseQuantity = (existing.baseQuantity || 0) + baseQty;
            existing.unitPrice = unitPrice;
            existing.subtotal = newQty * unitPrice;
          } else {
            newQty = item.quantity;
            unitPrice = item.unitPrice || applyWholesalePrice(inventory, newQty, itemUnit);
            order.products.push({
              inventoryId: new mongoose.Types.ObjectId(invId),
              productName: inventory.productName,
              productCode: inventory.productCode,
              unit: itemUnit,
              quantity: newQty,
              factor,
              baseQuantity: baseQty,
              unitPrice,
              subtotal: newQty * unitPrice,
            });
          }

          stockRecord.quantity -= baseQty;
          stockRecord.lastUpdated = new Date();
          await stockRecord.save({ session });
        }
      }

      if (action === "remove") {
        for (const item of products) {
          const invId = item.inventoryId;
          const existingIndex = order.products.findIndex(
            (p) => p.inventoryId.toString() === invId
          );

          if (existingIndex === -1) {
            throw new CustomError(404, `Product not found in order: ${invId}`);
          }

          const existing = order.products[existingIndex];
          const removeFactor = existing.factor || 1;
          if (item.quantity > existing.quantity) {
            throw new CustomError(400, `Cannot remove ${item.quantity} items. Only ${existing.quantity} exist in order for this product.`);
          }

          const removeBaseQty = item.quantity * removeFactor;
          const newQty = existing.quantity - item.quantity;
          const newBaseQty = (existing.baseQuantity || existing.quantity) - removeBaseQty;
          if (newQty <= 0) {
            order.products.splice(existingIndex, 1);
          } else {
            const inventory = inventoryMap[invId];
            const unitPrice = applyWholesalePrice(inventory, newQty, existing.unit);
            existing.quantity = newQty;
            existing.baseQuantity = newBaseQty;
            existing.unitPrice = unitPrice;
            existing.subtotal = newQty * unitPrice;
          }

          const stockRecord = stockMap[invId];
          if (stockRecord) {
            stockRecord.quantity += removeBaseQty;
            stockRecord.lastUpdated = new Date();
            await stockRecord.save({ session });
          } else {
            await StorefrontInventory.create([{
              inventoryId: new mongoose.Types.ObjectId(invId),
              storefrontId,
              quantity: removeBaseQty,
              lastUpdated: new Date(),
            }], { session });
          }
        }
      }

      order.totalAmount = recalculateTotal(order.products);
      await order.save({ session });

      await order.populate("products.inventoryId", "productName productCode SKU images");

      logActivity({
        admin: req.user._id,
        action: action === "add" ? "add_items" : "remove_items",
        feature: "ecommerce_order",
        description: `${action === "add" ? "Added" : "Removed"} products from ecommerce order ${order.orderNumber}`,
        targetId: order._id,
        targetModel: "EcommerceOrder",
        ip: req.ip,
      });

      res.status(200).json({
        success: true,
        message: action === "add" ? "Products added successfully" : "Products removed successfully",
        data: order,
      });
    });
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((val) => val.message);
      return next(new CustomError(400, `Validation error: ${errors.join(". ")}`));
    }
    console.error("Update ecommerce order products error:", error);
    return next(new CustomError(500, `Failed to update order products: ${error.message}`));
  } finally {
    await session.endSession();
  }
});

export const resetPurchaseLimit = asyncErrorHandler(async (req, res, next) => {
  const { customerId, inventoryId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }
  if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
    return next(new CustomError(400, "Invalid inventory ID format"));
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  const inventory = await Inventory.findById(inventoryId);
  if (!inventory) {
    return next(new CustomError(404, "Inventory item not found"));
  }
  if (!inventory.ecommerceMaxPerUser) {
    return next(new CustomError(400, "This product has no purchase limit"));
  }

  await PurchaseReset.create({
    customerId,
    inventoryId,
    resetAt: new Date(),
    resetBy: req.user._id,
  });

  logActivity({
    admin: req.user._id,
    action: "reset_purchase_limit",
    feature: "ecommerce",
    description: `Reset purchase limit for customer ${customer.name || customer._id} on product ${inventory.productCode} - ${inventory.productName}`,
    targetId: inventory._id,
    targetModel: "Inventory",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `Purchase limit reset successfully for "${inventory.productName}".`,
  });
});

export const resetAllPurchaseLimits = asyncErrorHandler(async (req, res, next) => {
  const { inventoryId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
    return next(new CustomError(400, "Invalid inventory ID format"));
  }

  const inventory = await Inventory.findById(inventoryId);
  if (!inventory) {
    return next(new CustomError(404, "Inventory item not found"));
  }
  if (!inventory.ecommerceMaxPerUser) {
    return next(new CustomError(400, "This product has no purchase limit"));
  }

  await PurchaseReset.create({
    customerId: null,
    inventoryId,
    resetAt: new Date(),
    resetBy: req.user._id,
  });

  logActivity({
    admin: req.user._id,
    action: "reset_all_purchase_limits",
    feature: "ecommerce",
    description: `Reset purchase limit for ALL customers on product ${inventory.productCode} - ${inventory.productName}`,
    targetId: inventory._id,
    targetModel: "Inventory",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: `Purchase limit reset for ALL customers on "${inventory.productName}".`,
  });
});

export const getPurchaseUsage = asyncErrorHandler(async (req, res, next) => {
  const { customerId, inventoryId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }
  if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
    return next(new CustomError(400, "Invalid inventory ID format"));
  }

  const customer = await Customer.findById(customerId).select("name phone tier");
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  const inventory = await Inventory.findById(inventoryId).select(
    "productName productCode ecommerceMaxPerUser ecommercePurchaseResetMode ecommercePurchaseResetDays"
  );
  if (!inventory) {
    return next(new CustomError(404, "Inventory item not found"));
  }
  if (!inventory.ecommerceMaxPerUser) {
    return next(new CustomError(400, "This product has no purchase limit"));
  }

  const tierMultiplier = getTierMultiplier(customer.tier);
  const effectiveLimit = inventory.ecommerceMaxPerUser * tierMultiplier;

  const latestReset = await PurchaseReset.findOne({ customerId: { $in: [customerId, null] }, inventoryId })
    .sort({ resetAt: -1 })
    .populate("resetBy", "name");

  let cutoff;
  if (inventory.ecommercePurchaseResetMode === "manual") {
    cutoff = latestReset ? latestReset.resetAt : new Date(0);
  } else {
    const days = inventory.ecommercePurchaseResetDays || 30;
    const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    cutoff = latestReset
      ? new Date(Math.max(latestReset.resetAt, windowStart))
      : windowStart;
  }

  const existingOrders = await EcommerceOrder.find({
    customerId,
    createdAt: { $gte: cutoff },
    isDeleted: false,
    status: { $ne: "cancelled" },
    "products.inventoryId": inventoryId,
  });

  const alreadyOrdered = existingOrders.reduce((sum, order) => {
    const p = order.products.find(pr => pr.inventoryId.toString() === inventoryId);
    return sum + (p ? (p.baseQuantity || p.quantity) : 0);
  }, 0);

  res.status(200).json({
    success: true,
    data: {
      customer: { _id: customer._id, name: customer.name, phone: customer.phone, tier: customer.tier },
      product: {
        _id: inventory._id,
        productName: inventory.productName,
        productCode: inventory.productCode,
        maxPerUser: inventory.ecommerceMaxPerUser,
        effectiveLimit,
        tierMultiplier,
        resetMode: inventory.ecommercePurchaseResetMode,
        resetDays: inventory.ecommercePurchaseResetDays,
      },
      alreadyOrdered,
      remaining: Math.max(0, effectiveLimit - alreadyOrdered),
      lastResetAt: latestReset?.resetAt || null,
      lastResetBy: latestReset?.resetBy || null,
    },
  });
});

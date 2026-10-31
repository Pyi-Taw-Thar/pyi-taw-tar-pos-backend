import mongoose from "mongoose";
import StorefrontInventory from "../models/storefrontInventory.model.js";
import Inventory from "../models/inventory.model.js";
import BatchStock from "../models/batchStock.model.js";
import LocationProfile from "../models/locationProfile.model.js";
import EcommerceOrder from "../models/ecommerceOrder.model.js";
import Order from "../models/orders.model.js";
import Customer from "../models/customer.model.js";
import PurchaseReset from "../models/purchaseReset.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { getEffectiveFactor } from "../utils/uom.utils.js";
import { logActivity } from "../services/activityLog.service.js";
import { getTierMultiplier } from "../services/customerTier.service.js";
import { createAndSendCustomerNotification } from "../services/customerNotification.service.js";
import { adjustBatchLocationStock } from "../utils/batchLocationStock.utils.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import { findEcommerceWholesalePrice } from "../utils/wholesale.utils.js";

const ecommerceStorefrontId = process.env.ECOMMERCE_STOREFRONT_ID;

// Admin က status API ဖြင့် ကိုယ်တိုင် ပြောင်းခွင့်ရှိသော transition များ
// (pending → confirmed = sendOrderToFulfillment, confirmed → shipped = fulfillment complete ဖြင့်သာ)
const MANUAL_STATUS_TRANSITIONS = {
  pending: ["cancelled"],
  confirmed: ["cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export const getBrands = asyncErrorHandler(async (req, res, next) => {
  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const { subCategory } = req.query;
  const storefrontObjId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const matchStage = { "inventory.status": "active" };
  if (subCategory) {
    matchStage["inventory.subCategory"] = subCategory;
  }

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
    { $match: matchStage },
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

export const getSubCategories = asyncErrorHandler(async (req, res, next) => {
  if (!ecommerceStorefrontId) {
    return next(new CustomError(500, "Ecommerce storefront not configured"));
  }
  if (!mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Invalid ecommerce storefront ID"));
  }

  const storefrontObjId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const subCategories = await StorefrontInventory.aggregate([
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
        _id: "$inventory.subCategory",
      },
    },
    {
      $project: {
        _id: 0,
        subCategory: "$_id",
      },
    },
    { $sort: { subCategory: 1 } },
  ]);

  const subCategoryList = subCategories
    .map((s) => s.subCategory)
    .filter(Boolean); // only remove null/undefined/empty

  res.status(200).json({
    success: true,
    data: subCategoryList,
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
  const { page, limit, category, subCategory, search, brand, limitedOnly, id, sort } = req.query;
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

  // ProductDetail page ကို direct link ဖြင့်ဖွင့်သည့်အခါ product တစ်ခုတည်း ရယူရန်
  if (id !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid product id"));
    }
    matchStage.inventoryId = new mongoose.Types.ObjectId(id);
  }

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

    if (subCategory) {
      const escaped = subCategory.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pipe.push({
        $match: { "inventory.subCategory": { $regex: `^${escaped}$`, $options: "i" } },
      });
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
            { "inventory.chemicalNames": { $regex: escaped, $options: "i" } },
          ],
        },
      });
    }

    if (forCount) {
      pipe.push({ $count: "total" });
    } else {
      if (hasPagination) {
        // Pagination အတွက် ပစ္စည်းများ အစဉ် တည်ငြိမ်စေရန် productName ဖြင့် sort လုပ်ပြီး _id ဖြင့် tiebreak သည်
        const sortDirection = sort === "desc" ? -1 : 1;
        pipe.push(
          { $sort: { "inventory.productName": sortDirection, _id: 1 } },
          { $skip: skip },
          { $limit: limitNum }
        );
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
            chemicalNames: "$inventory.chemicalNames",
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
    // A-Z / Z-A အစဉ် မှန်ကန်စေရန် အကြီးအသေး မခွဲဘဲ ဂဏန်းစဉ် (B2 < B12) ပါဝင်သော collation သုံးသည်
    const [rawProducts, countResult] = await Promise.all([
      StorefrontInventory.aggregate(buildPipeline(false)).collation({
        locale: "en",
        strength: 1,
        numericOrdering: true,
      }),
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
    return next(new CustomError(400, "အော်ဒါတွင် ပစ္စည်း အနည်းဆုံး ၁ ခု ပါရပါမည်။"));
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
    console.error(`[createOrder] Ecommerce storefront not found: ${ecommerceStorefrontId}`);
    return next(new CustomError(404, "အော်ဒါ လက်ခံ၍ မရသေးပါ။ ဆိုင်ကို ဆက်သွယ်ပါ။"));
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

  // ပစ္စည်းတူ unit မတူ line များအတွက် base qty ကို ပစ္စည်းအလိုက် ကြိုတင်စုပေါင်းတွက်ချက်ခြင်း
  const totalBaseByInv = {};
  const linesByInv = {};
  const preparedLines = [];

  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    const invId = item.inventoryId;

    if (!mongoose.Types.ObjectId.isValid(invId)) {
      return next(
        new CustomError(
          400,
          '"ပစ္စည်းတစ်ခု" သည် ယခု ဝယ်ယူ၍ မရတော့ပါ။ ဈေးခြင်းမှ ဖယ်ပြီး ပြန်ကြိုးစားပါ။',
          {
            code: "PRODUCT_UNAVAILABLE",
            inventoryId: typeof invId === "string" ? invId : undefined,
            productName: "ပစ္စည်းတစ်ခု",
          }
        )
      );
    }

    const inventory = inventoryMap[invId];
    if (!inventory) {
      return next(
        new CustomError(
          404,
          '"ပစ္စည်းတစ်ခု" သည် ယခု ဝယ်ယူ၍ မရတော့ပါ။ ဈေးခြင်းမှ ဖယ်ပြီး ပြန်ကြိုးစားပါ။',
          {
            code: "PRODUCT_UNAVAILABLE",
            inventoryId: invId,
            productName: "ပစ္စည်းတစ်ခု",
          }
        )
      );
    }

    const stockRecord = stockMap[invId];
    if (!stockRecord) {
      return next(
        new CustomError(
          404,
          `"${inventory.productName}" သည် ယခု ဝယ်ယူ၍ မရတော့ပါ။ ဈေးခြင်းမှ ဖယ်ပြီး ပြန်ကြိုးစားပါ။`,
          {
            code: "PRODUCT_UNAVAILABLE",
            inventoryId: invId,
            productName: inventory.productName,
          }
        )
      );
    }

    const requestedQty = item.quantity;
    if (!requestedQty || requestedQty < 1) {
      return next(
        new CustomError(
          400,
          `"${inventory.productName}" ၏ အရေအတွက် အနည်းဆုံး ၁ ဖြစ်ရပါမည်။`,
          {
            code: "INVALID_QUANTITY",
            inventoryId: invId,
            productName: inventory.productName,
          }
        )
      );
    }

    const itemUnit = item.unit || inventory.unitOfMeasure || null;
    const factor = getUnitFactor(inventory, itemUnit);
    const baseQty = requestedQty * factor;
    const displayUnit = itemUnit || inventory.unitOfMeasure || "";

    totalBaseByInv[invId] = (totalBaseByInv[invId] || 0) + baseQty;
    if (!linesByInv[invId]) linesByInv[invId] = [];
    linesByInv[invId].push({ qty: requestedQty, unit: displayUnit });

    preparedLines.push({
      invId,
      inventory,
      stockRecord,
      requestedQty,
      itemUnit,
      factor,
      baseQty,
    });
  }

  // Validate each product (stock နှင့် ဝယ်ခွင့် limit ကို ပစ္စည်းအလိုက် စုစုပေါင်း base qty ဖြင့် စစ်သည်)
  let totalAmount = 0;
  const validatedProducts = [];
  const stockUpdates = [];
  const checkedInvIds = new Set();

  for (const prep of preparedLines) {
    const { invId, inventory, stockRecord, requestedQty, itemUnit, factor, baseQty } = prep;

    if (!checkedInvIds.has(invId)) {
      checkedInvIds.add(invId);
      const totalReqBase = totalBaseByInv[invId];
      const invLines = linesByInv[invId];

      if (stockRecord.quantity < totalReqBase) {
        let outOfStockMsg;
        if (invLines.length === 1) {
          const displayQty = Number(requestedQty).toLocaleString();
          const displayUnit = itemUnit || inventory.unitOfMeasure || "";
          outOfStockMsg = `"${inventory.productName}" ကို ${displayQty} ${displayUnit} မှာထားသော်လည်း လက်ကျန် မလုံလောက်ပါ။ အရေအတွက် လျှော့ပြီး ပြန်ကြိုးစားပါ။`;
        } else {
          const combinedQtyStr = invLines
            .map((l) => `${Number(l.qty).toLocaleString()} ${l.unit}`)
            .join(" + ");
          outOfStockMsg = `"${inventory.productName}" ကို ${combinedQtyStr} မှာထားသော်လည်း လက်ကျန် မလုံလောက်ပါ။ အရေအတွက် လျှော့ပြီး ပြန်ကြိုးစားပါ။`;
        }
        return next(
          new CustomError(400, outOfStockMsg, {
            code: "OUT_OF_STOCK",
            inventoryId: invId,
            productName: inventory.productName,
          })
        );
      }

      if (inventory.ecommerceMaxPerUser) {
        const tierMultiplier = getTierMultiplier(req.customer.tier);
        const effectiveLimit = inventory.ecommerceMaxPerUser * tierMultiplier;
        const alreadyOrdered = orderedMap[invId] || 0;
        const totalBaseQty = alreadyOrdered + totalReqBase;
        if (totalBaseQty > effectiveLimit) {
          const remaining = Math.max(0, effectiveLimit - alreadyOrdered);
          const baseUnit = inventory.unitOfMeasure || "";
          const limitStr = Number(effectiveLimit).toLocaleString();
          const remStr = Number(remaining).toLocaleString();

          let modeText = "";
          if (inventory.ecommercePurchaseResetMode === "timeline") {
            const days = inventory.ecommercePurchaseResetDays || 30;
            modeText = `${days} ရက်အတွင်း`;
          } else {
            modeText = "ဆိုင်မှ ပြန်ဖွင့်ပေးသည်အထိ";
          }

          const remainingText =
            remaining === 0
              ? "ယခုအကြိမ် ဝယ်ခွင့် ကုန်သွားပါပြီ။"
              : `နောက်ထပ် ${remStr} ${baseUnit} ဝယ်နိုင်ပါသည်။`;

          const limitMessage = `"${inventory.productName}" ကို တစ်ယောက်လျှင် ${limitStr} ${baseUnit} အထိသာ ဝယ်ခွင့်ရှိပါသည် (${modeText})။ ${remainingText}`;

          return next(
            new CustomError(400, limitMessage, {
              code: "LIMIT_EXCEEDED",
              inventoryId: invId,
              productName: inventory.productName,
            })
          );
        }
      }
    }

    const unitPrice = getEcommerceUnitPrice(inventory, itemUnit, requestedQty);
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
      stockRecordId: stockRecord._id,
      deductQty: baseQty,
      inventoryId: invId,
      productName: inventory.productName,
    });
  }

  // ACID transaction (withTransaction) နှင့် orderNumber duplicate (E11000) retry ၃ ကြိမ်ဖြင့် အော်ဒါဖန်တီးခြင်း
  const MAX_ORDER_ATTEMPTS = 3;
  let order;
  let txRuns = 0;

  for (let attempt = 1; attempt <= MAX_ORDER_ATTEMPTS; attempt++) {
    const session = await mongoose.startSession();
    try {
      // WriteConflict (TransientTransactionError) နှင့် UnknownTransactionCommitResult တို့ကို driver က အလိုအလျောက် ပြန်ကြိုးစားပေးသည်
      await session.withTransaction(async () => {
        txRuns++;
        // 1. Atomically verify and deduct stock with concurrency check
        for (const update of stockUpdates) {
          const updatedStock = await StorefrontInventory.findOneAndUpdate(
            {
              _id: update.stockRecordId,
              quantity: { $gte: update.deductQty },
            },
            {
              $inc: { quantity: -update.deductQty },
              $set: { lastUpdated: new Date() },
            },
            { session, new: true }
          );

          if (!updatedStock) {
            throw new CustomError(
              400,
              `"${update.productName}" ၏ လက်ကျန် ပြောင်းသွားပါသည်။ ခဏနေ ပြန်ကြိုးစားပါ။`,
              {
                code: "STOCK_CHANGED",
                inventoryId: update.inventoryId ? update.inventoryId.toString() : undefined,
                productName: update.productName,
              }
            );
          }
        }

        // 2. Create ecommerce order inside session
        const [newOrder] = await EcommerceOrder.create(
          [
            {
              customerId,
              products: validatedProducts,
              shippingAddress: shippingAddress || {},
              totalAmount,
              paymentMethod: paymentMethod || "cash_on_delivery",
              note: note || null,
            },
          ],
          { session }
        );

        order = newOrder;
      });

      if (attempt > 1 || txRuns > 1) {
        console.warn(
          `[createOrder] Order succeeded after retry (attempt=${attempt}, txRuns=${txRuns})`
        );
      }
      break; // အောင်မြင်ပါက retry loop မှ ထွက်မည်
    } catch (err) {
      // orderNumber တူ၍ duplicate key (E11000) ဖြစ်မှသာ နံပါတ်အသစ်ဖြင့် ပြန်ကြိုးစားမည်
      if (err?.code === 11000 && err?.keyPattern?.orderNumber) {
        console.warn(
          `[createOrder] Duplicate orderNumber E11000 retry (attempt=${attempt}/${MAX_ORDER_ATTEMPTS})`
        );
        if (attempt < MAX_ORDER_ATTEMPTS) {
          continue;
        }
        return next(
          new CustomError(
            409,
            "အော်ဒါများ တစ်ပြိုင်နက် ဝင်နေပါသည်။ ခဏနေ ပြန်ကြိုးစားပါ။"
          )
        );
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

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

  // မြန်မာစံတော်ချိန် (Asia/Yangon) အခြေခံသည့် dateFilter utility ဖြင့် filter လုပ်ခြင်း
  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
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
      .populate("products.inventoryId", "productName productCode SKU images")
      .populate({
        path: "fulfillmentOrderId",
        select: "orderNumber orderStatus ordersProducts",
      }),
    EcommerceOrder.countDocuments(filter),
  ]);

  // Ecommerce line တစ်ကြောင်းချင်းတွင် ကိုယ်ပိုင် batches သိမ်းပြီးဖြစ်၍ legacy fopMap fallback မသုံးတော့ပါ
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
    .populate("products.inventoryId", "productName productCode SKU images")
    .populate({
      path: "fulfillmentOrderId",
      select: "orderNumber orderStatus ordersProducts",
    });

  if (!order || order.isDeleted) {
    return next(new CustomError(404, "Order not found"));
  }

  const orderObj = order.toObject ? order.toObject() : order;

  // Ecommerce line ကိုယ်ပိုင် batches ကိုသာ အသုံးပြုသည် (legacy fopMap fallback မသုံးတော့ပါ)
  // Calculate customer's current total credit outstanding across all credit orders
  let customerCreditOutstanding = 0;
  const customerIdVal = orderObj.customerId?._id || orderObj.customerId;
  if (customerIdVal && mongoose.Types.ObjectId.isValid(customerIdVal)) {
    const custOrders = await Order.find({
      creditPersonId: customerIdVal,
      paymentType: "credit",
      isDeleted: false,
    }).select("finalAmount paidAmount");

    customerCreditOutstanding = custOrders.reduce(
      (sum, o) => sum + Math.max(0, (o.finalAmount || 0) - (o.paidAmount || 0)),
      0
    );
  }
  orderObj.customerCreditOutstanding = customerCreditOutstanding;

  res.status(200).json({
    success: true,
    data: orderObj,
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

  if (!ecommerceStorefrontId || !mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Valid ecommerce storefront is not configured"));
  }
  const storefrontObjId = new mongoose.Types.ObjectId(ecommerceStorefrontId);

  const session = await mongoose.startSession();
  session.startTransaction();

  let order;
  let previousStatus;
  try {
    order = await EcommerceOrder.findById(id).session(session);

    if (!order || order.isDeleted) {
      throw new CustomError(404, "Order not found");
    }

    previousStatus = order.status;

    if (previousStatus === "cancelled" && status !== "cancelled") {
      throw new CustomError(
        400,
        "Cancelled orders cannot be reopened because stock has already been restored."
      );
    }

    // ကိုယ်တိုင် ပြောင်းခွင့်ရှိသော status များ
    // pending → confirmed = "ဂိုဒေါင်သို့ လွှဲမည်" သာ၊ confirmed → shipped = fulfillment complete သာ
    if (previousStatus !== status) {
      const allowed = MANUAL_STATUS_TRANSITIONS[previousStatus] || [];
      if (!allowed.includes(status)) {
        const reason =
          status === "confirmed"
            ? "\"ဂိုဒေါင်သို့ လွှဲမည်\" ဖြင့်သာ confirmed ဖြစ်နိုင်ပါသည်"
            : status === "shipped"
              ? "ဂိုဒေါင် fulfillment ပြီးမှသာ shipped ဖြစ်နိုင်ပါသည်"
              : status === "cancelled"
                ? "ပို့ပြီးသား order ကို cancel မရပါ"
                : `"${previousStatus}" မှ "${status}" သို့ ပြောင်း၍ မရပါ`;
        throw new CustomError(400, reason);
      }
    }

    // ဂိုဒေါင်သို့ လွှဲပြီးသား order ကို cancel လုပ်လျှင် fulfillment order ကိုပါ cancel လုပ်ပြီး
    // scan ပြီးသား batch stock ကို ပြန်ထည့်သည် (fulfillment ပြီးသွားလျှင် ငြင်း)
    if (previousStatus !== "cancelled" && status === "cancelled" && order.fulfillmentOrderId) {
      const fulfillmentOrder = await Order.findById(order.fulfillmentOrderId).session(session);
      if (fulfillmentOrder && !fulfillmentOrder.isDeleted) {
        if (fulfillmentOrder.orderStatus === "completed") {
          throw new CustomError(
            400,
            `ဂိုဒေါင် fulfillment (${fulfillmentOrder.orderNumber}) ပြီးသွားပြီဖြစ်၍ cancel မရပါ`
          );
        }
        if (fulfillmentOrder.orderStatus !== "cancelled") {
          for (const op of fulfillmentOrder.ordersProducts) {
            for (const b of op.batches || []) {
              const qty = Number(b.quantity) || 0;
              if (qty <= 0 || !b.batchStockId) continue;
              const batch = await BatchStock.findById(b.batchStockId).session(session);
              if (!batch) continue;
              batch.quantity += qty;
              if (batch.quantity > 0 && batch.status === "depleted") batch.status = "active";
              await batch.save({ session });

              // Batch ၏ location သည် order ၏ storefront (E) မဟုတ်ပါက ထို location ၏ စုစုပေါင်း stock ကိုပါ ပြန်ထည့်မည် (Plan §7)
              const orderStorefrontIdStr = storefrontObjId.toString();
              const batchLocationIdStr = (batch.locationId?._id || batch.locationId)?.toString();

              if (batchLocationIdStr !== orderStorefrontIdStr) {
                await adjustBatchLocationStock({
                  inventoryId: op.inventoryId._id || op.inventoryId,
                  locationType: batch.locationType,
                  locationId: batch.locationId,
                  delta: -qty, // negative delta = add back
                  adminId: req.user?._id || null,
                  orderNumber: order.orderNumber,
                  batchNumber: batch.batchNumber,
                  orderId: order._id,
                  session,
                });
              }
            }
          }
          fulfillmentOrder.orderStatus = "cancelled";
          const cancelNote = `[Cancelled from ecommerce ${order.orderNumber}]`;
          fulfillmentOrder.note = fulfillmentOrder.note
            ? `${fulfillmentOrder.note} | ${cancelNote}`
            : cancelNote;
          await fulfillmentOrder.save({ session });
        }
      }
    }

    // Restore stock to StorefrontInventory when transitioning from non-cancelled to cancelled
    if (previousStatus !== "cancelled" && status === "cancelled") {
      for (const item of order.products) {
        const restoreQty =
          item.baseQuantity ?? item.quantity * (item.factor || 1);

        if (restoreQty > 0) {
          await StorefrontInventory.findOneAndUpdate(
            {
              inventoryId: item.inventoryId,
              storefrontId: storefrontObjId,
            },
            {
              $inc: { quantity: restoreQty },
              $set: { lastUpdated: new Date() },
            },
            { session, upsert: true, new: true }
          );
        }
      }
    }

    order.status = status;
    await order.save({ session });

    if (previousStatus !== "cancelled" && status === "cancelled") {
      await createAndSendCustomerNotification({
        customerId: order.customerId,
        orderId: order._id,
        orderNumber: order.orderNumber,
        title: `အော်ဒါ #${order.orderNumber} ကို ပယ်ဖျက်လိုက်ပါသည်`,
        message: `အော်ဒါ #${order.orderNumber} ကို ဆိုင်မှ ပယ်ဖျက်လိုက်ပါသည်။`,
        type: "order_status",
        session,
      });
    }

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  if (previousStatus !== status && req.user?._id) {
    logActivity({
      admin: req.user._id,
      action: status === "cancelled" ? "cancel_order" : "update_order_status",
      feature: "ecommerce_order",
      description: `Updated ecommerce order ${order.orderNumber} status from "${previousStatus}" to "${status}"`,
      targetId: order._id,
      targetModel: "EcommerceOrder",
      ip: req.ip,
    });
  }

  res.status(200).json({
    success: true,
    message:
      status === "cancelled" && previousStatus !== "cancelled"
        ? "Order cancelled and stock restored successfully."
        : "Order status updated successfully.",
    data: order,
  });
});

export const sendOrderToFulfillment = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid order ID format"));
  }

  const ecommerceOrder = await EcommerceOrder.findOne({
    _id: id,
    isDeleted: false,
  }).populate("customerId");

  if (!ecommerceOrder) {
    return next(new CustomError(404, "Ecommerce order not found"));
  }

  if (ecommerceOrder.status === "cancelled") {
    return next(new CustomError(400, "Cannot send cancelled order to fulfillment"));
  }

  if (ecommerceOrder.isSentToFulfillment && ecommerceOrder.fulfillmentOrderId) {
    const existingFulfillment = await Order.findOne({
      _id: ecommerceOrder.fulfillmentOrderId,
      isDeleted: false,
    });
    if (existingFulfillment) {
      return next(
        new CustomError(
          400,
          `Order is already sent to fulfillment (${existingFulfillment.orderNumber})`
        )
      );
    }
  }

  if (!ecommerceStorefrontId || !mongoose.Types.ObjectId.isValid(ecommerceStorefrontId)) {
    return next(new CustomError(500, "Ecommerce storefront is not configured"));
  }

  const storefrontId = new mongoose.Types.ObjectId(ecommerceStorefrontId);
  const storefront = await LocationProfile.findOne({
    _id: storefrontId,
    type: "storefront",
    isDeleted: false,
  });

  if (!storefront) {
    return next(new CustomError(404, "Ecommerce storefront location not found"));
  }

  if (ecommerceOrder.status !== "pending") {
    return next(
      new CustomError(400, `"${ecommerceOrder.status}" ဖြစ်နေသော order ကို ဂိုဒေါင်သို့ လွှဲ၍ မရပါ (pending သာ)`)
    );
  }

  const customer = ecommerceOrder.customerId;
  const customerName =
    customer?.name || ecommerceOrder.shippingAddress?.label || "Ecommerce Customer";
  const customerPhone = customer?.phone || null;

  let fulfillmentOrder = null;
  let sentOrder = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Atomic claim — request ၂ ခု တစ်ပြိုင်နက်ရောက်လျှင် တစ်ခုသာ အောင်မြင်ပြီး fulfillment order ၂ ခု မဖြစ်စေရန်
      const claimed = await EcommerceOrder.findOneAndUpdate(
        { _id: id, isDeleted: false, status: "pending", isSentToFulfillment: { $ne: true } },
        { $set: { isSentToFulfillment: true, sentToFulfillmentAt: new Date() } },
        { new: true, session }
      );
      if (!claimed) {
        throw new CustomError(409, "ဤ order ကို ဂိုဒေါင်သို့ လွှဲပြီးသား ဖြစ်ပါသည်");
      }

      // Generate order number for fulfillment Order
      const orderNumber = await Order.generateOrderNumber();

      // Prepare products for Order (ecommerce line ၏ _id ကို sourceLineId အဖြစ် ချိတ်ဆက်သိမ်းသည်)
      const ordersProducts = claimed.products.map((p) => ({
        inventoryId: p.inventoryId,
        sourceLineId: p._id,
        quantity: p.quantity,
        unit: p.unit || null,
        factor: p.factor || 1,
        baseQuantity: p.baseQuantity || p.quantity * (p.factor || 1),
        unitPrice: p.unitPrice,
        batches: [],
      }));

      const noteParts = [
        `[Ecommerce: ${claimed.orderNumber}]`,
        claimed.shippingAddress?.addressLine,
        claimed.shippingAddress?.city,
        claimed.note ? `Note: ${claimed.note}` : null,
      ].filter(Boolean);

      const paymentType = claimed.paymentStatus === "paid" ? "paid" : "credit";

      // Create Order in pending status for warehouse fulfillment queue
      // (Note: StorefrontInventory was already deducted upon ecommerce checkout, so we don't deduct again!)
      [fulfillmentOrder] = await Order.create(
        [
          {
            orderNumber,
            saleType: "storefront",
            storefrontId,
            customerName,
            customerPhone,
            creditPersonId: customer?.isCreditPerson ? customer._id : null,
            ordersProducts,
            subTotal: claimed.totalAmount,
            tax: 0,
            discount: 0,
            finalAmount: claimed.totalAmount,
            paidAmount: claimed.paymentStatus === "paid" ? claimed.totalAmount : 0,
            paymentType,
            paymentMethod: claimed.paymentMethod || "cash",
            orderStatus: "pending",
            soldBy: req.user._id,
            note: noteParts.join(" | "),
            ecommerceOrderId: claimed._id,
            orderDate: new Date(),
          },
        ],
        { session }
      );

      // Update EcommerceOrder status and fulfillment linkage
      claimed.status = "confirmed";
      claimed.fulfillmentOrderId = fulfillmentOrder._id;
      await claimed.save({ session });
      sentOrder = claimed;
    });
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    console.error("Send to fulfillment error:", error);
    return next(new CustomError(500, `Failed to send order to fulfillment: ${error.message}`));
  } finally {
    await session.endSession();
  }

  const ecommerceOrderResult = sentOrder;

  logActivity({
    admin: req.user?._id,
    action: "create",
    feature: "ecommerce_order",
    description: `Sent ecommerce order ${ecommerceOrderResult.orderNumber} to warehouse fulfillment as ${fulfillmentOrder.orderNumber}`,
    targetId: ecommerceOrderResult._id,
    targetModel: "EcommerceOrder",
    ip: req.ip,
  });

  res.status(200).json({
    success: true,
    message: "Order successfully sent to warehouse fulfillment",
    data: {
      ecommerceOrder: ecommerceOrderResult,
      fulfillmentOrder,
    },
  });
});

// convertFrom chain ပါ တွက်သော factor (ဥပမာ ဖာ → ပုံး → ဘူး)
const getUnitFactor = (inventory, unit) =>
  getEffectiveFactor(inventory.uomConversions, inventory.unitOfMeasure, unit);


// Ecommerce တွင် unit နှင့် quantity အလိုက် wholesale စျေး သို့မဟုတ် လက်လီစျေး (sellingPrice × factor) တွက်ချက်သည်
const getEcommerceUnitPrice = (inventory, unit, qty = 1) => {
  const wholesalePrice = findEcommerceWholesalePrice(inventory, unit, qty);
  if (wholesalePrice !== null && wholesalePrice !== undefined) {
    return wholesalePrice;
  }
  return inventory.sellingPrice * getUnitFactor(inventory, unit);
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
    if (item.lineId !== undefined && item.lineId !== null && item.lineId !== "") {
      if (!mongoose.Types.ObjectId.isValid(item.lineId)) {
        return next(new CustomError(400, `Product at index ${i}: Invalid lineId`));
      }
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
  // Commit ပြီးမှ response / activity log ပို့ရန် (retry ဖြစ်လျှင် နောက်ဆုံး run ၏ တန်ဖိုး ကျန်)
  let responseBody = null;
  let activityLog = null;

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

          // လက်ရှိ ပြင်ဆင်နေသော order ကို ချန်လှပ်၍ အခြား order များ၏ ဝယ်ယူပြီးပမာဏကိုသာ ရေတွက်သည်
          const allOrders = await EcommerceOrder.find({
            _id: { $ne: order._id },
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

          const existingLine = order.products.find((p) => p.inventoryId.toString() === invId);
          const normalizeUnit = (u) => (u || "").trim().toLowerCase();

          // unit မပါလျှင် ရှိပြီးသား line ၏ unit (မရှိလျှင် base unit) ကို သုံးသည်
          const itemUnit = item.unit || existingLine?.unit || inventory.unitOfMeasure || null;

          const validUnits = [
            inventory.unitOfMeasure,
            ...(inventory.uomConversions || []).map((c) => c.unit),
          ].map(normalizeUnit);
          if (itemUnit && !validUnits.includes(normalizeUnit(itemUnit))) {
            throw new CustomError(400, `"${inventory.productName}" တွင် unit "${itemUnit}" မရှိပါ`);
          }

          const factor = getUnitFactor(inventory, itemUnit);
          const baseQty = item.quantity * factor;

          if (stockRecord.quantity < baseQty) {
            throw new CustomError(400, `Insufficient stock for ${inventory.productName} (available: ${stockRecord.quantity}, requested: ${baseQty} in base unit "${inventory.unitOfMeasure}")`);
          }

          if (inventory.ecommerceMaxPerUser) {
            const tierMultiplier = getTierMultiplier(customerTier);
            const effectiveLimit = inventory.ecommerceMaxPerUser * tierMultiplier;
            const alreadyOrdered = orderedMap[invId] || 0;
            // လက်ရှိ order ထဲရှိ ထိုပစ္စည်း၏ line အားလုံး၏ base qty ကို ပေါင်းစစ်သည်
            const currentInThisOrder = order.products
              .filter((p) => p.inventoryId.toString() === invId)
              .reduce((sum, p) => sum + (p.baseQuantity || p.quantity * (p.factor || 1)), 0);
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

          // unit တူသော line ရှိလျှင် ထို line ထဲ ပေါင်းပြီး၊ unit မတူလျှင် line အသစ်အဖြစ် ထည့်သည်
          const existingIndex = order.products.findIndex(
            (p) =>
              p.inventoryId.toString() === invId &&
              normalizeUnit(p.unit || inventory.unitOfMeasure) === normalizeUnit(itemUnit)
          );

          let unitPrice;
          let newQty;

          if (existingIndex !== -1) {
            const existing = order.products[existingIndex];
            newQty = existing.quantity + item.quantity;
            unitPrice = item.unitPrice || getEcommerceUnitPrice(inventory, existing.unit, newQty);
            existing.quantity = newQty;
            existing.baseQuantity =
              (existing.baseQuantity || existing.quantity * (existing.factor || 1)) + baseQty;
            existing.unitPrice = unitPrice;
            existing.subtotal = newQty * unitPrice;
          } else {
            newQty = item.quantity;
            unitPrice = item.unitPrice || getEcommerceUnitPrice(inventory, itemUnit, newQty);
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
          let existingIndex = -1;

          // lineId ပါလျှင် line _id ဖြင့် တိကျစွာ ရှာသည်
          if (item.lineId) {
            existingIndex = order.products.findIndex(
              (p) => p._id && p._id.toString() === item.lineId.toString()
            );
            if (existingIndex === -1) {
              throw new CustomError(404, `Order line not found: ${item.lineId}`);
            }
            if (order.products[existingIndex].inventoryId.toString() !== invId) {
              throw new CustomError(400, `Line ID does not match inventoryId: ${invId}`);
            }
          } else {
            // lineId မပါလျှင် ပစ္စည်းတူ line တစ်ကြောင်းတည်း ရှိမှသာ ခွင့်ပြုသည်
            const matchingIndices = [];
            order.products.forEach((p, idx) => {
              if (p.inventoryId.toString() === invId) {
                matchingIndices.push(idx);
              }
            });
            if (matchingIndices.length === 0) {
              throw new CustomError(404, `Product not found in order: ${invId}`);
            }
            if (matchingIndices.length > 1) {
              throw new CustomError(400, "ပစ္စည်းတူ line များ ရှိ၍ line ရွေးပါ");
            }
            existingIndex = matchingIndices[0];
          }

          const existing = order.products[existingIndex];
          const removeFactor = existing.factor || 1;
          if (item.quantity > existing.quantity) {
            throw new CustomError(400, `Cannot remove ${item.quantity} items. Only ${existing.quantity} exist in order for this product.`);
          }

          const removeBaseQty = item.quantity * removeFactor;
          const newQty = existing.quantity - item.quantity;
          const newBaseQty =
            (existing.baseQuantity || existing.quantity * removeFactor) - removeBaseQty;
          if (newQty <= 0) {
            order.products.splice(existingIndex, 1);
          } else {
            const inventory = inventoryMap[invId];
            const unitPrice = getEcommerceUnitPrice(inventory, existing.unit, newQty);
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
            const [createdStock] = await StorefrontInventory.create([{
              inventoryId: new mongoose.Types.ObjectId(invId),
              storefrontId,
              quantity: removeBaseQty,
              lastUpdated: new Date(),
            }], { session });
            stockMap[invId] = createdStock;
          }
        }
      }

      order.totalAmount = recalculateTotal(order.products);
      order.isEdited = true;
      order.editedAt = new Date();
      order.editedReason = action === "add" ? "admin_add" : "admin_remove";

      const changeMsg = action === "remove"
        ? "အော်ဒါမှ ပစ္စည်းအချို့အား ဖယ်ထုတ်/လျှော့ချပြီး ပြင်ဆင်ထားပါသည်"
        : "အော်ဒါတွင် ပစ္စည်းအသစ် ထပ်မံဖြည့်စွက်ပြီး ပြင်ဆင်ထားပါသည်";

      const editNote = `[အသိပေးချက်: ${changeMsg} (စုစုပေါင်း ကျသင့်ငွေ: ${order.totalAmount.toLocaleString()} MMK)]`;
      order.note = order.note ? `${order.note}\n\n${editNote}` : editNote;

      await order.save({ session });

      await createAndSendCustomerNotification({
        customerId: order.customerId,
        orderId: order._id,
        orderNumber: order.orderNumber,
        title: `အော်ဒါ #${order.orderNumber} အား ပြင်ဆင်ထားပါသည်`,
        message: `${changeMsg}။ စုစုပေါင်း ကျသင့်ငွေ: ${order.totalAmount.toLocaleString()} MMK`,
        type: "order_edited",
        session,
      });

      await order.populate("products.inventoryId", "productName productCode SKU images");

      activityLog = {
        admin: req.user._id,
        action: action === "add" ? "add_items" : "remove_items",
        feature: "ecommerce_order",
        description: `${action === "add" ? "Added" : "Removed"} products from ecommerce order ${order.orderNumber}`,
        targetId: order._id,
        targetModel: "EcommerceOrder",
        ip: req.ip,
      };

      responseBody = {
        success: true,
        message: action === "add" ? "Products added successfully" : "Products removed successfully",
        data: order,
      };
    });

    if (activityLog) logActivity(activityLog);
    res.status(200).json(responseBody);
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


// Ecommerce အရောင်းအစီရင်ခံစာ (Ecommerce Sales Report) Endpoint
export const getEcommerceReport = asyncErrorHandler(async (req, res, next) => {
  const { status, limit = 10 } = req.query;
  const filter = { isDeleted: false };

  if (status && status !== "all") {
    filter.status = status;
  }

  // Timezone-aware date filter
  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  // 1. Overall Summary
  const summaryAgg = await EcommerceOrder.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: {
          $sum: {
            $cond: [{ $ne: ["$status", "cancelled"] }, "$totalAmount", 0],
          },
        },
        deliveredRevenue: {
          $sum: {
            $cond: [{ $eq: ["$status", "delivered"] }, "$totalAmount", 0],
          },
        },
        totalOrderedQuantity: {
          $sum: {
            $cond: [
              { $ne: ["$status", "cancelled"] },
              { $sum: "$products.quantity" },
              0,
            ],
          },
        },
        pendingCount: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
        confirmedCount: {
          $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, 1, 0] },
        },
        shippedCount: {
          $sum: { $cond: [{ $eq: ["$status", "shipped"] }, 1, 0] },
        },
        deliveredCount: {
          $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
        },
        cancelledCount: {
          $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
        },
      },
    },
  ]);

  const summaryData = summaryAgg[0] || {
    totalOrders: 0,
    totalRevenue: 0,
    deliveredRevenue: 0,
    totalOrderedQuantity: 0,
    pendingCount: 0,
    confirmedCount: 0,
    shippedCount: 0,
    deliveredCount: 0,
    cancelledCount: 0,
  };

  const validOrdersCount = summaryData.totalOrders - summaryData.cancelledCount;
  const avgOrderValue = validOrdersCount > 0 ? Math.round(summaryData.totalRevenue / validOrdersCount) : 0;

  // 2. Daily Sales Trend (Asia/Yangon +06:30 timezone grouping)
  const dailySalesAgg = await EcommerceOrder.aggregate([
    {
      $match: {
        ...filter,
        status: { $ne: "cancelled" },
      },
    },
    {
      $project: {
        totalAmount: 1,
        dateStr: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: "+06:30",
          },
        },
      },
    },
    {
      $group: {
        _id: "$dateStr",
        revenue: { $sum: "$totalAmount" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const dailySales = dailySalesAgg.map((item) => ({
    date: item._id,
    revenue: item.revenue || 0,
    totalSales: item.revenue || 0,
    orders: item.orders || 0,
    orderCount: item.orders || 0,
  }));

  // 3. Top Selling Products (Non-cancelled orders)
  const topProductsAgg = await EcommerceOrder.aggregate([
    {
      $match: {
        ...filter,
        status: { $ne: "cancelled" },
      },
    },
    { $unwind: "$products" },
    {
      $group: {
        _id: "$products.inventoryId",
        productName: { $first: "$products.productName" },
        productCode: { $first: "$products.productCode" },
        unit: { $first: "$products.unit" },
        totalQuantity: { $sum: "$products.quantity" },
        totalRevenue: { $sum: "$products.subtotal" },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: parseInt(limit) || 10 },
    {
      $lookup: {
        from: "inventories",
        localField: "_id",
        foreignField: "_id",
        as: "inventoryInfo",
      },
    },
    {
      $project: {
        _id: 1,
        productName: 1,
        productCode: 1,
        unit: 1,
        totalQuantity: 1,
        totalRevenue: 1,
        orderCount: 1,
        image: { $arrayElemAt: ["$inventoryInfo.images.url", 0] },
      },
    },
  ]);

  // 4. Payment Methods Breakdown
  const paymentMethodAgg = await EcommerceOrder.aggregate([
    {
      $match: {
        ...filter,
        status: { $ne: "cancelled" },
      },
    },
    {
      $group: {
        _id: "$paymentMethod",
        count: { $sum: 1 },
        totalAmount: { $sum: "$totalAmount" },
      },
    },
    { $sort: { totalAmount: -1 } },
  ]);

  const paymentMethods = paymentMethodAgg.map((pm) => ({
    method: pm._id || "cash_on_delivery",
    count: pm.count,
    totalAmount: pm.totalAmount,
  }));

  // 5. Recent Orders in the period (Limit 15)
  const recentOrders = await EcommerceOrder.find(filter)
    .sort({ createdAt: -1 })
    .limit(15)
    .populate("customerId", "name phone")
    .select("orderNumber customerId totalAmount status paymentMethod paymentStatus createdAt");

  res.status(200).json({
    success: true,
    data: {
      summary: {
        ...summaryData,
        totalOrderedQuantity: summaryData.totalOrderedQuantity || 0,
        totalItemsQuantity: summaryData.totalOrderedQuantity || 0,
        deliveredOrders: summaryData.deliveredCount || 0,
        cancelledOrders: summaryData.cancelledCount || 0,
        pendingOrders: summaryData.pendingCount || 0,
        confirmedOrders: summaryData.confirmedCount || 0,
        shippedOrders: summaryData.shippedCount || 0,
        validOrdersCount,
        avgOrderValue,
      },
      dailySales,
      topProducts: topProductsAgg,
      paymentMethods,
      recentOrders,
    },
  });
});


/**
 * Ecommerce ပစ္စည်းအလိုက် မှာယူမှု အစီရင်ခံစာ (Ecommerce Product Orders Report) Endpoint
 * ဘယ်ပစ္စည်းက အရေအတွက် ဘယ်လောက် အော်ဒါတင်ထားလဲ ဆိုသည်ကို ရက်စွဲ filter ဖြင့် စစ်ထုတ်ကြည့်ရှုနိုင်ခြင်း
 */
export const getEcommerceProductOrdersReport = asyncErrorHandler(async (req, res, next) => {
  const { status, search, inventoryId } = req.query;
  const filter = { isDeleted: false };

  // Status filter: default to excluding cancelled orders unless specifically asked
  if (status && status !== "all") {
    filter.status = status;
  } else if (!status || status === "all") {
    filter.status = { $ne: "cancelled" };
  }

  // Timezone-aware date filter
  try {
    const dateFilter = createDateFilter(req.query, "createdAt", false);
    Object.assign(filter, dateFilter);
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  // If inventoryId is provided, return orders that contain this specific inventoryId
  if (inventoryId && mongoose.Types.ObjectId.isValid(inventoryId)) {
    const targetInventoryId = new mongoose.Types.ObjectId(inventoryId);
    filter["products.inventoryId"] = targetInventoryId;

    const matchingOrders = await EcommerceOrder.find(filter)
      .sort({ createdAt: -1 })
      .populate("customerId", "name phone address township")
      .select("orderNumber customerId totalAmount status paymentMethod paymentStatus createdAt products");

    const ordersDetail = matchingOrders.map((ord) => {
      const productItem = (ord.products || []).find(
        (p) => (p.inventoryId?._id || p.inventoryId)?.toString() === inventoryId
      );
      return {
        _id: ord._id,
        orderNumber: ord.orderNumber,
        customerName: ord.customerId?.name || "Customer",
        customerPhone: ord.customerId?.phone || "",
        customerAddress: ord.customerId?.address || "",
        customerTownship: ord.customerId?.township || "",
        createdAt: ord.createdAt,
        status: ord.status,
        paymentMethod: ord.paymentMethod,
        quantity: productItem?.quantity || 0,
        originalQuantity: productItem?.originalQuantity || productItem?.quantity || 0,
        unit: productItem?.originalUnit || productItem?.unit || "",
        unitPrice: productItem?.unitPrice || 0,
        subtotal: productItem?.subtotal || 0,
        orderTotalAmount: ord.totalAmount,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        inventoryId,
        orders: ordersDetail,
      },
    });
  }

  // Aggregation across products
  const pipeline = [
    { $match: filter },
    { $unwind: "$products" },
  ];

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    pipeline.push({
      $match: {
        $or: [
          { "products.productName": regex },
          { "products.productCode": regex },
        ],
      },
    });
  }

  pipeline.push(
    {
      $group: {
        _id: "$products.inventoryId",
        productName: { $first: "$products.productName" },
        productCode: { $first: "$products.productCode" },
        unit: { $first: "$products.unit" },
        originalUnit: { $first: "$products.originalUnit" },
        totalQuantity: { $sum: "$products.quantity" },
        totalRevenue: { $sum: "$products.subtotal" },
        orderCount: { $sum: 1 },
        pendingQuantity: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$products.quantity", 0] },
        },
        confirmedQuantity: {
          $sum: { $cond: [{ $eq: ["$status", "confirmed"] }, "$products.quantity", 0] },
        },
        shippedQuantity: {
          $sum: { $cond: [{ $eq: ["$status", "shipped"] }, "$products.quantity", 0] },
        },
        deliveredQuantity: {
          $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$products.quantity", 0] },
        },
      },
    },
    { $sort: { totalQuantity: -1 } },
    {
      $lookup: {
        from: "inventories",
        localField: "_id",
        foreignField: "_id",
        as: "inventoryInfo",
      },
    },
    {
      $project: {
        _id: 1,
        productName: 1,
        productCode: 1,
        unit: { $ifNull: ["$originalUnit", "$unit"] },
        totalQuantity: 1,
        totalRevenue: 1,
        orderCount: 1,
        pendingQuantity: 1,
        confirmedQuantity: 1,
        shippedQuantity: 1,
        deliveredQuantity: 1,
        averageUnitPrice: {
          $cond: [{ $gt: ["$totalQuantity", 0] }, { $round: [{ $divide: ["$totalRevenue", "$totalQuantity"] }, 0] }, 0],
        },
        image: { $arrayElemAt: ["$inventoryInfo.images.url", 0] },
        category: { $arrayElemAt: ["$inventoryInfo.category", 0] },
      },
    }
  );

  const productsAgg = await EcommerceOrder.aggregate(pipeline);

  const totals = productsAgg.reduce(
    (acc, p) => {
      acc.totalQuantity += p.totalQuantity || 0;
      acc.totalRevenue += p.totalRevenue || 0;
      acc.totalOrderHits += p.orderCount || 0;
      return acc;
    },
    { totalQuantity: 0, totalRevenue: 0, totalOrderHits: 0 }
  );

  res.status(200).json({
    success: true,
    data: {
      totals: {
        uniqueProductsCount: productsAgg.length,
        totalQuantity: totals.totalQuantity,
        totalRevenue: totals.totalRevenue,
      },
      products: productsAgg,
    },
  });
});

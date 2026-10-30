import Order from "../models/orders.model.js";
import CreditRecord from "../models/creditRecord.model.js";
import EcommerceOrder from "../models/ecommerceOrder.model.js";
import Customer from "../models/customer.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { signToken } from "../services/jwtToken.service.js";
import { TIER_KEYS } from "../constants/customerTiers.js";
import mongoose from "mongoose";
import XLSX from "xlsx";

export const register = asyncErrorHandler(async (req, res, next) => {
  const { name, phone, password, address, township } = req.body;

  if (!name || !phone || !password) {
    return next(new CustomError(400, "Name, phone and password are required."));
  }

  if (password.length < 6) {
    return next(new CustomError(400, "Password must be at least 6 characters."));
  }

  const existing = await Customer.findOne({ phone });
  if (existing) {
    return next(new CustomError(400, "Phone number already registered."));
  }

  const customer = await Customer.create({
    name: name.trim().toLowerCase(),
    phone,
    password,
    address: address || "",
    township: township || "",
  });

  res.status(201).json({
    success: true,
    message: "Account created successfully.",
    data: {
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        township: customer.township,
      },
      token: signToken(customer._id, "customer"),
    },
  });
});

// login အမည် နှိုင်းယှဉ်ရန် — space / zero-width space အားလုံးဖယ်, အကြီးအသေး မခွဲ
// (DB ထဲရှိ အမည်ကို မပြောင်း — နှိုင်းယှဉ်ရာတွင်သာ သုံး)
const normalizeLoginName = (value = "") =>
  value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s​-‍﻿]+/g, "");

export const login = asyncErrorHandler(async (req, res, next) => {
  const { phone, password, name } = req.body;

  if (!phone || !password) {
    return next(new CustomError(400, "Phone and password are required."));
  }

  const customer = await Customer.findOne({ phone }).select("+password");
  if (!customer) {
    return next(
      new CustomError(
        401,
        "ဖုန်းနံပါတ် မှားယွင်းနေပါသည် သို့မဟုတ် အကောင့်မရှိပါ။"
      )
    );
  }
  if (!customer.isActive) {
    return next(new CustomError(401, "Your account has been deactivated."));
  }

  const isMatch = await customer.comparePassword(password);
  if (!isMatch) {
    return next(new CustomError(401, "Invalid phone or password."));
  }

  // If name is provided, verify matching against customer name
  if (name && typeof name === "string" && name.trim()) {
    const inputName = normalizeLoginName(name);
    const currentName = normalizeLoginName(customer.name || "");

    if (inputName && currentName && currentName !== inputName) {
      return next(
        new CustomError(
          401,
          "အမည် သို့မဟုတ် ဖုန်းနံပါတ် မှားယွင်းနေပါသည်။ (အကောင့်ဖွင့်ထားသော အမည်နှင့် မကိုက်ညီပါ)"
        )
      );
    }

    if (!customer.name) {
      customer.name = name.trim().toLowerCase();
      await customer.save();
    }
  }

  res.status(200).json({
    success: true,
    message: "Login successful.",
    data: {
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        township: customer.township,
        tier: customer.tier,
      },
      token: signToken(customer._id, "customer"),
    },
  });
});

export const getMe = asyncErrorHandler(async (req, res, next) => {
  res.status(200).json({
    success: true,
    data: req.customer,
  });
});

export const getAllCustomers = asyncErrorHandler(async (req, res, next) => {
  const { page, limit, search, tier, township } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  const filter = {};
  if (tier && TIER_KEYS.includes(tier)) {
    filter.tier = tier;
  }
  if (township && township.trim()) {
    filter.township = township.trim();
  }
  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { phone: { $regex: escaped, $options: "i" } },
    ];
  }

  console.log("getAllCustomers filter applied:", filter);
  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Customer.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: customers,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

export const getAllTownships = asyncErrorHandler(async (req, res, next) => {
  const townships = await Customer.distinct("township");
  res.status(200).json({
    success: true,
    message: "Townships retrieved successfully",
    data: townships.filter(Boolean),
  });
});

export const updateMe = asyncErrorHandler(async (req, res, next) => {
  const { name, phone, password, address, township } = req.body;
  const customer = req.customer;

  if (name) customer.name = typeof name === "string" ? name.trim().toLowerCase() : name;

  if (phone && phone !== customer.phone) {
    const existing = await Customer.findOne({ phone });
    if (existing) {
      return next(new CustomError(400, "Phone number already in use."));
    }
    customer.phone = phone;
  }

  if (password) {
    if (password.length < 6) {
      return next(new CustomError(400, "Password must be at least 6 characters."));
    }
    customer.password = password;
  }

  if (address !== undefined) customer.address = address;
  if (township !== undefined) customer.township = township;

  await customer.save();

  res.status(200).json({
    success: true,
    message: "Profile updated successfully.",
    data: customer,
  });
});

export const updateCustomerByAdmin = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, phone, password, isActive, address, township, tier } = req.body;

  const customer = await Customer.findById(id);
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  if (tier !== undefined) {
    if (!TIER_KEYS.includes(tier)) {
      return next(new CustomError(400, `Invalid tier. Must be one of: ${TIER_KEYS.join(", ")}`));
    }
    customer.tier = tier;
  }

  if (name !== undefined) customer.name = typeof name === "string" ? name.trim().toLowerCase() : name;

  if (phone !== undefined) {
    if (phone !== customer.phone) {
      const existing = await Customer.findOne({ phone });
      if (existing) {
        return next(new CustomError(400, "Phone number already in use."));
      }
      customer.phone = phone;
    }
  }

  if (password !== undefined) {
    if (password.length < 6) {
      return next(new CustomError(400, "Password must be at least 6 characters."));
    }
    customer.password = password;
  }

  if (isActive !== undefined) customer.isActive = isActive;
  if (address !== undefined) customer.address = address;
  if (township !== undefined) customer.township = township;

  await customer.save();

  res.status(200).json({
    success: true,
    message: "Customer updated successfully.",
    data: customer,
  });
});

// ─── Credit Person Management ─────────────────────────────────────

// Toggle customer as credit person (on/off)
export const toggleCreditPersonStatus = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }

  const customer = await Customer.findById(id);
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  customer.isCreditPerson = !customer.isCreditPerson;
  // If unmarking as credit person, clear blacklist too
  if (!customer.isCreditPerson) {
    customer.blacklist = false;
    customer.blacklistReason = null;
    customer.blacklistDate = null;
  }
  await customer.save();

  res.status(200).json({
    success: true,
    message: customer.isCreditPerson
      ? "Customer is now a credit person"
      : "Credit person status removed",
    data: customer,
  });
});

// Update credit person blacklist status
export const updateCreditPersonBlacklist = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { blacklist, blacklistReason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }

  const customer = await Customer.findById(id);
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  customer.blacklist = blacklist;
  customer.blacklistDate = blacklist ? new Date() : null;
  customer.blacklistReason = blacklist ? (blacklistReason || null) : null;
  await customer.save();

  res.status(200).json({
    success: true,
    message: blacklist
      ? "Customer has been blacklisted"
      : "Customer removed from blacklist",
    data: customer,
  });
});

// Get all credit persons (for admin dropdown, etc.)
export const getCreditPersonCustomers = asyncErrorHandler(async (req, res, next) => {
  const creditPersons = await Customer.find({
    isCreditPerson: true,
    blacklist: { $ne: true },
  }).select("name phone isCreditPerson blacklist");

  res.status(200).json({
    success: true,
    data: creditPersons,
  });
});

// ─── Excel Import ─────────────────────────────────────────────────

// Import customers from Excel file (credit persons)
// Expected columns: Name, ShortDesc, Phone, Address, IsCredit, CreditLimit, DueInDays, Township
export const importCustomersFromExcel = asyncErrorHandler(async (req, res, next) => {
  if (!req.file) {
    return next(new CustomError(400, "Please upload an Excel file"));
  }

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet);

  if (rows.length === 0) {
    return next(new CustomError(400, "Excel file is empty"));
  }

  let created = 0;
  let skipped = 0;
  const errors = [];

  // Helper to extract values case-insensitively
  const getRowValue = (row, keyName) => {
    const key = Object.keys(row).find(k => k.trim().toLowerCase() === keyName.toLowerCase());
    return key ? row[key] : undefined;
  };

  for (const row of rows) {
    try {
      const nameVal = getRowValue(row, "Name");
      const name = nameVal ? nameVal.toString().trim().replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase() : '';
      if (!name) {
        skipped++;
        continue;
      }

      const addressLineVal = getRowValue(row, "Address");
      const addressLine = addressLineVal ? String(addressLineVal).trim() : "";
      
      const townshipVal = getRowValue(row, "Township");
      const township = townshipVal ? String(townshipVal).trim() : "";

      const phoneVal = getRowValue(row, "Phone");
      let phone = undefined;
      if (phoneVal) {
        phone = phoneVal.toString().trim().replace(/[^0-9]/g, "");
      }

      // Check for duplicate by name (case-insensitive)
      const existing = await Customer.findOne({
        name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      });

      if (existing) {
        // Update existing customer details instead of skipping
        let modified = false;

        if (phone && !existing.phone) {
          existing.phone = phone;
          modified = true;
        }

        if (addressLine && existing.address !== addressLine) {
          existing.address = addressLine;
          modified = true;
        }

        if (township && existing.township !== township) {
          existing.township = township;
          modified = true;
        }

        if (!existing.isCreditPerson) {
          existing.isCreditPerson = true;
          modified = true;
        }

        if (modified) {
          await existing.save();
          created++;
        } else {
          skipped++;
        }
        continue;
      }

      const customerData = {
        name,
        password: Math.random().toString(36).slice(2, 10),
        isCreditPerson: true,
        address: addressLine,
        township,
      };

      if (phone) {
        customerData.phone = phone;
      }

      await Customer.create(customerData);
      created++;
    } catch (err) {
      errors.push({ name: row.Name || "unknown", error: err.message });
    }
  }

  res.status(200).json({
    success: true,
    message: `Import completed: ${created} created, ${skipped} skipped, ${errors.length} errors`,
    data: {
      total: rows.length,
      created,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    },
  });
});

// ဝယ်ယူသူတစ်ဦးချင်းစီ၏ အသေးစိတ်နှင့် မှာယူမှုမှတ်တမ်း (Customer Detail with Order History & Analytics)
export const getCustomerAnalyticsById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }

  const customer = await Customer.findById(id).select("-password");
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  const customerObjId = new mongoose.Types.ObjectId(id);

  // 1. Customer Orders Metrics
  const metricsAgg = await EcommerceOrder.aggregate([
    {
      $match: {
        customerId: customerObjId,
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalSpent: {
          $sum: {
            $cond: [{ $ne: ["$status", "cancelled"] }, "$totalAmount", 0],
          },
        },
        deliveredCount: {
          $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
        },
        cancelledCount: {
          $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
        },
        pendingCount: {
          $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
        },
        shippedCount: {
          $sum: { $cond: [{ $eq: ["$status", "shipped"] }, 1, 0] },
        },
      },
    },
  ]);

  const metrics = metricsAgg[0] || {
    totalOrders: 0,
    totalSpent: 0,
    deliveredCount: 0,
    cancelledCount: 0,
    pendingCount: 0,
    shippedCount: 0,
  };

  const validOrdersCount = metrics.totalOrders - metrics.cancelledCount;
  const avgOrderValue = validOrdersCount > 0
    ? Math.round(metrics.totalSpent / validOrdersCount)
    : 0;

  // 2. All Orders by this customer
  const orders = await EcommerceOrder.find({
    customerId: customerObjId,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .populate("products.inventoryId", "productName productCode images")
    .select("orderNumber totalAmount status paymentMethod paymentStatus createdAt products note isEdited");

  // 3. Top Purchased Products by this customer
  const topProductsAgg = await EcommerceOrder.aggregate([
    {
      $match: {
        customerId: customerObjId,
        isDeleted: false,
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
        totalSpent: { $sum: "$products.subtotal" },
        orderCount: { $sum: 1 },
        lastPurchasedAt: { $max: "$createdAt" },
      },
    },
    { $sort: { totalSpent: -1 } },
    { $limit: 15 },
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
        totalSpent: 1,
        orderCount: 1,
        lastPurchasedAt: 1,
        image: { $arrayElemAt: ["$inventoryInfo.images.url", 0] },
      },
    },
  ]);

  // 4. Customer Credit Outstanding and Payment Records
  const creditOrders = await Order.find({
    creditPersonId: customerObjId,
    paymentType: "credit",
    isDeleted: false,
  }).select("orderNumber finalAmount paidAmount createdAt");

  let creditOutstanding = 0;
  for (const co of creditOrders) {
    creditOutstanding += Math.max(0, (co.finalAmount || 0) - (co.paidAmount || 0));
  }

  const creditPayments = await CreditRecord.find({
    creditPersonId: customerObjId,
    isDeleted: false,
  })
    .sort({ paymentDate: -1 })
    .limit(30)
    .populate("orderId", "orderNumber")
    .populate("addedBy", "name");

  res.status(200).json({
    success: true,
    data: {
      customer,
      metrics: {
        ...metrics,
        deliveredOrders: metrics.deliveredCount || 0,
        cancelledOrders: metrics.cancelledCount || 0,
        pendingOrders: metrics.pendingCount || 0,
        shippedOrders: metrics.shippedCount || 0,
        validOrdersCount,
        avgOrderValue,
        creditOutstanding,
      },
      orders,
      topProducts: topProductsAgg,
      creditOrders,
      creditPayments,
    },
  });
});


/**
 * Customer အကြွေးဆပ်ရန် (FIFO စနစ်ဖြင့် မကြေသေးသော အကြွေး order များကို အဟောင်းဆုံးမှစ၍ အလိုအလျောက် ဖြတ်ပေးခြင်း)
 */
export const payCustomerCredit = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { paidAmount, paymentMethod = "cash", notes } = req.body;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID"));
  }

  const numericPaidAmount = Number(paidAmount);
  if (!numericPaidAmount || numericPaidAmount <= 0) {
    return next(new CustomError(400, "Paid amount must be greater than zero"));
  }

  const customer = await Customer.findById(id);
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  const customerObjId = new mongoose.Types.ObjectId(id);

  // Find all unpaid or partially paid credit orders for this customer (Oldest first - FIFO)
  const creditOrders = await Order.find({
    creditPersonId: customerObjId,
    paymentType: "credit",
    isDeleted: false,
  }).sort({ createdAt: 1 });

  const eligibleOrders = creditOrders.filter(
    (o) => (o.finalAmount || 0) - (o.paidAmount || 0) > 0
  );

  if (eligibleOrders.length === 0) {
    return next(new CustomError(400, "Customer has no outstanding credit balance to pay"));
  }

  const totalOutstandingBefore = eligibleOrders.reduce(
    (sum, o) => sum + Math.max(0, (o.finalAmount || 0) - (o.paidAmount || 0)),
    0
  );

  if (numericPaidAmount > totalOutstandingBefore) {
    return next(
      new CustomError(
        400,
        `Payment amount (${numericPaidAmount.toLocaleString()} MMK) exceeds total outstanding balance (${totalOutstandingBefore.toLocaleString()} MMK)`
      )
    );
  }

  const session = await mongoose.startSession();
  const createdRecords = [];
  let remainingToDistribute = numericPaidAmount;

  try {
    await session.withTransaction(async () => {
      for (const order of eligibleOrders) {
        if (remainingToDistribute <= 0) break;

        const orderRemaining = Math.max(0, (order.finalAmount || 0) - (order.paidAmount || 0));
        const paymentForThisOrder = Math.min(orderRemaining, remainingToDistribute);

        if (paymentForThisOrder > 0) {
          order.paidAmount = (order.paidAmount || 0) + paymentForThisOrder;
          await order.save({ session });

          const [record] = await CreditRecord.create(
            [
              {
                orderId: order._id,
                creditPersonId: customerObjId,
                paidAmount: paymentForThisOrder,
                paymentDate: new Date(),
                paymentMethod: paymentMethod || "cash",
                notes: notes
                  ? `${notes} (towards ${order.orderNumber})`
                  : `Bulk credit payment towards ${order.orderNumber}`,
                addedBy: req.user._id,
              },
            ],
            { session }
          );

          createdRecords.push(record);
          remainingToDistribute -= paymentForThisOrder;
        }
      }
    });
  } catch (err) {
    console.error("Error in payCustomerCredit transaction:", err);
    return next(new CustomError(500, err.message || "Failed to process credit payment"));
  } finally {
    await session.endSession();
  }

  // Recalculate remaining total outstanding
  const updatedOrders = await Order.find({
    creditPersonId: customerObjId,
    paymentType: "credit",
    isDeleted: false,
  });
  const newTotalOutstanding = updatedOrders.reduce(
    (sum, o) => sum + Math.max(0, (o.finalAmount || 0) - (o.paidAmount || 0)),
    0
  );

  res.status(200).json({
    success: true,
    message: "Credit payment processed successfully",
    data: {
      paidAmount: numericPaidAmount,
      previousOutstanding: totalOutstandingBefore,
      remainingOutstanding: newTotalOutstanding,
      allocatedOrdersCount: createdRecords.length,
      records: createdRecords,
    },
  });
});

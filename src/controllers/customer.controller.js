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
import moment from "moment-timezone";
import Inventory from "../models/inventory.model.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import {
  getCustomerCreditBalance,
  derivePaymentStatus,
} from "../services/customerCredit.service.js";

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
        isCreditPerson: customer.isCreditPerson,
        blacklist: customer.blacklist,
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

// Base quantity ကို အကြီးဆုံး unit မှစ၍ စနစ်တကျ ဖော်ပြပေးသည့် helper (ဥပမာ "2 pack 15 box")
const formatDisplayQty = (totalBaseQty, baseUnit, uomConversions = []) => {
  const unitLabel = baseUnit || "ခု";
  let rem = Math.max(0, Math.round(Number(totalBaseQty) || 0));
  if (rem === 0) return `0 ${unitLabel}`;

  const sortedConversions = (Array.isArray(uomConversions) ? uomConversions : [])
    .filter((c) => c && c.unit && Number(c.factor) > 1)
    .sort((a, b) => Number(b.factor) - Number(a.factor));

  const parts = [];
  for (const conv of sortedConversions) {
    const factor = Number(conv.factor);
    if (rem >= factor) {
      const count = Math.floor(rem / factor);
      parts.push(`${count.toLocaleString()} ${conv.unit}`);
      rem = rem % factor;
    }
  }

  if (rem > 0 || parts.length === 0) {
    parts.push(`${rem.toLocaleString()} ${unitLabel}`);
  }

  return parts.join(" ");
};

// Ecommerce app အတွက် လက်ရှိ login ဝင်ထားသော customer ၏ အကြွေးနှင့် အော်ဒါတင်ခွင့် အခြေအနေ (GET /customer/me/credit)
export const getMyCredit = asyncErrorHandler(async (req, res, next) => {
  const customer = req.customer;
  const balance = await getCustomerCreditBalance(customer._id);

  res.status(200).json({
    success: true,
    data: {
      creditRemaining: balance.creditRemaining,
      payableRemaining: balance.payableRemaining,
      isCreditPerson: customer.isCreditPerson,
      blacklist: customer.blacklist,
    },
  });
});

// Customer Detail စာမျက်နှာအတွက် အကျဉ်းချုပ်၊ အကြွေးလက်ကျန်နှင့် အကြွေးဆပ်မှတ်တမ်း (GET /customer/:id/summary)
export const getCustomerSummary = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }

  const customer = await Customer.findById(id).select("-password");
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  const customerObjId = new mongoose.Types.ObjectId(id);

  const posBaseMatch = {
    ecommerceOrderId: null,
    isDeleted: false,
    $or: [{ customerId: customerObjId }, { creditPersonId: customerObjId }],
  };

  const [
    creditBalance,
    ecommerceOrderCount,
    posOrderCount,
    lastEcomOrder,
    lastPosOrder,
    creditPayments,
  ] = await Promise.all([
    getCustomerCreditBalance(customerObjId),
    EcommerceOrder.countDocuments({
      customerId: customerObjId,
      isDeleted: false,
    }),
    Order.countDocuments(posBaseMatch),
    EcommerceOrder.findOne({ customerId: customerObjId, isDeleted: false })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),
    Order.findOne(posBaseMatch)
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean(),
    CreditRecord.find({
      creditPersonId: customerObjId,
      isDeleted: false,
    })
      .sort({ paymentDate: -1, _id: -1 })
      .limit(100)
      .populate("orderId", "orderNumber")
      .populate("ecommerceOrderId", "orderNumber")
      .populate("addedBy", "name")
      .lean(),
  ]);

  let lastOrderDate = null;
  if (lastEcomOrder?.createdAt && lastPosOrder?.createdAt) {
    lastOrderDate =
      new Date(lastEcomOrder.createdAt) >= new Date(lastPosOrder.createdAt)
        ? lastEcomOrder.createdAt
        : lastPosOrder.createdAt;
  } else {
    lastOrderDate = lastEcomOrder?.createdAt || lastPosOrder?.createdAt || null;
  }

  res.status(200).json({
    success: true,
    data: {
      customer,
      ...creditBalance,
      orderCount: {
        ecommerce: ecommerceOrderCount,
        pos: posOrderCount,
        total: ecommerceOrderCount + posOrderCount,
      },
      lastOrderDate,
      creditPayments,
    },
  });
});

// E-commerce နှင့် POS အော်ဒါများကို $unionWith ဖြင့် ပေါင်းစပ်၍ filter / pagination ဖြင့် ပြန်ပေးခြင်း (GET /customer/:id/orders)
export const getCustomerOrders = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const {
    source = "all",
    status,
    from,
    to,
    startDate,
    endDate,
    page = 1,
    limit = 20,
  } = req.query;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }

  const customerExists = await Customer.exists({ _id: id });
  if (!customerExists) {
    return next(new CustomError(404, "Customer not found"));
  }

  const normalizedSource = ["all", "ecommerce", "pos"].includes(source)
    ? source
    : "all";

  let dateFilter = {};
  try {
    dateFilter = createDateFilter(
      {
        startDate: from || startDate,
        endDate: to || endDate,
      },
      "createdAt",
      false
    );
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  const customerObjId = new mongoose.Types.ObjectId(id);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  // Ecommerce base match (source=pos ဖြစ်လျှင် ecommerce ဘက်မှ document မထွက်စေရန် _id: null စစ်သည်)
  const ecomMatch =
    normalizedSource === "pos"
      ? { _id: null }
      : {
          customerId: customerObjId,
          isDeleted: false,
          ...dateFilter,
        };

  // POS union match (fulfillment Order များ မပါဝင်စေရန် ecommerceOrderId: null မဖြစ်မနေ စစ်သည်)
  const posMatch =
    normalizedSource === "ecommerce"
      ? { _id: null }
      : {
          ecommerceOrderId: null,
          isDeleted: false,
          $or: [{ customerId: customerObjId }, { creditPersonId: customerObjId }],
          ...dateFilter,
        };

  const pipeline = [
    { $match: ecomMatch },
    {
      $project: {
        _id: 1,
        source: { $literal: "ecommerce" },
        orderNumber: 1,
        date: "$createdAt",
        status: "$status",
        itemCount: { $size: { $ifNull: ["$products", []] } },
        totalAmount: { $ifNull: ["$totalAmount", 0] },
        paidAmount: { $ifNull: ["$paidAmount", 0] },
        remaining: {
          $cond: [
            { $eq: ["$status", "cancelled"] },
            0,
            {
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
          ],
        },
        paymentType: { $literal: "credit" },
        paymentStatus: { $ifNull: ["$paymentStatus", "unpaid"] },
      },
    },
    {
      $unionWith: {
        coll: "orders",
        pipeline: [
          { $match: posMatch },
          {
            $project: {
              _id: 1,
              source: { $literal: "pos" },
              orderNumber: 1,
              date: "$createdAt",
              status: "$orderStatus",
              itemCount: { $size: { $ifNull: ["$ordersProducts", []] } },
              totalAmount: { $ifNull: ["$finalAmount", 0] },
              paidAmount: { $ifNull: ["$paidAmount", 0] },
              remaining: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$paymentType", "credit"] },
                      { $ne: ["$orderStatus", "cancelled"] },
                    ],
                  },
                  {
                    $max: [
                      0,
                      {
                        $subtract: [
                          { $ifNull: ["$finalAmount", 0] },
                          { $ifNull: ["$paidAmount", 0] },
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
              paymentType: { $ifNull: ["$paymentType", "paid"] },
              paymentStatus: {
                $cond: [
                  { $eq: ["$paymentType", "paid"] },
                  "paid",
                  {
                    $cond: [
                      { $lte: [{ $ifNull: ["$paidAmount", 0] }, 0] },
                      "unpaid",
                      {
                        $cond: [
                          {
                            $gte: [
                              { $ifNull: ["$paidAmount", 0] },
                              { $ifNull: ["$finalAmount", 0] },
                            ],
                          },
                          "paid",
                          "partial",
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    },
  ];

  if (status && status !== "all") {
    pipeline.push({ $match: { status } });
  }

  pipeline.push(
    { $sort: { date: -1, _id: -1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limitNum }],
        totalCount: [{ $count: "count" }],
      },
    }
  );

  const [aggResult] = await EcommerceOrder.aggregate(pipeline);
  const rows = aggResult?.data || [];
  const totalItems = aggResult?.totalCount?.[0]?.count || 0;

  res.status(200).json({
    success: true,
    data: rows,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
      totalItems,
      itemsPerPage: limitNum,
    },
  });
});

// Customer ဝယ်ထားသော ပစ္စည်းစာရင်းနှင့် လအလိုက် ဝယ်ယူငွေ စာရင်းအင်း (GET /customer/:id/products)
export const getCustomerProducts = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { source = "all", from, to, startDate, endDate } = req.query;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID format"));
  }

  const customerExists = await Customer.exists({ _id: id });
  if (!customerExists) {
    return next(new CustomError(404, "Customer not found"));
  }

  const normalizedSource = ["all", "ecommerce", "pos"].includes(source)
    ? source
    : "all";

  let dateFilter = {};
  try {
    dateFilter = createDateFilter(
      {
        startDate: from || startDate,
        endDate: to || endDate,
      },
      "createdAt",
      false
    );
  } catch (error) {
    if (error instanceof CustomError) return next(error);
    return next(new CustomError(400, error.message || "Invalid date filter"));
  }

  const customerObjId = new mongoose.Types.ObjectId(id);

  const [ecomOrders, posOrders] = await Promise.all([
    normalizedSource === "pos"
      ? Promise.resolve([])
      : EcommerceOrder.find({
          customerId: customerObjId,
          isDeleted: false,
          status: { $ne: "cancelled" },
          ...dateFilter,
        })
          .select("products createdAt totalAmount")
          .lean(),
    normalizedSource === "ecommerce"
      ? Promise.resolve([])
      : Order.find({
          ecommerceOrderId: null,
          isDeleted: false,
          orderStatus: { $ne: "cancelled" },
          $or: [{ customerId: customerObjId }, { creditPersonId: customerObjId }],
          ...dateFilter,
        })
          .select("ordersProducts createdAt finalAmount")
          .lean(),
  ]);

  const productMap = new Map();
  const monthlyMap = new Map();

  const ensureEntry = (invIdStr, fallbackName = "", fallbackCode = "") => {
    if (!productMap.has(invIdStr)) {
      productMap.set(invIdStr, {
        inventoryId: invIdStr,
        productName: fallbackName,
        productCode: fallbackCode,
        totalBaseQty: 0,
        totalAmount: 0,
        orderIds: new Set(),
        lastPurchaseDate: null,
      });
    }
    return productMap.get(invIdStr);
  };

  for (const eo of ecomOrders) {
    const orderIdStr = eo._id.toString();
    const orderDate = eo.createdAt ? new Date(eo.createdAt) : null;
    const monthKey = orderDate
      ? moment(orderDate).tz("Asia/Yangon").format("YYYY-MM")
      : null;

    for (const p of eo.products || []) {
      const invIdStr = (p.inventoryId?._id || p.inventoryId)?.toString();
      if (!invIdStr) continue;

      const qty = Number(p.quantity) || 0;
      const factor = Number(p.factor) || 1;
      const baseQty =
        p.baseQuantity != null && Number(p.baseQuantity) > 0
          ? Number(p.baseQuantity)
          : qty * factor;
      const lineAmt =
        p.subtotal != null
          ? Number(p.subtotal)
          : qty * (Number(p.unitPrice) || 0);

      const entry = ensureEntry(invIdStr, p.productName, p.productCode);
      entry.totalBaseQty += baseQty;
      entry.totalAmount += lineAmt;
      entry.orderIds.add(orderIdStr);
      if (
        orderDate &&
        (!entry.lastPurchaseDate || orderDate > new Date(entry.lastPurchaseDate))
      ) {
        entry.lastPurchaseDate = orderDate;
      }

      if (monthKey) {
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + lineAmt);
      }
    }
  }

  for (const po of posOrders) {
    const orderIdStr = po._id.toString();
    const orderDate = po.createdAt ? new Date(po.createdAt) : null;
    const monthKey = orderDate
      ? moment(orderDate).tz("Asia/Yangon").format("YYYY-MM")
      : null;

    for (const op of po.ordersProducts || []) {
      const invIdStr = (op.inventoryId?._id || op.inventoryId)?.toString();
      if (!invIdStr) continue;

      const qty = Number(op.quantity) || 0;
      const factor = Number(op.factor) || 1;
      const baseQty =
        op.baseQuantity != null && Number(op.baseQuantity) > 0
          ? Number(op.baseQuantity)
          : qty * factor;
      const lineAmt = qty * (Number(op.unitPrice) || 0);

      const entry = ensureEntry(invIdStr);
      entry.totalBaseQty += baseQty;
      entry.totalAmount += lineAmt;
      entry.orderIds.add(orderIdStr);
      if (
        orderDate &&
        (!entry.lastPurchaseDate || orderDate > new Date(entry.lastPurchaseDate))
      ) {
        entry.lastPurchaseDate = orderDate;
      }

      if (monthKey) {
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + lineAmt);
      }
    }
  }

  const allInvIds = Array.from(productMap.keys())
    .filter((k) => mongoose.Types.ObjectId.isValid(k))
    .map((k) => new mongoose.Types.ObjectId(k));

  const inventories =
    allInvIds.length > 0
      ? await Inventory.find({ _id: { $in: allInvIds } })
          .select("productName productCode unitOfMeasure uomConversions images")
          .lean()
      : [];

  const invMap = new Map(inventories.map((inv) => [inv._id.toString(), inv]));

  const products = Array.from(productMap.values())
    .map((entry) => {
      const inv = invMap.get(entry.inventoryId);
      const baseUnit = inv?.unitOfMeasure || "ခု";
      return {
        inventoryId: entry.inventoryId,
        productName: inv?.productName || entry.productName || "Unknown Product",
        productCode: inv?.productCode || entry.productCode || "",
        baseUnit,
        totalBaseQty: entry.totalBaseQty,
        displayQty: formatDisplayQty(
          entry.totalBaseQty,
          baseUnit,
          inv?.uomConversions
        ),
        totalAmount: entry.totalAmount,
        orderCount: entry.orderIds.size,
        lastPurchaseDate: entry.lastPurchaseDate,
        image: inv?.images?.[0]?.url || null,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);

  // နောက်ဆုံး ၁၂ လအတွက် လအလိုက် ဝယ်ယူငွေ (Asia/Yangon timezone)
  const nowYangon = moment.tz("Asia/Yangon");
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const mKey = nowYangon.clone().subtract(i, "months").format("YYYY-MM");
    monthly.push({
      month: mKey,
      amount: monthlyMap.get(mKey) || 0,
    });
  }

  const totalAmountSum = products.reduce((sum, p) => sum + p.totalAmount, 0);

  res.status(200).json({
    success: true,
    data: {
      products,
      monthly,
      totals: {
        uniqueProducts: products.length,
        totalAmount: totalAmountSum,
        topProduct:
          products.length > 0
            ? {
                inventoryId: products[0].inventoryId,
                productName: products[0].productName,
                totalAmount: products[0].totalAmount,
                displayQty: products[0].displayQty,
              }
            : null,
      },
    },
  });
});

/**
 * Customer အကြွေးဆပ်ရန် (FIFO စနစ်ဖြင့် POS အကြွေးနှင့် ပို့ပြီးသား Ecommerce အော်ဒါများကို အဟောင်းဆုံးမှစ၍ အလိုအလျောက် ခွဲဝေဆပ်ပေးခြင်း)
 */
export const payCustomerCredit = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { paidAmount, paymentMethod = "cash", notes } = req.body;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid customer ID"));
  }

  const numericPaidAmount = Number(paidAmount);
  if (!Number.isFinite(numericPaidAmount) || numericPaidAmount <= 0) {
    return next(
      new CustomError(400, "ပေးဆပ်မည့် ငွေပမာဏသည် 0 ထက် ကြီးရပါမည်")
    );
  }

  const customer = await Customer.findById(id);
  if (!customer) {
    return next(new CustomError(404, "Customer not found"));
  }

  const customerObjId = new mongoose.Types.ObjectId(id);
  const session = await mongoose.startSession();
  let createdRecords = [];
  let payableBefore = 0;

  try {
    await session.withTransaction(async () => {
      createdRecords = [];

      // 1. ဆပ်ခွင့်ရှိသော POS အကြွေး order များ (ecommerceOrderId: null, cancelled မဟုတ်)
      const posCreditOrders = await Order.find({
        ecommerceOrderId: null,
        isDeleted: false,
        paymentType: "credit",
        orderStatus: { $ne: "cancelled" },
        $or: [{ customerId: customerObjId }, { creditPersonId: customerObjId }],
      })
        .sort({ createdAt: 1 })
        .session(session);

      // 2. ဆပ်ခွင့်ရှိသော Ecommerce order များ (shipped / delivered သာ — U-6 စည်းမျဉ်း)
      const ecomPayableOrders = await EcommerceOrder.find({
        customerId: customerObjId,
        isDeleted: false,
        status: { $in: ["shipped", "delivered"] },
      })
        .sort({ createdAt: 1 })
        .session(session);

      const eligibleItems = [];

      for (const po of posCreditOrders) {
        const rem = Math.max(0, (po.finalAmount || 0) - (po.paidAmount || 0));
        if (rem > 0) {
          eligibleItems.push({
            kind: "pos",
            doc: po,
            createdAt: po.createdAt,
            remaining: rem,
          });
        }
      }

      for (const eo of ecomPayableOrders) {
        const rem = Math.max(0, (eo.totalAmount || 0) - (eo.paidAmount || 0));
        if (rem > 0) {
          eligibleItems.push({
            kind: "ecommerce",
            doc: eo,
            createdAt: eo.createdAt,
            remaining: rem,
          });
        }
      }

      // POS နှင့် Ecommerce နှစ်မျိုးလုံးကို createdAt အစဉ်လိုက် (အဟောင်းဆုံး အရင်) စီခြင်း
      eligibleItems.sort((a, b) => {
        const diff =
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (diff !== 0) return diff;
        return a.doc._id.toString().localeCompare(b.doc._id.toString());
      });

      payableBefore = eligibleItems.reduce(
        (sum, item) => sum + item.remaining,
        0
      );

      if (payableBefore <= 0 || numericPaidAmount > payableBefore) {
        throw new CustomError(
          400,
          `ဆပ်ငွေသည် ယခု ဆပ်နိုင်သော ကျန်ငွေ (${payableBefore.toLocaleString()} MMK) ထက် များနေပါသည်`
        );
      }

      let remainingToDistribute = numericPaidAmount;

      for (const item of eligibleItems) {
        if (remainingToDistribute <= 0) break;

        const pay = Math.min(item.remaining, remainingToDistribute);
        if (pay <= 0) continue;

        if (item.kind === "pos") {
          const order = item.doc;
          order.paidAmount = (order.paidAmount || 0) + pay;
          await order.save({ session });

          const [record] = await CreditRecord.create(
            [
              {
                orderId: order._id,
                ecommerceOrderId: null,
                creditPersonId: customerObjId,
                paidAmount: pay,
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
        } else {
          const ecomOrder = item.doc;
          ecomOrder.paidAmount = (ecomOrder.paidAmount || 0) + pay;
          ecomOrder.paymentStatus = derivePaymentStatus(
            ecomOrder.totalAmount,
            ecomOrder.paidAmount
          );
          await ecomOrder.save({ session });

          // ချိတ်ထားသော fulfillment Order ရှိပါက sale report မပျက်စေရန် paidAmount ကိုသာ ညှိပေးသည် (finalAmount မထိပါ)
          if (ecomOrder.fulfillmentOrderId) {
            const linkedFulfillment = await Order.findOne({
              _id: ecomOrder.fulfillmentOrderId,
              isDeleted: false,
            }).session(session);

            if (linkedFulfillment) {
              linkedFulfillment.paidAmount = ecomOrder.paidAmount;
              await linkedFulfillment.save({ session });
            }
          }

          const [record] = await CreditRecord.create(
            [
              {
                ecommerceOrderId: ecomOrder._id,
                orderId: ecomOrder.fulfillmentOrderId || null,
                creditPersonId: customerObjId,
                paidAmount: pay,
                paymentDate: new Date(),
                paymentMethod: paymentMethod || "cash",
                notes: notes
                  ? `${notes} (towards ${ecomOrder.orderNumber})`
                  : `Bulk credit payment towards ${ecomOrder.orderNumber}`,
                addedBy: req.user._id,
              },
            ],
            { session }
          );

          createdRecords.push(record);
        }

        remainingToDistribute -= pay;
      }
    });
  } catch (err) {
    if (err instanceof CustomError) {
      return next(err);
    }
    console.error("Error in payCustomerCredit transaction:", err);
    return next(
      new CustomError(500, err.message || "Failed to process credit payment")
    );
  } finally {
    await session.endSession();
  }

  // Shared service မှ လက်ကျန်အကြွေးအသစ်ကို ပြန်တွက်သည်
  const afterBalance = await getCustomerCreditBalance(customerObjId);

  res.status(200).json({
    success: true,
    message: "Credit payment processed successfully",
    data: {
      paidAmount: numericPaidAmount,
      previousOutstanding: payableBefore,
      remainingOutstanding: afterBalance.creditRemaining,
      payableRemaining: afterBalance.payableRemaining,
      creditPaid: afterBalance.creditPaid,
      allocatedOrdersCount: createdRecords.length,
      records: createdRecords,
    },
  });
});

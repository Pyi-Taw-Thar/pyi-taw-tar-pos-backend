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
    name,
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

export const login = asyncErrorHandler(async (req, res, next) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return next(new CustomError(400, "Phone and password are required."));
  }

  const customer = await Customer.findOne({ phone }).select("+password");
  if (!customer) {
    return next(new CustomError(401, "Invalid phone or password."));
  }
  if (!customer.isActive) {
    return next(new CustomError(401, "Your account has been deactivated."));
  }

  const isMatch = await customer.comparePassword(password);
  if (!isMatch) {
    return next(new CustomError(401, "Invalid phone or password."));
  }

  res.status(200).json({
    success: true,
    message: "Login successful.",
    data: {
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
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
  const { page, limit, search, tier } = req.query;
  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  const filter = {};
  if (tier && TIER_KEYS.includes(tier)) {
    filter.tier = tier;
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

export const updateMe = asyncErrorHandler(async (req, res, next) => {
  const { name, phone, password, address, township } = req.body;
  const customer = req.customer;

  if (name) customer.name = name;

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

  if (name !== undefined) customer.name = name;

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
      const name = nameVal ? nameVal.toString().trim().replace(/[\u200B-\u200D\uFEFF]/g, '') : '';
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

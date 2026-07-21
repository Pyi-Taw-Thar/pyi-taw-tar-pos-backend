import SupplierProfile from "../models/supplierProfile.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";
import { logActivity } from "../services/activityLog.service.js";
import XLSX from "xlsx";
import multer from "multer";

// Multer config for Excel file upload
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (
      allowedMimes.includes(file.mimetype) ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xls") ||
      file.originalname.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls, .csv) are allowed"), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

export const createSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const {
      supplierName,
      shortDesc,
      companyName,
      contactNumber,
      email,
      address,
      township,
      isCredit,
      dueInDays,
      isConsign,
    } = req.body;

    if (!supplierName) {
      return next(new CustomError(400, "Supplier name is required"));
    }

    // Check for duplicate supplierName
    const existing = await SupplierProfile.findOne({
      supplierName: supplierName.trim(),
      isDeleted: false,
    });
    if (existing) {
      return next(new CustomError(400, "Supplier name already exists"));
    }

    const supplier = await SupplierProfile.create({
      supplierName: supplierName.trim(),
      shortDesc: shortDesc || null,
      companyName: companyName || null,
      contactNumber: contactNumber || null,
      email: email || null,
      address: address || null,
      township: township || null,
      isCredit: isCredit !== undefined ? isCredit : false,
      dueInDays: dueInDays !== undefined ? dueInDays : null,
      isConsign: isConsign !== undefined ? isConsign : false,
    });

    logActivity({
      admin: req.user._id,
      action: "create",
      feature: "supplier",
      description: `Created supplier ${supplier.supplierName}`,
      targetId: supplier._id,
      targetModel: "SupplierProfile",
      ip: req.ip,
    });

    res.status(201).json({
      success: true,
      message: "Supplier profile created successfully",
      data: supplier,
    });
  },
);

export const getAllSupplierProfiles = asyncErrorHandler(
  async (req, res, next) => {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
      includeDeleted = false,
      isDeleted,
      isCredit,
      isConsign,
      township,
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;
    let query = {};

    // Handle isDeleted filter
    if (isDeleted !== undefined) {
      query.isDeleted = isDeleted === "true" || isDeleted === true;
    } else if (!includeDeleted || includeDeleted === "false") {
      query.isDeleted = false;
    }

    // Search across multiple fields
    if (search) {
      query.$or = [
        { supplierName: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { township: { $regex: search, $options: "i" } },
        { shortDesc: { $regex: search, $options: "i" } },
        { contactNumber: { $regex: search, $options: "i" } },
      ];
    }

    // Filters
    if (isCredit !== undefined) {
      query.isCredit = isCredit === "true" || isCredit === true;
    }
    if (isConsign !== undefined) {
      query.isConsign = isConsign === "true" || isConsign === true;
    }
    if (township) {
      query.township = { $regex: township, $options: "i" };
    }

    const suppliers = await SupplierProfile.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum);
    const total = await SupplierProfile.countDocuments(query);

    res.status(200).json({
      success: true,
      message: "Supplier profiles retrieved successfully",
      data: suppliers,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  },
);

export const getSupplierProfileById = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    const supplier = await SupplierProfile.findById(id);
    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    res.status(200).json({
      success: true,
      message: "Supplier profile retrieved successfully",
      data: supplier,
    });
  },
);

export const updateSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }

    const allowedFields = [
      "supplierName",
      "shortDesc",
      "companyName",
      "contactNumber",
      "email",
      "address",
      "township",
      "isCredit",
      "dueInDays",
      "isConsign",
    ];

    // Build update object with only allowed fields
    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return next(new CustomError(400, "No valid fields provided to update"));
    }

    // Check duplicate supplierName if being updated
    if (updateData.supplierName) {
      const existing = await SupplierProfile.findOne({
        supplierName: updateData.supplierName.trim(),
        _id: { $ne: id },
        isDeleted: false,
      });
      if (existing) {
        return next(new CustomError(400, "Supplier name already exists"));
      }
    }

    const supplier = await SupplierProfile.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true },
    );

    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }

    logActivity({
      admin: req.user._id,
      action: "update",
      feature: "supplier",
      description: `Updated supplier ${supplier.supplierName}`,
      targetId: supplier._id,
      targetModel: "SupplierProfile",
      ip: req.ip,
    });

    res.status(200).json({
      success: true,
      message: "Supplier profile updated successfully",
      data: supplier,
    });
  },
);

export const softDeleteSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }
    const supplier = await SupplierProfile.findById(id);
    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    if (supplier.isDeleted) {
      return next(
        new CustomError(400, "Supplier profile is already soft deleted"),
      );
    }
    const softDeletedSupplier = await SupplierProfile.findByIdAndUpdate(
      id,
      { $set: { isDeleted: true, deletedAt: Date.now() } },
      { new: true, runValidators: true },
    );
    if (!softDeletedSupplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    logActivity({
      admin: req.user._id,
      action: "delete",
      feature: "supplier",
      description: `Soft deleted supplier ${softDeletedSupplier.supplierName}`,
      targetId: softDeletedSupplier._id,
      targetModel: "SupplierProfile",
      ip: req.ip,
    });
    res.status(200).json({
      success: true,
      message: "Supplier profile soft deleted successfully",
      data: softDeletedSupplier,
    });
  },
);

export const restoreSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }
    const supplier = await SupplierProfile.findById(id);
    if (!supplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    if (!supplier.isDeleted) {
      return next(new CustomError(400, "Supplier profile is not soft deleted"));
    }
    const restoredSupplier = await SupplierProfile.findByIdAndUpdate(
      id,
      { $set: { isDeleted: false, deletedAt: null } },
      { new: true, runValidators: true },
    );
    if (!restoredSupplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    res.status(200).json({
      success: true,
      message: "Supplier profile restored successfully",
      data: restoredSupplier,
    });
  },
);

export const deleteSupplierProfile = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid supplier profile ID format"));
    }
    const deletedSupplier = await SupplierProfile.findByIdAndDelete(id);
    if (!deletedSupplier) {
      return next(new CustomError(404, "Supplier profile not found"));
    }
    res.status(200).json({
      success: true,
      message: "Supplier profile deleted successfully",
      data: deletedSupplier,
    });
  },
);

// Bulk import supplier from Excel
export const importSupplierFromExcel = [
  upload.single("file"),
  asyncErrorHandler(async (req, res, next) => {
    if (!req.file) {
      return next(new CustomError(400, "Please upload an Excel file"));
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    if (rows.length === 0) {
      return next(new CustomError(400, "Excel file is empty"));
    }

    const results = {
      total: rows.length,
      success: 0,
      failed: 0,
      errors: [],
      created: [],
    };

    // Track supplierNames in this batch to avoid batch-level duplicates
    const batchNames = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      try {
        const supplierName =
          row.Name || row.name || row.supplierName || row["Supplier Name"];
        if (!supplierName || !String(supplierName).trim()) {
          throw new Error("Supplier name (Name) is required");
        }

        const trimmedName = String(supplierName).trim();

        // Check batch-level duplicate
        if (batchNames.has(trimmedName.toLowerCase())) {
          results.failed++;
          results.errors.push({
            row: rowNum,
            message: `Duplicate supplier name '${trimmedName}' in same batch`,
          });
          continue;
        }
        batchNames.add(trimmedName.toLowerCase());

        // Check DB-level duplicate (exclude soft-deleted)
        const existing = await SupplierProfile.findOne({
          supplierName: trimmedName,
          isDeleted: false,
        });
        if (existing) {
          results.failed++;
          results.errors.push({
            row: rowNum,
            message: `Supplier name '${trimmedName}' already exists`,
          });
          continue;
        }

        // Parse boolean/string fields
        const isCredit = normalizeBoolean(row.IsCredit, row.isCredit);
        const isConsign = normalizeBoolean(row.IsConsign, row.isConsign);
        const dueInDaysRaw = row.DueInDays || row.dueInDays || row.due_in_days;
        const dueInDays = dueInDaysRaw ? Number(dueInDaysRaw) : null;

        const supplierData = {
          supplierName: trimmedName,
          shortDesc: row.ShortDesc || row.shortDesc || row.short_desc || null,
          companyName:
            row.CompanyName || row.companyName || row.company_name || null,
          contactNumber: row.Phone || row.phone || row.contactNumber || null,
          email: row.Email || row.email || null,
          address: row.Address || row.address || null,
          township: row.Township || row.township || null,
          isCredit: isCredit,
          dueInDays: dueInDays && !isNaN(dueInDays) && dueInDays >= 0 ? dueInDays : null,
          isConsign: isConsign,
        };

        const newSupplier = await SupplierProfile.create(supplierData);
        results.success++;
        results.created.push({
          row: rowNum,
          id: newSupplier._id,
          supplierName: newSupplier.supplierName,
        });
      } catch (error) {
        results.failed++;
        results.errors.push({
          row: rowNum,
          message: error.message,
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Import completed: ${results.success} created, ${results.failed} failed out of ${results.total}`,
      data: results,
    });
  }),
];

// Get all unique townships from suppliers
export const getAllTownships = asyncErrorHandler(async (req, res, next) => {
  const townships = await SupplierProfile.distinct("township");

  res.status(200).json({
    success: true,
    message: "Townships retrieved successfully",
    data: townships.filter(Boolean), // Remove any null or undefined values
  });
});

// Helper: normalize boolean values from various formats
function normalizeBoolean(...values) {
  for (const val of values) {
    if (val === undefined || val === null) continue;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const lower = val.trim().toLowerCase();
      if (["true", "yes", "1", "y"].includes(lower)) return true;
      if (["false", "no", "0", "n", ""].includes(lower)) return false;
    }
    if (typeof val === "number") return val !== 0;
  }
  return false;
}

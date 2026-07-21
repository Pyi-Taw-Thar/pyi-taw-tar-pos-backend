/**
 * Import suppliers from supplier_list.xlsx into MongoDB
 *
 * Usage: node scripts/import-suppliers.js
 *
 * Make sure supplier_list.xlsx is in the project root directory
 * and .env file has MONGODB_URI configured.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import XLSX from "xlsx";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: "./.env" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supplier schema (inline — matches the model)
const supplierProfileSchema = new mongoose.Schema(
  {
    supplierName: { type: String, required: true, trim: true },
    shortDesc: { type: String, trim: true, default: null },
    companyName: { type: String, trim: true, default: null },
    contactNumber: { type: String, trim: true, default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    address: { type: String, trim: true, default: null },
    township: { type: String, trim: true, default: null },
    isCredit: { type: Boolean, default: false },
    dueInDays: { type: Number, min: 0, default: null },
    isConsign: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const SupplierProfile = mongoose.model("SupplierProfile", supplierProfileSchema);

// Normalize boolean helper
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

async function importSuppliers() {
  try {
    // Connect to MongoDB
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI, { maxPoolSize: 10 });
    console.log(`✓ Connected: ${mongoose.connection.host}\n`);

    // Resolve Excel file path
    const projectRoot = path.resolve(__dirname, "..");
    const excelPath = path.join(projectRoot, "supplier_list.xlsx");

    console.log(`Reading: ${excelPath}`);
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    console.log(`Found ${rows.length} rows in Excel\n`);

    // Prepare batch tracking
    const batchNames = new Set();
    const results = {
      total: rows.length,
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const supplierName =
        row.Name || row.name || row.supplierName || row["Supplier Name"];

      if (!supplierName || !String(supplierName).trim()) {
        results.skipped++;
        continue;
      }

      const trimmedName = String(supplierName).trim();

      // Check batch-level duplicate
      if (batchNames.has(trimmedName.toLowerCase())) {
        results.failed++;
        results.errors.push({ row: rowNum, name: trimmedName, message: "Duplicate in same batch" });
        continue;
      }
      batchNames.add(trimmedName.toLowerCase());

      // Check DB-level duplicate
      const existing = await SupplierProfile.findOne({
        supplierName: trimmedName,
        isDeleted: false,
      });
      if (existing) {
        results.skipped++;
        continue;
      }

      try {
        const isCredit = normalizeBoolean(row.IsCredit, row.isCredit);
        const isConsign = normalizeBoolean(row.IsConsign, row.isConsign);
        const dueInDaysRaw = row.DueInDays || row.dueInDays || row.due_in_days;
        const dueInDays = dueInDaysRaw ? Number(dueInDaysRaw) : null;

        await SupplierProfile.create({
          supplierName: trimmedName,
          shortDesc: row.ShortDesc || row.shortDesc || row.short_desc || null,
          companyName: row.CompanyName || row.companyName || row.company_name || null,
          contactNumber: row.Phone || row.phone || row.contactNumber || null,
          email: row.Email || row.email || null,
          address: row.Address || row.address || null,
          township: row.Township || row.township || null,
          isCredit: isCredit,
          dueInDays: dueInDays && !isNaN(dueInDays) && dueInDays >= 0 ? dueInDays : null,
          isConsign: isConsign,
        });

        results.success++;
        process.stdout.write(`\r  ✓ ${results.success}/${results.total} — ${trimmedName.slice(0, 30)}`);
      } catch (err) {
        results.failed++;
        results.errors.push({ row: rowNum, name: trimmedName, message: err.message });
      }
    }

    console.log("\n");
    console.log("═══════════════════════════════════");
    console.log("        IMPORT COMPLETE");
    console.log("═══════════════════════════════════");
    console.log(`  Total rows:    ${results.total}`);
    console.log(`  ✓ Created:     ${results.success}`);
    console.log(`  ○ Skipped:     ${results.skipped}`);
    console.log(`  ✗ Failed:      ${results.failed}`);

    if (results.errors.length > 0) {
      console.log("\n  Errors:");
      results.errors.forEach((e) => {
        console.log(`    Row ${e.row}: ${e.name || "?"} — ${e.message}`);
      });
    }

    console.log("\nDone!");
  } catch (error) {
    console.error("\nFatal error:", error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("Disconnected from MongoDB");
  }
}

importSuppliers();

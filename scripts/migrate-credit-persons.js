/**
 * Migration Script: Merge CreditPerson records into Customer collection
 *
 * Usage: node scripts/migrate-credit-persons.js
 *
 * This script:
 * 1. Reads all existing CreditPerson records
 * 2. For each one, finds a matching Customer by phone
 * 3. Merges credit fields into the Customer document
 * 4. Creates new Customer records for CreditPersons without a matching Customer
 * 5. Reports summary of what was done
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

// We need to define schemas inline since we're reading the old CreditPerson model
// and writing to the new Customer model (with credit fields)

const creditPersonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String },
    blacklist: { type: Boolean, default: false },
    blacklistReason: { type: String, default: null },
    blacklistDate: { type: Date, default: null },
  },
  { timestamps: true }
);

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },
    addresses: [{ label: String, addressLine: String, city: String, isDefault: Boolean }],
    isActive: { type: Boolean, default: true },
    tier: { type: String, default: "standard" },

    // Credit Person fields (merged)
    isCreditPerson: { type: Boolean, default: false },
    blacklist: { type: Boolean, default: false },
    blacklistReason: { type: String, default: null },
    blacklistDate: { type: Date, default: null },
  },
  { timestamps: true }
);

const CreditPerson = mongoose.model("CreditPerson", creditPersonSchema, "creditpersons");
const Customer = mongoose.model("Customer", customerSchema, "customers");

async function migrate() {
  try {
    // Connect to database
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error("❌ MONGODB_URI not found in .env file");
      process.exit(1);
    }

    await mongoose.connect(uri, { maxPoolSize: 10 });
    console.log("✅ Connected to database\n");

    // Check if CreditPerson collection exists
    const collections = await mongoose.connection.db.listCollections().toArray();
    const hasCreditPersonCollection = collections.some(
      (c) => c.name === "creditpersons"
    );

    if (!hasCreditPersonCollection) {
      console.log("ℹ️  CreditPerson collection does not exist. Nothing to migrate.");
      await mongoose.disconnect();
      process.exit(0);
    }

    // Fetch all CreditPerson records
    const creditPersons = await CreditPerson.find({}).lean();
    console.log(`📊 Found ${creditPersons.length} CreditPerson records\n`);

    if (creditPersons.length === 0) {
      console.log("ℹ️  No CreditPerson records to migrate.");
      await mongoose.disconnect();
      process.exit(0);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = [];

    for (const cp of creditPersons) {
      try {
        const phone = cp.phone || "";

        if (!phone) {
          console.log(`  ⚠️  Skipping CreditPerson "${cp.name}" — no phone number`);
          skipped++;
          continue;
        }

        // Try to find existing Customer by phone
        const existingCustomer = await Customer.findOne({ phone });

        if (existingCustomer) {
          // Customer exists — update credit fields
          await Customer.findByIdAndUpdate(existingCustomer._id, {
            isCreditPerson: true,
            blacklist: cp.blacklist || false,
            blacklistReason: cp.blacklistReason || null,
            blacklistDate: cp.blacklistDate || null,
          });
          console.log(`  ✓ Updated "${cp.name}" (phone: ${phone}) — existing customer`);
          updated++;
        } else {
          // Customer doesn't exist — create new one with random password
          await Customer.create({
            name: cp.name,
            phone: phone,
            password: Math.random().toString(36).slice(2, 10),
            isCreditPerson: true,
            blacklist: cp.blacklist || false,
            blacklistReason: cp.blacklistReason || null,
            blacklistDate: cp.blacklistDate || null,
          });
          console.log(`  ✓ Created "${cp.name}" (phone: ${phone}) — new customer`);
          created++;
        }
      } catch (err) {
        console.error(`  ✗ Error processing "${cp.name}": ${err.message}`);
        errors.push({ name: cp.name, phone: cp.phone, error: err.message });
      }
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("📋 Migration Summary");
    console.log("=".repeat(50));
    console.log(`  Total CreditPerson records: ${creditPersons.length}`);
    console.log(`  Customers updated:           ${updated}`);
    console.log(`  Customers created:           ${created}`);
    console.log(`  Skipped:                     ${skipped}`);
    console.log(`  Errors:                      ${errors.length}`);
    console.log("=".repeat(50));

    if (errors.length > 0) {
      console.log("\n❌ Errors:");
      errors.forEach((e) => console.log(`  - ${e.name} (${e.phone}): ${e.error}`));
    }

    console.log("\n✅ Migration complete!\n");
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from database");
    process.exit(0);
  }
}

migrate();

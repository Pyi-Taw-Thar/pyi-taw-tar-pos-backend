import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import mongoose from "mongoose";
import Db from "../configs/db.config.js";
import BatchStock from "../models/batchStock.model.js";
import WarehouseStock from "../models/warehouse.model.js";
import StorefrontInventory from "../models/storefrontInventory.model.js";

async function runMigration() {
  console.log("=== Starting Initial BatchStock Migration ===");
  try {
    await Db();
    console.log("Connected to MongoDB.");

    let whCount = 0;
    let sfCount = 0;
    let barcodeOffset = 0;

    // 1. Migrate WarehouseStock
    const whStocks = await WarehouseStock.find({ quantity: { $gt: 0 } });
    console.log(`Found ${whStocks.length} WarehouseStock records with quantity > 0.`);

    for (const ws of whStocks) {
      const existing = await BatchStock.findOne({
        inventoryId: ws.inventoryId,
        locationId: ws.warehouseId,
      });

      if (!existing) {
        const barcode = await BatchStock.generateNextBatchBarcode(null, barcodeOffset);
        barcodeOffset++;

        await BatchStock.create({
          inventoryId: ws.inventoryId,
          locationType: "warehouse",
          locationId: ws.warehouseId,
          batchNumber: "INITIAL-STOCK",
          batchBarcode: barcode,
          expiryDate: null,
          manufacturingDate: null,
          quantity: ws.quantity,
          status: "active",
        });
        whCount++;
      }
    }

    // 2. Migrate StorefrontInventory
    const sfStocks = await StorefrontInventory.find({ quantity: { $gt: 0 } });
    console.log(`Found ${sfStocks.length} StorefrontInventory records with quantity > 0.`);

    for (const ss of sfStocks) {
      const existing = await BatchStock.findOne({
        inventoryId: ss.inventoryId,
        locationId: ss.storefrontId,
      });

      if (!existing) {
        const barcode = await BatchStock.generateNextBatchBarcode(null, barcodeOffset);
        barcodeOffset++;

        await BatchStock.create({
          inventoryId: ss.inventoryId,
          locationType: "storefront",
          locationId: ss.storefrontId,
          batchNumber: "INITIAL-STOCK",
          batchBarcode: barcode,
          expiryDate: null,
          manufacturingDate: null,
          quantity: ss.quantity,
          status: "active",
        });
        sfCount++;
      }
    }

    console.log("=== Migration Completed Successfully ===");
    console.log(`Created ${whCount} Warehouse BatchStock records.`);
    console.log(`Created ${sfCount} Storefront BatchStock records.`);
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
    process.exit(0);
  }
}

runMigration();

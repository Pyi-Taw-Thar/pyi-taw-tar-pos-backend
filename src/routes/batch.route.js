import express from "express";
import {
  scanBatchBarcode,
  getBatchesByProduct,
  getExpiringBatches,
  getExpiredBatches,
  adjustBatchStock,
  getAllBatches,
} from "../controllers/batch.controller.js";
import {
  protect,
  permissionGranted,
} from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Barcode Scanning for POS / Fulfillment
router.get(
  "/batches/scan/:batchBarcode",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  scanBatchBarcode
);

// Batches by product
router.get(
  "/batches/by-product/:inventoryId",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getBatchesByProduct
);

// Expiring soon batches
router.get(
  "/batches/expiring",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getExpiringBatches
);

// Expired batches
router.get(
  "/batches/expired",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getExpiredBatches
);

// Adjust batch stock
router.post(
  "/batches/adjust",
  protect,
  permissionGranted("owner", "admin"),
  adjustBatchStock
);

// Get all batches
router.get(
  "/batches",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getAllBatches
);

export default router;

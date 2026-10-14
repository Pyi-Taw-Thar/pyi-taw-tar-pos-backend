import express from "express";
import {
  getPendingFulfillmentOrders,
  fulfillOrder,
} from "../controllers/fulfillment.controller.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Get all pending orders awaiting fulfillment
router.get(
  "/fulfillment/pending",
  protect,
  permissionGranted("owner", "admin", "cashier", "staff"),
  getPendingFulfillmentOrders
);

// Fulfill and complete order with scanned batches
router.post(
  "/fulfillment/:orderId",
  protect,
  permissionGranted("owner", "admin", "cashier", "staff"),
  fulfillOrder
);

export default router;

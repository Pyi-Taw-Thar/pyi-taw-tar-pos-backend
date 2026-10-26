import express from "express";
import {
  getPendingFulfillmentOrders,
  fulfillOrder,
  savePartialFulfillment,
} from "../controllers/fulfillment.controller.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Get all pending and partially fulfilled orders awaiting fulfillment
router.get(
  "/fulfillment/pending",
  protect,
  permissionGranted("owner", "admin", "cashier", "staff"),
  getPendingFulfillmentOrders
);

// Save partial fulfillment progress with scanned batches
router.post(
  "/fulfillment/:orderId/partial",
  protect,
  permissionGranted("owner", "admin", "cashier", "staff"),
  savePartialFulfillment
);

// Fulfill and complete order with scanned batches
router.post(
  "/fulfillment/:orderId",
  protect,
  permissionGranted("owner", "admin", "cashier", "staff"),
  fulfillOrder
);

export default router;

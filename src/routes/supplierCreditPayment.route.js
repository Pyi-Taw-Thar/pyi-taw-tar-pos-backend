import express from "express";
import {
  createSupplierCreditPayment,
  getAllSupplierCreditPayments,
  getCreditPaymentsByPurchaseId,
  getCreditPaymentsBySupplierId,
  deleteSupplierCreditPayment,
} from "../controllers/supplierCreditPayment.controller.js";
import {
  protect,
  permissionGranted,
} from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

// Create supplier credit payment
router.post(
  "/supplier-credit-payment",
  protect,
  permissionGranted("owner", "admin"),
  createSupplierCreditPayment,
);

// Get all supplier credit payments (with optional filtering)
router.get(
  "/supplier-credit-payment",
  protect,
  permissionGranted("owner", "admin"),
  getAllSupplierCreditPayments,
);

// Get all credit payments for a specific PO
router.get(
  "/purchase/:purchaseId/credit-payments",
  protect,
  permissionGranted("owner", "admin"),
  getCreditPaymentsByPurchaseId,
);

// Get all credit payments for a specific supplier
router.get(
  "/supplier-profile/:supplierId/credit-payments",
  protect,
  permissionGranted("owner", "admin"),
  getCreditPaymentsBySupplierId,
);

// Delete supplier credit payment
router.delete(
  "/supplier-credit-payment/:id",
  protect,
  permissionGranted("owner"),
  deleteSupplierCreditPayment,
);

export default router;

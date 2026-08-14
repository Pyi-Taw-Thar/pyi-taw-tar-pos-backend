import express from "express";
import multer from "multer";
import {
  register,
  login,
  getMe,
  updateMe,
  getAllCustomers,
  getAllTownships,
  updateCustomerByAdmin,
  toggleCreditPersonStatus,
  updateCreditPersonBlacklist,
  getCreditPersonCustomers,
  importCustomersFromExcel,
} from "../controllers/customer.controller.js";
import { customerProtect } from "../middlewares/customerAuth.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Customer auth & profile
router.post("/customer/register", register);
router.post("/customer/login", login);
router.get("/customer/me", customerProtect, getMe);
router.patch("/customer/me", customerProtect, updateMe);
router.get("/customer", protect, permissionGranted("owner", "admin"), getAllCustomers);
router.get("/customer/townships", protect, permissionGranted("owner", "admin"), getAllTownships);
router.patch("/customer/:id", protect, permissionGranted("owner", "admin"), updateCustomerByAdmin);

// Credit person management (for POS / dashboard admin)
router.patch(
  "/customer/:id/toggle-credit",
  protect,
  permissionGranted("owner", "admin"),
  toggleCreditPersonStatus
);
router.patch(
  "/customer/:id/blacklist",
  protect,
  permissionGranted("owner", "admin"),
  updateCreditPersonBlacklist
);
router.get(
  "/customer/credit-persons",
  protect,
  permissionGranted("owner", "admin", "cashier"),
  getCreditPersonCustomers
);

// Excel import (admin only)
router.post(
  "/customer/import-excel",
  protect,
  permissionGranted("owner", "admin"),
  upload.single("file"),
  importCustomersFromExcel
);

export default router;

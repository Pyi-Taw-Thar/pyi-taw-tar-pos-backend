import express from "express";
import multer from "multer";
import {
  register,
  login,
  getMe,
  getMyCredit,
  updateMe,
  getAllCustomers,
  getAllTownships,
  updateCustomerByAdmin,
  toggleCreditPersonStatus,
  updateCreditPersonBlacklist,
  getCreditPersonCustomers,
  importCustomersFromExcel,
  getCustomerSummary,
  getCustomerOrders,
  getCustomerProducts,
  payCustomerCredit,
} from "../controllers/customer.controller.js";
import {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../controllers/customerNotification.controller.js";
import { customerProtect } from "../middlewares/customerAuth.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";
import validate from "../middlewares/validate.middleware.js";
import { authLimiter } from "../middlewares/rateLimiter.middleware.js";
import {
  customerRegisterSchema,
  customerLoginSchema,
  updateMeSchema,
} from "../validations/customer.validation.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Customer auth & profile (/customer/me/credit ကို /customer/:id/... မတိုင်မီ ထားရှိရမည်)
router.post("/customer/register", authLimiter, validate(customerRegisterSchema), register);
router.post("/customer/login", authLimiter, validate(customerLoginSchema), login);
router.get("/customer/me", customerProtect, getMe);
router.get("/customer/me/credit", customerProtect, getMyCredit);
router.patch("/customer/me", customerProtect, validate(updateMeSchema), updateMe);

// Customer notifications
router.get("/customer/notifications", customerProtect, getMyNotifications);
router.patch("/customer/notifications/read-all", customerProtect, markAllNotificationsAsRead);
router.patch("/customer/notifications/:id/read", customerProtect, markNotificationAsRead);

router.get("/customer", protect, permissionGranted("owner", "admin"), getAllCustomers);
router.get("/customer/townships", protect, permissionGranted("owner", "admin"), getAllTownships);
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

// Customer detail unified endpoints (summary / orders / products / pay-credit)
router.get("/customer/:id/summary", protect, permissionGranted("owner", "admin"), getCustomerSummary);
router.get("/customer/:id/orders", protect, permissionGranted("owner", "admin"), getCustomerOrders);
router.get("/customer/:id/products", protect, permissionGranted("owner", "admin"), getCustomerProducts);
router.post("/customer/:id/pay-credit", protect, permissionGranted("owner", "admin", "cashier"), payCustomerCredit);
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

export default router;

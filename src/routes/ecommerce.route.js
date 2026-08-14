import express from "express";
import {
  getBrands,
  getSubCategories,
  getCategories,
  getProducts,
  createOrder,
  getMyOrders,
  getMyOrderById,
  getAllEcommerceOrders,
  getEcommerceOrderById,
  updateEcommerceOrderStatus,
  updateEcommerceOrderProducts,
  resetPurchaseLimit,
  resetAllPurchaseLimits,
  getPurchaseUsage,
} from "../controllers/ecommerce.controller.js";
import { customerProtect } from "../middlewares/customerAuth.js";
import { protect, permissionGranted } from "../controllers/administrationPolicy.controller.js";

const router = express.Router();

router.get("/ecommerce/products/brands", getBrands);
router.get("/ecommerce/products/subcategories", getSubCategories);
router.get("/ecommerce/products/categories", getCategories);
router.get("/ecommerce/products", getProducts);
router.post("/ecommerce/order", customerProtect, createOrder);
router.get("/ecommerce/orders", customerProtect, getMyOrders);
router.get("/ecommerce/orders/:id", customerProtect, getMyOrderById);

router.get("/ecommerce/admin/orders", protect, permissionGranted("owner", "admin"), getAllEcommerceOrders);
router.get("/ecommerce/admin/orders/:id", protect, permissionGranted("owner", "admin"), getEcommerceOrderById);
router.patch("/ecommerce/admin/orders/:id/status", protect, permissionGranted("owner", "admin"), updateEcommerceOrderStatus);
router.patch("/ecommerce/admin/orders/:id/products", protect, permissionGranted("owner", "admin"), updateEcommerceOrderProducts);

router.post("/ecommerce/admin/reset-purchase-limit", protect, permissionGranted("owner", "admin"), resetPurchaseLimit);
router.post("/ecommerce/admin/reset-all-purchase-limits", protect, permissionGranted("owner", "admin"), resetAllPurchaseLimits);
router.get("/ecommerce/admin/purchase-usage/:customerId/:inventoryId", protect, permissionGranted("owner", "admin"), getPurchaseUsage);

export default router;

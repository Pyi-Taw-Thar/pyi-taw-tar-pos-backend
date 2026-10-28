import express from "express";
import {
  signup,
  login,
  logout,
  updatePassword,
  userSoftDelete,
  getAllAccounts,
  getAccountById,
  updateUser,
  userRestore,
  userDelete,
} from "../controllers/admin.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
import validate from "../middlewares/validate.middleware.js";
import { authLimiter } from "../middlewares/rateLimiter.middleware.js";
import {
  adminSignupSchema,
  adminLoginSchema,
  updatePasswordSchema,
} from "../validations/admin.validation.js";

const router = express.Router();

router.post(
  "/admin/signup",
  protect,
  permissionGranted("owner", "admin"),
  validate(adminSignupSchema),
  signup
);
router.post("/admin/login", authLimiter, validate(adminLoginSchema), login);
router.post("/admin/logout", protect, logout);
router.get(
  "/admin",
  protect,
  permissionGranted("owner", "admin"),
  getAllAccounts
);
router.get(
  "/admin/:accountId",
  protect,
  permissionGranted("owner", "admin"),
  getAccountById
);
router.patch(
  "/admin/:accountId",
  protect,
  permissionGranted("owner"),
  updateUser
);
router.patch(
  "/admin/update-password/:accountId",
  protect,
  permissionGranted("owner"),
  validate(updatePasswordSchema),
  updatePassword
);
router.patch(
  "/admin/soft-delete/:accountId",
  protect,
  permissionGranted("owner"),
  userSoftDelete
);
router.patch(
  "/admin/restore/:accountId",
  protect,
  permissionGranted("owner"),
  userRestore
);
router.delete(
  "/admin/:accountId",
  protect,
  permissionGranted("owner"),
  userDelete
);

export default router;

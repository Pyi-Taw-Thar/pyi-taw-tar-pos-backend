import express from "express";
import {
  createSupplierProfile,
  getAllSupplierProfiles,
  getSupplierProfileById,
  updateSupplierProfile,
  softDeleteSupplierProfile,
  restoreSupplierProfile,
  deleteSupplierProfile,
  importSupplierFromExcel,
  getAllTownships,
} from "../controllers/supplier.controller.js";
import { protect } from "../controllers/administrationPolicy.controller.js";
import { permissionGranted } from "../controllers/administrationPolicy.controller.js";
const router = express.Router();

router.post(
  "/supplier-profile",
  protect,
  permissionGranted("owner", "admin"),
  createSupplierProfile
);
router.get(
  "/supplier-profile",
  protect,
  permissionGranted("owner", "admin"),
  getAllSupplierProfiles
);
// Get all unique townships (MUST be before :id route)
router.get(
  "/supplier-profile/townships",
  protect,
  permissionGranted("owner", "admin"),
  getAllTownships
);
router.get(
  "/supplier-profile/:id",
  protect,
  permissionGranted("owner", "admin"),
  getSupplierProfileById
);
router.patch(
  "/supplier-profile/:id",
  protect,
  permissionGranted("owner"),
  updateSupplierProfile
);
router.patch(
  "/supplier-profile/:id/soft-delete",
  protect,
  permissionGranted("owner"),
  softDeleteSupplierProfile
);
router.patch(
  "/supplier-profile/:id/restore",
  protect,
  permissionGranted("owner"),
  restoreSupplierProfile
);
// Bulk import supplier from Excel
router.post(
  "/supplier-profile/import-excel",
  protect,
  permissionGranted("owner", "admin"),
  importSupplierFromExcel,
);

router.delete(
  "/supplier-profile/:id",
  protect,
  permissionGranted("owner"),
  deleteSupplierProfile
);
export default router;

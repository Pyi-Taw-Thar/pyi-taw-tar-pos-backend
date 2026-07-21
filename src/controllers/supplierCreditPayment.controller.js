import mongoose from "mongoose";
import SupplierCreditPayment from "../models/supplierCreditPayment.model.js";
import Purchasing from "../models/purchasing.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import { createDateFilter } from "../utils/dateFilter.utils.js";
import { logActivity } from "../services/activityLog.service.js";

// Create supplier credit payment (record payment against a PO)
export const createSupplierCreditPayment = asyncErrorHandler(
  async (req, res, next) => {
    const { purchaseId, paidAmount, paymentDate, paymentMethod, notes } =
      req.body;
    const addedBy = req.user._id;

    // Validate required fields
    if (!purchaseId) {
      return next(new CustomError(400, "Purchase order ID is required"));
    }

    if (!mongoose.Types.ObjectId.isValid(purchaseId)) {
      return next(new CustomError(400, "Invalid purchase order ID format"));
    }

    if (!paidAmount && paidAmount !== 0) {
      return next(new CustomError(400, "Paid amount is required"));
    }

    if (paidAmount <= 0) {
      return next(new CustomError(400, "Paid amount must be greater than zero"));
    }

    // Start MongoDB session for transaction
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // 1. Validate PO exists and is not deleted
        const purchase = await Purchasing.findById(purchaseId).session(session);

        if (!purchase) {
          throw new CustomError(404, "Purchase order not found");
        }

        if (purchase.isDeleted) {
          throw new CustomError(
            400,
            "Cannot add payment to a deleted purchase order",
          );
        }

        // 2. Calculate current remaining balance
        const totalPaidSoFar = purchase.paidAmount || 0;
        const currentRemainingBalance = Math.max(
          0,
          purchase.totalAmount - totalPaidSoFar,
        );

        // 3. Validate payment doesn't exceed remaining balance
        if (paidAmount > currentRemainingBalance) {
          throw new CustomError(
            400,
            `Payment amount (${paidAmount}) exceeds remaining balance (${currentRemainingBalance}). Maximum payment allowed: ${currentRemainingBalance}`,
          );
        }

        // 4. Create credit payment record
        const paymentData = {
          purchaseId: new mongoose.Types.ObjectId(purchaseId),
          supplierId: purchase.supplierId,
          paidAmount,
          paymentDate: paymentDate || new Date(),
          paymentMethod: paymentMethod || "cash",
          notes: notes || null,
          addedBy,
        };

        const [paymentRecord] = await SupplierCreditPayment.create(
          [paymentData],
          { session },
        );

        // 5. Update PO's paidAmount
        purchase.paidAmount = (purchase.paidAmount || 0) + paidAmount;
        await purchase.save({ session });

        // 6. Populate for response
        await paymentRecord.populate(
          "purchaseId",
          "poNumber totalAmount paidAmount",
        );
        await paymentRecord.populate("supplierId", "supplierName");

        // 7. Send response
        const newRemainingBalance = Math.max(
          0,
          purchase.totalAmount - purchase.paidAmount,
        );

        logActivity({
          admin: addedBy,
          action: "create_payment",
          feature: "supplier_credit",
          description: `Supplier credit payment ${paidAmount} MMK recorded for PO ${purchase.poNumber}`,
          targetId: paymentRecord._id,
          targetModel: "SupplierCreditPayment",
          metadata: {
            purchaseId: purchase._id,
            poNumber: purchase.poNumber,
            paidAmount,
          },
          ip: req.ip,
        });

        res.status(201).json({
          success: true,
          message: "Supplier credit payment recorded successfully",
          data: {
            payment: paymentRecord,
            purchase: {
              poNumber: purchase.poNumber,
              totalAmount: purchase.totalAmount,
              previousPaidAmount: totalPaidSoFar,
              paymentAmount: paidAmount,
              newPaidAmount: purchase.paidAmount,
              newRemainingBalance,
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof CustomError) {
        return next(error);
      }

      if (error.name === "ValidationError") {
        const errors = Object.values(error.errors).map((val) => val.message);
        return next(
          new CustomError(400, `Validation error: ${errors.join(". ")}`),
        );
      }

      console.error("Supplier credit payment creation error:", error);
      return next(
        new CustomError(
          500,
          `Failed to record supplier credit payment: ${error.message}`,
        ),
      );
    } finally {
      await session.endSession();
    }
  },
);

// Get all supplier credit payments (with filtering)
export const getAllSupplierCreditPayments = asyncErrorHandler(
  async (req, res, next) => {
    const { purchaseId, supplierId, paymentMethod, page, limit } = req.query;

    const query = { isDeleted: false };

    // Filter by purchaseId
    if (purchaseId) {
      if (!mongoose.Types.ObjectId.isValid(purchaseId)) {
        return next(new CustomError(400, "Invalid purchase order ID format"));
      }
      query.purchaseId = purchaseId;
    }

    // Filter by supplierId
    if (supplierId) {
      if (!mongoose.Types.ObjectId.isValid(supplierId)) {
        return next(new CustomError(400, "Invalid supplier ID format"));
      }
      query.supplierId = supplierId;
    }

    // Filter by paymentMethod
    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    // Add date range filter
    try {
      const dateFilter = createDateFilter(req.query, "paymentDate", false);
      Object.assign(query, dateFilter);
    } catch (error) {
      if (error instanceof CustomError) {
        return next(error);
      }
      return next(
        new CustomError(400, error.message || "Invalid date filter"),
      );
    }

    let paymentsQuery = SupplierCreditPayment.find(query)
      .populate("purchaseId", "poNumber totalAmount paidAmount")
      .populate("supplierId", "supplierName")
      .populate("addedBy", "name role")
      .sort({ paymentDate: -1 });

    let pagination = null;

    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const skip = (pageNum - 1) * limitNum;

      paymentsQuery = paymentsQuery.skip(skip).limit(limitNum);

      const total = await SupplierCreditPayment.countDocuments(query);
      pagination = {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      };
    }

    const payments = await paymentsQuery;

    const response = {
      success: true,
      message: "Supplier credit payments retrieved successfully",
      data: payments,
    };

    if (pagination) {
      response.pagination = pagination;
    }

    res.status(200).json(response);
  },
);

// Get all credit payments for a specific PO
export const getCreditPaymentsByPurchaseId = asyncErrorHandler(
  async (req, res, next) => {
    const { purchaseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(purchaseId)) {
      return next(new CustomError(400, "Invalid purchase order ID format"));
    }

    // Validate PO exists
    const purchase = await Purchasing.findById(purchaseId);
    if (!purchase) {
      return next(new CustomError(404, "Purchase order not found"));
    }

    // Get all payments for this PO
    const payments = await SupplierCreditPayment.find({
      purchaseId,
      isDeleted: false,
    })
      .populate("supplierId", "supplierName")
      .populate("addedBy", "name role")
      .sort({ paymentDate: -1 });

    // Calculate totals
    const totalPaid = payments.reduce(
      (sum, p) => sum + (p.paidAmount || 0),
      0,
    );
    const remainingBalance = Math.max(
      0,
      purchase.totalAmount - (purchase.paidAmount || 0),
    );

    res.status(200).json({
      success: true,
      message: "Supplier credit payments retrieved successfully",
      data: {
        purchase: {
          _id: purchase._id,
          poNumber: purchase.poNumber,
          totalAmount: purchase.totalAmount,
          paidAmount: purchase.paidAmount || 0,
          remainingBalance,
        },
        payments: {
          count: payments.length,
          records: payments,
          totalPaidFromRecords: totalPaid,
        },
      },
    });
  },
);

// Get all credit payments for a specific supplier
export const getCreditPaymentsBySupplierId = asyncErrorHandler(
  async (req, res, next) => {
    const { supplierId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(supplierId)) {
      return next(new CustomError(400, "Invalid supplier ID format"));
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get all payments for this supplier
    const query = { supplierId, isDeleted: false };

    const payments = await SupplierCreditPayment.find(query)
      .populate("purchaseId", "poNumber totalAmount paidAmount")
      .populate("addedBy", "name role")
      .sort({ paymentDate: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await SupplierCreditPayment.countDocuments(query);

    // Get all PO totals for this supplier
    const purchases = await Purchasing.find({
      supplierId,
      isDeleted: false,
    }).select("poNumber totalAmount paidAmount");

    const totalPOAmount = purchases.reduce(
      (sum, p) => sum + (p.totalAmount || 0),
      0,
    );
    const totalPaidOnPOs = purchases.reduce(
      (sum, p) => sum + (p.paidAmount || 0),
      0,
    );
    const totalOutstanding = Math.max(0, totalPOAmount - totalPaidOnPOs);

    res.status(200).json({
      success: true,
      message: "Supplier credit payments retrieved successfully",
      data: {
        supplierId,
        summary: {
          totalPOs: purchases.length,
          totalPOAmount,
          totalPaid: totalPaidOnPOs,
          totalOutstanding,
        },
        payments: {
          count: payments.length,
          records: payments,
        },
      },
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
      },
    });
  },
);

// Delete/hard delete a supplier credit payment
export const deleteSupplierCreditPayment = asyncErrorHandler(
  async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new CustomError(400, "Invalid payment record ID format"));
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        // Find the payment record
        const payment = await SupplierCreditPayment.findById(id).session(
          session,
        );

        if (!payment) {
          throw new CustomError(404, "Supplier credit payment not found");
        }

        if (payment.isDeleted) {
          throw new CustomError(400, "Payment record is already deleted");
        }

        // Get the associated PO to update its paidAmount
        const purchase = await Purchasing.findById(
          payment.purchaseId,
        ).session(session);

        if (!purchase) {
          throw new CustomError(
            404,
            "Associated purchase order not found",
          );
        }

        // Store for response
        const paymentAmount = payment.paidAmount || 0;
        const previousPaidAmount = purchase.paidAmount || 0;

        // Update PO paidAmount (subtract this payment)
        purchase.paidAmount = Math.max(
          0,
          previousPaidAmount - paymentAmount,
        );
        await purchase.save({ session });

        // Populate for response
        await payment.populate("purchaseId", "poNumber totalAmount paidAmount");
        await payment.populate("supplierId", "supplierName");

        // Hard delete the payment record
        await SupplierCreditPayment.findByIdAndDelete(id).session(session);

        logActivity({
          admin: req.user._id,
          action: "delete_payment",
          feature: "supplier_credit",
          description: `Deleted supplier credit payment ${paymentAmount} MMK for PO ${purchase.poNumber}`,
          targetId: payment._id,
          targetModel: "SupplierCreditPayment",
          metadata: {
            purchaseId: purchase._id,
            poNumber: purchase.poNumber,
            deletedAmount: paymentAmount,
          },
          ip: req.ip,
        });

        res.status(200).json({
          success: true,
          message: "Supplier credit payment deleted successfully",
          data: {
            deletedPayment: payment.toObject(),
            purchase: {
              poNumber: purchase.poNumber,
              previousPaidAmount,
              deletedAmount: paymentAmount,
              newPaidAmount: purchase.paidAmount,
              newRemainingBalance: Math.max(
                0,
                purchase.totalAmount - purchase.paidAmount,
              ),
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof CustomError) {
        return next(error);
      }

      console.error("Delete supplier credit payment error:", error);
      return next(
        new CustomError(
          500,
          `Failed to delete supplier credit payment: ${error.message}`,
        ),
      );
    } finally {
      await session.endSession();
    }
  },
);

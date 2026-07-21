import mongoose from "mongoose";

const supplierCreditPaymentSchema = new mongoose.Schema(
  {
    purchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Purchasing",
      required: [true, "Purchase order ID is required"],
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupplierProfile",
      required: [true, "Supplier ID is required"],
    },
    paidAmount: {
      type: Number,
      required: [true, "Paid amount is required"],
      min: [0, "Paid amount cannot be negative"],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      enum: {
        values: ["cash", "bank_transfer", "cheque", "mobile_payment", "other"],
        message: "Payment method must be one of: cash, bank_transfer, cheque, mobile_payment, other",
      },
      default: "cash",
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: [true, "Added by is required"],
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better query performance
supplierCreditPaymentSchema.index({ purchaseId: 1 });
supplierCreditPaymentSchema.index({ supplierId: 1 });
supplierCreditPaymentSchema.index({ paymentDate: -1 });
supplierCreditPaymentSchema.index({ purchaseId: 1, isDeleted: 1 });
supplierCreditPaymentSchema.index({ supplierId: 1, isDeleted: 1 });

const SupplierCreditPayment = mongoose.model(
  "SupplierCreditPayment",
  supplierCreditPaymentSchema,
);

export default SupplierCreditPayment;

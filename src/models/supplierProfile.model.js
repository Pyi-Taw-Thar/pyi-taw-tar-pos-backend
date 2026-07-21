import mongoose from "mongoose";

const supplierProfileSchema = new mongoose.Schema(
  {
    supplierName: {
      type: String,
      required: [true, "Supplier name is required"],
      trim: true,
    },
    shortDesc: {
      type: String,
      trim: true,
      default: null,
    },
    companyName: {
      type: String,
      trim: true,
      default: null,
    },
    contactNumber: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    township: {
      type: String,
      trim: true,
      default: null,
    },
    isCredit: {
      type: Boolean,
      default: false,
    },
    dueInDays: {
      type: Number,
      min: [0, "Due in days cannot be negative"],
      default: null,
    },
    isConsign: {
      type: Boolean,
      default: false,
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
supplierProfileSchema.index({ township: 1 });
supplierProfileSchema.index({ isCredit: 1 });
supplierProfileSchema.index({ isConsign: 1 });
supplierProfileSchema.index({ shortDesc: 1 });
supplierProfileSchema.index({ supplierName: "text", companyName: "text", township: "text" }); // Text search index

const SupplierProfile = mongoose.model(
  "SupplierProfile",
  supplierProfileSchema,
);

export default SupplierProfile;

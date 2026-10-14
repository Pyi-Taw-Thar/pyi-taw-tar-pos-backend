import mongoose from "mongoose";

const batchStockSchema = new mongoose.Schema(
  {
    inventoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Inventory",
      required: [true, "Inventory ID is required"],
      index: true,
    },
    locationType: {
      type: String,
      enum: {
        values: ["warehouse", "storefront"],
        message: "Location type must be either warehouse or storefront",
      },
      required: [true, "Location type is required"],
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LocationProfile",
      required: [true, "Location ID is required"],
      index: true,
    },
    batchNumber: {
      type: String,
      required: [true, "Batch number is required"],
      trim: true,
    },
    batchBarcode: {
      type: String,
      required: [true, "Batch barcode is required"],
      trim: true,
      index: true,
    },
    expiryDate: {
      type: Date,
      default: null,
      index: true,
    },
    manufacturingDate: {
      type: Date,
      default: null,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [0, "Quantity cannot be negative"],
      default: 0,
    },
    costPrice: {
      type: Number,
      default: 0,
      min: [0, "Cost price cannot be negative"],
    },
    status: {
      type: String,
      enum: {
        values: ["active", "expired", "depleted"],
        message: "Status must be active, expired, or depleted",
      },
      default: "active",
      index: true,
    },
    receivedDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound Unique Indexes
// 1. In a single location (warehouse or storefront), each batch barcode must be unique
batchStockSchema.index({ locationId: 1, batchBarcode: 1 }, { unique: true });

// 2. For a specific product at a specific location, each batch number must be unique
batchStockSchema.index({ inventoryId: 1, locationId: 1, batchNumber: 1 }, { unique: true });

// Performance queries
batchStockSchema.index({ inventoryId: 1, locationId: 1 });
batchStockSchema.index({ locationType: 1, locationId: 1, status: 1 });
batchStockSchema.index({ expiryDate: 1, status: 1 });

/**
 * Static method to generate next sequential batchBarcode (e.g. B000001)
 * Queries the highest existing batchBarcode starting with "B" and adds +1.
 * Supports passing a session and an offset for bulk generation.
 */
batchStockSchema.statics.generateNextBatchBarcode = async function (session = null, offset = 0) {
  const query = this.findOne({
    batchBarcode: /^B\d+$/,
  })
    .sort({ batchBarcode: -1 })
    .select("batchBarcode");

  if (session) {
    query.session(session);
  }

  const latest = await query.exec();

  let nextSeq = 1;
  if (latest && latest.batchBarcode) {
    const numPart = latest.batchBarcode.substring(1);
    const parsed = parseInt(numPart, 10);
    if (!isNaN(parsed)) {
      nextSeq = parsed + 1;
    }
  }

  nextSeq += offset;
  return `B${String(nextSeq).padStart(6, "0")}`;
};

const BatchStock = mongoose.model("BatchStock", batchStockSchema);

export default BatchStock;

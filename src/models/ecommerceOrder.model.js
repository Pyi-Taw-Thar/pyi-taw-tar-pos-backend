import mongoose from "mongoose";
import Counter from "./counter.model.js";

const productSchema = new mongoose.Schema({
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Inventory",
    required: [true, "Inventory ID is required"],
  },
  productName: { type: String, required: true },
  productCode: { type: String },
  unit: { type: String, default: null },
  quantity: {
    type: Number,
    required: [true, "Quantity is required"],
    min: [1, "Quantity must be at least 1"],
  },
  factor: {
    type: Number,
    default: 1,
    min: [0.001, "Factor must be greater than 0"],
  },
  baseQuantity: {
    type: Number,
    default: null,
    min: [0, "Base quantity cannot be negative"],
  },
  unitPrice: {
    type: Number,
    required: [true, "Unit price is required"],
    min: [0, "Unit price cannot be negative"],
  },
  subtotal: {
    type: Number,
    required: [true, "Subtotal is required"],
    min: [0, "Subtotal cannot be negative"],
  },
  originalQuantity: {
    type: Number,
    default: null,
  },
  batches: [
    {
      batchStockId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BatchStock",
      },
      batchNumber: {
        type: String,
        trim: true,
      },
      batchBarcode: {
        type: String,
        trim: true,
        default: null,
      },
      expiryDate: {
        type: Date,
        default: null,
      },
      quantity: {
        type: Number,
        default: 0,
      },
    },
  ],
});

const ecommerceOrderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    required: [true, "Customer ID is required"],
  },
  products: [productSchema],
  shippingAddress: {
    label: { type: String, trim: true },
    addressLine: { type: String, trim: true },
    city: { type: String, trim: true },
  },
  totalAmount: {
    type: Number,
    required: [true, "Total amount is required"],
    min: [0, "Total amount cannot be negative"],
  },
  status: {
    type: String,
    enum: ["pending", "confirmed", "shipped", "delivered", "cancelled"],
    default: "pending",
  },
  paymentMethod: {
    type: String,
    default: "cash_on_delivery",
  },
  paymentStatus: {
    type: String,
    enum: ["unpaid", "paid"],
    default: "unpaid",
  },
  note: {
    type: String,
    trim: true,
    default: null,
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  editedReason: {
    type: String,
    default: null,
  },
  editedAt: {
    type: Date,
    default: null,
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  fulfillmentOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    default: null,
  },
  isSentToFulfillment: {
    type: Boolean,
    default: false,
  },
  sentToFulfillmentAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

ecommerceOrderSchema.pre("save", async function () {
  if (this.isNew && !this.orderNumber) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const prefix = `ECO-${year}-${month}-${day}-`;
    const counterId = prefix.slice(0, -1);

    // ယနေ့အတွက် counter document မရှိသေးပါက ရှိပြီးသား အမြင့်ဆုံး orderNumber ကို ဖတ်၍ $max ဖြင့် စတင်သတ်မှတ်မည် (session မပါ)
    const existingCounter = await Counter.findById(counterId).session(null).lean();
    if (!existingCounter) {
      const lastOrder = await mongoose
        .model("EcommerceOrder")
        .findOne({ orderNumber: new RegExp(`^${prefix}`) })
        .sort({ orderNumber: -1 })
        .select("orderNumber")
        .session(null)
        .lean();

      let lastSeq = 0;
      if (lastOrder?.orderNumber) {
        const parts = lastOrder.orderNumber.split("-");
        if (parts.length === 5) {
          const parsed = parseInt(parts[4], 10);
          if (!Number.isNaN(parsed)) {
            lastSeq = parsed;
          }
        }
      }

      try {
        await Counter.updateOne(
          { _id: counterId },
          { $max: { seq: lastSeq } },
          { upsert: true }
        );
      } catch (err) {
        // တစ်ပြိုင်နက်တည်း upsert လုပ်မိ၍ E11000 ဖြစ်ပါက ရှိပြီးသား document ကို $max ဖြင့်သာ update လုပ်မည်
        if (err?.code === 11000) {
          await Counter.updateOne(
            { _id: counterId },
            { $max: { seq: lastSeq } }
          );
        } else {
          throw err;
        }
      }
    }

    // Transaction အပြင်ဘက်တွင် (session မပါဘဲ) atomic $inc ဖြင့် နံပါတ်အသစ် ရယူမည်
    const counter = await Counter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    this.orderNumber = `${prefix}${String(counter.seq).padStart(6, "0")}`;
  }
});

ecommerceOrderSchema.index({ customerId: 1, createdAt: -1 });
// Note: orderNumber index is automatically created by unique: true in schema
ecommerceOrderSchema.index({ customerId: 1, "products.inventoryId": 1, createdAt: -1 });

const EcommerceOrder = mongoose.model("EcommerceOrder", ecommerceOrderSchema);
export default EcommerceOrder;

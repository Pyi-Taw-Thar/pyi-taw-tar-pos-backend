import mongoose from "mongoose";

const creditRecordSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    // Ecommerce အော်ဒါ အကြွေးဆပ်မှုအတွက် တိုက်ရိုက်ချိတ်ဆက်သိမ်းသည့် field
    ecommerceOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EcommerceOrder",
      default: null,
    },
    creditPersonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    paidAmount: {
      type: Number,
      required: [true, "Paid amount is required"],
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      required: [true, "Payment date is required"],
    },
    paymentMethod: {
      type: String,
      default: "cash",
    },
    notes: {
      type: String,
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// orderId သို့မဟုတ် ecommerceOrderId တစ်ခုခု မဖြစ်မနေ ပါဝင်ရန် စစ်ဆေးခြင်း
creditRecordSchema.pre("validate", async function () {
  if (!this.orderId && !this.ecommerceOrderId) {
    this.invalidate(
      "orderId",
      "orderId သို့မဟုတ် ecommerceOrderId တစ်ခုခု မဖြစ်မနေ ပါဝင်ရပါမည်"
    );
  }
});

// Indexes for better query performance
creditRecordSchema.index({ orderId: 1 });
creditRecordSchema.index({ ecommerceOrderId: 1 });
creditRecordSchema.index({ creditPersonId: 1 }); // For querying by credit person
creditRecordSchema.index({ orderId: 1, isDeleted: 1 }); // Compound index for active records
creditRecordSchema.index({ creditPersonId: 1, isDeleted: 1 }); // Compound index for credit person queries
creditRecordSchema.index({ paymentDate: -1 }); // For sorting by payment date

const CreditRecord = mongoose.model("CreditRecord", creditRecordSchema);

export default CreditRecord;

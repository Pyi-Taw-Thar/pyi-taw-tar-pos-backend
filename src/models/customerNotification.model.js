import mongoose from "mongoose";

const customerNotificationSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EcommerceOrder",
      default: null,
    },
    orderNumber: {
      type: String,
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ["order_edited", "order_status", "system"],
      default: "order_edited",
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

customerNotificationSchema.index({ customerId: 1, isRead: 1, createdAt: -1 });

const CustomerNotification = mongoose.model(
  "CustomerNotification",
  customerNotificationSchema
);

export default CustomerNotification;

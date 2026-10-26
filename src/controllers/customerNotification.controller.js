import CustomerNotification from "../models/customerNotification.model.js";
import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";

/**
 * Get current customer's notifications
 */
export const getMyNotifications = asyncErrorHandler(async (req, res, next) => {
  const customerId = req.customer._id;
  const { page = 1, limit = 20 } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;
  const skip = (pageNum - 1) * limitNum;

  const [notifications, total, unreadCount] = await Promise.all([
    CustomerNotification.find({ customerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    CustomerNotification.countDocuments({ customerId }),
    CustomerNotification.countDocuments({ customerId, isRead: false }),
  ]);

  res.status(200).json({
    success: true,
    data: notifications,
    unreadCount,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      itemsPerPage: limitNum,
    },
  });
});

/**
 * Mark a single notification as read
 */
export const markNotificationAsRead = asyncErrorHandler(async (req, res, next) => {
  const customerId = req.customer._id;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid notification ID"));
  }

  const notification = await CustomerNotification.findOneAndUpdate(
    { _id: id, customerId },
    { isRead: true },
    { new: true }
  );

  if (!notification) {
    return next(new CustomError(404, "Notification not found"));
  }

  res.status(200).json({
    success: true,
    data: notification,
  });
});

/**
 * Mark all notifications as read for current customer
 */
export const markAllNotificationsAsRead = asyncErrorHandler(async (req, res, next) => {
  const customerId = req.customer._id;

  await CustomerNotification.updateMany(
    { customerId, isRead: false },
    { isRead: true }
  );

  res.status(200).json({
    success: true,
    message: "All notifications marked as read",
  });
});

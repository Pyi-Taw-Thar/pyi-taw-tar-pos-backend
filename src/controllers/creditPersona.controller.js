import Customer from "../models/customer.model.js";
import { asyncErrorHandler } from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import mongoose from "mongoose";

// Helper: map customer doc to credit person response shape
const toCreditPersonResponse = (customer) => ({
  _id: customer._id,
  name: customer.name,
  phone: customer.phone,
  township: customer.township,
  blacklist: customer.blacklist,
  blacklistReason: customer.blacklistReason,
  blacklistDate: customer.blacklistDate,
  createdAt: customer.createdAt,
  updatedAt: customer.updatedAt,
});

// Create new credit person (find existing customer or create new one)
export const createCreditPerson = asyncErrorHandler(async (req, res, next) => {
  const { name, phone } = req.body;

  if (!name || !phone) {
    return next(new CustomError(400, "Name and phone are required"));
  }

  // Try to find existing customer by phone
  let customer = await Customer.findOne({ phone });

  if (customer) {
    // Customer exists — mark as credit person
    customer.isCreditPerson = true;
    if (name) customer.name = name;
    await customer.save();
  } else {
    // Customer doesn't exist — create new one
    customer = await Customer.create({
      name,
      phone,
      isCreditPerson: true,
      // Generate a random password for credit-person-only customers
      password: Math.random().toString(36).slice(2, 10),
    });
  }

  res.status(201).json({
    success: true,
    message: "Credit person created successfully",
    data: toCreditPersonResponse(customer),
  });
});

// Get all credit persons (customers with isCreditPerson: true)
export const getAllCreditPersons = asyncErrorHandler(async (req, res, next) => {
  const creditPersons = await Customer.find({ isCreditPerson: true }).sort({
    createdAt: -1,
  });

  res.status(200).json({
    success: true,
    message: "Credit persons fetched successfully",
    data: creditPersons.map(toCreditPersonResponse),
  });
});

// Get single credit person by ID
export const getCreditPersonById = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const customer = await Customer.findOne({
    _id: id,
    isCreditPerson: true,
  });

  if (!customer) {
    return next(new CustomError(404, "Credit person not found"));
  }

  res.status(200).json({
    success: true,
    message: "Credit person fetched successfully",
    data: toCreditPersonResponse(customer),
  });
});

// Update credit person details
export const updateCreditPerson = asyncErrorHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, phone, blacklist, blacklistReason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new CustomError(400, "Invalid credit person ID format"));
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (blacklist !== undefined) {
    updateData.blacklist = blacklist;
    updateData.blacklistDate = blacklist ? new Date() : null;
    if (!blacklist) updateData.blacklistReason = null;
  }
  if (blacklistReason !== undefined && blacklist) {
    updateData.blacklistReason = blacklistReason;
  }

  const customer = await Customer.findByIdAndUpdate(id, updateData, {
    new: true,
  });

  if (!customer) {
    return next(new CustomError(404, "Credit person not found"));
  }

  res.status(200).json({
    success: true,
    message: "Credit person updated successfully",
    data: toCreditPersonResponse(customer),
  });
});

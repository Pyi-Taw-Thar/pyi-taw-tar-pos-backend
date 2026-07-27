import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { TIER_KEYS } from "../constants/customerTiers.js";

const addressSchema = new mongoose.Schema({
  label: { type: String, trim: true },
  addressLine: { type: String, trim: true },
  city: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
}, { _id: false });

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
  },
  phone: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: [6, "Password must be at least 6 characters"],
    select: false,
  },
  addresses: [addressSchema],
  isActive: {
    type: Boolean,
    default: true,
  },
  tier: {
    type: String,
    enum: {
      values: TIER_KEYS,
      message: "Tier must be one of: " + TIER_KEYS.join(", "),
    },
    default: "standard",
  },

  // Credit Person fields (merged from CreditPerson schema)
  isCreditPerson: {
    type: Boolean,
    default: false,
  },
  blacklist: {
    type: Boolean,
    default: false,
  },
  blacklistReason: {
    type: String,
    default: null,
  },
  blacklistDate: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

customerSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

customerSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const Customer = mongoose.model("Customer", customerSchema);
export default Customer;

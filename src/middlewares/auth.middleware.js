import asyncErrorHandler from "../utils/asyncErrorHandler.js";
import CustomError from "../utils/customError.js";
import jwt from "jsonwebtoken";
import util from "util";
import Admin from "../models/admin.model.js";

/**
 * Authentication middleware for staff & admin users
 */
export const protect = asyncErrorHandler(async (req, res, next) => {
  const testToken = req.headers.authorization;
  let token;
  if (testToken && testToken.startsWith("Bearer")) {
    token = testToken.split(" ")[1];
  }
  if (!token) {
    return next(
      new CustomError(401, "You are not logged in! Authentication required")
    );
  }

  const verifyAsync = util.promisify(jwt.verify);
  let decodedToken;
  try {
    decodedToken = await verifyAsync(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(
        new CustomError(401, "Your login session has expired. Please login again.")
      );
    }
    if (err.name === "JsonWebTokenError") {
      return next(new CustomError(401, "Invalid token. Please login again."));
    }
    return next(err);
  }

  const { id, role } = decodedToken || {};

  let user = null;
  if (
    role === "owner" ||
    role === "admin" ||
    role === "cashier" ||
    role === "kitchen" ||
    role === "bar-counter" ||
    role === "ktv-waiter" ||
    role === "restaurant-waiter"
  ) {
    user = await Admin.findById(id);
  }

  if (!user) {
    return next(new CustomError(401, "The account does not exist"));
  }

  if (user.softDeleted) {
    return next(new CustomError(401, "You can't access this resource."));
  }

  // normalize on req.user for downstream middlewares/controllers
  req.user = user;
  next();
});

/**
 * Authorization middleware for role-based access control
 */
export const permissionGranted = (...allowedRoles) => {
  return (req, res, next) => {
    const role = req.user?.role;

    if (!role) {
      return next(
        new CustomError(401, "Unauthorized. No role information available.")
      );
    }
    if (!allowedRoles.includes(role)) {
      return next(
        new CustomError(
          403,
          `Access denied. Role '${role}' is not authorized to access this resource.`
        )
      );
    }

    next();
  };
};

export default { protect, permissionGranted };

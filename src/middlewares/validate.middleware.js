import CustomError from "../utils/customError.js";

/**
 * Express middleware to validate request payload (body, query, params) against Zod schemas.
 * @param {Object} schema - Object containing Zod schemas for { body, query, params }
 */
export const validate = (schema) => {
  return (req, res, next) => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }
      if (schema.query) {
        req.query = schema.query.parse(req.query);
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params);
      }
      next();
    } catch (error) {
      if (error?.issues && Array.isArray(error.issues)) {
        const errorMessages = error.issues
          .map((issue) => `${issue.path.join(".") || "field"}: ${issue.message}`)
          .join("; ");
        return next(new CustomError(400, `Validation failed: ${errorMessages}`));
      }
      next(error);
    }
  };
};

export default validate;

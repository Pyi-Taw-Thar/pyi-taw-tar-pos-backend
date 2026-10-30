class CustomError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.success = statusCode >= 400 && statusCode < 500 ? false : true;
    this.details = details; // စနစ်တကျ structured error details (ဥပမာ code, inventoryId, productName)

    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default CustomError;

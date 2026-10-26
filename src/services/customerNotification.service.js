import CustomerNotification from "../models/customerNotification.model.js";
import logger from "../utils/logger.utils.js";

/**
 * Creates a customer notification in the database
 * @param {Object} params
 * @param {string|ObjectId} params.customerId
 * @param {string|ObjectId} [params.orderId]
 * @param {string} [params.orderNumber]
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.type='order_edited']
 * @param {Object} [params.metadata]
 * @param {ClientSession} [params.session]
 */
export const createAndSendCustomerNotification = async ({
  customerId,
  orderId = null,
  orderNumber = null,
  title,
  message,
  type = "order_edited",
  metadata = null,
  session = null,
}) => {
  try {
    const docData = {
      customerId,
      orderId,
      orderNumber,
      title,
      message,
      type,
      metadata,
    };

    let notification;
    if (session) {
      const created = await CustomerNotification.create([docData], { session });
      notification = created[0];
    } else {
      notification = await CustomerNotification.create(docData);
    }

    logger.info(`Customer notification created for customer ${customerId}: ${title}`);
    return notification;
  } catch (error) {
    logger.error("Failed to create customer notification:", error);
    // Do not throw so parent business transaction does not fail if notification error occurs
    return null;
  }
};

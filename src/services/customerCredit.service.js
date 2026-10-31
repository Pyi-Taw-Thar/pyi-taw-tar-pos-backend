import mongoose from "mongoose";
import EcommerceOrder from "../models/ecommerceOrder.model.js";
import Order from "../models/orders.model.js";
import CreditRecord from "../models/creditRecord.model.js";

/**
 * စုစုပေါင်းကျသင့်ငွေနှင့် ပေးချေပြီးငွေပေါ် မူတည်၍ paymentStatus သတ်မှတ်ပေးသည့် helper
 */
export const derivePaymentStatus = (totalAmount, paidAmount) => {
  const total = Number(totalAmount) || 0;
  const paid = Number(paidAmount) || 0;
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
};

/**
 * Customer တစ်ဦး၏ စုစုပေါင်းဝယ်ယူငွေ၊ အကြွေးလက်ကျန်၊ ယခုဆပ်နိုင်သောငွေနှင့် ဆပ်ပြီးငွေများကို တစ်နေရာတည်းမှ တွက်ချက်ပေးသည့် service
 * - Ecommerce အကြွေး = EcommerceOrder (status !== "cancelled", isDeleted: false) ၏ totalAmount - paidAmount
 * - POS အကြွေး = Order (ecommerceOrderId: null, paymentType: "credit", orderStatus !== "cancelled", isDeleted: false) ၏ finalAmount - paidAmount
 * - Fulfillment Order (ecommerceOrderId !== null) ကို အကြွေးနှင့် ဝယ်ယူငွေထဲ လုံးဝ ထည့်မတွက်ပါ (ငွေ ၂ ဆ မဖြစ်စေရန်)
 */
export const getCustomerCreditBalance = async (
  customerId,
  { excludeEcommerceOrderId = null, session = null } = {}
) => {
  if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
    return {
      totalPurchase: 0,
      creditRemaining: 0,
      payableRemaining: 0,
      creditPaid: 0,
      ecommerceRemaining: 0,
      posRemaining: 0,
    };
  }

  const custObjId = new mongoose.Types.ObjectId(customerId);

  const ecomFilter = {
    customerId: custObjId,
    isDeleted: false,
    status: { $ne: "cancelled" },
  };

  if (
    excludeEcommerceOrderId &&
    mongoose.Types.ObjectId.isValid(excludeEcommerceOrderId)
  ) {
    ecomFilter._id = {
      $ne: new mongoose.Types.ObjectId(excludeEcommerceOrderId),
    };
  }

  const posFilter = {
    ecommerceOrderId: null,
    isDeleted: false,
    orderStatus: { $ne: "cancelled" },
    $or: [{ customerId: custObjId }, { creditPersonId: custObjId }],
  };

  const creditRecordFilter = {
    creditPersonId: custObjId,
    isDeleted: false,
  };

  const [ecomOrders, posOrders, creditRecords] = await Promise.all([
    EcommerceOrder.find(ecomFilter)
      .select("totalAmount paidAmount status")
      .session(session || null)
      .lean(),
    Order.find(posFilter)
      .select("finalAmount paidAmount paymentType orderStatus")
      .session(session || null)
      .lean(),
    CreditRecord.find(creditRecordFilter)
      .select("paidAmount")
      .session(session || null)
      .lean(),
  ]);

  let ecomTotalPurchase = 0;
  let ecommerceRemaining = 0;
  let ecommercePayable = 0;

  for (const eo of ecomOrders) {
    const total = Number(eo.totalAmount) || 0;
    const paid = Number(eo.paidAmount) || 0;
    const rem = Math.max(0, total - paid);

    ecomTotalPurchase += total;
    ecommerceRemaining += rem;

    // ပစ္စည်းပို့ပြီး (shipped / delivered) ecommerce order များသာ ငွေဆပ်ခွင့်ရှိသည်
    if (eo.status === "shipped" || eo.status === "delivered") {
      ecommercePayable += rem;
    }
  }

  let posTotalPurchase = 0;
  let posRemaining = 0;

  for (const po of posOrders) {
    const finalAmt = Number(po.finalAmount) || 0;
    const paid = Number(po.paidAmount) || 0;

    posTotalPurchase += finalAmt;

    if (po.paymentType === "credit") {
      posRemaining += Math.max(0, finalAmt - paid);
    }
  }

  const creditPaid = creditRecords.reduce(
    (sum, r) => sum + (Number(r.paidAmount) || 0),
    0
  );

  const totalPurchase = ecomTotalPurchase + posTotalPurchase;
  const creditRemaining = ecommerceRemaining + posRemaining;
  const payableRemaining = ecommercePayable + posRemaining;

  return {
    totalPurchase,
    creditRemaining,
    payableRemaining,
    creditPaid,
    ecommerceRemaining,
    posRemaining,
  };
};

import { z } from "zod";

export const ecommerceOrderCreateSchema = {
  body: z.object({
    products: z.array(
      z.object({
        inventoryId: z.string().min(1, "ပစ္စည်း ID လိုအပ်ပါသည်"),
        quantity: z.number().positive("အရေအတွက် ၀ ထက် ကြီးရပါမည်"),
        unit: z.string().trim().optional(),
      })
    ).min(1, "ပစ္စည်း အနည်းဆုံး ၁ ခု ပါရပါမည်"),
    paymentMethod: z.enum(["cash_on_delivery", "kpay", "wavepay", "bank_transfer"]).optional(),
    shippingAddressId: z.string().optional(),
    note: z.string().trim().max(500, "မှတ်ချက် စာလုံးရေ ၅၀၀ ထက် မကျော်ရပါ").optional().nullable(),
  }),
};

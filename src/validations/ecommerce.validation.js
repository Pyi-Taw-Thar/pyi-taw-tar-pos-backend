import { z } from "zod";

export const ecommerceOrderCreateSchema = {
  body: z.object({
    products: z.array(
      z.object({
        inventoryId: z.string().min(1, "Inventory ID is required"),
        quantity: z.number().positive("Quantity must be greater than zero"),
        unit: z.string().trim().optional(),
      })
    ).min(1, "At least one product is required"),
    paymentMethod: z.enum(["cash_on_delivery", "kpay", "wavepay", "bank_transfer"]).optional(),
    shippingAddressId: z.string().optional(),
    note: z.string().trim().max(500).optional().nullable(),
  }),
};

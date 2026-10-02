import { z } from "zod";

export const customerRegisterSchema = {
  body: z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters long"),
    phone: z.string().trim().min(7, "Phone number must be at least 7 digits"),
    password: z.string().min(6, "Password must be at least 6 characters long"),
    address: z.string().trim().optional(),
    township: z.string().trim().optional(),
  }),
};

export const customerLoginSchema = {
  body: z.object({
    phone: z.string().trim().min(1, "Phone is required"),
    password: z.string().min(1, "Password is required"),
  }),
};

export const updateMeSchema = {
  body: z.object({
    name: z.string().trim().min(2).optional(),
    phone: z.string().trim().min(7).optional(),
    password: z.string().min(6).optional(),
    address: z.string().trim().optional(),
    township: z.string().trim().optional(),
  }),
};

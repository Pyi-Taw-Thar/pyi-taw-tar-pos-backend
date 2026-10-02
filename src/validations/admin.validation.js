import { z } from "zod";

export const adminSignupSchema = {
  body: z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters long"),
    password: z.string().min(6, "Password must be at least 6 characters long"),
    confirmPassword: z.string().min(6, "Confirm password is required"),
    role: z.enum(["owner", "admin", "cashier", "kitchen", "bar-counter", "ktv-waiter", "restaurant-waiter"]),
    locationId: z.string().optional().nullable(),
  }).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  }),
};

export const adminLoginSchema = {
  body: z.object({
    name: z.string().trim().min(1, "Name is required"),
    password: z.string().min(1, "Password is required"),
  }),
};

export const updatePasswordSchema = {
  body: z.object({
    newPassword: z.string().min(6, "New password must be at least 6 characters long"),
    confirmPassword: z.string().optional(),
  }).refine((data) => !data.confirmPassword || data.newPassword === data.confirmPassword, {
    message: "New password and confirm password do not match",
    path: ["confirmPassword"],
  }),
};

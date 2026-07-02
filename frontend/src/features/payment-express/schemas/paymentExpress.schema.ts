import { z } from "zod";

export const paymentExpressRutSchema = z.object({
  rut: z
    .string()
    .trim()
    .min(1, "El RUT es obligatorio.")
    .max(20, "El RUT no puede superar los 20 caracteres."),
});

export type PaymentExpressRutFormValues = z.infer<
  typeof paymentExpressRutSchema
>;

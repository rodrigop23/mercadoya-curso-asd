import { z } from 'zod';

export const uuidSchema = z.uuid();
export const errorResponseSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.array(z.string())).optional(),
});
export const createOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(2_147_483_647),
});
export const orderResponseSchema = z.object({
  order: z.object({
    id: uuidSchema,
    productId: uuidSchema,
    quantity: z.number().int(),
    buyerId: z.string().nullable(),
    status: z.enum(['pending', 'confirmed', 'rejected']),
    rejectionReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
});

export const signUpSchema = z.strictObject({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(8).max(128),
  image: z.string().optional(),
  callbackURL: z.string().optional(),
});
export const signInSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(8).max(128),
  rememberMe: z.boolean().optional(),
  callbackURL: z.string().optional(),
});
// Better Auth puede añadir campos mediante plugins. Conservamos esa extensibilidad.
export const identityUserSchema = z.looseObject({
  id: z.string(),
  email: z.email(),
  name: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullish(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  role: z.string().nullish(),
});
export const identitySessionResponseSchema = z.looseObject({
  session: z.looseObject({
    id: z.string(),
    userId: z.string(),
    expiresAt: z.iso.datetime(),
    token: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    ipAddress: z.string().nullish(),
    userAgent: z.string().nullish(),
    impersonatedBy: z.string().nullish(),
  }),
  user: identityUserSchema,
});
// Adapter de lectura para servicios que solo necesitan identificar al comprador.
export const sessionBuyerSchema = identitySessionResponseSchema
  .pick({ user: true })
  .extend({
    user: identityUserSchema.pick({ id: true }).strip(),
  })
  .strip();
export const signUpResponseSchema = z.looseObject({
  token: z.string().nullable(),
  user: identityUserSchema,
});
export const signInResponseSchema = z.looseObject({
  redirect: z.boolean(),
  token: z.string(),
  url: z.string().optional(),
  user: identityUserSchema,
});
export const signOutRequestSchema = z.object({
  callbackURL: z.string().optional(),
  disableRedirect: z.boolean().optional(),
  state: z.string().optional(),
});
export const signOutResponseSchema = z.looseObject({
  success: z.boolean(),
  url: z.string().optional(),
  redirect: z.boolean().optional(),
});
export const authErrorResponseSchema = z.looseObject({ code: z.string(), message: z.string() });

// El schema valida los strings de multipart y entrega valores numéricos al módulo.
export const productFormSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio.').max(160),
  description: z.string().trim().min(1, 'La descripción es obligatoria.').max(5000),
  price: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, 'El precio debe tener hasta dos decimales.')
    .transform(Number)
    .pipe(z.number().finite().positive().max(99_999_999.99)),
  stock: z
    .string()
    .trim()
    .regex(/^\d+$/, 'El stock debe ser un número entero no negativo.')
    .transform(Number)
    .pipe(z.number().int().min(0).max(2_147_483_647)),
});
export const productSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string(),
  price: z.number(),
  stock: z.number().int(),
  imagePath: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const productsResponseSchema = z.object({ products: z.array(productSchema) });
export const productResponseSchema = z.object({ product: productSchema });
export const stockResponseSchema = z.object({
  availableStock: z.number().int().nonnegative().nullable(),
});
export const stockAdjustmentSchema = z.object({
  delta: z
    .number()
    .int()
    .safe()
    .refine((value) => value !== 0),
});
export const stockAdjustmentResponseSchema = z.discriminatedUnion('adjusted', [
  z.object({ adjusted: z.literal(true), availableStock: z.number().int().nonnegative() }),
  z.object({
    adjusted: z.literal(false),
    reason: z.enum(['product_not_found', 'insufficient_stock', 'stock_limit']),
  }),
]);

export type CreateOrderRequest = z.infer<typeof createOrderSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type IdentitySessionResponse = z.infer<typeof identitySessionResponseSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
export type ProductFormInput = z.input<typeof productFormSchema>;
export type StockAdjustmentResponse = z.infer<typeof stockAdjustmentResponseSchema>;

// Application tokens differ from Better Auth's session cookie/cache.
export const applicationJwtClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(['user', 'admin']),
  iss: z.string().url(),
  aud: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});
export const applicationTokenResponseSchema = z.object({ token: z.string().min(1) });
export const publicJwksSchema = z.object({
  keys: z.array(
    z.object({
      kid: z.string().min(1),
      kty: z.literal('RSA'),
      alg: z.literal('RS256'),
      n: z.string().min(1),
      e: z.string().min(1),
    }),
  ),
});

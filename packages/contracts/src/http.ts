import { z } from 'zod';

export const uuidSchema = z.uuid();
export const errorResponseSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.array(z.string())).optional(),
});
export const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(2_147_483_647),
});
export const cartItemsSchema = z
  .array(cartItemSchema)
  .min(1)
  .max(20)
  .refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    'El carrito no debe repetir productos.',
  );
export type CartItem = z.infer<typeof cartItemSchema>;
export const createOrderSchema = z.union([
  z.object({ items: cartItemsSchema, idempotencyKey: uuidSchema.optional() }),
  cartItemSchema.extend({ idempotencyKey: uuidSchema.optional() }),
]);
export const orderItemSchema = cartItemSchema.extend({
  title: z.string(),
  thumbnailPath: z.string().nullable(),
  unitAmount: z.number().int().positive(),
  currency: z.literal('pen'),
});
export type OrderItem = z.infer<typeof orderItemSchema>;
export const orderResponseSchema = z.object({
  order: z.object({
    id: uuidSchema,
    productId: uuidSchema,
    quantity: z.number().int(),
    items: z.array(orderItemSchema).nullable().optional(),
    totalAmount: z.number().int().positive().nullable().optional(),
    currency: z.literal('pen').nullable().optional(),
    buyerId: z.string().nullable(),
    status: z.enum(['pending', 'confirmed', 'rejected']),
    rejectionReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
});

export const paymentCheckoutResponseSchema = z.object({
  provider: z.literal('polar'),
  checkout: z
    .object({
      id: uuidSchema,
      url: z.url(),
      expiresAt: z.iso.datetime(),
      amount: z.number().int().positive(),
      currency: z.string().length(3),
    })
    .nullable(),
});
export type PaymentCheckoutResponse = z.infer<typeof paymentCheckoutResponseSchema>;

export const billingProductSchema = z.object({
  productId: uuidSchema,
  polarProductId: uuidSchema,
  unitAmount: z.number().int().min(200).max(99_999_999),
  currency: z.literal('pen'),
  title: z.string().optional(),
  thumbnailPath: z.string().nullable().optional(),
});
export const billingOrderItemSchema = billingProductSchema.extend({
  quantity: cartItemSchema.shape.quantity,
  title: z.string(),
  thumbnailPath: z.string().nullable(),
});
export type BillingOrderItem = z.infer<typeof billingOrderItemSchema>;
export const catalogBillingResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), product: billingProductSchema }),
  z.object({ status: z.literal('pending'), product: z.null() }),
  z.object({ status: z.literal('failed'), product: z.null() }),
]);
export type BillingProduct = z.infer<typeof billingProductSchema>;
export type CatalogBillingResponse = z.infer<typeof catalogBillingResponseSchema>;

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
    .pipe(
      z
        .number()
        .finite()
        .min(2, 'El precio mínimo es S/ 2.00.')
        .max(999_999.99, 'El precio máximo es S/ 999,999.99.'),
    ),
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
export const stockBatchSchema = z.object({
  operationId: z.string().min(1).max(100),
  adjustments: z
    .array(
      z.object({
        productId: uuidSchema,
        delta: z
          .number()
          .int()
          .min(-2_147_483_647)
          .max(2_147_483_647)
          .refine((value) => value !== 0),
      }),
    )
    .min(1)
    .max(20)
    .refine(
      (items) => new Set(items.map((item) => item.productId)).size === items.length,
      'No se deben repetir productos.',
    ),
});
export const stockBatchResponseSchema = z.discriminatedUnion('adjusted', [
  z.object({ adjusted: z.literal(true) }),
  z.object({
    adjusted: z.literal(false),
    reason: z.enum(['product_not_found', 'insufficient_stock', 'stock_limit']),
  }),
]);
export type StockBatchRequest = z.infer<typeof stockBatchSchema>;
export type StockBatchResponse = z.infer<typeof stockBatchResponseSchema>;

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

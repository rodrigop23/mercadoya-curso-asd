import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { z } from 'zod';
import * as contracts from '../dist/index.js';

const repo = new URL('../../../', import.meta.url);
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonSchema = (schema, io = 'input') => {
  const { $schema: _dialect, ...result } = z.toJSONSchema(schema, { target: 'draft-2020-12', io });
  return result;
};
const cookie = { betterAuthSession: [] };
const schemas = {
  Error: contracts.errorResponseSchema,
  CreateOrder: contracts.createOrderSchema,
  OrderResponse: contracts.orderResponseSchema,
  SignUp: contracts.signUpSchema,
  SignIn: contracts.signInSchema,
  IdentitySession: contracts.identitySessionResponseSchema,
  SignUpResponse: contracts.signUpResponseSchema,
  SignInResponse: contracts.signInResponseSchema,
  SignOutResponse: contracts.signOutResponseSchema,
  SignOutBody: contracts.signOutRequestSchema,
  AuthError: contracts.authErrorResponseSchema,
  ProductResponse: contracts.productResponseSchema,
  ProductsResponse: contracts.productsResponseSchema,
  StockResponse: contracts.stockResponseSchema,
  StockAdjustment: contracts.stockAdjustmentSchema,
  StockAdjustmentResponse: contracts.stockAdjustmentResponseSchema,
  ReservationResponseV1: contracts.reservationResponseV1Schema,
  ReservationResponseV2: contracts.reservationResponseV2Schema,
};
const allSchemas = Object.fromEntries(
  Object.entries(schemas).map(([name, schema]) => [name, jsonSchema(schema)]),
);
// Zod no representa refinements personalizados en JSON Schema.
allSchemas.StockAdjustment.properties.delta.not = { const: 0 };
const form = jsonSchema(contracts.productFormSchema);
form.properties.price.description = 'String decimal; tras trim, mayor que 0 y hasta 99999999.99.';
form.properties.stock.description = 'String entero; tras trim, entre 0 y 2147483647.';
const image = {
  type: 'string',
  format: 'binary',
  description:
    'Archivo JPEG, PNG o WebP, no vacío, hasta 2097152 bytes. Media verifica MIME y firma y produce las imágenes full/thumb.',
};
allSchemas.CreateProduct = {
  ...form,
  properties: { ...form.properties, image },
  required: [...form.required, 'image'],
};
allSchemas.UpdateProduct = { ...form, properties: { ...form.properties, image } };
const response = (description, schema) => ({
  description,
  ...(schema
    ? {
        content: {
          'application/json': { schema: typeof schema === 'string' ? ref(schema) : schema },
        },
      }
    : {}),
});
const descriptions = {
  400: 'Solicitud inválida.',
  401: 'Falta una sesión o credencial válida.',
  403: 'Se requiere rol admin.',
  404: 'No encontrado.',
  500: 'Falló la operación.',
  502: 'El servicio remoto no está disponible.',
  503: 'Token interno no configurado.',
};
const errors = (...codes) =>
  Object.fromEntries(codes.map((code) => [code, response(descriptions[code], 'Error')]));
const body = (schema, media = 'application/json') => ({
  required: true,
  content: { [media]: { schema: ref(schema) } },
});
const id = (name) => ({
  name,
  in: 'path',
  required: true,
  schema: jsonSchema(contracts.uuidSchema),
});
const op = (operationId, summary, responses, extra = {}) => ({
  operationId,
  summary,
  security: [],
  responses,
  ...extra,
});
const health = (module, version) =>
  response('El proceso responde.', {
    type: 'object',
    required: ['module', 'ok', ...(version ? ['serviceVersion'] : [])],
    properties: {
      module: { type: 'string', const: module },
      ok: { type: 'boolean', const: true },
      ...(version ? { serviceVersion: { type: 'string', const: version } } : {}),
    },
  });
const bff = { url: 'http://localhost:3001', description: 'BFF local; los paths incluyen /api.' };
const doc = (title, version, paths, description, servers = [bff]) => {
  // Solo exportamos componentes utilizados por este documento.
  const used = new Set(
    [...JSON.stringify(paths).matchAll(/#\/components\/schemas\/([^"\s]+)/g)].map(
      (match) => match[1],
    ),
  );
  return {
    openapi: '3.1.0',
    info: { title: `MercadoYa ${title}`, version, description },
    servers,
    paths,
    components: {
      securitySchemes: {
        betterAuthSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description:
            'Cookie Better Auth local. En HTTPS puede usar el prefijo __Secure-. No es Bearer JWT.',
        },
        ...(title === 'Catalog'
          ? {
              catalogInternalToken: {
                type: 'apiKey',
                in: 'header',
                name: 'x-catalog-internal-token',
                description: 'Secreto compartido para Inventory, no para el navegador.',
              },
            }
          : {}),
      },
      schemas: Object.fromEntries([...used].map((name) => [name, allSchemas[name]])),
    },
  };
};
const documents = new Map();
documents.set(
  'apps/orders-service/openapi.yaml',
  doc(
    'Orders',
    '1.0.0',
    {
      '/api/orders/health': {
        get: op('ordersHealth', 'Estado de Orders', { 200: health('orders') }),
      },
      '/api/orders': {
        post: op(
          'createOrder',
          'Crear un pedido pendiente y publicar orders.placed',
          {
            202: response('Pedido aceptado; la saga resuelve el estado.', 'OrderResponse'),
            ...errors(400, 401, 500, 502),
          },
          {
            security: [cookie],
            requestBody: body('CreateOrder'),
            description:
              'buyerId procede de la sesión. Campos extra como paymentMode se descartan; solo el CLI interno usa ese override.',
          },
        ),
      },
      '/api/orders/{orderId}': {
        get: op(
          'getOrder',
          'Consultar un pedido sin autenticación',
          { 200: response('Pedido encontrado.', 'OrderResponse'), ...errors(400, 404, 500, 502) },
          { parameters: [id('orderId')] },
        ),
      },
    },
    'HTTP actual; GET público, POST con cookie. El BFF también puede devolver 502 al fallar el proxy.',
    [bff, { url: 'http://localhost:3002', description: 'Orders directo.' }],
  ),
);

const identityPaths = {
  '/api/identity/health': {
    get: op('identityHealth', 'Estado de Identity', { 200: health('identity') }),
  },
  '/api/me': {
    get: op(
      'getMe',
      'Consultar sesión y usuario actuales',
      { 200: response('Sesión actual serializada a JSON.', 'IdentitySession'), ...errors(401) },
      { security: [cookie] },
    ),
  },
  '/api/auth/get-session': {
    get: op(
      'getAuthSession',
      'Consultar sesión mediante Better Auth',
      {
        200: response('Sesión o null si no hay sesión válida.', {
          anyOf: [ref('IdentitySession'), { type: 'null' }],
        }),
        default: response('Error del proveedor.', 'AuthError'),
      },
      { security: [cookie, {}] },
    ),
  },
  '/api/auth/sign-out': {
    post: op(
      'signOut',
      'Cerrar sesión y expirar la cookie',
      {
        200: response('Sesión cerrada.', 'SignOutResponse'),
        default: response('Error del proveedor.', 'AuthError'),
      },
      { security: [cookie], requestBody: { ...body('SignOutBody'), required: false } },
    ),
  },
};
for (const [route, request, result, operation] of [
  ['sign-up', 'SignUp', 'SignUpResponse', 'signUpEmail'],
  ['sign-in', 'SignIn', 'SignInResponse', 'signInEmail'],
]) {
  identityPaths[`/api/auth/${route}/email`] = {
    post: op(
      operation,
      `${route} por email con Better Auth`,
      {
        200: {
          ...response('Usuario y token opaco de sesión. La sesión HTTP usa Set-Cookie.', result),
          headers: {
            'Set-Cookie': {
              description: 'Cookie HttpOnly de Better Auth.',
              schema: { type: 'string' },
            },
          },
        },
        400: response('Hono puede devolver ZodError; Better Auth puede devolver code/message.', {
          anyOf: [
            ref('AuthError'),
            {
              type: 'object',
              required: ['success', 'error'],
              properties: {
                success: { const: false },
                error: { type: 'object', additionalProperties: true },
              },
            },
          ],
        }),
        default: response(
          'Error de Better Auth, incluidos autenticación y rate limit.',
          'AuthError',
        ),
      },
      { requestBody: body(request) },
    ),
  };
}
documents.set(
  'apps/api/openapi/identity.yaml',
  doc(
    'Identity',
    '1.0.0',
    identityPaths,
    'Borde usado por la web y los servicios. /api/auth/* delega GET/POST restantes al proveedor Better Auth y admin plugin; este documento fija login, logout y sesión, no reemplaza la API completa del proveedor. El módulo sigue dentro del BFF.',
  ),
);

const productResponses = { ...errors(400, 401, 403, 500) };
documents.set(
  'apps/api/openapi/catalog.yaml',
  doc(
    'Catalog',
    '1.0.0',
    {
      '/api/catalog/health': {
        get: op('catalogHealth', 'Estado de Catalog', { 200: health('catalog') }),
      },
      '/api/products': {
        get: op('listProducts', 'Listar productos', {
          200: response(
            'Productos ordenados por fecha de creación descendente.',
            'ProductsResponse',
          ),
        }),
        post: op(
          'createProduct',
          'Crear producto con imagen',
          { 201: response('Producto creado.', 'ProductResponse'), ...productResponses },
          {
            security: [cookie],
            requestBody: body('CreateProduct', 'multipart/form-data'),
            description:
              'Requiere admin. Media procesa la imagen dentro del módulo; no existe endpoint HTTP de upload separado.',
          },
        ),
      },
      '/api/products/{id}': {
        put: op(
          'updateProduct',
          'Actualizar producto; la imagen es opcional',
          {
            200: response('Producto actualizado.', 'ProductResponse'),
            ...productResponses,
            ...errors(404),
          },
          {
            security: [cookie],
            parameters: [id('id')],
            requestBody: body('UpdateProduct', 'multipart/form-data'),
          },
        ),
        delete: op(
          'deleteProduct',
          'Eliminar producto y sus imágenes',
          { 204: response('Producto eliminado; sin cuerpo.'), ...errors(400, 401, 403, 404, 500) },
          { security: [cookie], parameters: [id('id')] },
        ),
      },
      '/api/internal/catalog/products/{id}/stock': {
        get: op(
          'getStock',
          'Consultar stock para Inventory',
          {
            200: response('null si no existe el producto.', 'StockResponse'),
            ...errors(400, 401, 503),
          },
          { security: [{ catalogInternalToken: [] }], parameters: [id('id')] },
        ),
      },
      '/api/internal/catalog/products/{id}/adjust-stock': {
        post: op(
          'adjustStock',
          'Ajustar stock atómicamente',
          {
            200: response(
              'Resultado de negocio; los rechazos también usan HTTP 200.',
              'StockAdjustmentResponse',
            ),
            ...errors(400, 401, 503),
          },
          {
            security: [{ catalogInternalToken: [] }],
            parameters: [id('id')],
            requestBody: body('StockAdjustment'),
          },
        ),
      },
    },
    'Catalog sigue dentro del BFF. Multipart conserva strings para price/stock; los refinements numéricos se ejecutan después de convertirlos. Las rutas internas son un borde HTTP real, no URLs de infraestructura en DTOs.',
  ),
);

const inventoryPaths = {};
for (const [prefix, version, legacy] of [
  ['/api/inventory', 'v2', true],
  ['/api/inventory/v1', 'v1', false],
  ['/api/inventory/v2', 'v2', false],
]) {
  const servers = [
    bff,
    {
      url: version === 'v1' ? 'http://localhost:3003' : 'http://localhost:3005',
      description: `Inventory ${version} directo.`,
    },
  ];
  const suffix = legacy ? 'Default' : version.toUpperCase();
  inventoryPaths[`${prefix}/health`] = {
    servers,
    get: op(
      `inventoryHealth${suffix}`,
      `Estado Inventory ${version}`,
      { 200: health('inventory', version) },
      {
        ...(version === 'v1'
          ? {
              deprecated: true,
              description: 'Retenido para compatibilidad. Usa /api/inventory/v2/health.',
            }
          : {}),
      },
    ),
  };
  inventoryPaths[`${prefix}/reservations/{orderId}`] = {
    servers,
    get: op(
      `getReservation${suffix}`,
      `Consultar reserva ${version}`,
      {
        200: {
          ...response(
            'Reserva encontrada.',
            version === 'v1' ? 'ReservationResponseV1' : 'ReservationResponseV2',
          ),
          headers: {
            'X-Service-Version': {
              schema: { type: 'string', const: version },
              description: 'Versión del proceso.',
            },
          },
        },
        ...errors(400, 401, 404, 500, 502),
      },
      {
        security: [cookie],
        parameters: [id('orderId')],
        ...(version === 'v1' ? { deprecated: true } : {}),
        description:
          'Valida sesión con Identity; no verifica que el usuario sea comprador. La reserva entra por NATS. ' +
          (version === 'v1'
            ? 'Retenido para compatibilidad. Migra a /api/inventory/v2/reservations/{orderId}, que añade reservation.status. Sin fecha de retirada.'
            : 'Contrato de aplicación por defecto; reservation.status es obligatorio.'),
      },
    ),
  };
  if (version === 'v1') {
    for (const path of [`${prefix}/health`, `${prefix}/reservations/{orderId}`]) {
      for (const result of Object.values(inventoryPaths[path].get.responses)) {
        result.headers = {
          ...result.headers,
          Deprecation: {
            schema: { type: 'string', const: '@1790726400' },
            description: 'Fecha de deprecación según RFC 9745. Sin fecha de retirada.',
          },
          Link: {
            schema: { type: 'string' },
            description: 'Ruta v2 equivalente con rel="successor-version".',
          },
        };
      }
    }
  }
}
documents.set(
  'apps/inventory-service/openapi.yaml',
  doc(
    'Inventory HTTP API',
    '3.0.0',
    inventoryPaths,
    'V2 es el default de aplicación y del alias sin versión. Solo el despliegue v2 consume la saga. V1 se retiene explícito y deprecated, sin fecha de retirada. No existe POST de reserva.',
  ),
);

const media = doc(
  'Media',
  '1.0.0',
  {
    '/api/media/health': { get: op('mediaHealth', 'Estado de Media', { 200: health('media') }) },
    '/uploads/{file}': {
      get: op(
        'readUpload',
        'Leer una imagen publicada por Catalog',
        {
          200: {
            description: 'Imagen full o thumb.',
            content: Object.fromEntries(
              ['image/jpeg', 'image/png', 'image/webp'].map((mime) => [
                mime,
                { schema: { type: 'string', format: 'binary' } },
              ]),
            ),
          },
          404: response('Archivo no encontrado; respuesta del middleware estático.'),
        },
        { parameters: [{ name: 'file', in: 'path', required: true, schema: { type: 'string' } }] },
      ),
    },
  },
  'La ruta estática /uploads/* la monta Catalog. La entrada de Media es image en multipart de Catalog; no hay upload HTTP autónomo. Polar y gateway Kong quedan para decisiones futuras.',
);
documents.set('apps/api/openapi/media.yaml', media);
const eventSchemas = Object.fromEntries(
  [
    [contracts.eventSubjects.ordersPlaced, contracts.orderPlacedEventSchema],
    [contracts.eventSubjects.inventoryReserved, contracts.inventoryReservedEventSchema],
    [contracts.eventSubjects.inventoryRejected, contracts.inventoryRejectedEventSchema],
    [contracts.eventSubjects.inventoryReleased, contracts.inventoryReleasedEventSchema],
    [contracts.eventSubjects.paymentSucceeded, contracts.paymentSucceededEventSchema],
    [contracts.eventSubjects.paymentFailed, contracts.paymentFailedEventSchema],
  ].map(([subject, schema]) => [
    subject,
    z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }),
  ]),
);

export const generatedDocuments = documents;
export async function generate(check = false) {
  const outputs = [...documents].map(([path, document]) => [
    path,
    `# Generado por @mercadoya/contracts. No editar; ejecutar pnpm openapi:generate.\n${stringify(document, { lineWidth: 0, aliasDuplicateObjects: false })}`,
  ]);
  outputs.push([
    'packages/contracts/events.schema.json',
    `${JSON.stringify(eventSchemas, null, 2)}\n`,
  ]);
  for (const [path, contents] of outputs) {
    const target = new URL(path, repo);
    if (check) {
      const current = await readFile(target, 'utf8').catch(() => '');
      if (current !== contents)
        throw new Error(`${path} no está actualizado. Ejecuta pnpm openapi:generate.`);
    } else await writeFile(target, contents);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  await generate(process.argv.includes('--check'));

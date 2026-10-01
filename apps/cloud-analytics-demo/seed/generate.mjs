#!/usr/bin/env node
/**
 * MercadoYa Sesión 6 — analytics seed generator
 * Reproducible CSV raw zone for Glue → S3 → Athena → QuickSight.
 *
 * Usage:
 *   node generate.mjs
 *   node generate.mjs --seed 42 --products 120 --orders 3500 --days 75
 *
 * Writes UTF-8 CSVs under ./raw/ with headers. FKs are consistent across tables.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'raw');

function parseArgs(argv) {
  const opts = {
    seed: 20261001,
    products: 120,
    customers: 800,
    orders: 3500,
    days: 75,
    endDate: '2026-09-30', // inclusive end of window (box/user context Oct 2026)
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') opts.seed = Number(argv[++i]);
    else if (a === '--products') opts.products = Number(argv[++i]);
    else if (a === '--customers') opts.customers = Number(argv[++i]);
    else if (a === '--orders') opts.orders = Number(argv[++i]);
    else if (a === '--days') opts.days = Number(argv[++i]);
    else if (a === '--end-date') opts.endDate = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node generate.mjs [--seed N] [--products N] [--customers N] [--orders N] [--days N] [--end-date YYYY-MM-DD]`);
      process.exit(0);
    }
  }
  return opts;
}

/** Mulberry32 — deterministic PRNG from a 32-bit seed. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function stableUuid(namespace, key) {
  const h = createHash('sha256').update(`${namespace}:${key}`).digest();
  const bytes = Buffer.from(h.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(path, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

const CITIES = [
  'Lima', 'Arequipa', 'Trujillo', 'Chiclayo', 'Piura', 'Cusco', 'Iquitos',
  'Huancayo', 'Tacna', 'Pucallpa', 'Chimbote', 'Ica', 'Juliaca', 'Cajamarca',
];
const SEGMENTS = ['retail', 'wholesale', 'vip', 'new'];
const CATEGORIES = [
  { name: 'Electrónica', min: 49.9, max: 2499.0 },
  { name: 'Hogar', min: 19.9, max: 899.0 },
  { name: 'Ropa', min: 29.9, max: 349.0 },
  { name: 'Alimentos', min: 4.9, max: 89.9 },
  { name: 'Deportes', min: 39.9, max: 799.0 },
  { name: 'Belleza', min: 14.9, max: 259.0 },
  { name: 'Libros', min: 24.9, max: 149.0 },
  { name: 'Juguetes', min: 19.9, max: 299.0 },
  { name: 'Automotriz', min: 29.9, max: 599.0 },
  { name: 'Oficina', min: 9.9, max: 449.0 },
];
const PRODUCT_ADJECTIVES = [
  'Premium', 'Clásico', 'Eco', 'Pro', 'Lite', 'Urban', 'Andino', 'Norte',
  'Express', 'Plus', 'Max', 'Soft', 'Hard', 'Fresh', 'Daily', 'Smart',
];
const PRODUCT_NOUNS = [
  'Auriculares', 'Licuadora', 'Camiseta', 'Café', 'Zapatillas', 'Crema',
  'Novela', 'Bloques', 'Aceite', 'Cuaderno', 'Mouse', 'Sartén', 'Jeans',
  'Snack', 'Mochila', 'Champú', 'Guía', 'Peluche', 'Filtro', 'Lámpara',
  'Teclado', 'Organizador', 'Polera', 'Miel', 'Balón', 'Serum', 'Comic',
  'Puzzle', 'Cargador', 'Estante',
];

// Order statuses (MercadoYa-shaped + analytics variety; BRIEF asks for mixed statuses)
const ORDER_STATUSES = [
  { status: 'confirmed', w: 0.72 },
  { status: 'pending', w: 0.12 },
  { status: 'rejected', w: 0.08 },
  { status: 'cancelled', w: 0.05 },
  { status: 'shipped', w: 0.03 },
];

// Polar-ish payment statuses
const PAYMENT_STATUSES = ['succeeded', 'failed', 'pending', 'canceled'];

function weightedPick(rng, items) {
  const r = rng();
  let acc = 0;
  for (const it of items) {
    acc += it.w;
    if (r <= acc) return it.status;
  }
  return items[items.length - 1].status;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDateTime(dateStr, hour, minute, second) {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:${ss}Z`;
}

function stockStatusFromQty(qty) {
  if (qty <= 0) return 'out_of_stock';
  if (qty <= 10) return 'low';
  if (qty <= 40) return 'ok';
  return 'high';
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rng = mulberry32(opts.seed);

  mkdirSync(OUT_DIR, { recursive: true });

  // --- customers ---
  const customers = [];
  for (let i = 1; i <= opts.customers; i++) {
    const customer_id = stableUuid('customer', i);
    const signupOffset = Math.floor(rng() * (opts.days + 120));
    const signup_date = addDays(opts.endDate, -signupOffset);
    // ~2% null city for ETL null-handling demo (BRIEF)
    const city = rng() < 0.02 ? null : pick(rng, CITIES);
    const segment = pick(rng, SEGMENTS);
    const email = `buyer${String(i).padStart(4, '0')}@example.pe`;
    customers.push({ customer_id, signup_date, city, segment, email });
  }

  // --- products ---
  const products = [];
  for (let i = 1; i <= opts.products; i++) {
    const product_id = stableUuid('product', i);
    const cat = pick(rng, CATEGORIES);
    const title = `${pick(rng, PRODUCT_ADJECTIVES)} ${pick(rng, PRODUCT_NOUNS)} ${100 + i}`;
    const price = round2(cat.min + rng() * (cat.max - cat.min));
    // stock on catalog row (point-in-time); inventory_snapshots holds richer stock view
    // Bias ~12% toward low/oos so Athena/QuickSight low-stock KPIs have signal
    let stock;
    if (rng() < 0.12) {
      stock = Math.floor(rng() * 11); // 0–10
    } else {
      stock = 11 + Math.floor(rng() * 190);
    }
    const stock_status = stockStatusFromQty(stock);
    // ~1% null category for ETL demo
    const category = rng() < 0.01 ? null : cat.name;
    products.push({
      product_id,
      title,
      category,
      price,
      stock,
      stock_status,
      currency: 'PEN',
    });
  }

  // --- inventory_snapshots (current snapshot per product + a few historical days) ---
  const inventory_snapshots = [];
  const snapshotDays = [0, 7, 14, 30]; // days before endDate
  let snapSeq = 0;
  for (const dayOffset of snapshotDays) {
    const snapshot_date = addDays(opts.endDate, -dayOffset);
    for (const p of products) {
      snapSeq++;
      // drift stock over time
      const noise = Math.floor((rng() - 0.5) * 30);
      const quantity_on_hand = clamp(p.stock + noise - dayOffset, 0, 250);
      const quantity_reserved = Math.floor(rng() * Math.min(15, quantity_on_hand));
      inventory_snapshots.push({
        snapshot_id: stableUuid('invsnap', snapSeq),
        product_id: p.product_id,
        snapshot_date,
        quantity_on_hand,
        quantity_reserved,
        quantity_available: quantity_on_hand - quantity_reserved,
        warehouse: pick(rng, ['LIM-01', 'AQP-01', 'TRU-01']),
      });
    }
  }

  // --- orders + order_items + payments ---
  const orders = [];
  const order_items = [];
  const payments = [];
  let itemSeq = 0;
  let paySeq = 0;

  const startDate = addDays(opts.endDate, -(opts.days - 1));

  for (let i = 1; i <= opts.orders; i++) {
    const order_id = stableUuid('order', i);
    const customer = pick(rng, customers);
    const dayIndex = Math.floor(rng() * opts.days);
    // mild weekend bump
    const order_date = addDays(startDate, dayIndex);
    const dow = new Date(`${order_date}T12:00:00Z`).getUTCDay();
    const hourBias = dow === 0 || dow === 6 ? 11 : 14;
    const hour = clamp(Math.floor(hourBias + (rng() - 0.5) * 10), 0, 23);
    const minute = Math.floor(rng() * 60);
    const second = Math.floor(rng() * 60);
    const order_ts = isoDateTime(order_date, hour, minute, second);

    let status = weightedPick(rng, ORDER_STATUSES);
    // ~1.5% null status for ETL
    if (rng() < 0.015) status = null;

    const nItems = 1 + Math.floor(rng() * 5); // 1–5
    const chosen = new Set();
    const lines = [];
    let total = 0;
    for (let k = 0; k < nItems; k++) {
      let p;
      do {
        p = pick(rng, products);
      } while (chosen.has(p.product_id) && chosen.size < products.length);
      chosen.add(p.product_id);
      const quantity = 1 + Math.floor(rng() * 4);
      // slight price variance vs catalog (promos / rounding)
      const unit_price =
        rng() < 0.08 ? round2(p.price * (0.85 + rng() * 0.1)) : p.price;
      const line_total = round2(unit_price * quantity);
      total = round2(total + line_total);
      itemSeq++;
      lines.push({
        order_item_id: stableUuid('orderitem', itemSeq),
        order_id,
        product_id: p.product_id,
        quantity,
        unit_price,
        line_total,
      });
    }
    order_items.push(...lines);

    // ~0.5% null total for ETL
    const total_amount = rng() < 0.005 ? null : total;

    orders.push({
      order_id,
      customer_id: customer.customer_id,
      order_date: order_ts,
      status,
      total_amount,
      currency: 'PEN',
      channel: pick(rng, ['web', 'mobile', 'api']),
    });

    // payments: ~1:1 where applicable; skip some pending/rejected without payment attempt
    const skipPayment =
      status === 'rejected' && rng() < 0.35
        ? true
        : status === null && rng() < 0.2;
    if (!skipPayment) {
      paySeq++;
      let payStatus;
      if (status === 'confirmed' || status === 'shipped') {
        payStatus = rng() < 0.97 ? 'succeeded' : 'pending';
      } else if (status === 'pending') {
        payStatus = rng() < 0.6 ? 'pending' : rng() < 0.5 ? 'succeeded' : 'failed';
      } else if (status === 'rejected') {
        payStatus = rng() < 0.7 ? 'failed' : 'canceled';
      } else if (status === 'cancelled') {
        payStatus = rng() < 0.5 ? 'canceled' : 'failed';
      } else {
        payStatus = pick(rng, PAYMENT_STATUSES);
      }

      const paid_at =
        payStatus === 'succeeded'
          ? isoDateTime(order_date, hour, clamp(minute + 1 + Math.floor(rng() * 5), 0, 59), second)
          : null;

      payments.push({
        payment_id: stableUuid('payment', paySeq),
        order_id,
        amount: total_amount ?? total,
        currency: 'PEN',
        status: payStatus,
        provider: 'polar',
        provider_ref: `pol_${createHash('sha1').update(`pay:${i}`).digest('hex').slice(0, 16)}`,
        created_at: order_ts,
        paid_at,
      });
    }
  }

  writeCsv(join(OUT_DIR, 'customers.csv'), ['customer_id', 'signup_date', 'city', 'segment', 'email'], customers);
  writeCsv(
    join(OUT_DIR, 'products.csv'),
    ['product_id', 'title', 'category', 'price', 'stock', 'stock_status', 'currency'],
    products,
  );
  writeCsv(
    join(OUT_DIR, 'inventory_snapshots.csv'),
    [
      'snapshot_id',
      'product_id',
      'snapshot_date',
      'quantity_on_hand',
      'quantity_reserved',
      'quantity_available',
      'warehouse',
    ],
    inventory_snapshots,
  );
  writeCsv(
    join(OUT_DIR, 'orders.csv'),
    ['order_id', 'customer_id', 'order_date', 'status', 'total_amount', 'currency', 'channel'],
    orders,
  );
  writeCsv(
    join(OUT_DIR, 'order_items.csv'),
    ['order_item_id', 'order_id', 'product_id', 'quantity', 'unit_price', 'line_total'],
    order_items,
  );
  writeCsv(
    join(OUT_DIR, 'payments.csv'),
    [
      'payment_id',
      'order_id',
      'amount',
      'currency',
      'status',
      'provider',
      'provider_ref',
      'created_at',
      'paid_at',
    ],
    payments,
  );

  // Sanity KPIs (stdout)
  const confirmed = orders.filter((o) => o.status === 'confirmed' || o.status === 'shipped');
  const succeededPays = payments.filter((p) => p.status === 'succeeded');
  const failedPays = payments.filter((p) => p.status === 'failed');
  const lowStock = products.filter((p) => p.stock_status === 'low' || p.stock_status === 'out_of_stock');

  // daily sales from succeeded payments (or confirmed orders)
  const daily = new Map();
  for (const o of orders) {
    if (o.status !== 'confirmed' && o.status !== 'shipped') continue;
    if (o.total_amount == null) continue;
    const d = o.order_date.slice(0, 10);
    daily.set(d, round2((daily.get(d) || 0) + o.total_amount));
  }
  const dailyValues = [...daily.values()];
  const avgDaily = dailyValues.length
    ? round2(dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length)
    : 0;
  const failRate = payments.length
    ? round2((failedPays.length / payments.length) * 100)
    : 0;

  console.log(JSON.stringify({
    seed: opts.seed,
    window: { start: startDate, end: opts.endDate, days: opts.days },
    counts: {
      customers: customers.length,
      products: products.length,
      inventory_snapshots: inventory_snapshots.length,
      orders: orders.length,
      order_items: order_items.length,
      payments: payments.length,
    },
    kpi_sanity: {
      confirmed_or_shipped_orders: confirmed.length,
      succeeded_payments: succeededPays.length,
      payment_fail_rate_pct: failRate,
      low_or_oos_products: lowStock.length,
      avg_daily_confirmed_sales_pen: avgDaily,
      distinct_order_days: daily.size,
      avg_items_per_order: round2(order_items.length / orders.length),
    },
    out_dir: OUT_DIR,
  }, null, 2));
}

main();

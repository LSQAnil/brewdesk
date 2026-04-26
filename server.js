/**
 * BrewDesk – Café Ordering System
 * Cloud Edition: Node.js + Express + PostgreSQL + WebSocket
 * Deploys to Railway, Render, Fly.io — free tier
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ─── Database Connection ──────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Helper functions
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || {};
}

// ─── Database Setup ───────────────────────────────────────────────────────────
async function initDb() {
  console.log('Initializing database...');

  await query(`
    CREATE TABLE IF NOT EXISTS tables_list (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      is_active  INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS categories (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      is_active  INTEGER DEFAULT 1
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id           SERIAL PRIMARY KEY,
      category_id  INTEGER REFERENCES categories(id),
      name         TEXT NOT NULL,
      description  TEXT DEFAULT '',
      price        NUMERIC(10,2) NOT NULL,
      is_available INTEGER DEFAULT 1,
      sort_order   INTEGER DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id             SERIAL PRIMARY KEY,
      order_ref      TEXT NOT NULL UNIQUE,
      table_id       INTEGER REFERENCES tables_list(id),
      status         TEXT DEFAULT 'new',
      payment_status TEXT DEFAULT 'pending',
      payment_method TEXT,
      total          NUMERIC(10,2) DEFAULT 0,
      notes          TEXT DEFAULT '',
      created_at     TIMESTAMP DEFAULT NOW(),
      updated_at     TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id       SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      item_id  INTEGER REFERENCES menu_items(id),
      name     TEXT NOT NULL,
      price    NUMERIC(10,2) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      notes    TEXT DEFAULT ''
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS daily_counter (
      counter_date TEXT PRIMARY KEY,
      counter_val  INTEGER DEFAULT 0
    )
  `);

  // Seed default settings
  const defaultSettings = [
    ['cafe_name', 'My Café'],
    ['upi_id', 'yourcafe@upi'],
    ['currency', '₹'],
  ];
  for (const [key, value] of defaultSettings) {
    await query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [key, value]);
  }

  // Seed tables
  const tableNames = ['T1','T2','T3','T4','T5','T6'];
  for (const name of tableNames) {
    await query('INSERT INTO tables_list(name) VALUES($1) ON CONFLICT(name) DO NOTHING', [name]);
  }

  // Seed categories + menu (only if empty)
  const existing = await queryOne('SELECT COUNT(*) as c FROM menu_items');
  if (parseInt(existing.c) === 0) {
    const cats = [
      ['Pizzas – Veg', 1], ['Pizzas – Non Veg', 2], ['Pizzas – Coastal Special', 3],
      ['Burgers', 4], ['Sides & Bites', 5], ['Sandwiches', 6],
      ['Ice Cream Scoops', 7], ['Sundaes – TRY', 8], ['Sundaes – Signature', 9],
      ['Sundaes – Premium', 10], ['Sundaes – Indian & Fun', 11], ['Sundaes – Tall & Layered', 12],
      ['Shakes', 13], ['Coolers & Beverages', 14], ['Fresh Juices', 15],
      ['Falooda', 16], ['Combos', 17],
    ];

    const catIds = {};
    for (const [name, ord] of cats) {
      const row = await run(
        'INSERT INTO categories(name,sort_order) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET sort_order=$2 RETURNING id',
        [name, ord]
      );
      catIds[name] = row.id;
    }

    const items = [
      // Pizzas Veg
      ['Pizzas – Veg','Farmhouse Pizza (Personal 6")',199,'Personal size',1],
      ['Pizzas – Veg','Farmhouse Pizza (Regular 10")',299,'Regular size',2],
      ['Pizzas – Veg','Sweet Corn Pizza (Personal 6")',209,'Personal size',3],
      ['Pizzas – Veg','Sweet Corn Pizza (Regular 10")',309,'Regular size',4],
      ['Pizzas – Veg','Kadai Paneer Pizza (Personal 6")',229,'Personal size',5],
      ['Pizzas – Veg','Kadai Paneer Pizza (Regular 10")',329,'Regular size',6],
      // Pizzas Non Veg
      ['Pizzas – Non Veg','BBQ Chicken Pizza (Personal 6")',239,'Personal size',1],
      ['Pizzas – Non Veg','BBQ Chicken Pizza (Regular 10")',339,'Regular size',2],
      ['Pizzas – Non Veg','Chicken Tikka Pizza (Personal 6")',249,'Personal size',3],
      ['Pizzas – Non Veg','Chicken Tikka Pizza (Regular 10")',349,'Regular size',4],
      ['Pizzas – Non Veg','Cheesy Chicken Pizza (Personal 6")',289,'Personal size',5],
      ['Pizzas – Non Veg','Cheesy Chicken Pizza (Regular 10")',379,'Regular size',6],
      // Coastal
      ['Pizzas – Coastal Special','Coastal Prawn Pizza (Personal 6")',319,'Seasonal special',1],
      ['Pizzas – Coastal Special','Coastal Prawn Pizza (Regular 10")',399,'Seasonal special',2],
      ['Pizzas – Coastal Special','Extra Cheese Add-on',40,'Add to any pizza',3],
      // Burgers
      ['Burgers','Crispy Crunch Veg Burger',129,'',1],
      ['Burgers','Juicy Chicken Burger',169,'',2],
      ['Burgers','Big Bonanza Chicken Burger',199,'',3],
      // Sides
      ['Sides & Bites','French Fries',99,'',1],
      ['Sides & Bites','Peri Peri Fries',119,'',2],
      ['Sides & Bites','Cheese Loaded Fries',159,'',3],
      // Sandwiches
      ['Sandwiches','Bombay Masala Sandwich',109,'',1],
      ['Sandwiches','Paneer Peri Peri Sandwich',129,'',2],
      ['Sandwiches','Grilled Chicken Cheese Sandwich',149,'',3],
      // Ice Cream
      ['Ice Cream Scoops','Classic Scoop – Vanilla / Strawberry / Chocolate / Mango',79,'Choose your flavour',1],
      ['Ice Cream Scoops','Premium Scoop – Belgian Choc / Anjeer / Muskmelon / Arabian Delight',99,'Choose your flavour',2],
      // Sundaes TRY
      ['Sundaes – TRY','Death by Chocolate Fudge ⭐',229,'Must try!',1],
      ['Sundaes – TRY','Tiramisu Sundae ⭐',229,'Must try!',2],
      ['Sundaes – TRY','Chocolate Fantasy ⭐',229,'Must try!',3],
      ['Sundaes – TRY','Gud Bud ⭐',199,'Must try!',4],
      // Sundaes Signature
      ['Sundaes – Signature','Chocolate Choconut Sundae',149,'',1],
      ['Sundaes – Signature','Vanilla Choconut Sundae',139,'',2],
      ['Sundaes – Signature','Rainbow Sundae',149,'',3],
      ['Sundaes – Signature','Choco Dip Sundae',149,'',4],
      ['Sundaes – Signature','Oreo Sundae',159,'',5],
      // Sundaes Premium
      ['Sundaes – Premium','Jack Pot',219,'',1],
      ['Sundaes – Premium','Rock N Rooster',169,'',2],
      ['Sundaes – Premium','Cookies & Cream Sundae',209,'',3],
      // Indian & Fun
      ['Sundaes – Indian & Fun','Dilkush (Indian Special)',209,'',1],
      ['Sundaes – Indian & Fun','Hard Dip',159,'',2],
      ['Sundaes – Indian & Fun','Candy Crush',159,'',3],
      ['Sundaes – Indian & Fun','Lovely Spread',159,'',4],
      ['Sundaes – Indian & Fun','Choco Block',159,'',5],
      // Tall Layered
      ['Sundaes – Tall & Layered','Knicker Boker',219,'Must try!',1],
      ['Sundaes – Tall & Layered','Parfait',219,'Must try!',2],
      ['Sundaes – Tall & Layered','Chocolate Dad',219,'Must try!',3],
      ['Sundaes – Tall & Layered','Nutty Symphony',219,'Must try!',4],
      // Shakes
      ['Shakes','Classic Shake – Mango / Vanilla / Strawberry / Chocolate / Pista / Black Currant',129,'Choose flavour',1],
      ['Shakes','Exotica Shake – KitKat / Oreo / Sharjah',179,'Choose flavour',2],
      ['Shakes','Monster Shake',249,'',3],
      // Coolers
      ['Coolers & Beverages','Mojito (All Variants)',129,'',1],
      ['Coolers & Beverages','Mocktails',139,'',2],
      ['Coolers & Beverages','Floats',129,'',3],
      ['Coolers & Beverages','American Soda Pops',159,'',4],
      ['Coolers & Beverages','Cold Coffee / Bourn Vita / Horlicks',99,'',5],
      ['Coolers & Beverages','Lassi (Small)',59,'',6],
      ['Coolers & Beverages','Lassi (Large)',79,'',7],
      // Juices
      ['Fresh Juices','Lime Juice',40,'',1],
      ['Fresh Juices','Lime Soda',50,'',2],
      ['Fresh Juices','Pudina Lime',60,'',3],
      ['Fresh Juices','Fresh Juice (Seasonal)',89,'',4],
      // Falooda
      ['Falooda','Falooda – Fruit Royale / Rajdhani / Mastani / Kesar Pista',179,'Choose variant',1],
      // Combos
      ['Combos','Beach Combo 🏖️',349,'Personal Veg Pizza + Fries + Mojito',1],
      ['Combos','Chicken Combo 🍗',399,'Chicken Burger + Fries + Cold Coffee',2],
    ];

    for (const [cat, name, price, desc, ord] of items) {
      await query(
        'INSERT INTO menu_items(category_id,name,description,price,sort_order) VALUES($1,$2,$3,$4,$5)',
        [catIds[cat], name, desc, price, ord]
      );
    }
    console.log(`✅ Seeded ${items.length} menu items`);
  }

  console.log('✅ Database ready');
}

// ─── Order Ref Generator ──────────────────────────────────────────────────────
async function generateOrderRef(tableId) {
  const today = new Date().toISOString().slice(0, 10);

  const result = await run(`
    INSERT INTO daily_counter(counter_date, counter_val)
    VALUES($1, 1)
    ON CONFLICT(counter_date) DO UPDATE
      SET counter_val = daily_counter.counter_val + 1
    RETURNING counter_val
  `, [today]);

  const tableName = (await queryOne('SELECT name FROM tables_list WHERE id=$1', [tableId]))?.name || 'X';
  return `${tableName}-${String(result.counter_val).padStart(4, '0')}`;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}
wss.on('connection', ws => {
  ws.send(JSON.stringify({ event: 'connected', data: {} }));
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Helper ───────────────────────────────────────────────────────────────────
async function getOrderDetail(id) {
  const order = await queryOne(`
    SELECT o.*, t.name as table_name
    FROM orders o JOIN tables_list t ON o.table_id = t.id
    WHERE o.id = $1
  `, [id]);
  if (!order) return null;
  order.items = await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  return order;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// Settings
app.get('/api/settings', async (_, res) => {
  try {
    const rows = await query('SELECT key, value FROM settings');
    const s = {};
    rows.forEach(r => s[r.key] = r.value);
    res.json(s);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings', async (req, res) => {
  try {
    for (const [k, v] of Object.entries(req.body)) {
      await query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2', [k, v]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Tables
app.get('/api/tables', async (_, res) => {
  try {
    const tables = await query('SELECT * FROM tables_list WHERE is_active=1 ORDER BY id');
    const enriched = await Promise.all(tables.map(async t => {
      const activeOrder = await queryOne(`
        SELECT id, order_ref, status, total, created_at FROM orders
        WHERE table_id=$1 AND status NOT IN ('served','paid')
        ORDER BY id DESC LIMIT 1
      `, [t.id]);
      return { ...t, active_order: activeOrder || null };
    }));
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tables', async (req, res) => {
  try {
    const row = await run('INSERT INTO tables_list(name) VALUES($1) RETURNING id, name', [req.body.name]);
    res.json(row);
  } catch(e) { res.status(400).json({ error: 'Table name already exists' }); }
});

app.delete('/api/tables/:id', async (req, res) => {
  await query('UPDATE tables_list SET is_active=0 WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Menu
app.get('/api/menu', async (_, res) => {
  try {
    const categories = await query('SELECT * FROM categories WHERE is_active=1 ORDER BY sort_order');
    const items = await query('SELECT * FROM menu_items WHERE is_available=1 ORDER BY sort_order');
    res.json(categories.map(cat => ({
      ...cat,
      items: items.filter(i => i.category_id === cat.id)
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/menu/items', async (_, res) => {
  try {
    res.json(await query(`
      SELECT mi.*, c.name as category_name
      FROM menu_items mi JOIN categories c ON mi.category_id = c.id
      ORDER BY c.sort_order, mi.sort_order
    `));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/menu/items', async (req, res) => {
  try {
    const { category_id, name, description, price, sort_order } = req.body;
    const row = await run(
      'INSERT INTO menu_items(category_id,name,description,price,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [category_id, name, description || '', price, sort_order || 0]
    );
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/menu/items/:id', async (req, res) => {
  try {
    const { name, description, price, is_available, category_id } = req.body;
    await query(
      'UPDATE menu_items SET name=$1,description=$2,price=$3,is_available=$4,category_id=$5 WHERE id=$6',
      [name, description, price, is_available, category_id, req.params.id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/menu/items/:id', async (req, res) => {
  await query('UPDATE menu_items SET is_available=0 WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/menu/categories', async (_, res) => {
  res.json(await query('SELECT * FROM categories ORDER BY sort_order'));
});

app.post('/api/menu/categories', async (req, res) => {
  try {
    const row = await run(
      'INSERT INTO categories(name,sort_order) VALUES($1,$2) RETURNING id, name',
      [req.body.name, req.body.sort_order || 0]
    );
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Orders
app.post('/api/orders', async (req, res) => {
  const { table_id, items, notes } = req.body;
  if (!table_id || !items?.length) return res.status(400).json({ error: 'table_id and items required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const order_ref = await generateOrderRef(table_id);
    const orderRow = await client.query(
      'INSERT INTO orders(order_ref,table_id,notes) VALUES($1,$2,$3) RETURNING id',
      [order_ref, table_id, notes || '']
    );
    const orderId = orderRow.rows[0].id;

    let total = 0;
    for (const item of items) {
      const menuItem = (await client.query('SELECT * FROM menu_items WHERE id=$1', [item.item_id])).rows[0];
      if (!menuItem) throw new Error(`Item ${item.item_id} not found`);
      total += parseFloat(menuItem.price) * item.quantity;
      await client.query(
        'INSERT INTO order_items(order_id,item_id,name,price,quantity,notes) VALUES($1,$2,$3,$4,$5,$6)',
        [orderId, item.item_id, menuItem.name, menuItem.price, item.quantity, item.notes || '']
      );
    }

    await client.query('UPDATE orders SET total=$1 WHERE id=$2', [total, orderId]);
    await client.query('COMMIT');

    const order = await getOrderDetail(orderId);
    broadcast('order:new', order);
    res.json(order);
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { status, table_id, date } = req.query;
    let conditions = [];
    let params = [];
    let idx = 1;

    if (status) {
      const list = status.split(',').map(s => `'${s.trim()}'`).join(',');
      conditions.push(`o.status IN (${list})`);
    }
    if (table_id) { conditions.push(`o.table_id=$${idx++}`); params.push(table_id); }
    if (date) { conditions.push(`DATE(o.created_at)=$${idx++}`); params.push(date); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const orders = await query(`
      SELECT o.*, t.name as table_name
      FROM orders o JOIN tables_list t ON o.table_id = t.id
      ${where} ORDER BY o.created_at DESC
    `, params);

    const enriched = await Promise.all(orders.map(async o => ({
      ...o,
      items: await query('SELECT * FROM order_items WHERE order_id=$1', [o.id])
    })));
    res.json(enriched);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/ref/:ref', async (req, res) => {
  try {
    const o = await queryOne('SELECT * FROM orders WHERE order_ref=$1', [req.params.ref]);
    if (!o) return res.status(404).json({ error: 'Not found' });
    res.json(await getOrderDetail(o.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await getOrderDetail(req.params.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['new','accepted','preparing','ready','served','paid'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await query('UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.id]);
    const order = await getOrderDetail(req.params.id);
    broadcast('order:status', { id: order.id, order_ref: order.order_ref, status, table_name: order.table_name });
    res.json(order);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/orders/:id/payment', async (req, res) => {
  try {
    const { payment_status, payment_method } = req.body;
    await query(
      "UPDATE orders SET payment_status=$1, payment_method=$2, status='paid', updated_at=NOW() WHERE id=$3",
      [payment_status, payment_method || 'cash', req.params.id]
    );
    const order = await getOrderDetail(req.params.id);
    broadcast('order:payment', { id: order.id, order_ref: order.order_ref, payment_status, table_name: order.table_name });
    res.json(order);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders/:id/items', async (req, res) => {
  try {
    const { items } = req.body;
    const orderId = req.params.id;
    let added = 0;
    for (const item of items) {
      const menuItem = await queryOne('SELECT * FROM menu_items WHERE id=$1', [item.item_id]);
      added += parseFloat(menuItem.price) * item.quantity;
      await query(
        'INSERT INTO order_items(order_id,item_id,name,price,quantity,notes) VALUES($1,$2,$3,$4,$5,$6)',
        [orderId, item.item_id, menuItem.name, menuItem.price, item.quantity, item.notes || '']
      );
    }
    await query('UPDATE orders SET total = total + $1 WHERE id=$2', [added, orderId]);
    const order = await getOrderDetail(orderId);
    broadcast('order:updated', order);
    res.json(order);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Reports
app.get('/api/reports/daily', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const summary = await queryOne(`
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN payment_status='paid' THEN total ELSE 0 END) as revenue,
        SUM(CASE WHEN payment_status='pending' THEN total ELSE 0 END) as pending_amount
      FROM orders WHERE DATE(created_at) = $1
    `, [date]);

    const byTable = await query(`
      SELECT t.name as table_name, COUNT(o.id) as orders, SUM(o.total) as total
      FROM orders o JOIN tables_list t ON o.table_id = t.id
      WHERE DATE(o.created_at) = $1
      GROUP BY t.id, t.name ORDER BY total DESC
    `, [date]);

    const topItems = await query(`
      SELECT oi.name, SUM(oi.quantity) as qty, SUM(oi.price * oi.quantity) as revenue
      FROM order_items oi JOIN orders o ON oi.order_id = o.id
      WHERE DATE(o.created_at) = $1
      GROUP BY oi.name ORDER BY qty DESC LIMIT 10
    `, [date]);

    res.json({ date, summary, byTable, topItems });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/qr/:tableId', async (req, res) => {
  const t = await queryOne('SELECT * FROM tables_list WHERE id=$1', [req.params.tableId]);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  res.json({ url: `${protocol}://${host}/order?table=${req.params.tableId}`, table_name: t.name });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\n☕  BrewDesk running on port ${PORT}`);
      console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   DB:  ${process.env.DATABASE_URL ? 'PostgreSQL (cloud)' : 'NOT CONNECTED'}\n`);
    });
  })
  .catch(err => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });

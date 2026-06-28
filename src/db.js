const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function toBool(value) {
  return value === true || value === 1 || value === "1";
}

function normalizeProduct(row) {
  if (!row) return row;
  return {
    ...row,
    price: Number(row.price),
    has_youtube_membership: toBool(row.has_youtube_membership),
    is_active: toBool(row.is_active)
  };
}

function normalizeOrder(row) {
  if (!row) return row;
  return {
    ...row,
    total_amount: Number(row.total_amount),
    payment_confirmed: toBool(row.payment_confirmed),
    delivery_completed: toBool(row.delivery_completed),
    items: row.items || []
  };
}

function createDatabase(databasePath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "app.db")) {
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("foreign_keys = ON");

  async function migrate() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        price INTEGER NOT NULL CHECK (price >= 0),
        summary TEXT NOT NULL,
        table_of_contents TEXT NOT NULL,
        has_youtube_membership INTEGER NOT NULL DEFAULT 0,
        cover_image_url TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        receipt_type TEXT NOT NULL CHECK (receipt_type IN ('cash_receipt', 'tax_invoice')),
        email TEXT NOT NULL,
        total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
        payment_confirmed INTEGER NOT NULL DEFAULT 0,
        delivery_completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_title TEXT NOT NULL,
        product_price INTEGER NOT NULL CHECK (product_price >= 0)
      );
    `);
  }

  async function createProduct(product) {
    const result = db.prepare(`
      INSERT INTO products (
        title, author, price, summary, table_of_contents,
        has_youtube_membership, cover_image_url, is_active
      )
      VALUES (@title, @author, @price, @summary, @tableOfContents, @hasYoutubeMembership, @coverImageUrl, @isActive)
    `).run({
      title: product.title,
      author: product.author,
      price: Number(product.price),
      summary: product.summary,
      tableOfContents: product.tableOfContents,
      hasYoutubeMembership: product.hasYoutubeMembership ? 1 : 0,
      coverImageUrl: product.coverImageUrl || "",
      isActive: product.isActive !== false ? 1 : 0
    });
    return getProduct(result.lastInsertRowid, { includeInactive: true });
  }

  async function updateProduct(id, product) {
    db.prepare(`
      UPDATE products
      SET title = @title,
          author = @author,
          price = @price,
          summary = @summary,
          table_of_contents = @tableOfContents,
          has_youtube_membership = @hasYoutubeMembership,
          cover_image_url = @coverImageUrl,
          is_active = @isActive,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      id: Number(id),
      title: product.title,
      author: product.author,
      price: Number(product.price),
      summary: product.summary,
      tableOfContents: product.tableOfContents,
      hasYoutubeMembership: product.hasYoutubeMembership ? 1 : 0,
      coverImageUrl: product.coverImageUrl || "",
      isActive: product.isActive !== false ? 1 : 0
    });
    return getProduct(id, { includeInactive: true });
  }

  async function listProducts({ page = 1, pageSize = 10, includeInactive = false } = {}) {
    const offset = (page - 1) * pageSize;
    const where = includeInactive ? "" : "WHERE is_active = 1";
    const count = db.prepare(`SELECT COUNT(*) AS count FROM products ${where}`).get().count;
    const items = db.prepare(`
      SELECT *
      FROM products
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(pageSize, offset).map(normalizeProduct);
    return {
      items,
      total: Number(count),
      page,
      pageSize
    };
  }

  async function getProduct(id, { includeInactive = false } = {}) {
    const row = db.prepare(`
      SELECT *
      FROM products
      WHERE id = ? AND (? = 1 OR is_active = 1)
    `).get(Number(id), includeInactive ? 1 : 0);
    return normalizeProduct(row);
  }

  async function getProductsByIds(ids) {
    const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => "?").join(", ");
    return db.prepare(`
      SELECT *
      FROM products
      WHERE is_active = 1 AND id IN (${placeholders})
      ORDER BY title ASC
    `).all(...uniqueIds).map(normalizeProduct);
  }

  async function createOrder(order) {
    const products = await getProductsByIds(order.productIds || []);
    if (products.length === 0) {
      throw new Error("ORDER_REQUIRES_PRODUCTS");
    }
    const totalAmount = products.reduce((sum, product) => sum + product.price, 0);

    const transaction = db.transaction(() => {
      const orderResult = db.prepare(`
        INSERT INTO orders (customer_name, phone, receipt_type, email, total_amount)
        VALUES (@customerName, @phone, @receiptType, @email, @totalAmount)
      `).run({
        customerName: order.customerName,
        phone: order.phone,
        receiptType: order.receiptType,
        email: order.email,
        totalAmount
      });

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_title, product_price)
        VALUES (@orderId, @productId, @productTitle, @productPrice)
      `);
      for (const product of products) {
        insertItem.run({
          orderId: orderResult.lastInsertRowid,
          productId: product.id,
          productTitle: product.title,
          productPrice: product.price
        });
      }
      return Number(orderResult.lastInsertRowid);
    });

    const orderId = transaction();
    const created = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
    return normalizeOrder({
      ...created,
      items: products.map((product) => ({
        product_id: product.id,
        product_title: product.title,
        product_price: product.price
      }))
    });
  }

  async function listOrders() {
    const orders = db.prepare(`
      SELECT *
      FROM orders
      ORDER BY created_at DESC, id DESC
    `).all();
    const items = db.prepare(`
      SELECT *
      FROM order_items
      ORDER BY id ASC
    `).all();
    const itemsByOrder = new Map();
    for (const item of items) {
      const list = itemsByOrder.get(item.order_id) || [];
      list.push({ ...item, product_price: Number(item.product_price) });
      itemsByOrder.set(item.order_id, list);
    }
    return orders.map((row) => normalizeOrder({ ...row, items: itemsByOrder.get(row.id) || [] }));
  }

  async function setPaymentConfirmed(id, confirmed) {
    db.prepare(`
      UPDATE orders
      SET payment_confirmed = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(confirmed ? 1 : 0, Number(id));
    return normalizeOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id)));
  }

  async function setDeliveryCompleted(id, delivered) {
    db.prepare(`
      UPDATE orders
      SET delivery_completed = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(delivered ? 1 : 0, Number(id));
    return normalizeOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(id)));
  }

  function close() {
    db.close();
  }

  return {
    close,
    createOrder,
    createProduct,
    getProduct,
    getProductsByIds,
    listOrders,
    listProducts,
    migrate,
    setDeliveryCompleted,
    setPaymentConfirmed,
    updateProduct
  };
}

module.exports = {
  createDatabase
};

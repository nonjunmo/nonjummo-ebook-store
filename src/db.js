const { Pool } = require("pg");

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

function createDatabase({ pool, connectionString } = {}) {
  const dbPool = pool || new Pool({
    connectionString: connectionString || process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
  });

  async function query(sql, params = []) {
    return dbPool.query(sql, params);
  }

  async function migrate() {
    await query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        price INTEGER NOT NULL CHECK (price >= 0),
        summary TEXT NOT NULL,
        table_of_contents TEXT NOT NULL,
        has_youtube_membership BOOLEAN NOT NULL DEFAULT FALSE,
        cover_image_url TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        receipt_type TEXT NOT NULL CHECK (receipt_type IN ('cash_receipt', 'tax_invoice')),
        email TEXT NOT NULL,
        total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
        payment_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
        delivery_completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_title TEXT NOT NULL,
        product_price INTEGER NOT NULL CHECK (product_price >= 0)
      );
    `);
  }

  async function createProduct(product) {
    const result = await query(
      `
        INSERT INTO products (
          title, author, price, summary, table_of_contents,
          has_youtube_membership, cover_image_url, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        product.title,
        product.author,
        Number(product.price),
        product.summary,
        product.tableOfContents,
        Boolean(product.hasYoutubeMembership),
        product.coverImageUrl || "",
        product.isActive !== false
      ]
    );
    return normalizeProduct(result.rows[0]);
  }

  async function listProducts({ page = 1, pageSize = 10, includeInactive = false } = {}) {
    const offset = (page - 1) * pageSize;
    const where = includeInactive ? "" : "WHERE is_active = TRUE";
    const countResult = await query(`SELECT COUNT(*)::int AS count FROM products ${where}`);
    const result = await query(
      `
        SELECT *
        FROM products
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $1 OFFSET $2
      `,
      [pageSize, offset]
    );
    return {
      items: result.rows.map(normalizeProduct),
      total: Number(countResult.rows[0].count),
      page,
      pageSize
    };
  }

  async function getProduct(id, { includeInactive = false } = {}) {
    const result = await query(
      `
        SELECT *
        FROM products
        WHERE id = $1 AND ($2 = TRUE OR is_active = TRUE)
      `,
      [Number(id), Boolean(includeInactive)]
    );
    return normalizeProduct(result.rows[0]);
  }

  async function getProductsByIds(ids) {
    const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map((_, index) => `$${index + 1}`).join(", ");
    const result = await query(
      `
        SELECT *
        FROM products
        WHERE is_active = TRUE AND id IN (${placeholders})
        ORDER BY title ASC
      `,
      uniqueIds
    );
    return result.rows.map(normalizeProduct);
  }

  async function createOrder(order) {
    const products = await getProductsByIds(order.productIds || []);
    if (products.length === 0) {
      throw new Error("ORDER_REQUIRES_PRODUCTS");
    }
    const totalAmount = products.reduce((sum, product) => sum + product.price, 0);
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const orderResult = await client.query(
        `
          INSERT INTO orders (customer_name, phone, receipt_type, email, total_amount)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        [order.customerName, order.phone, order.receiptType, order.email, totalAmount]
      );
      const created = orderResult.rows[0];
      for (const product of products) {
        await client.query(
          `
            INSERT INTO order_items (order_id, product_id, product_title, product_price)
            VALUES ($1, $2, $3, $4)
          `,
          [created.id, product.id, product.title, product.price]
        );
      }
      await client.query("COMMIT");
      return normalizeOrder({ ...created, items: products.map((product) => ({
        product_id: product.id,
        product_title: product.title,
        product_price: product.price
      })) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function listOrders() {
    const result = await query(`
      SELECT *
      FROM orders
      ORDER BY created_at DESC, id DESC
    `);
    const itemResult = await query(`
      SELECT *
      FROM order_items
      ORDER BY id ASC
    `);
    const itemsByOrder = new Map();
    for (const item of itemResult.rows) {
      const list = itemsByOrder.get(item.order_id) || [];
      list.push({ ...item, product_price: Number(item.product_price) });
      itemsByOrder.set(item.order_id, list);
    }
    return result.rows.map((row) => normalizeOrder({ ...row, items: itemsByOrder.get(row.id) || [] }));
  }

  async function setPaymentConfirmed(id, confirmed) {
    const result = await query(
      `
        UPDATE orders
        SET payment_confirmed = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [Boolean(confirmed), Number(id)]
    );
    return normalizeOrder(result.rows[0]);
  }

  async function setDeliveryCompleted(id, delivered) {
    const result = await query(
      `
        UPDATE orders
        SET delivery_completed = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [Boolean(delivered), Number(id)]
    );
    return normalizeOrder(result.rows[0]);
  }

  return {
    createOrder,
    createProduct,
    getProduct,
    getProductsByIds,
    listOrders,
    listProducts,
    migrate,
    pool: dbPool,
    setDeliveryCompleted,
    setPaymentConfirmed
  };
}

module.exports = {
  createDatabase
};

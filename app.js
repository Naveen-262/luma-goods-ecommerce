const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ecommerce_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: false
});

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(status, code, message, details) {
  throw new HttpError(status, code, message, details);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(400, 'VALIDATION_ERROR', `${field} is required and must be a non-empty string.`);
  }

  const result = value.trim();
  if (result.length > maxLength) {
    fail(400, 'VALIDATION_ERROR', `${field} must be ${maxLength} characters or fewer.`);
  }
  return result;
}

function positiveInteger(value, field) {
  const text = typeof value === 'number' ? String(value) : value;
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^\d+$/.test(text) ||
    !Number.isSafeInteger(Number(text)) ||
    Number(text) < 1
  ) {
    fail(400, 'VALIDATION_ERROR', `${field} must be a positive integer.`);
  }
  return Number(text);
}

function optionalPositiveInteger(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return positiveInteger(value, field);
}

function validEmail(value) {
  const email = requiredString(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, 'VALIDATION_ERROR', 'email must be a valid email address.');
  }
  return email;
}

function decimalToCents(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    fail(500, 'DATABASE_ERROR', 'A product has an invalid price.');
  }
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(`${whole}${fraction.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(cents)) {
    fail(500, 'DATABASE_ERROR', 'A product price is too large.');
  }
  return cents;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function validateOrderBody(body) {
  if (!isPlainObject(body)) {
    fail(400, 'VALIDATION_ERROR', 'The request body must be a JSON object.');
  }

  const rawItems = body.items || body.products;
  let items = rawItems;
  if (!items && (body.product_id !== undefined || body.productId !== undefined)) {
    items = [{
      product_id: firstDefined(body.product_id, body.productId),
      quantity: body.quantity
    }];
  }

  if (!Array.isArray(items) || items.length === 0) {
    fail(400, 'VALIDATION_ERROR', 'items must be a non-empty array.');
  }
  if (items.length > 50) {
    fail(400, 'VALIDATION_ERROR', 'An order cannot contain more than 50 line items.');
  }

  const combinedItems = new Map();
  items.forEach((item, index) => {
    if (!isPlainObject(item)) {
      fail(400, 'VALIDATION_ERROR', `items[${index}] must be an object.`);
    }
    const productId = positiveInteger(
      firstDefined(item.product_id, item.productId, item.id),
      `items[${index}].product_id`
    );
    const quantity = positiveInteger(item.quantity, `items[${index}].quantity`);
    if (quantity > 100) {
      fail(400, 'VALIDATION_ERROR', `items[${index}].quantity cannot exceed 100.`);
    }
    combinedItems.set(productId, (combinedItems.get(productId) || 0) + quantity);
  });

  for (const [productId, quantity] of combinedItems) {
    if (quantity > 100) {
      fail(400, 'VALIDATION_ERROR', `The total quantity for product ${productId} cannot exceed 100.`);
    }
  }

  const customer = isPlainObject(body.customer) ? body.customer : body;
  const name = requiredString(
    firstDefined(customer.name, customer.full_name, customer.customer_name, body.customer_name),
    'name',
    100
  );
  const email = validEmail(
    firstDefined(customer.email, customer.customer_email, body.customer_email)
  );
  const address = requiredString(
    firstDefined(
      customer.address,
      customer.shipping_address,
      body.address,
      body.shipping_address
    ),
    'shipping_address',
    500
  );

  return {
    items: [...combinedItems].map(([productId, quantity]) => ({ productId, quantity })),
    name,
    email,
    address,
    userId: optionalPositiveInteger(firstDefined(body.user_id, body.userId), 'user_id')
  };
}

function productResponse(product) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    image_url: product.image_url,
    stock: product.stock
  };
}

async function withTransaction(db, callback) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function createApp(db = pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/products', async (req, res, next) => {
    try {
      const [rows] = await db.execute(
        'SELECT id, name, description, price, image_url, stock FROM products ORDER BY id ASC'
      );
      res.json(rows.map(productResponse));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/products/:id', async (req, res, next) => {
    try {
      const id = positiveInteger(req.params.id, 'id');
      const [rows] = await db.execute(
        'SELECT id, name, description, price, image_url, stock FROM products WHERE id = ?',
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({
          error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' }
        });
      }
      return res.json(productResponse(rows[0]));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/orders', async (req, res, next) => {
    try {
      const order = validateOrderBody(req.body);
      const result = await withTransaction(db, async (connection) => {
        const ids = order.items.map((item) => item.productId);
        const placeholders = ids.map(() => '?').join(', ');
        const [products] = await connection.execute(
          `SELECT id, name, price, image_url, stock FROM products WHERE id IN (${placeholders}) FOR UPDATE`,
          ids
        );
        const productsById = new Map(products.map((product) => [product.id, product]));
        const missingId = ids.find((id) => !productsById.has(id));
        if (missingId !== undefined) {
          fail(404, 'PRODUCT_NOT_FOUND', `Product ${missingId} was not found.`);
        }

        let totalCents = 0;
        const orderItems = order.items.map(({ productId, quantity }) => {
          const product = productsById.get(productId);
          if (product.stock !== null && Number(product.stock) < quantity) {
            fail(409, 'INSUFFICIENT_STOCK', `Product ${productId} does not have enough stock.`);
          }
          const unitPriceCents = decimalToCents(product.price);
          totalCents += unitPriceCents * quantity;
          if (!Number.isSafeInteger(totalCents)) {
            fail(400, 'VALIDATION_ERROR', 'The order total is too large.');
          }
          return {
            product_id: product.id,
            name: product.name,
            quantity,
            unit_price: Number((unitPriceCents / 100).toFixed(2))
          };
        });

        let userId = order.userId;
        if (userId !== null) {
          const [users] = await connection.execute('SELECT id FROM users WHERE id = ?', [userId]);
          if (users.length === 0) {
            fail(404, 'USER_NOT_FOUND', 'The supplied user_id was not found.');
          }
        } else {
          const [userResult] = await connection.execute(
            `INSERT INTO users (name, email, address)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), name = VALUES(name), address = VALUES(address)`,
            [order.name, order.email, order.address]
          );
          userId = userResult.insertId;
        }

        const orderReference = crypto.randomUUID();
        const totalAmount = (totalCents / 100).toFixed(2);
        const legacyProductId = orderItems.length === 1 ? orderItems[0].product_id : null;
        const legacyQuantity = orderItems.length === 1 ? orderItems[0].quantity : null;
        const [orderResult] = await connection.execute(
          `INSERT INTO orders
            (order_reference, user_id, product_id, quantity, customer_name, customer_email,
             shipping_address, items_json, total_price, total_amount, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderReference,
            userId,
            legacyProductId,
            legacyQuantity,
            order.name,
            order.email,
            order.address,
            JSON.stringify(orderItems),
            totalAmount,
            totalAmount,
            'pending'
          ]
        );

        for (const item of order.items) {
          await connection.execute(
            'UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL',
            [item.quantity, item.productId]
          );
        }

        return {
          id: orderResult.insertId,
          order_reference: orderReference,
          user_id: userId,
          items: orderItems,
          total_amount: Number(totalAmount),
          status: 'pending'
        };
      });

      return res.status(201).json({ order: result });
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'API route not found.' }
    });
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' }
      });
    }
    const status = error instanceof HttpError && error.status ? error.status : 500;
    const response = {
      error: {
        code: error instanceof HttpError ? error.code : 'INTERNAL_SERVER_ERROR',
        message: error instanceof HttpError ? error.message : 'An unexpected server error occurred.'
      }
    };
    if (error instanceof HttpError && error.details !== undefined) response.error.details = error.details;
    if (status >= 500) console.error(error);
    return res.status(status).json(response);
  });

  return app;
}

module.exports = { createApp, pool, HttpError };

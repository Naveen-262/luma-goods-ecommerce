const assert = require('node:assert/strict');
const { after, before, describe, it } = require('node:test');
const { createApp } = require('../app');

const product = {
  id: 1,
  name: 'Demo Product',
  description: 'A demo product',
  price: '12.50',
  image_url: 'https://example.test/demo.jpg',
  stock: 5
};

function createMockDatabase() {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push('begin'); },
    async commit() { calls.push('commit'); },
    async rollback() { calls.push('rollback'); },
    release() { calls.push('release'); },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM products WHERE id IN')) return [[product], []];
      if (sql.includes('INSERT INTO users')) return [{ insertId: 7 }, []];
      if (sql.includes('INSERT INTO orders')) return [{ insertId: 42 }, []];
      if (sql.includes('UPDATE products')) return [{ affectedRows: 1 }, []];
      throw new Error(`Unexpected transaction query: ${sql}`);
    }
  };

  return {
    calls,
    execute: async (sql) => {
      if (sql.includes('FROM products ORDER BY')) return [[product], []];
      if (sql.includes('FROM products WHERE id = ?')) return [[product], []];
      throw new Error(`Unexpected read query: ${sql}`);
    },
    getConnection: async () => connection
  };
}

function startTestServer(db) {
  const app = createApp(db);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

describe('e-commerce API', () => {
  let db;
  let server;
  let baseUrl;

  before(async () => {
    db = createMockDatabase();
    ({ server, baseUrl } = await startTestServer(db));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns the product catalogue and a product detail', async () => {
    const listResponse = await fetch(`${baseUrl}/api/products`);
    assert.equal(listResponse.status, 200);
    assert.deepEqual((await listResponse.json())[0], {
      id: 1,
      name: 'Demo Product',
      description: 'A demo product',
      price: 12.5,
      image_url: 'https://example.test/demo.jpg',
      stock: 5
    });

    const detailResponse = await fetch(`${baseUrl}/api/products/1`);
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).price, 12.5);
  });

  it('rejects an invalid order before opening a transaction', async () => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(db.calls.includes('begin'), false);
  });

  it('creates an order, calculates the total, and commits stock changes', async () => {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          address: '1 Example Street'
        },
        items: [{ product_id: 1, quantity: 2 }]
      })
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.order.id, 42);
    assert.equal(body.order.user_id, 7);
    assert.equal(body.order.total_amount, 25);
    assert.equal(body.order.items[0].quantity, 2);
    assert.equal(db.calls.includes('begin'), true);
    assert.equal(db.calls.includes('commit'), true);
    assert.equal(db.calls.includes('release'), true);
  });
});

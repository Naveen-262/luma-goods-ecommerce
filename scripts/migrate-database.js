require('dotenv').config();

const mysql = require('mysql2/promise');

const databaseName = process.env.DB_NAME || 'ecommerce_db';
const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || ''
};

function quoteIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

async function createDatabaseIfPossible() {
  let connection;
  try {
    connection = await mysql.createConnection(connectionConfig);
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(databaseName)}
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`Database ${databaseName} is ready.`);
  } catch (error) {
    // A restricted account may be unable to create a database that already
    // exists. The database connection below gives the useful final error if
    // it is actually unavailable.
    console.warn(`Could not create database ${databaseName}: ${error.message}`);
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

async function columnInfo(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return rows[0] || null;
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );
  return rows.length > 0;
}

async function ensureColumn(connection, tableName, columnName, definition) {
  // Check information_schema immediately before the ALTER so reruns do not
  // attempt to add a column that is already present.
  if (await columnInfo(connection, tableName, columnName)) return false;

  await connection.query(
    `ALTER TABLE ${quoteIdentifier(tableName)}
     ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`
  );
  console.log(`Added ${tableName}.${columnName}.`);
  return true;
}

async function makeColumnNullable(connection, tableName, columnName) {
  // Read the existing type instead of replacing it, so this change only
  // relaxes nullability on an older compatible schema.
  const column = await columnInfo(connection, tableName, columnName);
  if (!column || column.IS_NULLABLE === 'YES') return false;

  await connection.query(
    `ALTER TABLE ${quoteIdentifier(tableName)}
     MODIFY COLUMN ${quoteIdentifier(columnName)} ${column.COLUMN_TYPE} NULL`
  );
  console.log(`Made ${tableName}.${columnName} nullable.`);
  return true;
}

async function indexInfo(connection, tableName, indexName, columns, unique) {
  const [rows] = await connection.execute(
    `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [tableName]
  );

  const indexes = new Map();
  for (const row of rows) {
    if (!indexes.has(row.INDEX_NAME)) {
      indexes.set(row.INDEX_NAME, {
        nonUnique: row.NON_UNIQUE,
        columns: []
      });
    }
    indexes.get(row.INDEX_NAME).columns[row.SEQ_IN_INDEX - 1] = row.COLUMN_NAME;
  }

  const requestedColumns = columns.join(',');
  for (const [existingName, index] of indexes) {
    const sameColumns = index.columns.join(',') === requestedColumns;
    const sameName = existingName === indexName;
    const isAcceptable = !unique || Number(index.nonUnique) === 0;
    // An index with the requested name is already present, so leave it alone
    // rather than failing on a duplicate-name ALTER. A differently named
    // equivalent index is reusable only when it also has the required
    // uniqueness.
    if (sameName || (sameColumns && isAcceptable)) return index;
  }
  return null;
}

async function ensureIndex(connection, tableName, indexName, definition, columns, unique) {
  // Check information_schema immediately before the ALTER for idempotence.
  if (await indexInfo(connection, tableName, indexName, columns, unique)) return false;

  await connection.query(
    `ALTER TABLE ${quoteIdentifier(tableName)}
     ADD ${definition} ${quoteIdentifier(indexName)}
     (${columns.map(quoteIdentifier).join(', ')})`
  );
  console.log(`Added index ${tableName}.${indexName}.`);
  return true;
}

async function copyProductImages(connection) {
  const imageColumn = await columnInfo(connection, 'products', 'image');
  const imageUrlColumn = await columnInfo(connection, 'products', 'image_url');
  if (!imageColumn || !imageUrlColumn) return;

  const [result] = await connection.query(
    `UPDATE ${quoteIdentifier('products')}
        SET ${quoteIdentifier('image_url')} = ${quoteIdentifier('image')}
      WHERE ${quoteIdentifier('image_url')} IS NULL
        AND ${quoteIdentifier('image')} IS NOT NULL`
  );
  if (result.affectedRows > 0) {
    console.log(`Copied ${result.affectedRows} product image value(s) to image_url.`);
  }
}

async function migrate() {
  await createDatabaseIfPossible();

  const connection = await mysql.createConnection({
    ...connectionConfig,
    database: databaseName
  });

  try {
    for (const tableName of ['products', 'users', 'orders']) {
      if (!(await tableExists(connection, tableName))) {
        throw new Error(
          `Required table ${tableName} does not exist in ${databaseName}. ` +
            'Import database/schema.sql before running this migration.'
        );
      }
    }

    await ensureColumn(connection, 'products', 'image_url', 'VARCHAR(500) NULL');
    await copyProductImages(connection);

    await ensureColumn(connection, 'users', 'address', 'VARCHAR(500) NULL');

    await ensureColumn(connection, 'orders', 'order_reference', 'CHAR(36) NULL');
    await ensureColumn(connection, 'orders', 'customer_name', 'VARCHAR(100) NULL');
    await ensureColumn(connection, 'orders', 'customer_email', 'VARCHAR(254) NULL');
    await ensureColumn(connection, 'orders', 'shipping_address', 'VARCHAR(500) NULL');
    await ensureColumn(connection, 'orders', 'items_json', 'JSON NULL');
    await ensureColumn(connection, 'orders', 'total_amount', 'DECIMAL(10, 2) UNSIGNED NULL');
    await ensureColumn(
      connection,
      'orders',
      'status',
      "VARCHAR(30) NULL DEFAULT 'pending'"
    );

    await makeColumnNullable(connection, 'orders', 'product_id');
    await makeColumnNullable(connection, 'orders', 'quantity');

    await ensureIndex(connection, 'users', 'uq_users_email', 'UNIQUE KEY', ['email'], true);
    await ensureIndex(
      connection,
      'orders',
      'uq_orders_reference',
      'UNIQUE KEY',
      ['order_reference'],
      true
    );
    await ensureIndex(connection, 'orders', 'idx_orders_user_id', 'KEY', ['user_id'], false);
    await ensureIndex(
      connection,
      'orders',
      'idx_orders_product_id',
      'KEY',
      ['product_id'],
      false
    );

    console.log('Database migration completed.');
  } finally {
    await connection.end();
  }
}

migrate().catch((error) => {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const mysql = require('mysql2/promise');

const PRODUCT_IMAGE_PATHS = Object.freeze({
  1: '/images/products/wireless-headphones-1.jpg',
  2: '/images/products/smart-watch-1.jpg',
  3: '/images/products/running-shoes-1.jpg',
  4: '/images/products/travel-backpack-1.jpg',
  5: '/images/products/bluetooth-speaker-1.jpg',
  6: '/images/products/classic-tshirt-1.jpg',
  7: '/images/products/wireless-headphones-2.jpg',
  8: '/images/products/smart-watch-2.jpg',
  9: '/images/products/running-shoes-2.jpg',
  10: '/images/products/travel-backpack-2.jpg',
  11: '/images/products/bluetooth-speaker-2.jpg',
  12: '/images/products/classic-tshirt-2.jpg'
});

const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'ecommerce_db'
};

const publicDirectory = path.join(__dirname, '..', 'public');

function localAssetPath(imagePath) {
  return path.join(publicDirectory, imagePath.replace(/^\//, '').replaceAll('/', path.sep));
}

function verifyLocalAssets() {
  for (const imagePath of Object.values(PRODUCT_IMAGE_PATHS)) {
    const filePath = localAssetPath(imagePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing local product image asset: ${imagePath}`);
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size === 0) {
      throw new Error(`Product image asset is empty or not a file: ${imagePath}`);
    }
  }
}

async function updateProductImages(connection) {
  const mappings = Object.entries(PRODUCT_IMAGE_PATHS).map(([id, imagePath]) => ({
    id: Number(id),
    imagePath
  }));
  const ids = mappings.map(({ id }) => id);
  const placeholders = ids.map(() => '?').join(', ');
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [rows] = await connection.execute(
      `SELECT id FROM products WHERE id IN (${placeholders}) FOR UPDATE`,
      ids
    );
    const existingIds = new Set(rows.map((row) => Number(row.id)));
    const missingIds = ids.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      throw new Error(`Missing product ID(s): ${missingIds.join(', ')}`);
    }

    const changedIds = [];
    for (const { id, imagePath } of mappings) {
      const [result] = await connection.execute(
        `UPDATE products
            SET image_url = ?
          WHERE id = ?
            AND (image_url IS NULL OR image_url <> ?)`,
        [imagePath, id, imagePath]
      );

      if (result.affectedRows > 0) changedIds.push(id);
    }

    await connection.commit();

    for (const id of changedIds) {
      console.log(`Updated product ${id}.`);
    }
    console.log(`Updated ${changedIds.length} product image(s).`);

    return changedIds;
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {});
    throw error;
  }
}

async function main() {
  verifyLocalAssets();
  const connection = await mysql.createConnection(connectionConfig);
  try {
    await updateProductImages(connection);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Product image update failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { PRODUCT_IMAGE_PATHS, updateProductImages };

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { PRODUCT_IMAGE_PATHS } = require('../scripts/update-product-images');

const publicDirectory = path.join(__dirname, '..', 'public');

describe('local product image assets', () => {
  it('contains a non-empty local image for every mapped product', () => {
    for (const [id, imagePath] of Object.entries(PRODUCT_IMAGE_PATHS)) {
      const filePath = path.join(publicDirectory, imagePath.replace(/^\//, '').replaceAll('/', path.sep));
      assert.equal(fs.existsSync(filePath), true, `product ${id} image should exist`);
      assert.ok(fs.statSync(filePath).size > 0, `product ${id} image should not be empty`);
      assert.match(imagePath, /^\/images\/products\/.+\.jpg$/);
    }
  });
});

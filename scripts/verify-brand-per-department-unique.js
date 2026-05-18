#!/usr/bin/env node
/**
 * Static check: brand/category duplicate logic scoped correctly for Stock.
 * Run: node scripts/verify-brand-per-department-unique.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const serverPath = path.join(__dirname, '..', 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');

assert.ok(
  src.includes('idx_brand_stock_category_name_lower'),
  'server.js should define per-category brand unique index'
);
assert.ok(
  src.includes('idx_category_department_name_lower'),
  'server.js should define per-department category unique index'
);
assert.ok(
  src.includes('ensureBrandStockCategorySchema'),
  'server.js should call ensureBrandStockCategorySchema'
);

const postStart = src.indexOf("app.post('/api/brands',");
const postEnd = src.indexOf("app.patch('/api/brands/:id',", postStart);
assert.ok(postStart !== -1 && postEnd > postStart, 'could not find POST /api/brands block');
const postBlock = src.slice(postStart, postEnd);
assert.ok(
  postBlock.includes('category_id = $1') &&
    postBlock.includes('stockCategoryId') &&
    postBlock.includes('category_id IS NULL'),
  'POST /api/brands must check duplicates per category when category_id is set'
);

const catPostStart = src.indexOf("app.post('/api/categories',");
const catPostEnd = src.indexOf("app.patch('/api/categories/:id',", catPostStart);
const catBlock = src.slice(catPostStart, catPostEnd);
assert.ok(
  catBlock.includes('ensureStockCategoryDepartmentSchema'),
  'POST /api/categories should run stock category schema migration'
);

console.log('verify-brand-per-department-unique: OK');

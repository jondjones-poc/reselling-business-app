#!/usr/bin/env node
/**
 * Static check: brand duplicate logic is scoped per department (not global name).
 * Run: node scripts/verify-brand-per-department-unique.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const serverPath = path.join(__dirname, '..', 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');

assert.ok(
  src.includes('idx_brand_department_name_lower'),
  'server.js should define composite unique index idx_brand_department_name_lower'
);
assert.ok(
  src.includes('ensureBrandUniquePerDepartmentSchema'),
  'server.js should call ensureBrandUniquePerDepartmentSchema from ensureBrandDepartmentSchema'
);

const postStart = src.indexOf("app.post('/api/brands',");
const postEnd = src.indexOf("app.patch('/api/brands/:id',", postStart);
assert.ok(postStart !== -1 && postEnd > postStart, 'could not find POST /api/brands block');
const postBlock = src.slice(postStart, postEnd);
assert.ok(
  postBlock.includes('department_id = $2') &&
    postBlock.includes('normalizedBrandName') &&
    !postBlock.match(
      /SELECT id FROM brand\s+WHERE LOWER\(TRIM\(brand_name\)\) = LOWER\(\$1\)\s*$/m
    ),
  'POST /api/brands duplicate check must include department_id (not name-only)'
);

console.log('verify-brand-per-department-unique: OK');

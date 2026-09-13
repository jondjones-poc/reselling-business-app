const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStockListOptions, buildStockListWhere } = require('./stockListQuery');

test('All is default and adds no sale restriction', () => {
  const result = buildStockListWhere(parseStockListOptions({}));
  assert.equal(result.whereSql, 'TRUE');
});
for (const status of ['sold', 'unsold']) {
  test(`${status} combines with search, platform, department, category, size and brand`, () => {
    const result = buildStockListWhere(parseStockListOptions({
      unsold: status, q: 'blue shirt', view: 'vinted', department_id: '2',
      category_id: '3', category_size_id: '4', brand_id: '5',
    }));
    assert.ok(result.whereSql.includes(status === 'sold'
      ? '(s.sale_date IS NOT NULL OR s.sale_price IS NOT NULL)'
      : '(s.sale_date IS NULL AND s.sale_price IS NULL)'));
    for (const fragment of ['s.item_name', 'TRIM(s.vinted_id)', 'c.department_id =', 's.category_id =', 's.category_size_id =', 's.brand_id =']) {
      assert.ok(result.whereSql.includes(fragment), fragment);
    }
    assert.deepEqual(result.params, ['blue shirt', '%blue%', '%shirt%', 2, 3, 5, 4]);
    assert.equal(result.needsCategoryJoin, true);
  });
}

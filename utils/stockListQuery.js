const { normalizeDateOnlyString } = require('./dateOnly');

const STOCK_SORT_COLUMNS = {
  id: 's.id',
  item_name: 'LOWER(COALESCE(s.item_name, \'\'))',
  category_id: 'LOWER(COALESCE(c.category_name, \'\'))',
  purchase_price: 's.purchase_price',
  purchase_date: 's.purchase_date',
  sale_date: 's.sale_date',
};

const DEFAULT_SORT = 'id';
const DEFAULT_ORDER = 'desc';

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function parseStockListOptions(query = {}) {
  const page = parsePositiveInt(query.page, 1);
  const limitRaw = parsePositiveInt(query.limit, 50);
  const limit = Math.min(Math.max(limitRaw, 1), query.export === '1' ? 10000 : 200);
  const sortKey = String(query.sort ?? DEFAULT_SORT).trim();
  const sort = Object.prototype.hasOwnProperty.call(STOCK_SORT_COLUMNS, sortKey) ? sortKey : DEFAULT_SORT;
  const orderRaw = String(query.order ?? DEFAULT_ORDER).trim().toLowerCase();
  const order = orderRaw === 'asc' ? 'asc' : 'desc';
  const q = String(query.q ?? query.search ?? '').trim();
  const unsold = String(query.unsold ?? 'off').trim();
  const view = String(query.view ?? 'all').trim();
  const month = String(query.month ?? '').trim();
  const year = String(query.year ?? 'all-time').trim();
  const week = String(query.week ?? 'off').trim();
  const weekStart = String(query.week_start ?? '').trim();
  const categoryIdRaw = query.category_id;
  const categoryId =
    categoryIdRaw != null && String(categoryIdRaw).trim() !== ''
      ? parsePositiveInt(categoryIdRaw, 0)
      : null;
  const editId =
    query.edit_id != null && String(query.edit_id).trim() !== ''
      ? parsePositiveInt(query.edit_id, 0)
      : null;
  const toListCategoryId =
    query.to_list_category_id != null && String(query.to_list_category_id).trim() !== ''
      ? parsePositiveInt(query.to_list_category_id, 0)
      : null;

  return {
    page,
    limit,
    sort,
    order,
    q,
    unsold,
    view,
    month,
    year,
    week,
    weekStart,
    categoryId: categoryId && categoryId > 0 ? categoryId : null,
    editId: editId && editId > 0 ? editId : null,
    toListCategoryId: toListCategoryId && toListCategoryId > 0 ? toListCategoryId : null,
    isExport: query.export === '1',
  };
}

function isUnsoldSalePriceSql(column = 's.sale_price') {
  return `(${column} IS NULL OR TRIM(COALESCE(${column}::text, '')) = '' OR ${column}::numeric <= 0)`;
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function dateInWeekSql(dateColumn, weekStartParam, weekEndParam) {
  return `${dateColumn} IS NOT NULL AND ${dateColumn}::date >= ${weekStartParam}::date AND ${dateColumn}::date <= ${weekEndParam}::date`;
}

function dateInMonthYearSql(dateColumn, monthParam, yearParam) {
  return `${dateColumn} IS NOT NULL AND EXTRACT(MONTH FROM ${dateColumn})::int = ${monthParam}::int AND EXTRACT(YEAR FROM ${dateColumn})::int = ${yearParam}::int`;
}

function dateInLast30DaysSql(dateColumn) {
  return `${dateColumn} IS NOT NULL AND ${dateColumn}::date >= (CURRENT_DATE - INTERVAL '30 days') AND ${dateColumn}::date <= CURRENT_DATE`;
}

function buildSearchClause(q, params) {
  if (!q) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const parts = [];
  const idParam = addParam(params, q);
  parts.push(`CAST(s.id AS TEXT) ILIKE '%' || ${idParam} || '%'`);
  parts.push(`COALESCE(s.vinted_id, '') ILIKE '%' || ${idParam} || '%'`);
  parts.push(`COALESCE(s.ebay_id, '') ILIKE '%' || ${idParam} || '%'`);
  if (words.length > 0) {
    const wordClauses = words.map((word) => {
      const p = addParam(params, `%${word}%`);
      return `LOWER(COALESCE(s.item_name, '')) LIKE ${p}`;
    });
    parts.push(`(${wordClauses.join(' AND ')})`);
  }
  return `(${parts.join(' OR ')})`;
}

function buildViewClause(view, toListCategoryId, params) {
  switch (view) {
    case 'active-listing':
      return 's.purchase_date IS NOT NULL AND s.sale_date IS NULL';
    case 'list-on-vinted':
      return `${isUnsoldSalePriceSql()} AND (s.vinted_id IS NULL OR TRIM(s.vinted_id) = '')`;
    case 'list-on-ebay':
      return `${isUnsoldSalePriceSql()} AND (s.ebay_id IS NULL OR TRIM(s.ebay_id) = '')`;
    case 'to-list': {
      const unsold = isUnsoldSalePriceSql();
      if (toListCategoryId) {
        const catParam = addParam(params, toListCategoryId);
        return `${unsold} AND (s.category_id = ${catParam} OR ((s.vinted_id IS NULL OR TRIM(s.vinted_id) = '') AND (s.ebay_id IS NULL OR TRIM(s.ebay_id) = '')))`;
      }
      return `${unsold} AND ((s.vinted_id IS NULL OR TRIM(s.vinted_id) = '') AND (s.ebay_id IS NULL OR TRIM(s.ebay_id) = ''))`;
    }
    case 'inventory-write-off':
      return 'COALESCE(s.is_inventory_write_off, false) = true';
    case 'sales':
      return 's.sale_date IS NOT NULL';
    case 'listing':
      return 's.purchase_date IS NOT NULL';
    case 'all':
    default:
      return null;
  }
}

function buildDateClause(options, params) {
  const { view, year, month, weekStart } = options;
  const usesPurchaseDate =
    view === 'listing' ||
    view === 'list-on-vinted' ||
    view === 'list-on-ebay' ||
    view === 'to-list' ||
    view === 'active-listing';
  const usesSaleDate = view === 'sales';
  const usesBoth = view === 'all' || view === 'inventory-write-off';

  if (weekStart) {
    const startParam = addParam(params, weekStart);
    const weekEndExpr = `${startParam}::date + INTERVAL '6 days'`;
    if (usesBoth) {
      return `(${dateInWeekSql('s.purchase_date', startParam, weekEndExpr)} OR ${dateInWeekSql('s.sale_date', startParam, weekEndExpr)})`;
    }
    if (usesSaleDate) {
      return dateInWeekSql('s.sale_date', startParam, weekEndExpr);
    }
    return dateInWeekSql('s.purchase_date', startParam, weekEndExpr);
  }

  if (year === 'all-time') {
    return null;
  }

  if (year === 'last-30-days') {
    if (usesBoth) {
      return `(${dateInLast30DaysSql('s.purchase_date')} OR ${dateInLast30DaysSql('s.sale_date')})`;
    }
    if (usesSaleDate) {
      return dateInLast30DaysSql('s.sale_date');
    }
    return dateInLast30DaysSql('s.purchase_date');
  }

  const monthNum = parsePositiveInt(month, 0);
  const yearNum = parsePositiveInt(year, 0);
  if (monthNum < 1 || monthNum > 12 || yearNum < 1970) {
    return null;
  }
  const monthParam = addParam(params, monthNum);
  const yearParam = addParam(params, yearNum);
  if (usesBoth) {
    return `(${dateInMonthYearSql('s.purchase_date', monthParam, yearParam)} OR ${dateInMonthYearSql('s.sale_date', monthParam, yearParam)})`;
  }
  if (usesSaleDate) {
    return dateInMonthYearSql('s.sale_date', monthParam, yearParam);
  }
  return dateInMonthYearSql('s.purchase_date', monthParam, yearParam);
}

function buildUnsoldClause(unsold, params) {
  if (unsold === 'off') return null;
  const months = unsold === '3' ? 3 : unsold === '6' ? 6 : unsold === '12' ? 12 : 0;
  if (!months) return null;
  const daysParam = addParam(params, months * 30);
  return `s.sale_date IS NULL AND s.purchase_date IS NOT NULL AND s.purchase_date::date <= (CURRENT_DATE - (${daysParam}::int * INTERVAL '1 day'))`;
}

function buildStockListWhere(options) {
  const params = [];
  const clauses = ['TRUE'];
  const needsCategoryJoin = options.sort === 'category_id';

  if (options.unsold !== 'off') {
    const unsoldClause = buildUnsoldClause(options.unsold, params);
    if (unsoldClause) clauses.push(unsoldClause);
    const searchClause = buildSearchClause(options.q, params);
    if (searchClause) clauses.push(searchClause);
    if (options.categoryId) {
      const catParam = addParam(params, options.categoryId);
      clauses.push(`s.category_id = ${catParam}`);
    }
    return {
      whereSql: clauses.join(' AND '),
      params,
      needsCategoryJoin,
    };
  }

  if (options.q) {
    const searchClause = buildSearchClause(options.q, params);
    if (searchClause) clauses.push(searchClause);
    if (options.categoryId) {
      const catParam = addParam(params, options.categoryId);
      clauses.push(`s.category_id = ${catParam}`);
    }
    return {
      whereSql: clauses.join(' AND '),
      params,
      needsCategoryJoin,
    };
  }

  const viewClause = buildViewClause(options.view, options.toListCategoryId, params);
  if (viewClause) clauses.push(viewClause);

  const dateClause = buildDateClause(options, params);
  if (dateClause) clauses.push(dateClause);

  if (options.categoryId) {
    const catParam = addParam(params, options.categoryId);
    clauses.push(`s.category_id = ${catParam}`);
  }

  return {
    whereSql: clauses.join(' AND '),
    params,
    needsCategoryJoin,
  };
}

function buildStockListOrder(options) {
  const column = STOCK_SORT_COLUMNS[options.sort] ?? STOCK_SORT_COLUMNS[DEFAULT_SORT];
  const direction = options.order === 'asc' ? 'ASC' : 'DESC';
  const nulls = options.order === 'asc' ? 'NULLS FIRST' : 'NULLS LAST';
  if (options.sort === 'id' && options.order === 'desc') {
    return `s.id DESC`;
  }
  if (options.sort === 'id') {
    return `s.id ASC`;
  }
  return `${column} ${direction} ${nulls}, s.id DESC`;
}

function buildSummaryDatePurchaseClause(options, params) {
  const clone = { ...options, view: 'listing' };
  return buildDateClause(clone, params);
}

function buildSummaryDateSaleClause(options, params) {
  const clone = { ...options, view: 'sales' };
  return buildDateClause(clone, params);
}

module.exports = {
  STOCK_SORT_COLUMNS,
  parseStockListOptions,
  buildStockListWhere,
  buildStockListOrder,
  buildSummaryDatePurchaseClause,
  buildSummaryDateSaleClause,
  parsePositiveInt,
};

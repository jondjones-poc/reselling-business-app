import React, { useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import '../react-datepicker-dark.css';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { getApiBase } from '../utils/apiBase';
import './AccountantExport.css';

const API_BASE = getApiBase();

type VatTreatment = 'not-registered' | 'standard' | 'margin-scheme';

interface AccountingSettings {
  companyName: string;
  companyNumber: string;
  accountingPeriodStart: string;
  accountingPeriodEnd: string;
  tradingStartDate: string;
  vatTreatment: VatTreatment;
  vatEffectiveDate: string;
}

interface StockExportRow {
  stockItemId: number;
  itemName: string | null;
  brandName: string;
  categoryName: string;
  purchaseDate: string | null;
  purchasePrice: number | null;
  saleDate: string | null;
  salePrice: number | null;
  projectedSalePrice: number | null;
  platform: string;
  sourceUrl: string;
}

interface ExpenseExportRow {
  expenseId: number;
  description: string | null;
  amount: number | null;
  transactionDate: string | null;
  supplier: string;
  invoiceReference: string;
}

interface AccountingExportData {
  periodStart: string;
  periodEnd: string;
  sales: StockExportRow[];
  purchases: StockExportRow[];
  openingStock: StockExportRow[];
  closingStock: StockExportRow[];
  expenses: ExpenseExportRow[];
}

const VAT_RATE = 0.2; // UK standard rate — only applied when the user confirms a treatment that needs it.

function toIsoDateOnly(date: Date | null): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDateOnly(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sizes each column to its longest value (header or cell) so descriptions etc. are readable without manually widening. */
function autoColumnWidths(rows: Record<string, unknown>[]): { wch: number }[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    const longest = rows.reduce((max, row) => {
      const value = row[key];
      const text = value == null ? '' : String(value);
      return Math.max(max, text.length);
    }, key.length);
    return { wch: Math.min(60, Math.max(14, longest + 2)) };
  });
}

function standardVatFromInclusive(amountInclusive: number): number {
  return round2(amountInclusive - amountInclusive / (1 + VAT_RATE));
}

const AccountantExport: React.FC = () => {
  const [settings, setSettings] = useState<AccountingSettings>({
    companyName: '',
    companyNumber: '',
    accountingPeriodStart: '',
    accountingPeriodEnd: '',
    tradingStartDate: '',
    vatTreatment: 'not-registered',
    vatEffectiveDate: '',
  });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<AccountingExportData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/settings/accounting`);
        if (!res.ok) throw new Error('Failed to load accounting settings');
        const data = await res.json();
        if (!cancelled) setSettings((prev) => ({ ...prev, ...data }));
      } catch (err) {
        if (!cancelled) setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSetting = <K extends keyof AccountingSettings>(key: K, value: AccountingSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    setSavedMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings/accounting`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error('Failed to save accounting settings');
      const data = await res.json();
      setSettings((prev) => ({ ...prev, ...data }));
      setSavedMessage('Settings saved.');
      window.setTimeout(() => setSavedMessage(null), 3000);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  const periodStartDate = useMemo(() => parseIsoDateOnly(settings.accountingPeriodStart), [settings.accountingPeriodStart]);
  const periodEndDate = useMemo(() => parseIsoDateOnly(settings.accountingPeriodEnd), [settings.accountingPeriodEnd]);

  const buildWorkbookSheets = (data: AccountingExportData): { name: string; rows: Record<string, unknown>[] }[] => {
    const vat = settings.vatTreatment;

    const salesRows = data.sales.map((row) => {
      const salePrice = row.salePrice ?? 0;
      const purchasePrice = row.purchasePrice;
      return {
        stock_item_id: String(row.stockItemId).padStart(6, '0'),
        description: row.itemName ?? '',
        brand: row.brandName,
        category: row.categoryName,
        platform: row.platform,
        sale_date: row.saleDate ?? '',
        item_sales_amount: row.salePrice ?? '',
        purchase_cost: purchasePrice ?? '',
        profit: purchasePrice != null ? round2(salePrice - purchasePrice) : '',
        currency: 'GBP',
        review_note: '',
      };
    });

    const purchaseRows = data.purchases.map((row) => ({
      purchase_id: String(row.stockItemId).padStart(6, '0'),
      stock_item_id: String(row.stockItemId).padStart(6, '0'),
      description: row.itemName ?? '',
      brand: row.brandName,
      category: row.categoryName,
      purchase_date: row.purchaseDate ?? '',
      quantity: 1,
      purchase_price: row.purchasePrice ?? '',
      classification: 'Business',
    }));

    const stockSheet = (rows: StockExportRow[]) =>
      rows.map((row) => ({
        stock_item_id: String(row.stockItemId).padStart(6, '0'),
        description: row.itemName ?? '',
        brand: row.brandName,
        category: row.categoryName,
        purchase_date: row.purchaseDate ?? '',
        unit_cost: row.purchasePrice ?? '',
        estimated_selling_price: row.projectedSalePrice ?? '',
        closing_carrying_value: row.purchasePrice ?? '',
        review_note: '',
      }));

    const expenseRows = data.expenses.map((row) => {
      const amount = row.amount ?? 0;
      let vatAmount: number | null = null;
      let amountExclVat: number | null = null;
      if (vat === 'standard') {
        vatAmount = standardVatFromInclusive(amount);
        amountExclVat = round2(amount - vatAmount);
      }
      return {
        expense_id: String(row.expenseId).padStart(6, '0'),
        transaction_date: row.transactionDate ?? '',
        supplier: row.supplier,
        description: row.description ?? '',
        amount_excluding_VAT: amountExclVat ?? '',
        VAT_amount: vatAmount ?? '',
        total_amount: row.amount ?? '',
        invoice_reference: row.invoiceReference,
        review_note: '',
      };
    });

    const salesTotal = round2(data.sales.reduce((sum, r) => sum + (r.salePrice ?? 0), 0));
    const cogs = round2(data.sales.reduce((sum, r) => sum + (r.purchasePrice ?? 0), 0));
    const grossProfit = round2(salesTotal - cogs);
    const openingStockValue = round2(data.openingStock.reduce((sum, r) => sum + (r.purchasePrice ?? 0), 0));
    const purchasesValue = round2(data.purchases.reduce((sum, r) => sum + (r.purchasePrice ?? 0), 0));
    const closingStockValue = round2(data.closingStock.reduce((sum, r) => sum + (r.purchasePrice ?? 0), 0));
    const expensesTotal = round2(data.expenses.reduce((sum, r) => sum + (r.amount ?? 0), 0));
    const provisionalResult = round2(grossProfit - expensesTotal);

    const summaryRows = [
      { metric: 'Company name', value: settings.companyName || '(not set)' },
      { metric: 'Company number', value: settings.companyNumber || '(not set)' },
      { metric: 'Accounting period', value: `${data.periodStart} to ${data.periodEnd}` },
      { metric: 'Trading start date', value: settings.tradingStartDate || '(not set)' },
      { metric: 'VAT treatment', value: vat },
      { metric: '', value: '' },
      { metric: 'Sales (item sales amount)', value: salesTotal },
      { metric: 'Cost of goods sold (matched purchase cost of items sold)', value: cogs },
      { metric: 'Gross profit', value: grossProfit },
      { metric: '', value: '' },
      { metric: 'Opening stock value', value: openingStockValue },
      { metric: 'Purchases during period', value: purchasesValue },
      { metric: 'Closing stock value', value: closingStockValue },
      { metric: '', value: '' },
      { metric: 'Recorded fees and other expenses', value: expensesTotal },
      { metric: '', value: '' },
      {
        metric: 'Provisional trading result (gross profit less recorded expenses) — BEFORE accountant adjustments',
        value: provisionalResult,
      },
    ];

    const dictionaryRows = [
      { sheet: 'Sales', column: 'stock_item_id', meaning: 'Stable, zero-padded stock record ID (one row = one unique item sold).' },
      { sheet: 'Sales', column: 'sale_date', meaning: 'Date recorded as sold. Revenue is recognised in the period this date falls in.' },
      { sheet: 'Sales', column: 'item_sales_amount', meaning: 'Sale price recorded for the item, in GBP. No separate shipping/discount/refund fields exist.' },
      { sheet: 'Sales', column: 'purchase_cost', meaning: 'What this specific item cost to buy — the cost of goods sold matched to this sale.' },
      { sheet: 'Sales', column: 'profit', meaning: 'item_sales_amount minus purchase_cost for this item. Blank if no purchase cost is recorded.' },
      { sheet: 'Sales', column: 'revenue_excluding_VAT', meaning: 'Blank unless a VAT treatment was selected on the Sales page; a flat-rate/margin-scheme estimate for your accountant to confirm.' },
      { sheet: 'Sales', column: 'source_url', meaning: 'Direct link to the eBay / Vinted / Depop listing, whichever is present.' },
      { sheet: 'Stock Purchases', column: 'purchase_price', meaning: 'Amount paid for the item. No separate inbound costs (postage to acquire, etc.) are tracked.' },
      { sheet: 'Opening Stock / Closing Stock', column: '(sheet meaning)', meaning: 'Every item bought before the sheet\'s date and not yet sold by it — reconstructed from purchase_date/sale_date, not a stored snapshot.' },
      { sheet: 'Opening Stock / Closing Stock', column: 'estimated_selling_price', meaning: 'Your own projected/listed price for the item, where one was set. No NRV write-down has been calculated — apply lower-of-cost-or-NRV manually.' },
      { sheet: 'Fees and Other Expenses', column: 'total_amount', meaning: 'Cost as entered on the Expenses ledger. No expense category is recorded in this app.' },
      { sheet: 'Summary', column: 'Cost of goods sold', meaning: 'Sum of purchase_price for items whose sale falls in this period (matched to the sale, not to when they were bought).' },
      { sheet: 'All sheets', column: 'review_note', meaning: 'Left blank for your accountant to annotate — this app does not flag any rows as uncertain because it has no signal to do so.' },
    ];

    return [
      { name: 'Summary', rows: summaryRows },
      { name: 'Sales', rows: salesRows },
      { name: 'Stock Purchases', rows: purchaseRows },
      { name: 'Fees and Other Expenses', rows: expenseRows },
      { name: 'Opening Stock', rows: stockSheet(data.openingStock) },
      { name: 'Closing Stock', rows: stockSheet(data.closingStock) },
      { name: 'Data Dictionary', rows: dictionaryRows },
    ];
  };

  const generateExport = async (format: 'xlsx' | 'zip') => {
    if (!periodStartDate || !periodEndDate) {
      setGenerateError('Set the accounting period start and end date first.');
      return;
    }
    if (periodStartDate > periodEndDate) {
      setGenerateError('The accounting period start must be before the end.');
      return;
    }

    setGenerating(true);
    setGenerateError(null);
    try {
      const qs = new URLSearchParams({
        periodStart: settings.accountingPeriodStart,
        periodEnd: settings.accountingPeriodEnd,
      });
      const res = await fetch(`${API_BASE}/api/accounting/export?${qs}`);
      if (!res.ok) throw new Error('Failed to load export data');
      const data: AccountingExportData = await res.json();
      setLastExport(data);

      const sheets = buildWorkbookSheets(data);
      const filenameBase = `Accountant_Export_${data.periodStart}_to_${data.periodEnd}`;

      if (format === 'xlsx') {
        const workbook = XLSX.utils.book_new();
        sheets.forEach(({ name, rows }) => {
          const sheet = rows.length > 0
            ? XLSX.utils.json_to_sheet(rows)
            : XLSX.utils.aoa_to_sheet([['No rows for this period']]);
          sheet['!cols'] = autoColumnWidths(rows);
          XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
        });
        XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
      } else {
        const zip = new JSZip();
        sheets.forEach(({ name, rows }) => {
          const sheet = rows.length > 0
            ? XLSX.utils.json_to_sheet(rows)
            : XLSX.utils.aoa_to_sheet([['No rows for this period']]);
          const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', blankrows: false });
          zip.file(`${name.replace(/[^a-z0-9]+/gi, '_')}.csv`, csv);
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filenameBase}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate export');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="accountant-export">
      <section className="accountant-export-card">
        {settingsError && <div className="stock-error">{settingsError}</div>}
        {savedMessage && <div className="stock-success">{savedMessage}</div>}
        <div className="accountant-export-grid">
          <label className="new-entry-field">
            <span>Company name</span>
            <input
              type="text"
              value={settings.companyName}
              onChange={(e) => updateSetting('companyName', e.target.value)}
              placeholder="e.g. Gents Rail Ltd"
            />
          </label>
          <label className="new-entry-field">
            <span>Company number</span>
            <input
              type="text"
              value={settings.companyNumber}
              onChange={(e) => updateSetting('companyNumber', e.target.value)}
              placeholder="Companies House number"
            />
          </label>
          <label className="new-entry-field">
            <span>Trading start date</span>
            <DatePicker
              selected={parseIsoDateOnly(settings.tradingStartDate)}
              onChange={(date) => updateSetting('tradingStartDate', toIsoDateOnly(date))}
              dateFormat="yyyy-MM-dd"
              placeholderText="Select date"
              className="date-picker-input"
              calendarClassName="date-picker-calendar"
              wrapperClassName="date-picker-wrapper"
            />
          </label>
          <label className="new-entry-field">
            <span>Accounting period start</span>
            <DatePicker
              selected={periodStartDate}
              onChange={(date) => updateSetting('accountingPeriodStart', toIsoDateOnly(date))}
              selectsStart
              startDate={periodStartDate}
              endDate={periodEndDate}
              maxDate={periodEndDate ?? undefined}
              dateFormat="yyyy-MM-dd"
              placeholderText="Period start"
              className="date-picker-input"
              calendarClassName="date-picker-calendar"
              wrapperClassName="date-picker-wrapper"
            />
          </label>
          <label className="new-entry-field">
            <span>Accounting period end</span>
            <DatePicker
              selected={periodEndDate}
              onChange={(date) => updateSetting('accountingPeriodEnd', toIsoDateOnly(date))}
              selectsEnd
              startDate={periodStartDate}
              endDate={periodEndDate}
              minDate={periodStartDate ?? undefined}
              dateFormat="yyyy-MM-dd"
              placeholderText="Period end"
              className="date-picker-input"
              calendarClassName="date-picker-calendar"
              wrapperClassName="date-picker-wrapper"
            />
          </label>
        </div>
        <button type="button" className="new-entry-button" onClick={saveSettings} disabled={settingsLoading || settingsSaving}>
          {settingsSaving ? 'Saving…' : 'Save settings'}
        </button>
      </section>

      <section className="accountant-export-card">
        {generateError && <div className="stock-error">{generateError}</div>}
        <div className="accountant-export-actions">
          <button
            type="button"
            className="new-entry-button"
            onClick={() => generateExport('xlsx')}
            disabled={generating}
          >
            {generating ? 'Generating…' : 'Download Excel workbook'}
          </button>
          <button
            type="button"
            className="new-entry-button"
            onClick={() => generateExport('zip')}
            disabled={generating}
          >
            {generating ? 'Generating…' : 'Download CSV ZIP'}
          </button>
        </div>
        {lastExport && (
          <dl className="accountant-export-summary">
            <div>
              <dt>Sales rows</dt>
              <dd>{lastExport.sales.length}</dd>
            </div>
            <div>
              <dt>Purchase rows</dt>
              <dd>{lastExport.purchases.length}</dd>
            </div>
            <div>
              <dt>Opening stock items</dt>
              <dd>{lastExport.openingStock.length}</dd>
            </div>
            <div>
              <dt>Closing stock items</dt>
              <dd>{lastExport.closingStock.length}</dd>
            </div>
            <div>
              <dt>Expense rows</dt>
              <dd>{lastExport.expenses.length}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
};

export default AccountantExport;

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateEbayListing from './CreateEbayListing';
import { importVintedZip } from '../utils/vintedZipImport';
import { apiFetch } from '../utils/apiBase';
jest.mock('../utils/vintedZipImport', () => ({ importVintedZip: jest.fn() }));
jest.mock('../utils/apiBase', () => ({ apiFetch: jest.fn(), ebayOAuthStartUrl: () => '/connect-ebay' }));
beforeEach(() => {
  jest.clearAllMocks();
  (importVintedZip as jest.Mock).mockResolvedValue({ sku: '00123', title: 'Shirt', description: 'Blue shirt', price: '12.00', specifics: [], images: [new File(['photo'], '01.jpg', { type: 'image/jpeg' })] });
});
async function chooseZip() {
  const file = new File(['zip'], 'vinted.zip', { type: 'application/zip' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(3) });
  fireEvent.change(screen.getByLabelText('Vinted listing ZIP'), { target: { files: [file] } });
  await screen.findByLabelText('SKU');
}
test('sends reviewed details as a Seller Hub draft upload', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => JSON.stringify({ sku: '00123', taskId: '987' }) });
  render(<MemoryRouter><CreateEbayListing /></MemoryRouter>);
  await chooseZip();
  expect(apiFetch).not.toHaveBeenCalled();
  expect(screen.getByLabelText('SKU')).toHaveValue('00123');
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated shirt' } });
  fireEvent.change(screen.getByLabelText('eBay category ID'), { target: { value: '47140' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create eBay draft' }));
  await screen.findByText(/Draft upload submitted for SKU/);
  const [url, request] = (apiFetch as jest.Mock).mock.calls[0];
  expect(url).toBe('/api/ebay/listing-drafts/import');
  expect(JSON.parse(request.body)).toMatchObject({ sku: '00123', title: 'Updated shirt', categoryId: '47140' });
  expect(screen.getByRole('link', { name: 'Open eBay Seller Hub Drafts' })).toHaveAttribute('href', 'https://www.ebay.co.uk/sh/lst/drafts');
});
test('failed imports retain the details and offer eBay reconnection', async () => {
  (apiFetch as jest.Mock).mockResolvedValue({ ok: false, status: 403, text: async () => JSON.stringify({ error: 'eBay access denied' }) });
  render(<MemoryRouter><CreateEbayListing /></MemoryRouter>);
  await chooseZip();
  fireEvent.change(screen.getByLabelText('eBay category ID'), { target: { value: '47140' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create eBay draft' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('eBay access denied'));
  expect(screen.getByLabelText('SKU')).toHaveValue('00123');
  expect(screen.getByRole('link', { name: 'Connect or reconnect eBay' })).toHaveAttribute('href', '/connect-ebay');
});

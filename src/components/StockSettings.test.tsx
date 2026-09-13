import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { StockRowSettings } from './Stock';

const download = jest.fn();
function SettingsRows() {
  const [active, setActive] = useState<number | null>(null);
  return <>{[1, 2].map(id => <StockRowSettings key={id}
    row={{ id, vinted_id: id === 1 ? '123' : null, ebay_id: id === 1 ? '456' : null } as React.ComponentProps<typeof StockRowSettings>['row']}
    open={active === id} onOpen={() => setActive(id)} onClose={() => setActive(null)}
    inOrders={false} addingToOrder={false} vintedZipDownloading={false}
    onAddToOrder={jest.fn()} onDownloadVintedZip={download} />)}</>;
}

test('settings survives mouse leave, switches exclusively, and closes explicitly', () => {
  render(<SettingsRows />);
  const cogs = screen.getAllByRole('button', { name: 'Item settings' });
  fireEvent.mouseEnter(cogs[0]);
  fireEvent.mouseLeave(cogs[0]);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Open Vinted listing' })).toHaveAttribute('href', 'https://www.vinted.co.uk/items/123');
  expect(screen.getByRole('link', { name: 'Open eBay listing' })).toHaveAttribute('href', 'https://www.ebay.co.uk/itm/456');
  fireEvent.click(screen.getByRole('button', { name: 'Download Vinted zip' }));
  expect(download).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  fireEvent.mouseEnter(cogs[1]);
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Download Vinted zip' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close item settings' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(cogs[0]);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

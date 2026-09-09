import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable, DataTableColumn } from './DataTable';

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'id', header: 'Id', render: (r) => r.id },
  { key: 'name', header: 'Name', render: (r) => r.name },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` }));
}

describe('DataTable', () => {
  it('renders all rows when fewer than one page', () => {
    render(<DataTable columns={columns} rows={makeRows(5)} rowKey={(r) => r.id} pageSize={50} />);
    expect(screen.getByText('Row 0')).toBeInTheDocument();
    expect(screen.getByText('Row 4')).toBeInTheDocument();
    expect(screen.queryByText(/Page \d/)).not.toBeInTheDocument();
  });

  it('paginates rows and navigates between pages', () => {
    render(<DataTable columns={columns} rows={makeRows(120)} rowKey={(r) => r.id} pageSize={50} />);
    expect(screen.getByText('Row 0')).toBeInTheDocument();
    expect(screen.queryByText('Row 50')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3 (120 rows)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Row 50')).toBeInTheDocument();
    expect(screen.queryByText('Row 0')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Previous'));
    expect(screen.getByText('Row 0')).toBeInTheDocument();
  });

  it('shows an empty message when there are no rows', () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders skeleton placeholder rows while loading', () => {
    const { container } = render(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />);
    expect(container.querySelectorAll('.animate-skeleton').length).toBeGreaterThan(0);
  });

  it('renders row actions in an appended actions column', () => {
    render(
      <DataTable
        columns={columns}
        rows={makeRows(1)}
        rowKey={(r) => r.id}
        actions={(r) => <button type="button">Act on {r.id}</button>}
      />,
    );
    expect(screen.getByText('Act on row-0')).toBeInTheDocument();
  });
});

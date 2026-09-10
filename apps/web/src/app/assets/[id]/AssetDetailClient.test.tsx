import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { AssetDetailClient } from './AssetDetailClient';
import { AssetSummary } from '../../../components/StoreGrid';
import { HistoryEntryView, ReservationView } from '../../../lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn().mockResolvedValue([]),
  getCurrentKeeper: () => 'keeper-1',
  newIdempotencyKey: () => 'key-1',
}));

function asset(overrides: Partial<AssetSummary> = {}): AssetSummary {
  return {
    _id: 'DRILL-001',
    kind: 'drill',
    requiresCertification: null,
    status: 'IN_STORE',
    currentHolderId: null,
    upcomingReservation: null,
    lastActivityAt: null,
    dueAt: null,
    isOverdue: false,
    ...overrides,
  };
}

const HISTORY: HistoryEntryView[] = [
  {
    movement: {
      _id: 'mov-1',
      assetId: 'DRILL-001',
      workerId: 'worker-1',
      type: 'ISSUE',
      occurredAt: '2026-09-01T09:00:00.000Z',
      recordedAt: '2026-09-01T09:00:00.000Z',
      reason: null,
    },
    correction: null,
  },
];

const RESERVATIONS: ReservationView[] = [
  {
    _id: 'res-1',
    assetId: 'DRILL-001',
    workerId: 'worker-2',
    startAt: '2027-01-10T09:00:00.000Z',
    endAt: '2027-01-10T17:00:00.000Z',
    status: 'ACTIVE',
    cancelReason: null,
  },
];

describe('AssetDetailClient', () => {
  it('names who is currently holding an issued asset', () => {
    render(
      <AssetDetailClient
        asset={asset({ status: 'ISSUED', currentHolderId: 'worker-1' })}
        history={HISTORY}
        reservations={[]}
      />,
    );
    expect(screen.getByText('worker-1')).toBeInTheDocument();
  });

  it('states the certification an asset requires', () => {
    render(
      <AssetDetailClient asset={asset({ requiresCertification: 'FORKLIFT' })} history={HISTORY} reservations={[]} />,
    );
    expect(screen.getByText('FORKLIFT')).toBeInTheDocument();
  });

  it('says when no certification is required rather than leaving it blank', () => {
    render(<AssetDetailClient asset={asset()} history={HISTORY} reservations={[]} />);
    expect(screen.getByText('None required')).toBeInTheDocument();
  });

  it('shows the movement history', () => {
    render(<AssetDetailClient asset={asset()} history={HISTORY} reservations={[]} />);
    expect(
      screen.getByText(`occurred ${new Date('2026-09-01T09:00:00.000Z').toLocaleString()}`),
    ).toBeInTheDocument();
  });

  it('lists the reservations held against this asset', () => {
    render(<AssetDetailClient asset={asset()} history={HISTORY} reservations={RESERVATIONS} />);
    expect(screen.getByText(/worker-2/)).toBeInTheDocument();
  });

  it('says so when the asset has no reservations', () => {
    render(<AssetDetailClient asset={asset()} history={HISTORY} reservations={[]} />);
    expect(screen.getByText('No reservations for this asset.')).toBeInTheDocument();
  });

  it('offers the out-of-service control', () => {
    render(<AssetDetailClient asset={asset()} history={HISTORY} reservations={[]} />);
    expect(screen.getByRole('button', { name: 'Take out of service' })).toBeInTheDocument();
  });

  it('renders the last activity in local time rather than as a UTC ISO string', () => {
    const lastActivityAt = '2026-09-01T09:00:00.000Z';
    render(<AssetDetailClient asset={asset({ lastActivityAt })} history={HISTORY} reservations={[]} />);
    expect(screen.getByText(new Date(lastActivityAt).toLocaleString())).toBeInTheDocument();
  });

  it('says when an issued asset is due back, and that it is late once it is', () => {
    render(
      <AssetDetailClient
        asset={asset({
          status: 'ISSUED',
          currentHolderId: 'worker-1',
          dueAt: '2026-08-01T17:00:00.000Z',
          isOverdue: true,
        })}
        history={[]}
        reservations={[]}
      />,
    );

    expect(screen.getByText(new Date('2026-08-01T17:00:00.000Z').toLocaleString())).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
});

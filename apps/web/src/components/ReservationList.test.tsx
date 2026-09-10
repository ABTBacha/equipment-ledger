import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReservationList } from './ReservationList';
import { apiFetch } from '../lib/api';
import { ReservationView } from '../lib/types';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
}));

function reservation(overrides: Partial<ReservationView> = {}): ReservationView {
  return {
    _id: 'res-1',
    assetId: 'DRILL-001',
    workerId: 'worker-1',
    startAt: '2027-01-10T09:00:00.000Z',
    endAt: '2027-01-10T17:00:00.000Z',
    status: 'ACTIVE',
    cancelReason: null,
    fulfilledByMovementId: null,
    ...overrides,
  };
}

describe('ReservationList', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
    (apiFetch as jest.Mock).mockResolvedValue({});
  });

  it('offers to cancel an active reservation', () => {
    render(<ReservationList reservations={[reservation()]} onChanged={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Cancel reservation' })).toBeInTheDocument();
  });

  it.each(['CANCELLED', 'NOT_COLLECTED', 'FULFILLED', 'OVERDUE'] as const)(
    'does not offer to cancel a %s reservation',
    (status) => {
      render(<ReservationList reservations={[reservation({ status })]} onChanged={jest.fn()} />);
      expect(screen.queryByRole('button', { name: 'Cancel reservation' })).not.toBeInTheDocument();
    },
  );

  it('posts the cancellation with its reason and reports the change', async () => {
    const onChanged = jest.fn();
    render(<ReservationList reservations={[reservation()]} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Job postponed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/reservations/res-1/cancel', {
        method: 'POST',
        body: JSON.stringify({ reason: 'Job postponed' }),
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('requires confirmation before posting anything', () => {
    render(<ReservationList reservations={[reservation()]} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('surfaces a failed cancellation instead of reporting success', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new Error('Reservation res-1 is not active'));
    const onChanged = jest.fn();
    render(<ReservationList reservations={[reservation()]} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));

    await waitFor(() => expect(screen.getByText('Reservation res-1 is not active')).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows why a cancelled reservation was called off', () => {
    render(
      <ReservationList
        reservations={[reservation({ status: 'CANCELLED', cancelReason: 'Job postponed' })]}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/Job postponed/)).toBeInTheDocument();
  });

  it('renders the window in local time rather than as a UTC ISO string', () => {
    render(<ReservationList reservations={[reservation()]} onChanged={jest.fn()} />);
    expect(screen.getByText(new RegExp(new Date('2027-01-10T09:00:00.000Z').toLocaleString(), 'i'))).toBeInTheDocument();
    expect(screen.queryByText(/2027-01-10T09:00:00\.000Z/)).not.toBeInTheDocument();
  });

  it('lays the reservations out as a table', () => {
    render(<ReservationList reservations={[reservation()]} onChanged={jest.fn()} />);

    expect(screen.getByRole('columnheader', { name: 'Asset' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Worker' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'From' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'To' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('drops the asset column where the list already belongs to one asset', () => {
    render(<ReservationList reservations={[reservation()]} onChanged={jest.fn()} showAsset={false} />);

    expect(screen.queryByRole('columnheader', { name: 'Asset' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Worker' })).toBeInTheDocument();
  });

  it('puts the soonest window first, whatever order it was given them in', () => {
    render(
      <ReservationList
        reservations={[
          reservation({ _id: 'res-late', assetId: 'LATE-001', startAt: '2027-03-01T09:00:00.000Z', endAt: '2027-03-01T17:00:00.000Z' }),
          reservation({ _id: 'res-soon', assetId: 'SOON-001', startAt: '2027-01-01T09:00:00.000Z', endAt: '2027-01-01T17:00:00.000Z' }),
        ]}
        onChanged={jest.fn()}
      />,
    );

    const codes = screen.getAllByText(/-001$/).map((el) => el.textContent);
    expect(codes).toEqual(['SOON-001', 'LATE-001']);
  });

  it('names the reservation being cancelled in the confirmation', () => {
    render(<ReservationList reservations={[reservation()]} onChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/DRILL-001/);
    expect(dialog).toHaveTextContent(/worker-1/);
  });

  it('closes the confirmation without cancelling when the keeper keeps the booking', () => {
    render(<ReservationList reservations={[reservation()]} onChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reservation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('still says so when there are no reservations at all', () => {
    render(<ReservationList reservations={[]} onChanged={jest.fn()} emptyMessage="No reservations." />);
    expect(screen.getByText('No reservations.')).toBeInTheDocument();
  });
});

import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReservationForm } from './ReservationForm';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: jest.requireActual('../lib/api').newIdempotencyKey,
}));

const ASSETS = [
  {
    _id: 'DRILL-001',
    kind: 'drill',
    requiresCertification: null,
    status: 'IN_STORE',
    currentHolderId: null,
    upcomingReservation: null,
    lastActivityAt: null,
  },
  {
    _id: 'GRIND-002',
    kind: 'grinder',
    requiresCertification: null,
    status: 'IN_STORE',
    currentHolderId: null,
    upcomingReservation: null,
    lastActivityAt: null,
  },
];

const WORKERS = [
  { _id: 'worker-1', name: 'Worker One', certifications: [], currentlyHolding: [] },
  { _id: 'worker-2', name: 'Worker Two', certifications: [], currentlyHolding: [] },
];

/**
 * apiFetch serves GET /assets and GET /workers (fetched on mount) from fixed lists, and
 * queues resolutions/rejections (in order) for every other call (the reservation submit).
 */
function mockApiFetch() {
  const submitQueue: Array<() => Promise<unknown>> = [];
  (apiFetch as jest.Mock).mockReset();
  (apiFetch as jest.Mock).mockImplementation((path: string) => {
    if (path === '/assets') return Promise.resolve(ASSETS);
    if (path === '/workers') return Promise.resolve(WORKERS);
    const next = submitQueue.shift();
    return next ? next() : Promise.resolve({});
  });
  return {
    queueSubmitReject: (err: Error) => submitQueue.push(() => Promise.reject(err)),
    queueSubmitResolve: (value: unknown = {}) => submitQueue.push(() => Promise.resolve(value)),
  };
}

async function selectAsset(label: string) {
  const input = await screen.findByPlaceholderText('Select asset');
  fireEvent.focus(input);
  fireEvent.click(await screen.findByText(label));
}

async function selectWorker(label: string) {
  const input = await screen.findByPlaceholderText('Select worker');
  fireEvent.focus(input);
  fireEvent.click(await screen.findByText(label));
}

describe('ReservationForm', () => {
  it('shows a validation error and does not call the API when endAt <= startAt', async () => {
    mockApiFetch();
    render(<ReservationForm onCreated={jest.fn()} />);
    await selectAsset('DRILL-001 — drill (in store)');
    await selectWorker('Worker One (worker-1)');
    const startInput = screen.getByLabelText('Start');
    const endInput = screen.getByLabelText('End');
    fireEvent.change(startInput, { target: { value: '2027-01-10T17:00' } });
    fireEvent.change(endInput, { target: { value: '2027-01-10T09:00' } });
    fireEvent.click(screen.getByText('Reserve'));

    expect(screen.getByText('End must be after start')).toBeInTheDocument();
    expect((apiFetch as jest.Mock).mock.calls.every((c) => c[0] !== '/reservations')).toBe(true);
  });

  it('renders the conflicting window from a mocked 409 response', async () => {
    const { queueSubmitReject } = mockApiFetch();
    queueSubmitReject(
      new Error('Overlaps an existing reservation from 2027-01-10T09:00:00.000Z to 2027-01-10T17:00:00.000Z'),
    );

    render(<ReservationForm onCreated={jest.fn()} />);
    await selectAsset('DRILL-001 — drill (in store)');
    await selectWorker('Worker One (worker-1)');
    const startInput = screen.getByLabelText('Start');
    const endInput = screen.getByLabelText('End');
    fireEvent.change(startInput, { target: { value: '2027-01-10T12:00' } });
    fireEvent.change(endInput, { target: { value: '2027-01-10T20:00' } });
    fireEvent.click(screen.getByText('Reserve'));

    await waitFor(() => expect(screen.getByText(/Overlaps an existing reservation/)).toBeInTheDocument());
  });

  it('generates a new idempotency key (and clears fields) after a successful submission, ready for a new entry', async () => {
    const { queueSubmitResolve } = mockApiFetch();
    queueSubmitResolve();
    queueSubmitResolve();

    render(<ReservationForm onCreated={jest.fn()} />);
    await selectAsset('DRILL-001 — drill (in store)');
    await selectWorker('Worker One (worker-1)');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2027-01-10T09:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2027-01-10T17:00' } });
    fireEvent.click(screen.getByText('Reserve'));
    await waitFor(() => {
      const calls = (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/reservations');
      expect(calls).toHaveLength(1);
    });
    const firstKey = JSON.parse(
      (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/reservations')[0][1].body,
    ).idempotencyKey;

    // Form stays mounted (it's an always-visible inline form) and fields should be cleared.
    expect(screen.getByPlaceholderText('Select asset')).toHaveValue('');
    expect(screen.getByPlaceholderText('Select worker')).toHaveValue('');

    await selectAsset('GRIND-002 — grinder (in store)');
    await selectWorker('Worker Two (worker-2)');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2027-02-10T09:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2027-02-10T17:00' } });
    fireEvent.click(screen.getByText('Reserve'));
    await waitFor(() => {
      const calls = (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/reservations');
      expect(calls).toHaveLength(2);
    });
    const secondKey = JSON.parse(
      (apiFetch as jest.Mock).mock.calls.filter((c) => c[0] === '/reservations')[1][1].body,
    ).idempotencyKey;

    expect(secondKey).not.toBe(firstKey);
  });
});

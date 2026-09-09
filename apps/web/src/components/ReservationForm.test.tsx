import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReservationForm } from './ReservationForm';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
  newIdempotencyKey: jest.requireActual('../lib/api').newIdempotencyKey,
}));

describe('ReservationForm', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
  });

  it('shows a validation error and does not call the API when endAt <= startAt', () => {
    render(<ReservationForm onCreated={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Asset ID'), { target: { value: 'DRILL-001' } });
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    const [startInput, endInput] = screen.getAllByDisplayValue('');
    fireEvent.change(startInput, { target: { value: '2027-01-10T17:00' } });
    fireEvent.change(endInput, { target: { value: '2027-01-10T09:00' } });
    fireEvent.click(screen.getByText('Reserve'));

    expect(screen.getByText('End must be after start')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('renders the conflicting window from a mocked 409 response', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(
      new Error('Overlaps an existing reservation from 2027-01-10T09:00:00.000Z to 2027-01-10T17:00:00.000Z'),
    );

    render(<ReservationForm onCreated={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Asset ID'), { target: { value: 'DRILL-001' } });
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    const [startInput, endInput] = screen.getAllByDisplayValue('');
    fireEvent.change(startInput, { target: { value: '2027-01-10T12:00' } });
    fireEvent.change(endInput, { target: { value: '2027-01-10T20:00' } });
    fireEvent.click(screen.getByText('Reserve'));

    await waitFor(() => expect(screen.getByText(/Overlaps an existing reservation/)).toBeInTheDocument());
  });

  it('generates a new idempotency key (and clears fields) after a successful submission, ready for a new entry', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({});

    render(<ReservationForm onCreated={jest.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Asset ID'), { target: { value: 'DRILL-001' } });
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-1' } });
    let [startInput, endInput] = screen.getAllByDisplayValue('');
    fireEvent.change(startInput, { target: { value: '2027-01-10T09:00' } });
    fireEvent.change(endInput, { target: { value: '2027-01-10T17:00' } });
    fireEvent.click(screen.getByText('Reserve'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const firstKey = JSON.parse((apiFetch as jest.Mock).mock.calls[0][1].body).idempotencyKey;

    // Form stays mounted (it's an always-visible inline form) and fields should be cleared.
    expect(screen.getByPlaceholderText('Asset ID')).toHaveValue('');
    expect(screen.getByPlaceholderText('Worker ID')).toHaveValue('');

    fireEvent.change(screen.getByPlaceholderText('Asset ID'), { target: { value: 'GRIND-002' } });
    fireEvent.change(screen.getByPlaceholderText('Worker ID'), { target: { value: 'worker-2' } });
    [startInput, endInput] = screen.getAllByDisplayValue('');
    fireEvent.change(startInput, { target: { value: '2027-02-10T09:00' } });
    fireEvent.change(endInput, { target: { value: '2027-02-10T17:00' } });
    fireEvent.click(screen.getByText('Reserve'));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const secondKey = JSON.parse((apiFetch as jest.Mock).mock.calls[1][1].body).idempotencyKey;

    expect(secondKey).not.toBe(firstKey);
  });
});

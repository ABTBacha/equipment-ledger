import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CertificationEditor } from './CertificationEditor';
import { apiFetch } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiFetch: jest.fn(),
}));

const VALID = [{ code: 'HEIGHTS', expiresAt: '2099-01-01T00:00:00.000Z' }];

describe('CertificationEditor', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset();
    (apiFetch as jest.Mock).mockResolvedValue({});
  });

  it('lists the certifications the worker holds', () => {
    render(<CertificationEditor workerId="worker-1" certifications={VALID} onChanged={jest.fn()} />);
    expect(screen.getByText('HEIGHTS')).toBeInTheDocument();
  });

  it('marks a certification whose expiry has passed as expired', () => {
    render(
      <CertificationEditor
        workerId="worker-1"
        certifications={[{ code: 'GAS-DETECT', expiresAt: '2020-01-01T00:00:00.000Z' }]}
        onChanged={jest.fn()}
      />,
    );
    expect(screen.getByText(/Expired until/)).toBeInTheDocument();
  });

  it('marks a certification whose expiry is still ahead as valid', () => {
    render(<CertificationEditor workerId="worker-1" certifications={VALID} onChanged={jest.fn()} />);
    expect(screen.getByText(/Valid until/)).toBeInTheDocument();
  });

  it('adds a certification with its expiry as an ISO instant', async () => {
    const onChanged = jest.fn();
    render(<CertificationEditor workerId="worker-1" certifications={[]} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText('Certification code'), { target: { value: 'FORKLIFT' } });
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2028-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add certification' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/workers/worker-1/certifications/FORKLIFT', {
        method: 'PUT',
        body: JSON.stringify({ expiresAt: new Date('2028-01-01').toISOString() }),
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('url-encodes a code that is not URL-safe', async () => {
    render(<CertificationEditor workerId="worker-1" certifications={[]} onChanged={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Certification code'), { target: { value: 'FORK/LIFT' } });
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2028-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add certification' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/workers/worker-1/certifications/FORK%2FLIFT', expect.anything()),
    );
  });

  it('does not call the API when the code or expiry is missing', () => {
    render(<CertificationEditor workerId="worker-1" certifications={[]} onChanged={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Certification code'), { target: { value: 'FORKLIFT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add certification' }));

    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Code and expiry are both required')).toBeInTheDocument();
  });

  it('removes a certification after confirmation', async () => {
    const onChanged = jest.fn();
    render(<CertificationEditor workerId="worker-1" certifications={VALID} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove HEIGHTS' }));
    expect(apiFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/workers/worker-1/certifications/HEIGHTS', { method: 'DELETE' }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces a failed add instead of reporting success', async () => {
    (apiFetch as jest.Mock).mockRejectedValue(new Error('Worker worker-1 not found'));
    const onChanged = jest.fn();
    render(<CertificationEditor workerId="worker-1" certifications={[]} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText('Certification code'), { target: { value: 'FORKLIFT' } });
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2028-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add certification' }));

    await waitFor(() => expect(screen.getByText('Worker worker-1 not found')).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('labels the add action as a renewal when the code is already held', () => {
    render(<CertificationEditor workerId="worker-1" certifications={VALID} onChanged={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Certification code'), { target: { value: 'HEIGHTS' } });

    expect(screen.getByRole('button', { name: 'Renew certification' })).toBeInTheDocument();
  });
});

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CertificationList } from './CertificationList';

describe('CertificationList', () => {
  it('flags a certification whose expiresAt is in the past as Expired', () => {
    render(<CertificationList certifications={[{ code: 'GAS-DETECT', expiresAt: '2020-01-01T00:00:00.000Z' }]} />);
    expect(screen.getByText(/Expired/)).toBeInTheDocument();
  });

  it('does not flag a certification whose expiresAt is in the future', () => {
    render(<CertificationList certifications={[{ code: 'HEIGHTS', expiresAt: '2099-01-01T00:00:00.000Z' }]} />);
    expect(screen.queryByText(/Expired/)).not.toBeInTheDocument();
    expect(screen.getByText(/Valid/)).toBeInTheDocument();
  });
});

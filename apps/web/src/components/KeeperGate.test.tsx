import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeeperGate } from './KeeperGate';

describe('KeeperGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the keeper list and gates children until one is picked', () => {
    render(
      <KeeperGate>
        <div>Dashboard</div>
      </KeeperGate>,
    );
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Priya Patel')).toBeInTheDocument();
  });

  it('persists the selection to localStorage and reveals children', () => {
    render(
      <KeeperGate>
        <div>Dashboard</div>
      </KeeperGate>,
    );
    fireEvent.click(screen.getByText('Priya Patel'));
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(window.localStorage.getItem('equipment-ledger:keeper')).toBe('Priya Patel');
  });

  it('reads a previously persisted keeper on mount, skipping the picker', () => {
    window.localStorage.setItem('equipment-ledger:keeper', 'Marcus Webb');
    render(
      <KeeperGate>
        <div>Dashboard</div>
      </KeeperGate>,
    );
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});

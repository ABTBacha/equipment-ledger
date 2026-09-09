import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { SearchableSelect, SearchableSelectOption } from './SearchableSelect';

const OPTIONS: SearchableSelectOption[] = [
  { value: 'worker-ana-rios', label: 'Ana Rios (worker-ana-rios)' },
  { value: 'worker-ben-cole', label: 'Ben Cole (worker-ben-cole)' },
  { value: 'worker-cara-diaz', label: 'Cara Diaz (worker-cara-diaz)' },
];

function ControlledSelect() {
  const [value, setValue] = useState('');
  return (
    <SearchableSelect options={OPTIONS} value={value} onChange={setValue} placeholder="Search workers" />
  );
}

describe('SearchableSelect', () => {
  it('shows all options when opened', () => {
    render(<ControlledSelect />);
    fireEvent.focus(screen.getByPlaceholderText('Search workers'));
    expect(screen.getByText('Ana Rios (worker-ana-rios)')).toBeInTheDocument();
    expect(screen.getByText('Ben Cole (worker-ben-cole)')).toBeInTheDocument();
    expect(screen.getByText('Cara Diaz (worker-cara-diaz)')).toBeInTheDocument();
  });

  it('filters options as the user types', () => {
    render(<ControlledSelect />);
    const input = screen.getByPlaceholderText('Search workers');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ben' } });

    expect(screen.getByText('Ben Cole (worker-ben-cole)')).toBeInTheDocument();
    expect(screen.queryByText('Ana Rios (worker-ana-rios)')).not.toBeInTheDocument();
    expect(screen.queryByText('Cara Diaz (worker-cara-diaz)')).not.toBeInTheDocument();
  });

  it('calls onChange with the option value when an option is clicked', () => {
    render(<ControlledSelect />);
    const input = screen.getByPlaceholderText('Search workers');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText('Ben Cole (worker-ben-cole)'));

    // The input now shows the selected label as its placeholder (closed dropdown).
    expect(screen.getByPlaceholderText('Ben Cole (worker-ben-cole)')).toBeInTheDocument();
  });

  it('supports arrow-key navigation and Enter to select', () => {
    render(<ControlledSelect />);
    const input = screen.getByPlaceholderText('Search workers');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByPlaceholderText('Cara Diaz (worker-cara-diaz)')).toBeInTheDocument();
  });

  it('closes the dropdown on Escape', () => {
    render(<ControlledSelect />);
    const input = screen.getByPlaceholderText('Search workers');
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reopens the dropdown on a mouse click after Escape closed it (no new focus event fires)', () => {
    render(<ControlledSelect />);
    const input = screen.getByPlaceholderText('Search workers');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Input keeps focus after Escape, so a real click fires mousedown/click but no
    // fresh `focus` event. Simulate that: mousedown only, no fireEvent.focus.
    fireEvent.mouseDown(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('reopens the dropdown on a mouse click after a selection (no new focus event fires)', () => {
    render(<ControlledSelect />);
    const input = screen.getByPlaceholderText('Search workers');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText('Ben Cole (worker-ben-cole)'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.mouseDown(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('marks the keyboard-highlighted option with the accent-blue highlight classes', () => {
    render(<ControlledSelect />);
    const input = screen.getByPlaceholderText('Search workers');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const highlighted = screen.getByText('Ben Cole (worker-ben-cole)').closest('button');
    expect(highlighted).toHaveClass('border-accent-blue');
    expect(highlighted).toHaveClass('text-accent-blue');

    const notHighlighted = screen.getByText('Ana Rios (worker-ana-rios)').closest('button');
    expect(notHighlighted).not.toHaveClass('border-accent-blue');
  });
});

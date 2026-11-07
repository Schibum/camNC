import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DrawnBed } from './DrawnBed';

afterEach(cleanup);

describe('DrawnBed', () => {
  it('lays the bed out like the top view: X up, Y sideways', () => {
    render(<DrawnBed bounds={{ xmin: 0, xmax: 1220, ymin: 0, ymax: 2440 }} />);
    expect(screen.getByTestId('drawn-bed').getAttribute('viewBox')).toBe('0 0 2440 1220');
  });

  it('keeps grid lines on machine coordinates when the bed does not start at zero', () => {
    render(<DrawnBed bounds={{ xmin: 3, xmax: 203, ymin: 3, ymax: 103 }} />);
    const major = screen.getByTestId('drawn-bed').querySelectorAll('path')[1]!.getAttribute('d');
    // X = 100 and 200, 103 and 3 mm below the top edge at X = 203.
    expect(major).toContain('M100 103L0 103');
    expect(major).toContain('M100 3L0 3');
  });
});

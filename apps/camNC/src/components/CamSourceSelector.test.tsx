import { getActiveCamSource, ICamSource, useStore } from '@/store/store';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import type { ComponentProps } from 'react';
import { Box2, Matrix3, Vector2, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CamSourceSelector } from './CamSourceSelector';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, ...props }: ComponentProps<'a'> & { to: string }) => <a href={to} {...props} />,
}));

const camera: ICamSource = {
  name: 'Workshop camera',
  url: 'rtsp://camera/stream',
  maxResolution: [1920, 1080],
  calibration: { calibration_matrix: new Matrix3(), new_camera_matrix: new Matrix3(), distortion_coefficients: [] },
  extrinsics: { R: new Matrix3(), t: new Vector3() },
  markerPositions: [new Vector3(0, 0, 0)],
  markerPosInCam: [new Vector2(100, 100)],
};

beforeEach(() => {
  useStore.setState({
    camSources: { workshop: camera },
    activeCamId: 'workshop',
    machineBounds: new Box2(new Vector2(), new Vector2(600, 400)),
  });
});

afterEach(() => {
  cleanup();
  useStore.setState({ camSources: {}, activeCamId: null, machineBounds: null });
});

describe('camera picker', () => {
  it('turns the camera off without losing its setup or the machine bounds, and lets it be selected again', async () => {
    render(<CamSourceSelector />);
    const original = useStore.getState();
    await userEvent.click(screen.getByRole('button', { name: 'Camera' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /No camera/ }));

    expect(getActiveCamSource()).toBeNull();
    expect(useStore.getState().camSources).toBe(original.camSources);
    expect(useStore.getState().machineBounds).toBe(original.machineBounds);
    expect(screen.getByRole('button', { name: 'Camera' }).textContent).toBe('No camera');

    await userEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(screen.queryByRole('menuitem', { name: 'Camera settings' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Manage cameras' })).toBeTruthy();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Workshop camera' }));
    expect(useStore.getState().activeCamId).toBe('workshop');
    expect(getActiveCamSource()).toEqual(camera);
    expect(screen.getByRole('button', { name: 'Camera' }).textContent).toBe('Workshop camera');
  });

  it('keeps No camera selected after settings are rehydrated', async () => {
    render(<CamSourceSelector />);
    await userEvent.click(screen.getByRole('button', { name: 'Camera' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /No camera/ }));
    // Storage batches writes; wait for the off choice, then simulate a reload from those settings.
    await waitFor(() => expect(localStorage.getItem('settings')).toContain('"activeCamId":null'));
    act(() => {
      useStore.getState().setActiveCam('workshop');
      void useStore.persist.rehydrate();
    });
    expect(useStore.getState().activeCamId).toBeNull();
    expect(getActiveCamSource()).toBeNull();
    expect(useStore.getState().camSources.workshop).toEqual(camera);
    expect(screen.getByRole('button', { name: 'Camera' }).textContent).toBe('No camera');
  });

  it('still offers Add camera when none are saved', () => {
    useStore.setState({ camSources: {}, activeCamId: null });
    render(<CamSourceSelector />);
    expect(screen.getByRole('link', { name: 'Add camera' }).getAttribute('href')).toBe('/setup/url-entry');
  });
});

import { buildConnectionUrl, type RtcConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import type { VideoDimensions } from '@wbcnc/go2webrtc/video-source';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { VideoSourceSelection } from './VideoSourceSelection';

vi.mock('next-qrcode', () => ({
  useQRCode: () => ({
    SVG: ({ text }: { text: string }) => <svg data-testid="phone-pairing" data-url={text} />,
  }),
}));

// Keep the media handshake out of this test of pairing identity across form/dialog renders.
vi.mock('./ConnectDialog', () => ({
  ConnectDialog: ({
    params,
    onConfirm,
    onCancel,
  }: {
    params: RtcConnectionParams;
    onConfirm: (resolution: VideoDimensions) => void;
    onCancel: () => void;
  }) => (
    <div role="dialog" aria-label="Video Source Preview">
      <output data-testid="preview-url">{buildConnectionUrl(params)}</output>
      <button onClick={onCancel}>Cancel</button>
      <button onClick={() => onConfirm({ width: 1080, height: 1920 })}>Confirm Video Source</button>
    </div>
  ),
}));

describe('phone source pairing', () => {
  it.each([
    { source: 'a new phone', value: '' },
    { source: 'an existing phone', value: buildConnectionUrl({ type: 'webrtc', accessToken: 'existing-phone-token' }) },
  ])('keeps $source paired through preview cancellation', async ({ value }) => {
    const onChange = vi.fn();
    const screen = await render(<VideoSourceSelection value={value} onChange={onChange} />);
    const getPairingUrl = () => screen.getByTestId('phone-pairing').element().getAttribute('data-url')!;
    const originalPairingUrl = getPairingUrl();
    const accessToken = new URL(originalPairingUrl).searchParams.get('accessToken')!;
    const originalConnectionUrl = buildConnectionUrl({ type: 'webrtc', accessToken });
    if (value) expect(originalConnectionUrl).toBe(value);

    await screen.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.element(screen.getByTestId('preview-url')).toHaveTextContent(originalConnectionUrl);
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    expect(getPairingUrl()).toBe(originalPairingUrl);
    expect(onChange).not.toHaveBeenCalled();

    await screen.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.element(screen.getByTestId('preview-url')).toHaveTextContent(originalConnectionUrl);
    await screen.getByRole('button', { name: 'Confirm Video Source' }).click();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      url: originalConnectionUrl,
      maxResolution: { width: 1080, height: 1920 },
      name: 'Phone',
    });
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
    expect(getPairingUrl()).toBe(originalPairingUrl);
  });
});

import { WebrtcConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { useQRCode } from 'next-qrcode';

const SERVE_URL = 'https://camnc-webrtc-cam.vercel.app/webrtc-custom';

function ServeWebrtcQR({ params }: { params: WebrtcConnectionParams }) {
  const { SVG } = useQRCode();

  const searchParams = new URLSearchParams({
    share: params.share,
    pwd: params.pwd,
  });
  const url = `${SERVE_URL}?${searchParams.toString()}`;
  return <SVG text={url} />;
}

export function PhoneTab({
  defaults,
  onConnect,
}: {
  defaults: WebrtcConnectionParams;
  onConnect: (params: WebrtcConnectionParams) => void;
}) {
  function connect() {
    onConnect(defaults);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Phone via WebRTC</CardTitle>
        <CardDescription>Use an (old) phone as network camera source.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="w-[200px] h-[200px]">
          <ServeWebrtcQR params={defaults} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">Scan the QR code with the phone to use as a camera, then click Connect.</div>
          <div>
            <Button onClick={connect}>Connect</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

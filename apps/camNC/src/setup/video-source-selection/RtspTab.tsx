import { zodResolver } from '@hookform/resolvers/zod';
import { RtspConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  url: z
    .string()
    .trim()
    .regex(/^rtsps?:\/\/[^/\s]+/i, 'Enter an rtsp:// URL, e.g. rtsp://admin:password@192.168.1.20:554/h264Preview_01_main'),
  type: z.literal('rtsp'),
});

/** Desktop app only: the camera's own RTSP stream, played through the go2rtc bundled with the app. */
export function RtspTab({ defaults, onConnect }: { defaults: RtspConnectionParams; onConnect: (params: RtspConnectionParams) => void }) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Network camera (RTSP)</CardTitle>
        <CardDescription>
          Connect directly to an IP camera on your network, such as a Reolink. The desktop app streams it through its built-in go2rtc, so
          nothing else needs to be installed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onConnect)} className="space-y-6">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RTSP URL</FormLabel>
                  <FormControl>
                    <Input placeholder="rtsp://admin:password@192.168.1.20:554/h264Preview_01_main" autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>
                    Reolink: <code>rtsp://user:password@camera-ip:554/h264Preview_01_main</code> (or <code>h265Preview_01_main</code> on
                    newer models). Special characters in the password must be URL-encoded, e.g. <code>$</code> as <code>%24</code>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Connect</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

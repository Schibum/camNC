import { zodResolver } from '@hookform/resolvers/zod';
import { Go2rtcConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { Textarea } from '@wbcnc/ui/components/textarea';
import { ExternalLink } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const schema = z.object({
  host: z.string().min(1).url(),
  src: z.string().min(1),
  type: z.literal('go2rtc'),
});

export function Go2RtcApiTab({
  defaults,
  onConnect,
}: {
  defaults: Go2rtcConnectionParams;
  onConnect: (params: Go2rtcConnectionParams) => void;
}) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>go2rtc (local)</CardTitle>
        <CardDescription>
          Connect directly to a stream provided by{' '}
          <a className="text-blue-500 hover:underline" href="https://github.com/AlexxIT/go2rtc" target="_blank" rel="noreferrer">
            go2rtc
            <ExternalLink className="size-4 inline-block" />
          </a>
          . Preferred option for lower latency.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onConnect)} className="space-y-4">
            <FormField
              control={form.control}
              name="host"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>go2rtc Host</FormLabel>
                  <FormControl>
                    <Input placeholder="localhost:1984 or wss://host" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="src"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stream Name</FormLabel>
                  <FormControl>
                    <Input placeholder="camera1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid w-full items-center gap-1.5">
              <div className="text-sm text-muted-foreground">Example config:</div>
              <Textarea readOnly className="h-20" value={'api:\n  origin: "*"'} />
              <p className="text-sm text-muted-foreground">
                Run go2rtc on <code>localhost</code> or whitelist the host with Chrome&apos;s{' '}
                <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> flag when using plain HTTP. HTTPS/wss is also
                supported.
              </p>
            </div>
            <Button type="submit">Connect</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

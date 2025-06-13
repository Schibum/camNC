import { zodResolver } from '@hookform/resolvers/zod';
import { generatePassword, WebtorrentConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { Textarea } from '@wbcnc/ui/components/textarea';
import { ExternalLink } from 'lucide-react';
import { useForm, UseFormReturn } from 'react-hook-form';
import { stringify } from 'yaml';
import { z } from 'zod';

const go2rtcSchema = z.object({
  share: z.string().min(10),
  pwd: z.string().min(10),
  type: z.literal('webtorrent'),
});

function Rtc2GoConfigTextarea({ form }: { form: UseFormReturn<z.infer<typeof go2rtcSchema>> }) {
  'use no memo'; // opts out this component from being compiled by React Compiler
  const { watch } = form;
  const share = watch('share');
  const pwd = watch('pwd');
  function getGo2rtcConfig() {
    if (!share || !pwd) {
      return '';
    }
    return stringify({
      webtorrent: {
        shares: {
          [share]: {
            pwd: pwd,
            src: 'your-stream-name-from-streams-section',
          },
        },
      },
    });
  }
  if (!share || !pwd) {
    return null;
  }

  return (
    <div className="grid w-full items-center gap-1.5">
      <div className="text-sm text-muted-foreground">Your go2rtc config should include the following:</div>
      <Textarea readOnly className="h-36" value={getGo2rtcConfig()} />
    </div>
  );
}
export function Go2RtcWebtorrentTab({
  defaults,
  onConnect,
}: {
  defaults: WebtorrentConnectionParams;
  onConnect: (params: WebtorrentConnectionParams) => void;
}) {
  'use no memo'; // opts out this component from being compiled by React Compiler
  // const [params, setParams] = useAtom(connectionParamsAtom);
  // if (params.type !== 'webtorrent') throw new Error();
  const form = useForm<z.infer<typeof go2rtcSchema>>({
    resolver: zodResolver(go2rtcSchema),
    defaultValues: defaults,
  });

  // const [tracker, setTracker] = useState('wss://tracker.openwebtorrent.com');
  function onGenerateRandom(ev: React.MouseEvent<HTMLButtonElement>) {
    ev.preventDefault();
    form.setValue('share', crypto.randomUUID());
    form.setValue('pwd', generatePassword());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>go2rtc (webtorrent)</CardTitle>
        <CardDescription>
          Use any IP camera via{' '}
          <a
            className="text-blue-500 hover:underline"
            href="https://github.com/AlexxIT/go2rtc?tab=readme-ov-file#module-webtorrent"
            target="_blank"
            rel="noreferrer">
            go2rtc&apos;s webtorrent module
            <ExternalLink className="size-4 inline-block" />
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onConnect)} className="space-y-8">
            <FormField
              control={form.control}
              name="share"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Share Name</FormLabel>
                  <FormControl>
                    <Input placeholder="globally unique string" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pwd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input placeholder="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Rtc2GoConfigTextarea form={form} />
            <div className="flex gap-2">
              <Button type="submit">Connect</Button>
              <Button onClick={onGenerateRandom} variant="secondary">
                Generate Random
              </Button>
            </div>
          </form>
        </Form>
        {/* <InputWithLabel label="Tracker" value={tracker} onChange={e => setTracker(e.target.value)} type="url" /> */}
      </CardContent>
    </Card>
  );
}

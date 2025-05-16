import { zodResolver } from '@hookform/resolvers/zod';
import { UrlConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wbcnc/ui/components/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const urlSchema = z.object({
  url: z.string().url(),
  type: z.literal('url'),
});
export function UrlTab({ defaults, onConnect }: { defaults: UrlConnectionParams; onConnect: (params: UrlConnectionParams) => void }) {
  const form = useForm<z.infer<typeof urlSchema>>({
    resolver: zodResolver(urlSchema),
    defaultValues: defaults,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Video Stream URL</CardTitle>
        <CardDescription>Mainly intended for dev/testing purposes.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onConnect)} className="space-y-8">
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stream URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com/stream.mp4" {...field} />
                  </FormControl>
                  <FormDescription>URL of the video stream you want to use. Only https URLs are supported.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Connect</Button>
          </form>
        </Form>

        {/* <InputWithLabel type="url" label="Stream URL" value={url} onChange={e => setUrl(e.target.value)} /> */}
      </CardContent>
    </Card>
  );
}

import { createFileRoute } from '@tanstack/react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { Slider } from '@wbcnc/ui/components/slider';
import { Button } from '@wbcnc/ui/components/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { useForm } from 'react-hook-form';
import { toast } from '@wbcnc/ui/components/sonner';
import z from 'zod';
import { useMarkerScanIntervalMs, useSetMarkerScanIntervalMs } from '@/store/store';

export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings,
});

const schema = z.object({
  interval: z.number().min(1).max(10),
});

function GeneralSettings() {
  const intervalMs = useMarkerScanIntervalMs();
  const setIntervalMs = useSetMarkerScanIntervalMs();
  const form = useForm<z.infer<typeof schema>>({
    defaultValues: { interval: intervalMs / 1000 },
    resolver: zodResolver(schema),
  });

  function onSubmit(data: z.infer<typeof schema>) {
    setIntervalMs(data.interval * 1000);
    toast.success('Settings saved');
  }

  return (
    <div className="w-full h-full">
      <PageHeader title="General Settings" />
      <div className="container mx-auto max-w-xl py-6 space-y-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="interval"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Auto Marker Scan Interval ({field.value.toFixed(1)}s)</FormLabel>
                  <FormControl>
                    <Slider minValue={1} maxValue={10} step={0.5} value={[field.value]} onChange={(v: number | number[]) => field.onChange(Array.isArray(v) ? v[0] : v)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit">Save</Button>
          </form>
        </Form>
      </div>
    </div>
  );
}

export default GeneralSettings;

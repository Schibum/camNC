import { createFileRoute } from '@tanstack/react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { Button } from '@wbcnc/ui/components/button';
import { Slider } from '@wbcnc/ui/components/slider';
import { toast } from '@wbcnc/ui/components/sonner';
import { useForm } from 'react-hook-form';
import { useAutoScanInterval, useSetAutoScanInterval } from '@/store/store';
import z from 'zod';

export const Route = createFileRoute('/settings/general')({
  component: GeneralSettings,
});

const schema = z.object({
  intervalSec: z.number().min(1).max(10),
});

function GeneralSettings() {
  const intervalMs = useAutoScanInterval();
  const setIntervalMs = useSetAutoScanInterval();
  const form = useForm<z.infer<typeof schema>>({
    defaultValues: { intervalSec: intervalMs / 1000 },
    resolver: zodResolver(schema),
  });

  function onSubmit(values: z.infer<typeof schema>) {
    setIntervalMs(values.intervalSec * 1000);
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
              name="intervalSec"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Marker Scan Interval</FormLabel>
                  <FormControl>
                    <Slider
                      min={1}
                      max={10}
                      step={0.5}
                      value={field.value}
                      onValueChange={(v: number | number[]) => field.onChange(Array.isArray(v) ? v[0] : v)}
                    />
                  </FormControl>
                  <div className="text-sm text-muted-foreground">{field.value}s</div>
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

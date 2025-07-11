import { isDepthBlendSupported } from '@/depth/depthBlendManager';
import { useDepthSettings, useSetDepthSettings } from '@/store/store';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { Alert, AlertDescription, AlertTitle } from '@wbcnc/ui/components/alert';
import { Button } from '@wbcnc/ui/components/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Slider } from '@wbcnc/ui/components/slider';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { toast } from '@wbcnc/ui/components/sonner';
import { useForm } from 'react-hook-form';
import z from 'zod';

export const Route = createFileRoute('/settings/hide-machine')({
  component: HideMachineComponent,
});

function HideMachineComponent() {
  return <HideMachineSettings />;
}

const fpsOptions: { label: string; value: number }[] = [
  { label: 'Every 5 s', value: 0.2 },
  { label: 'Every 2 s', value: 0.5 },
  { label: '1 fps', value: 1 },
  { label: '2 fps', value: 2 },
  { label: '5 fps', value: 5 },
  { label: '10 fps', value: 10 },
];

const defaultSettings = {
  frameRateLimit: 0.5,
  bgMargin: 50,
  renderMargin: 10,
  minMaskVal: 0.1,
  thresholdOffset: 0.2,
};

const schema = z.object({
  frameRateLimit: z.number().min(0.01),
  bgMargin: z.number().min(0).max(75),
  renderMargin: z.number().min(0).max(75),
  minMaskVal: z.number().min(0).max(0.5),
  thresholdOffset: z.number().min(0).max(1),
});

function HideMachineSettings() {
  const depthSettings = useDepthSettings();
  const setDepthSettings = useSetDepthSettings();

  const form = useForm<z.infer<typeof schema>>({
    defaultValues: {
      ...depthSettings,
    },
    resolver: zodResolver(schema),
  });

  function onSubmit(data: z.infer<typeof schema>) {
    setDepthSettings(data);
    toast.success('Depth settings saved');
  }

  function handleReset() {
    form.reset(defaultSettings);
  }

  return (
    <div className="w-full h-full">
      <PageHeader title="Hide-Machine Settings" />
      <div className="container mx-auto max-w-xl py-6 space-y-6">
        {!isDepthBlendSupported() && (
          <Alert variant="destructive">
            <AlertTitle>WebGPU not supported</AlertTitle>
            <AlertDescription>This feature requires WebGPU, which is not supported by your browser yet.</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          This experimental feature estimates monocular depth using the Depth&nbsp;Anything V2 model to mask objects above the work surface
          and &quot;hide&quot; the machine (only tested with the{' '}
          <a href="https://docs.v1e.com/lowrider/" target="_blank" rel="noreferrer" className="underline">
            LowRider V4 beam
          </a>
          ). The algorithm assumes the largest depth cluster is the table and masks everything above a configurable offset.
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* FPS throttle */}
            <FormField
              control={form.control}
              name="frameRateLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Depth Estimation Interval</FormLabel>
                  <FormControl>
                    <Select value={field.value.toString()} onValueChange={v => field.onChange(parseFloat(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {fpsOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value.toString()}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>Throttle frame rate to reduce (GPU) load</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Background Margin */}
            <FormField
              control={form.control}
              name="bgMargin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Background Mask Margin</FormLabel>
                  <FormControl>
                    <Slider minValue={0} maxValue={75} step={1} value={[field.value]} onChange={(v: number | number[]) => field.onChange(Array.isArray(v) ? v[0] : v)} />
                  </FormControl>
                  <FormDescription>
                    Margin to add around mask when computing background to avoid artifacts from shadows etc.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Render Margin */}
            <FormField
              control={form.control}
              name="renderMargin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Render Mask Margin</FormLabel>
                  <FormControl>
                    <Slider minValue={0} maxValue={75} step={1} value={[field.value]} onChange={(v: number | number[]) => field.onChange(Array.isArray(v) ? v[0] : v)} />
                  </FormControl>
                  <FormDescription>Margin to add around mask when rendering to avoid artifacts from edges of the mask.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Minimum Mask Value */}
            <FormField
              control={form.control}
              name="minMaskVal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Minimum Opacity for Mask</FormLabel>
                  <FormControl>
                    <Slider minValue={0} maxValue={0.5} step={0.01} value={[field.value]} onChange={(v: number | number[]) => field.onChange(Array.isArray(v) ? v[0] : v)} />
                  </FormControl>
                  <FormDescription>Machine will always be visible with at least this opacity.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Offset above table */}
            <FormField
              control={form.control}
              name="thresholdOffset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relative Offset Above Table to Mask</FormLabel>
                  <FormControl>
                    <Slider minValue={0} maxValue={1} step={0.01} value={[field.value]} onChange={(v: number | number[]) => field.onChange(Array.isArray(v) ? v[0] : v)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="submit">Save</Button>
              <Button type="button" variant="secondary" onClick={handleReset}>
                Reset to Defaults
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}

import { getFluidSettingsBounds } from '@/lib/fluidnc/fluidnc-settings';
import { getCncApi } from '@/lib/fluidnc/machine';
import { useMachineBoundsOrNull, useStore } from '@/store/store';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@wbcnc/ui/components/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { toast } from '@wbcnc/ui/components/sonner';
import { useForm, useFormContext } from 'react-hook-form';
import z from 'zod';

function UseFluidNcSettingsButton() {
  'use no memo';
  const isConnected = getCncApi().isConnected.value;
  const formContext = useFormContext<z.infer<typeof schema>>();

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const settings = await getFluidSettingsBounds();
    if (!settings) {
      toast.error('Could not read FluidNC settings');
      return;
    }
    formContext.setValue('xmin', settings.xmin);
    formContext.setValue('xmax', settings.xmax);
    formContext.setValue('ymin', settings.ymin);
    formContext.setValue('ymax', settings.ymax);
  }
  return (
    <Button disabled={!isConnected} onClick={handleClick} variant="outline">
      Read FluidNC Settings
    </Button>
  );
}

const schema = z
  .object({
    // Machine coordinates may be negative, e.g. when homing in positive direction with mpos_mm: 0.
    xmin: z.coerce.number(),
    xmax: z.coerce.number(),
    ymin: z.coerce.number(),
    ymax: z.coerce.number(),
  })
  .refine(data => data.xmax > data.xmin, {
    message: 'xmax must be greater than xmin',
    path: ['xmax'],
  })
  .refine(data => data.ymax > data.ymin, {
    message: 'ymax must be greater than ymin',
    path: ['ymax'],
  });

export type MachineBoundsValues = z.infer<typeof schema>;

export function MachineBoundsForm({
  onConfirmed,
  initial,
  submitLabel = 'Confirm',
  showReadButton = true,
}: {
  onConfirmed: () => void;
  /** Values to start from instead of the saved bounds, e.g. read from the controller. */
  initial?: MachineBoundsValues;
  submitLabel?: string;
  /** Offer reading the bounds from the connected controller. */
  showReadButton?: boolean;
}) {
  const bounds = useMachineBoundsOrNull();
  const setMachineBounds = useStore(state => state.setMachineBounds);
  const form = useForm({
    defaultValues: initial ?? {
      xmin: bounds?.min.x ?? 6,
      xmax: bounds?.max.x ?? 600,
      ymin: bounds?.min.y ?? 6,
      ymax: bounds?.max.y ?? 1200,
    },
    resolver: zodResolver(schema),
  });
  function onSubmit(data: z.infer<typeof schema>) {
    setMachineBounds(data.xmin, data.ymin, data.xmax, data.ymax);
    onConfirmed();
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="grid grid-cols-1 @xs:grid-cols-2 gap-2">
          <FormField
            control={form.control}
            name="xmin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>xmin</FormLabel>
                <FormControl>
                  <Input {...field} type="number" />
                </FormControl>
                <FormDescription>Minimum usable x-coordinate</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="xmax"
            render={({ field }) => (
              <FormItem>
                <FormLabel>xmax</FormLabel>
                <FormControl>
                  <Input {...field} type="number" />
                </FormControl>
                <FormDescription>Maximum usable x-coordinate</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ymin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ymin</FormLabel>
                <FormControl>
                  <Input {...field} type="number" />
                </FormControl>
                <FormDescription>Minimum usable y-coordinate</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ymax"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ymax</FormLabel>
                <FormControl>
                  <Input {...field} type="number" />
                </FormControl>
                <FormDescription>Maximum usable y-coordinate</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex gap-2">
          {showReadButton && <UseFluidNcSettingsButton />}
          <Button type="submit">{submitLabel}</Button>
        </div>
      </form>
    </Form>
  );
}

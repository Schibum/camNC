import { getFluidSettingsBounds } from '@/lib/fluidnc/fluidnc-settings';
import { getFluidNcClient } from '@/lib/fluidnc/fluidnc-singleton';
import { useStore } from '@/store/store';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@wbcnc/ui/components/button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { toast } from '@wbcnc/ui/components/sonner';
import { useForm, useFormContext } from 'react-hook-form';
import z from 'zod';

function UseFluidNcSettingsButton() {
  'use no memo';
  const client = getFluidNcClient();
  const isConnected = client.isConnected.value;
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
    xmin: z.coerce.number().min(0),
    xmax: z.coerce.number().min(0),
    ymin: z.coerce.number().min(0),
    ymax: z.coerce.number().min(0),
  })
  .refine(data => data.xmax > data.xmin, {
    message: 'xmax must be greater than xmin',
    path: ['xmax'],
  })
  .refine(data => data.ymax > data.ymin, {
    message: 'ymax must be greater than ymin',
    path: ['ymax'],
  });

export function MachineBoundsForm({ onConfirmed }: { onConfirmed: () => void }) {
  const bounds = useStore(state => state.camSource!.machineBounds);
  const setMachineBounds = useStore(state => state.camSourceSetters.setMachineBounds);
  const form = useForm({
    defaultValues: {
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
          <UseFluidNcSettingsButton />
          <Button type="submit">Confirm</Button>
        </div>
      </form>
    </Form>
  );
}

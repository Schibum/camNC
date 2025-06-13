import { Hint } from '@/components/Hint';
import { useArucoConfig, useSetArucoConfig, useSetMarkerPositions, useStore } from '@/store/store';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { ExternalLink } from 'lucide-react';
import { Control, useForm } from 'react-hook-form';
import { Vector3 } from 'three';
import z from 'zod';
import { DownloadGcodeButton } from './DownloadGcodeButton';
import { MarkerBoundsButton, calculateDefaultMargin, calculateMarkersWithMargin } from './MarkerBoundsButton';

const markerSchema = z.object({
  x: z.coerce.number(),
  y: z.coerce.number(),
  z: z.coerce.number(),
});

const schema = z.object({
  markers: z.tuple([markerSchema, markerSchema, markerSchema, markerSchema]),
  useArucoMarkers: z.boolean(),
  arucoTagSize: z.coerce.number().min(1).max(1000),
});

type MarkerFormData = z.infer<typeof schema>;

// Marker indices for a fixed set of four positions
const markerIndices = [0, 1, 2, 3] as const;
type MarkerIndex = (typeof markerIndices)[number];

// Sub-component to render x, y, z fields inline for a given marker
interface MarkerFieldsProps {
  control: Control<MarkerFormData>;
  index: MarkerIndex;
}
function MarkerFields({ control, index }: MarkerFieldsProps) {
  return (
    <div className="flex space-x-4 items-end">
      <FormField
        control={control}
        name={`markers.${index}.x`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>x</FormLabel>
            <FormControl>
              <Input {...field} type="number" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`markers.${index}.y`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>y</FormLabel>
            <FormControl>
              <Input {...field} type="number" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={`markers.${index}.z`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>z</FormLabel>
            <FormControl>
              <Input {...field} type="number" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

export function MarkerPositionsForm({ onConfirmed }: { onConfirmed: () => void }) {
  'use no memo';
  const bounds = useStore(state => state.camSource!.machineBounds!);
  const savedRaw = useStore(state => state.camSource?.markerPositions);
  const arucoConfig = useArucoConfig();
  const setMarkerPositions = useSetMarkerPositions();
  const setArucoConfig = useSetArucoConfig();

  // Calculate default markers with margin based on ArUco configuration
  const defaultMargin = calculateDefaultMargin(arucoConfig.useArucoMarkers, arucoConfig.arucoTagSize);
  const machineDefaultMarkers = calculateMarkersWithMargin(bounds, defaultMargin);
  const defaultMarkers = savedRaw ? savedRaw.map(v => ({ x: v.x, y: v.y, z: v.z })) : machineDefaultMarkers;

  const form = useForm<MarkerFormData>({
    defaultValues: {
      markers: defaultMarkers,
      useArucoMarkers: arucoConfig.useArucoMarkers,
      arucoTagSize: arucoConfig.arucoTagSize,
    } as MarkerFormData,
    resolver: zodResolver(schema),
  });

  // Expose reset to restore machine-bound defaults
  const { watch } = form;
  const watchUseArucoMarkers = watch('useArucoMarkers');
  const watchArucoTagSize = parseInt(watch('arucoTagSize') + '');

  function handleMarkerBoundsApply(markers: Array<{ x: number; y: number; z: number }>) {
    form.setValue('markers', markers as any);
  }

  function onSubmit(data: MarkerFormData) {
    const vectors = data.markers.map(m => new Vector3(m.x, m.y, m.z));
    setMarkerPositions(vectors);
    setArucoConfig(data.useArucoMarkers, data.arucoTagSize);
    onConfirmed();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <Hint title="Marker Placement">
          <p className="mb-1">
            You need to place 4 markers on or near the wasteboard so they&apos;re visible in the camera view. You can do this in either of
            the following ways:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>
              Recommended: Add four small 40x40mm pockets to the wasteboard and place (3d) printed{' '}
              <a href="/aruco.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                ArUco markers <ExternalLink className="size-4 inline-block" />
              </a>{' '}
              inside. They can be (re-)detected automatically (e.g. in case the camera or table moves). <br />
              Pocketing gcode for 3.175mm (1/8in) endmill can be generated below for the positions entered.
            </li>
            <li>
              Engrave{' '}
              <a
                href="https://vector76.github.io/gcode_tpgen/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline">
                Squareness marks <ExternalLink className="size-4 inline-block" />
              </a>{' '}
              on the wasteboard at the machine bounds. Then select those manually in the camera view (next step).
            </li>
          </ul>
        </Hint>

        <div className="space-y-4 mb-6">
          <FormField
            control={form.control}
            name="useArucoMarkers"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Use ArUco markers (automatic detection)
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {watchUseArucoMarkers && (
            <FormField
              control={form.control}
              name="arucoTagSize"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ArUco tag size (mm)</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" placeholder="30" />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">Size of the black border in mm (excluding white border)</p>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div>
          <h3 className="font-medium mb-4">Marker Positions {watchUseArucoMarkers ? '(Centers of ArUco tags)' : ''}</h3>
        </div>

        {markerIndices.map(i => (
          <div key={i} className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Marker {i}</p>
            <MarkerFields control={form.control} index={i} />
          </div>
        ))}

        <div className="flex space-x-2 justify-end mt-8 flex-wrap">
          {watchUseArucoMarkers && (
            <DownloadGcodeButton points={watch('markers').map(m => markerSchema.parse(m))} tagSize={watchArucoTagSize} />
          )}
          <MarkerBoundsButton
            bounds={bounds}
            useArucoMarkers={watchUseArucoMarkers}
            arucoTagSize={watchArucoTagSize}
            onApply={handleMarkerBoundsApply}
          />
        </div>
        <div className="flex space-x-2 justify-end mt-2">
          <Button type="submit">Confirm</Button>
        </div>
      </form>
    </Form>
  );
}

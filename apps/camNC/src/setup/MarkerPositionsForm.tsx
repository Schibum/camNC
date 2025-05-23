import { useSetMarkerPositions, useStore } from '@/store/store';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@wbcnc/ui/components/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { ExternalLink } from 'lucide-react';
import { Control, useForm } from 'react-hook-form';
import { Vector3 } from 'three';
import z from 'zod';

const markerSchema = z.object({
  x: z.coerce.number(),
  y: z.coerce.number(),
  z: z.coerce.number(),
});

const schema = z.object({
  markers: z.tuple([markerSchema, markerSchema, markerSchema, markerSchema]),
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
  const bounds = useStore(state => state.camSource!.machineBounds!);
  const savedRaw = useStore(state => state.camSource?.markerPositions);
  const setMarkerPositions = useSetMarkerPositions();

  const machineDefaultMarkers = [
    { x: bounds.min.x, y: bounds.min.y, z: 0 },
    { x: bounds.min.x, y: bounds.max.y, z: 0 },
    { x: bounds.max.x, y: bounds.max.y, z: 0 },
    { x: bounds.max.x, y: bounds.min.y, z: 0 },
  ];
  const defaultMarkers = savedRaw ? savedRaw.map(v => ({ x: v.x, y: v.y, z: v.z })) : machineDefaultMarkers;

  const form = useForm<MarkerFormData>({
    defaultValues: { markers: defaultMarkers } as MarkerFormData,
    resolver: zodResolver(schema),
  });

  // Expose reset to restore machine-bound defaults
  const { reset } = form;
  function handleReset() {
    reset({ markers: machineDefaultMarkers } as MarkerFormData);
  }

  function onSubmit(data: MarkerFormData) {
    const vectors = data.markers.map(m => new Vector3(m.x, m.y, m.z));
    setMarkerPositions(vectors);
    onConfirmed();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="border-l-2 pl-2 mb-4 space-y-1">
          <div className="text-sm">
            <p className="mb-1 font-medium">Marker Placement</p>

            <p className="mb-1">
              You need to place 4 markers on or near the wasteboard so they're visible in the camera view. You can do this in either of the
              following ways:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>
                Easiest setup is to engrave{' '}
                <a
                  href="https://vector76.github.io/gcode_tpgen/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline">
                  Squareness marks <ExternalLink className="size-4 inline-block" />
                </a>{' '}
                on the wasteboard at the machine bounds. Then select those manually in the camera view (next step).
              </li>
              <li>
                Place{' '}
                <a href="/aruco.pdf" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                  ArUco markers <ExternalLink className="size-4 inline-block" />
                </a>{' '}
                next to the wasteboard at known machine coordinates. Harder to position accurately, but they can be (re-)detected
                automatically (e.g. in case the camera or table moves).
              </li>
            </ul>
          </div>
        </div>
        {markerIndices.map(i => (
          <div key={i}>
            <h3 className="font-medium mb-2">Marker {i}</h3>
            <MarkerFields control={form.control} index={i} />
          </div>
        ))}

        <div className="flex space-x-2 justify-end mt-8">
          <Button variant="secondary" type="button" onClick={handleReset}>
            Reset to machine bounds
          </Button>
          <Button type="submit">Confirm</Button>
        </div>
      </form>
    </Form>
  );
}

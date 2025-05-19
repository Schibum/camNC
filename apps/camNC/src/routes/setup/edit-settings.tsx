import { Array9, matrix3ToRowMajor } from '@/lib/three-plain';
import { ICamSource, useCamSource, useStore } from '@/store';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Card, CardContent } from '@wbcnc/ui/components/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { Textarea } from '@wbcnc/ui/components/textarea';
import { useForm } from 'react-hook-form';
import superjson from 'superjson';
import { Box2, Matrix3, Vector2, Vector3 } from 'three';
import { z } from 'zod';

export const Route = createFileRoute('/setup/edit-settings')({
  component: RouteComponent,
});

const innerSchema = z.object({
  calibration: z.object({
    calibration_matrix: z.array(z.number()).length(9),
    new_camera_matrix: z.array(z.number()).length(9),
    distortion_coefficients: z.array(z.number()).length(5),
  }),
  extrinsics: z.object({
    R: z.array(z.number()).length(9),
    t: z.array(z.number()).length(3),
  }),
  machineBounds: z.array(z.number()).length(4),
  machineBoundsInCam: z.array(z.array(z.number()).length(2)).length(4),
  markerPositions: z.array(z.array(z.number()).length(3)).length(4),
});

const schema = z.object({
  json: z
    .string()
    .superRefine((data, ctx) => {
      try {
        const calibration = JSON.parse(data);
        const { error } = innerSchema.safeParse(calibration);
        if (error) {
          for (const issue of error.issues) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: issue.path.join('.') + ': ' + issue.message,
            });
          }
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid calibration data',
        });
      }
    })
    .transform(data => JSON.parse(data) as z.infer<typeof innerSchema>)
    .transform(data => {
      return {
        calibration: {
          calibration_matrix: new Matrix3().set(...(data.calibration.calibration_matrix as Array9)),
          new_camera_matrix: new Matrix3().set(...(data.calibration.new_camera_matrix as Array9)),
          distortion_coefficients: data.calibration.distortion_coefficients,
        },
        extrinsics: {
          R: new Matrix3().set(...(data.extrinsics.R as Array9)),
          t: new Vector3().fromArray(data.extrinsics.t),
        },
        machineBounds: new Box2(
          new Vector2().fromArray(data.machineBounds.slice(0, 2)),
          new Vector2().fromArray(data.machineBounds.slice(2, 4))
        ),
        markerPositions: data.markerPositions.map(p => new Vector3(...p)),
        machineBoundsInCam: data.machineBoundsInCam,
      };
    }),
});

function calibToJson(data: ICamSource) {
  if (!data || !data.calibration) return '';
  return JSON.stringify(
    {
      calibration: {
        calibration_matrix: matrix3ToRowMajor(data.calibration!.calibration_matrix),
        new_camera_matrix: matrix3ToRowMajor(data.calibration!.new_camera_matrix),
        distortion_coefficients: data.calibration!.distortion_coefficients,
      },
      extrinsics: {
        R: matrix3ToRowMajor(data.extrinsics!.R),
        t: data.extrinsics!.t.toArray(),
      },
      machineBounds: data.machineBounds?.min.toArray().concat(data.machineBounds?.max.toArray()),
      markerPositions: data.markerPositions?.map(p => p.toArray()),
      machineBoundsInCam: data.machineBoundsInCam,
    },
    null,
    2
  );
}

function ExportButton() {
  const camSource = useCamSource();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const json = superjson.stringify(camSource);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cam-source.json';
    a.click();
  }
  return (
    <Button variant="secondary" onClick={handleClick}>
      Export
    </Button>
  );
}

function ImportButton({ onImport }: { onImport: (camSource: ICamSource) => void }) {
  const setCamSource = useStore(state => state.setCamSource);
  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const json = superjson.parse<ICamSource>(reader.result as string);
          setCamSource(json);
          onImport(json);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }
  return (
    <Button variant="secondary" onClick={handleClick}>
      Import
    </Button>
  );
}

function CalibrationSettingsForm() {
  const camSource = useCamSource();
  const setCalibration = useStore(state => state.camSourceSetters.setCalibration);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      json: calibToJson(camSource!),
    },
  });
  function onSubmit({ json }: z.infer<typeof schema>) {
    console.log('updating calibration data to ', json.calibration);
    setCalibration(json.calibration);
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="flex flex-row gap-2">
          <ExportButton />
          <ImportButton onImport={camSource => form.setValue('json', calibToJson(camSource))} />
        </div>
        <FormField
          control={form.control as any}
          name="json"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Camera Source Configuration</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit">Save</Button>
      </form>
    </Form>
  );
}

function RouteComponent() {
  return (
    <div className="w-full h-full">
      <PageHeader title="Edit Settings" />
      <div className="flex justify-center p-1 flex-row">
        <Card className="w-full max-w-xl">
          <CardContent>
            <CalibrationSettingsForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

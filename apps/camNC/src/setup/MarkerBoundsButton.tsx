/* eslint-disable react-refresh/only-export-components */
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@wbcnc/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@wbcnc/ui/components/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@wbcnc/ui/components/form';
import { Input } from '@wbcnc/ui/components/input';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Box2 } from 'three';
import z from 'zod';

const marginSchema = z.object({
  margin: z.coerce.number().min(0).max(1000),
});

type MarginFormData = z.infer<typeof marginSchema>;

interface MarkerBoundsButtonProps {
  bounds: Box2;
  arucoTagSize: number;
  onApply: (markers: Array<{ x: number; y: number; z: number }>) => void;
}

export function calculateDefaultMargin(arucoTagSize: number): number {
  return arucoTagSize / 2 + 5;
}

export function calculateMarkersWithMargin(bounds: Box2, margin: number, z = -3.2): Array<{ x: number; y: number; z: number }> {
  return [
    { x: bounds.min.x + margin, y: bounds.min.y + margin, z }, // bottom left
    { x: bounds.min.x + margin, y: bounds.max.y - margin, z }, // top left
    { x: bounds.max.x - margin, y: bounds.max.y - margin, z }, // top right
    { x: bounds.max.x - margin, y: bounds.min.y + margin, z }, // bottom right
  ];
}

export function MarkerBoundsButton({ bounds, arucoTagSize, onApply }: MarkerBoundsButtonProps) {
  const [open, setOpen] = useState(false);
  const defaultMargin = calculateDefaultMargin(arucoTagSize);

  const form = useForm<MarginFormData>({
    defaultValues: { margin: defaultMargin },
    resolver: zodResolver(marginSchema),
  });

  function handleApply(data: MarginFormData) {
    const markers = calculateMarkersWithMargin(bounds, data.margin);
    onApply(markers);
    setOpen(false);
  }

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (newOpen) {
      // Reset form to current default when opening
      form.reset({ margin: calculateDefaultMargin(arucoTagSize) });
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    form.handleSubmit(handleApply)(event);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" type="button">
          Use machine bounds + margin
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set marker margin</DialogTitle>
          <DialogDescription>Choose how far inward from the machine bounds to place the markers.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="margin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Margin (mm)</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" placeholder={String(defaultMargin)} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{`Default: ${defaultMargin}mm (tag size/2 + 5mm clearance)`}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

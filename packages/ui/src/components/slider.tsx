'use client';

import { Slider as HeroSlider } from '@heroui/slider';
import type { SliderProps as HeroSliderProps } from '@heroui/slider';
import { cn } from '@wbcnc/ui/lib/utils';

export interface SliderProps extends HeroSliderProps {
  min?: number;
  max?: number;
  onValueChange?: (value: number | number[]) => void;
}

export function Slider({ className, classNames, min, max, onValueChange, ...props }: SliderProps) {
  return (
    <HeroSlider
      classNames={{
        base: cn(
          'relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
          className
        ),
        trackWrapper:
          'bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5',
        filler: 'bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
        thumb:
          'border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
        track: 'bg-muted w-full h-full rounded-full',
        ...classNames,
      }}
      minValue={min}
      maxValue={max}
      onChange={onValueChange as any}
      {...(props as any)}
    />
  );
}

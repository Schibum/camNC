'use client';

import { Slider as HeroSlider, SliderProps as HeroSliderProps } from '@heroui/slider';
import * as React from 'react';

import { cn } from '@wbcnc/ui/lib/utils';

type SliderProps = HeroSliderProps & { className?: string };

function Slider({ className, ...props }: SliderProps) {
  const classNames = {
    base: cn(
      'relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
      className
    ),
    track:
      'bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5',
    filler: 'bg-primary',
    thumb:
      'border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50',
  } as any;

  return <HeroSlider classNames={classNames} {...(props as any)} />;
}

export { Slider };

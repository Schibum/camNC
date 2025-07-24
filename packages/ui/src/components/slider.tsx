'use client';

import { Slider as HeroSlider } from '@heroui/slider';
import * as React from 'react';

type SliderProps = Omit<React.ComponentProps<typeof HeroSlider>, 'onChange'> & {
  onChange: (value: number) => void;
};

function Slider({ onChange, ...props }: SliderProps) {
  return <HeroSlider {...(props as any)} onChange={onChange} />;
}

export { Slider };

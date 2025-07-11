import { heroui } from '@heroui/react';
export default heroui({
  layout: {
    disabledOpacity: '0.3', // opacity-[0.3]
    radius: {
      small: '0.25rem', // rounded-small
      medium: '0.5rem', // rounded-medium
      large: '1rem', // rounded-large
    },
    borderWidth: {
      small: '1px', // border-small
      medium: '1px', // border-medium
      large: '2px', // border-large
    },
  },
  themes: {
    light: {},
    dark: {},
  },
}) as any;

import convexPlugin from '@convex-dev/eslint-plugin';
import { config as baseConfig } from '@wbcnc/eslint-config/react-internal';

// /** @type {import("eslint").Linter.FlatConfig[]} */
export default [...baseConfig, ...convexPlugin.configs.recommended];

import { config as baseConfig } from '@wbcnc/eslint-config/react-internal';

// These must not import back into modules that start job recovery: a partial vi.mock of camMachine then deadlocks on
// its own import, and the test file hangs with no timeout (see camMachine.partialMock.test.ts).
const machineConnection = { group: ['**/fluidnc/machine'], message: 'Import getExistingCncApi from fluidnc/machineInstance.' };

// /** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  ...baseConfig,
  {
    files: ['src/lib/machine/jobRecovery.ts', 'src/lib/machine/executionFiles.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [machineConnection] }] },
  },
  {
    files: ['src/cam/machine/camMachine.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [machineConnection, { group: ['**/machine/jobRecovery'], message: 'Import the signals from machine/jobRecoveryState.' }] },
      ],
    },
  },
];

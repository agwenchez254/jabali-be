/** @type {import('jest').Config} */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
};
module.exports = {
  projects: [
    { ...base, displayName: 'unit', rootDir: 'src', testRegex: '.*\.spec\.ts$' },
    {
      ...base,
      displayName: 'e2e',
      rootDir: 'test',
      testRegex: '.*\.e2e-spec\.ts$',
      globalSetup: '<rootDir>/global-setup.ts',
    },
  ],
};

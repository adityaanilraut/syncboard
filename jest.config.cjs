module.exports = {
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.test.tsx'],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  setupFiles: ['<rootDir>/tests/setup.cjs'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        jsx: 'react-jsx', esModuleInterop: true, isolatedModules: true,
      },
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '\\.css$': '<rootDir>/tests/styles.cjs',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', 'server/**/*.ts'],
  coverageReporters: ['text', 'json-summary'],
};

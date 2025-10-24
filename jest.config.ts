import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/agents', '<rootDir>/services', '<rootDir>/hooks', '<rootDir>/components', '<rootDir>/utils', '<rootDir>/tests', '<rootDir>/server'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy'
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: 'tsconfig.json',
    },
  },
  collectCoverageFrom: [
    'agents/**/*.ts',
    'services/**/*.ts',
    'hooks/**/*.ts',
    'components/**/*.tsx',
    '!components/icons.tsx'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './agents/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './services/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './hooks/useAgentOrchestrator.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './components/Dashboard.tsx': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  },
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }]
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  extensionsToTreatAsEsm: ['.ts', '.tsx']
};

export default config;

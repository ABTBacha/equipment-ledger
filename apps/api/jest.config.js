module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  globalSetup: '../jest.global-setup.js',
  globalTeardown: '../jest.global-teardown.js',
  setupFilesAfterEnv: ['../jest.setup-db.js'],
};

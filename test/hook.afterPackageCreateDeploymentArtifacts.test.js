/* global jest beforeEach describe it expect */

jest.mock('fs', () => ({
  existsSync: jest.mock(),
  promises: {
    mkdir: jest.fn(),
    write: jest.fn(),
    rmdir: jest.fn(),
  },
}));
const fsAsync = require('fs').promises;
const Middleware = require('../src/index');
const { getServerlessConfig } = require('./utils/configUtils');

describe('Serverless middleware plugin after:deploy:deploy hook', () => {
  beforeEach(() => fsAsync.rmdir.mockClear());

  it('Should clean the temporary folder if cleanFolder is set to true', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      service: {
        custom: {
          middleware: {
            cleanFolder: true,
          },
        },
        functions: {
          someFunc1: {
            name: 'someFunc1',
            handler: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
          },
        },
      },
    });
    const plugin = new Middleware(serverless, {});

    await plugin.hooks['after:package:createDeploymentArtifacts']();

    expect(fsAsync.rmdir).toHaveBeenCalledTimes(1);
    expect(fsAsync.rmdir).toHaveBeenCalledWith('testPath/.middleware');
  });

  it('Should clean the custom temporary folder if cleanFolder is set to true', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      service: {
        custom: {
          middleware: {
            folderName: 'test-folder',
            cleanFolder: true,
          },
        },
        functions: {
          someFunc1: {
            name: 'someFunc1',
            handler: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
          },
        },
      },
    });
    const plugin = new Middleware(serverless, {});

    await plugin.hooks['after:package:createDeploymentArtifacts']();

    expect(fsAsync.rmdir).toHaveBeenCalledTimes(1);
    expect(fsAsync.rmdir).toHaveBeenCalledWith('testPath/test-folder');
  });

  it('Should not clean the temporary folder if cleanFolder is set to false', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      service: {
        custom: {
          middleware: {
            cleanFolder: false,
          },
        },
        functions: {
          someFunc1: {
            name: 'someFunc1',
            handler: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
          },
        },
      },
    });
    const plugin = new Middleware(serverless, {});

    await plugin.hooks['after:package:createDeploymentArtifacts']();

    expect(fsAsync.rmdir).not.toHaveBeenCalled();
  });
});

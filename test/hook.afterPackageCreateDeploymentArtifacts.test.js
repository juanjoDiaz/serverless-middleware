/* global jest beforeEach describe it expect */

jest.mock('fs-extra');
const fs = require('fs-extra');
const Middleware = require('../src/index');
const { getServerlessConfig } = require('./utils/configUtils');

describe('Serverless middleware plugin after:deploy:deploy hook', () => {
  beforeEach(() => fs.remove.mockClear());

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

    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledWith('testPath/.middleware');
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

    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledWith('testPath/test-folder');
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

    expect(fs.remove).not.toHaveBeenCalled();
  });
});

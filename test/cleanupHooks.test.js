/* global jest beforeEach describe it expect */

jest.mock('fs', () => ({
  existsSync: jest.mock(),
  promises: {
    mkdir: jest.fn(),
    write: jest.fn(),
    rm: jest.fn(),
  },
}));
const fsAsync = require('fs').promises;
const path = require('path');
const Middleware = require('../src/index');
const { getServerlessConfig, getPluginUtils } = require('./utils/configUtils');

describe.each([
  'after:package:createDeploymentArtifacts',
  'after:deploy:function:deploy',
  'after:invoke:local:invoke',
  'before:offline:start:end',
])('Serverless middleware plugin %s hook', (hook) => {
  beforeEach(() => fsAsync.rm.mockClear());

  it('Should clean the temporary folder by default', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      service: {
        functions: {
          someFunc1: {
            name: 'someFunc1',
            custom: {
              middleware: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
            },
          },
        },
      },
    });
    const pluginUtils = getPluginUtils({
      log: {
        error: jest.fn(),
      },
    });

    const plugin = new Middleware(serverless, {}, pluginUtils);

    await plugin.hooks[hook]();

    expect(fsAsync.rm).toHaveBeenCalledTimes(1);
    expect(fsAsync.rm).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(pluginUtils.log.error).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

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
            custom: {
              middleware: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
            },
          },
        },
      },
    });
    const pluginUtils = getPluginUtils({
      log: {
        error: jest.fn(),
      },
    });

    const plugin = new Middleware(serverless, {}, pluginUtils);

    await plugin.hooks[hook]();

    expect(fsAsync.rm).toHaveBeenCalledTimes(1);
    expect(fsAsync.rm).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(pluginUtils.log.error).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
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
            custom: {
              middleware: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
            },
          },
        },
      },
    });
    const pluginUtils = getPluginUtils({
      log: {
        error: jest.fn(),
      },
    });

    const plugin = new Middleware(serverless, {}, pluginUtils);

    await plugin.hooks[hook]();

    expect(fsAsync.rm).toHaveBeenCalledTimes(1);
    expect(fsAsync.rm).toHaveBeenCalledWith(path.join('testPath', 'test-folder'), { recursive: true });
    expect(pluginUtils.log.error).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

  it('Should ignore cleaning the custom temporary folder if there was nothing to clean', async () => {
    const err = new Error('Folder doesn\'t exist');
    err.code = 'ENOENT';
    fsAsync.rm.mockRejectedValueOnce(err);
    const serverless = getServerlessConfig({
      service: {
        functions: { someFunc1: { name: 'someFunc1' }, someFunc2: { name: 'someFunc2' } },
      },
    });
    const pluginUtils = getPluginUtils({
      log: {
        error: jest.fn(),
      },
    });

    const plugin = new Middleware(serverless, {}, pluginUtils);

    await plugin.hooks[hook]();

    expect(fsAsync.rm).toHaveBeenCalledTimes(1);
    expect(fsAsync.rm).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(pluginUtils.log.error).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

  it('Should not error if couldn\'t clean up the custom temporary folder', async () => {
    fsAsync.rm.mockRejectedValueOnce(new Error('Folder couldn\'t be cleaned'));
    const serverless = getServerlessConfig({
      service: {
        functions: { someFunc1: { name: 'someFunc1' }, someFunc2: { name: 'someFunc2' } },
      },
    });
    const pluginUtils = getPluginUtils({
      log: {
        error: jest.fn(),
      },
    });

    const plugin = new Middleware(serverless, {}, pluginUtils);

    await plugin.hooks[hook]();

    expect(fsAsync.rm).toHaveBeenCalledTimes(1);
    expect(fsAsync.rm).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(pluginUtils.log.error).toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
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
            custom: {
              middleware: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
            },
          },
        },
      },
    });
    const pluginUtils = getPluginUtils({
      log: {
        error: jest.fn(),
      },
    });

    const plugin = new Middleware(serverless, {}, pluginUtils);

    await plugin.hooks[hook]();

    expect(fsAsync.rm).not.toHaveBeenCalled();
    expect(pluginUtils.log.error).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });
});

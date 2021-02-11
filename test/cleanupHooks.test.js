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
const path = require('path');
const Middleware = require('../src/index');
const { getServerlessConfig } = require('./utils/configUtils');

describe.each([
  'after:package:createDeploymentArtifacts',
  'after:deploy:function:deploy',
  'after:invoke:local:invoke',
  'before:offline:start:end',
])('Serverless middleware plugin %s hook', (hook) => {
  beforeEach(() => fsAsync.rmdir.mockClear());

  it('Should clean the temporary folder by default', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      config: {
        cli: {
          log: jest.fn(),
        },
      },
      service: {
        functions: {
          someFunc1: {
            name: 'someFunc1',
            handler: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
          },
        },
      },
    });
    const plugin = new Middleware(serverless, {});

    await plugin.hooks[hook]();

    expect(fsAsync.rmdir).toHaveBeenCalledTimes(1);
    expect(fsAsync.rmdir).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(serverless.cli.log).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

  it('Should clean the temporary folder if cleanFolder is set to true', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      config: {
        cli: {
          log: jest.fn(),
        },
      },
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

    await plugin.hooks[hook]();

    expect(fsAsync.rmdir).toHaveBeenCalledTimes(1);
    expect(fsAsync.rmdir).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(serverless.cli.log).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

  it('Should clean the custom temporary folder if cleanFolder is set to true', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      config: {
        cli: {
          log: jest.fn(),
        },
      },
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

    await plugin.hooks[hook]();

    expect(fsAsync.rmdir).toHaveBeenCalledTimes(1);
    expect(fsAsync.rmdir).toHaveBeenCalledWith(path.join('testPath', 'test-folder'), { recursive: true });
    expect(serverless.cli.log).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

  it('Should ignore cleaning the custom temporary folder if there was nothing to clean', async () => {
    const err = new Error('Folder doesn\'t exist');
    err.code = 'ENOENT';
    fsAsync.rmdir.mockRejectedValueOnce(err);
    const serverless = getServerlessConfig({
      config: {
        cli: {
          log: jest.fn(),
        },
      },
      service: {
        functions: { someFunc1: { name: 'someFunc1' }, someFunc2: { name: 'someFunc2' } },
      },
    });
    const plugin = new Middleware(serverless, {});

    await plugin.hooks[hook]();

    expect(fsAsync.rmdir).toHaveBeenCalledTimes(1);
    expect(fsAsync.rmdir).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(serverless.cli.log).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

  it('Should not error if couldn\'t clean up the custom temporary folder', async () => {
    fsAsync.rmdir.mockRejectedValueOnce(new Error('Folder couldn\'t be cleaned'));
    const serverless = getServerlessConfig({
      config: {
        cli: {
          log: jest.fn(),
        },
      },
      service: {
        functions: { someFunc1: { name: 'someFunc1' }, someFunc2: { name: 'someFunc2' } },
      },
    });
    const plugin = new Middleware(serverless, {});

    await plugin.hooks[hook]();

    expect(fsAsync.rmdir).toHaveBeenCalledTimes(1);
    expect(fsAsync.rmdir).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
    expect(serverless.cli.log).toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });

  it('Should not clean the temporary folder if cleanFolder is set to false', async () => {
    const mockProvider = { request: jest.fn(() => Promise.resolve()) };
    const serverless = getServerlessConfig({
      getProvider() { return mockProvider; },
      config: {
        cli: {
          log: jest.fn(),
        },
      },
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

    await plugin.hooks[hook]();

    expect(fsAsync.rmdir).not.toHaveBeenCalled();
    expect(serverless.cli.log).not.toHaveBeenCalledWith(expect.stringMatching(/^Middleware: Couldn't clean up temporary folder .*/));
  });
});

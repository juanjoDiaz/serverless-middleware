/* global jest beforeEach describe it expect */

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    mkdir: jest.fn(),
    unlink: jest.fn(),
    writeFile: jest.fn(),
    rm: jest.fn(),
  },
}));
const fs = require('fs');
const path = require('path');

const fsAsync = fs.promises;
const Middleware = require('../src/index');
const { getServerlessConfig, getPluginUtils } = require('./utils/configUtils');

describe('Backward compatibility', () => {
  describe('configSchemaHandler', () => {
    it('should not set the schema if configSchemaHandler is undefined', async () => {
      const serverless = getServerlessConfig({
        configSchemaHandler: null,
      });
      const pluginUtils = getPluginUtils();

      // eslint-disable-next-line no-new
      new Middleware(serverless, {}, pluginUtils);
    });

    it('should not define custom properties if defineCustomProperties is undefined', async () => {
      const defineCustomProperties = null;
      const defineFunctionProperties = jest.fn(() => {});
      const serverless = getServerlessConfig({
        configSchemaHandler: {
          defineCustomProperties,
          defineFunctionProperties,
        },
      });
      const pluginUtils = getPluginUtils();

      // eslint-disable-next-line no-new
      new Middleware(serverless, {}, pluginUtils);

      expect(defineFunctionProperties).toHaveBeenCalledTimes(1);
    });

    it('should not define function properties if defineFunctionProperties is undefined', async () => {
      const defineCustomProperties = jest.fn(() => {});
      const defineFunctionProperties = null;
      const serverless = getServerlessConfig({
        configSchemaHandler: {
          defineCustomProperties,
          defineFunctionProperties,
        },
      });
      const pluginUtils = getPluginUtils();

      // eslint-disable-next-line no-new
      new Middleware(serverless, {}, pluginUtils);

      expect(defineCustomProperties).toHaveBeenCalledTimes(1);
    });
  });

  describe('servicePath renamed to serviceDir', () => {
    beforeEach(() => {
      fs.existsSync.mockImplementation((filePath) => filePath.endsWith('.js'));
      fsAsync.mkdir.mockClear();
      fsAsync.mkdir.mockResolvedValue(undefined);
      fsAsync.writeFile.mockClear();
      fsAsync.writeFile.mockResolvedValue(undefined);
    });

    it('should fallback to servicePath if serviceDir is not defined', async () => {
      const serverless = getServerlessConfig({
        service: {
          custom: {
            warmup: {
              default: {
                enabled: true,
              },
            },
          },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              custom: {
                middleware: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
              },
            },
            someFunc2: { name: 'someFunc2' },
          },
        },
        serviceDir: null,
        config: {
          servicePath: 'testPath',
        },
      });
      const pluginUtils = getPluginUtils();

      const plugin = new Middleware(serverless, {}, pluginUtils);

      await plugin.hooks['before:package:createDeploymentArtifacts']();

      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenCalledWith(path.join('testPath', '.middleware'), { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
      expect(fsAsync.writeFile).toHaveBeenCalledWith(path.join('testPath', '.middleware', 'someFunc1.js'), expect.anything());
    });

    it('should fallback to \'\' if serviceDir and servicePath are not defined', async () => {
      const serverless = getServerlessConfig({
        service: {
          functions: {
            someFunc1: {
              name: 'someFunc1',
              custom: {
                middleware: ['middleware1.handler', 'middleware2.handler', 'handler.handler'],
              },
            },
            someFunc2: { name: 'someFunc2' },
          },
        },
        serviceDir: null,
      });
      const pluginUtils = getPluginUtils();

      const plugin = new Middleware(serverless, {}, pluginUtils);

      await plugin.hooks['before:package:createDeploymentArtifacts']();

      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('', '.middleware'), { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
      expect(fsAsync.writeFile).toHaveBeenCalledWith(path.join('', '.middleware', 'someFunc1.js'), expect.anything());
    });
  });
});

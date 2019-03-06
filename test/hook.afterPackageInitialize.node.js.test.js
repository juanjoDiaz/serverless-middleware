/* global jest beforeEach describe it expect */

jest.mock('fs-extra');
const fs = require('fs-extra');
const Middleware = require('../src/index');
const { getServerlessConfig } = require('./utils/configUtils');
const { GeneratedFunctionTester } = require('./utils/generatedFunctionTester');
const { shouldHaveBeenCalledInOrder } = require('./utils/jest');

fs.outputFile.mockReturnValue(Promise.resolve());

describe('Serverless middleware after:package:initialize hook', () => {
  beforeEach(() => {
    fs.existsSync.mockImplementation(path => path.endsWith('.js'));
    fs.outputFile.mockClear();
  });

  describe('error cases', () => {
    it('should error on unsupported runtimes', async () => {
      const serverless = getServerlessConfig({
        service: {
          provider: { stage: '', region: '', runtime: 'dotnet' },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [{ then: 'middleware1.handler' }, 'middleware2.handler', 'someFunc1.handler'],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await expect(plugin.hooks['after:package:initialize']()).rejects.toThrow('Serverless Middleware doesn\'t support the "dotnet" runtime');
      expect(fs.outputFile).not.toHaveBeenCalled();
    });

    it('should error on unsupported node extensions', async () => {
      fs.existsSync.mockImplementation(path => !path.startsWith('middleware1'));
      const serverless = getServerlessConfig({
        service: {
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [{ then: 'middleware1.handler' }, 'middleware2.handler', 'someFunc1.handler'],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await expect(plugin.hooks['after:package:initialize']()).rejects.toThrow('Unsupported handler extension for module middleware1. Only .js, .jsx, .ts and .tsx are supported.');
      expect(fs.outputFile).not.toHaveBeenCalled();
    });

    it('should error on invalid handler', async () => {
      fs.existsSync.mockImplementation(path => !path.startsWith('middleware1'));
      const serverless = getServerlessConfig({
        service: {
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [{ wrong_field: 'middleware1.handler' }, 'middleware2.handler', 'someFunc1.handler'],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await expect(plugin.hooks['after:package:initialize']()).rejects.toThrow('Invalid handler: {"wrong_field":"middleware1.handler"}');
      expect(fs.outputFile).not.toHaveBeenCalled();
    });
  });

  describe('without pre/pos', () => {
    it('should process handlers that contain arrays and do nothing with standard handlers', async () => {
      const serverless = getServerlessConfig({
        service: {
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [{ then: 'middleware1.handler' }, 'middleware2.handler', 'someFunc1.handler'],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(1);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');

      const event = {};
      const context = {};
      const middlewares = {
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const functionTester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await functionTester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);

      shouldHaveBeenCalledInOrder([
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
        middlewares.someFunc1.handler,
      ]);
    });

    it('should process handler with catch blocks', async () => {
      const serverless = getServerlessConfig({
        service: {
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [
                { then: 'middleware1.handler' },
                { then: 'middleware2.handler', catch: 'catchMiddleware1.handler' },
                'middleware3.handler',
                { catch: 'catchMiddleware2.handler' },
                'someFunc1.handler',
              ],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(1);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');

      const event = {};
      const context = {};
      const err = new Error('Error.');
      const middlewares = {
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware3: { handler: jest.fn().mockImplementation(() => Promise.reject(err)) },
        catchMiddleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        catchMiddleware2: {
          handler: jest.fn().mockImplementation(() => {
            expect(context.prev).toEqual(err);
            return Promise.resolve();
          }),
        },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const functionTester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await functionTester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware1.handler).not.toHaveBeenCalled();
      expect(middlewares.middleware3.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware3.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);

      shouldHaveBeenCalledInOrder([
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
        middlewares.middleware3.handler,
        middlewares.catchMiddleware2.handler,
        middlewares.someFunc1.handler,
      ]);
    });

    it('should end process if context.end is called', async () => {
      const serverless = getServerlessConfig({
        service: {
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [
                { then: 'middleware1.handler' },
                { then: 'middleware2.handler', catch: 'catchMiddleware1.handler' },
                'middleware3.handler',
                { catch: 'catchMiddleware2.handler' },
                'someFunc1.handler',
              ],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(1);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');

      const event = {};
      const context = {};
      const err = new Error('Error.');
      const middlewares = {
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: {
          handler: jest.fn().mockImplementation((_, ctx) => {
            ctx.end();
            return Promise.resolve();
          }),
        },
        middleware3: { handler: jest.fn().mockImplementation(() => Promise.reject(err)) },
        catchMiddleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        catchMiddleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const functionTester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await functionTester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware1.handler).not.toHaveBeenCalled();
      expect(middlewares.middleware3.handler).not.toHaveBeenCalled();
      expect(middlewares.catchMiddleware2.handler).not.toHaveBeenCalled();
      expect(middlewares.someFunc1.handler).not.toHaveBeenCalled();

      shouldHaveBeenCalledInOrder([
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
      ]);
    });
  });

  describe('with pre-handlers', () => {
    it('should process standard and array handlers and add the pre-handlers', async () => {
      const serverless = getServerlessConfig({
        service: {
          custom: {
            middleware: {
              pre: ['preHandler1.handler', 'preHandler2.handler'],
            },
          },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [{ then: 'middleware1.handler' }, 'middleware2.handler', 'someFunc1.handler'],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('_middleware/someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(2);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');
      expect(fs.outputFile.mock.calls[1][0]).toEqual('testPath/_middleware/someFunc2.js');

      const event = {};
      const context = {};
      const middlewares = {
        preHandler1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        preHandler2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const someFunc1Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.preHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);

      shouldHaveBeenCalledInOrder([
        middlewares.preHandler1.handler,
        middlewares.preHandler2.handler,
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
        middlewares.someFunc1.handler,
      ]);

      middlewares.preHandler1.handler.mockClear();
      middlewares.preHandler2.handler.mockClear();

      const someFunc2Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[1][1]);
      await someFunc2Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.preHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc2.handler).toHaveBeenCalledWith(event, context);

      // Commented because jest doesn't clear invocationCallOrder
      // shouldHaveBeenCalledInOrder([
      //   middlewares.preHandler1.handler,
      //   middlewares.preHandler2.handler,
      //   middlewares.middleware1.handler,
      //   middlewares.middleware2.handler,
      //   middlewares.someFunc2.handler,
      // ]);
    });

    it('should process handler and add pre-handlers with catch blocks', async () => {
      const serverless = getServerlessConfig({
        service: {
          custom: {
            middleware: {
              pre: ['preHandler1.handler', { then: 'preHandler2.handler', catch: 'catchPreHandler1.handler' }],
            },
          },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [
                { then: 'middleware1.handler' },
                { then: 'middleware2.handler', catch: 'catchMiddleware1.handler' },
                'middleware3.handler',
                { catch: 'catchMiddleware2.handler' },
                'someFunc1.handler',
              ],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('_middleware/someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(2);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');
      expect(fs.outputFile.mock.calls[1][0]).toEqual('testPath/_middleware/someFunc2.js');

      const event = {};
      const context = {};
      const err1 = new Error('Error 1.');
      const err2 = new Error('Error 2.');
      const middlewares = {
        preHandler1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        preHandler2: { handler: jest.fn().mockImplementation(() => Promise.reject(err1)) },
        catchPreHandler1: {
          handler: jest.fn().mockImplementation(() => {
            expect(context.prev).toEqual(err1);
            return Promise.resolve();
          }),
        },
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware3: { handler: jest.fn().mockImplementation(() => Promise.reject(err2)) },
        catchMiddleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        catchMiddleware2: {
          handler: jest.fn().mockImplementation(() => {
            expect(context.prev).toEqual(err2);
            return Promise.resolve();
          }),
        },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const someFunc1Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.preHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware1.handler).not.toHaveBeenCalled();
      expect(middlewares.middleware3.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware3.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);

      shouldHaveBeenCalledInOrder([
        middlewares.preHandler1.handler,
        middlewares.preHandler2.handler,
        middlewares.catchPreHandler1.handler,
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
        middlewares.middleware3.handler,
        middlewares.catchMiddleware2.handler,
        middlewares.someFunc1.handler,
      ]);

      middlewares.preHandler1.handler.mockClear();
      middlewares.preHandler2.handler.mockClear();
      middlewares.catchPreHandler1.handler.mockClear();
      const someFunc2Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[1][1]);
      await someFunc2Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.preHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc2.handler).toHaveBeenCalledWith(event, context);

      // Commented because jest doesn't clear invocationCallOrder
      // shouldHaveBeenCalledInOrder([
      //   middlewares.preHandler1.handler,
      //   middlewares.preHandler2.handler,
      //   middlewares.catchPreHandler1.handler,
      //   middlewares.someFunc2.handler,
      // ]);
    });

    it('should end process if context.end is called', async () => {
      const serverless = getServerlessConfig({
        service: {
          custom: {
            middleware: {
              pre: ['preHandler1.handler', { then: 'preHandler2.handler', catch: 'catchPreHandler1.handler' }],
            },
          },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [
                { then: 'middleware1.handler' },
                { then: 'middleware2.handler', catch: 'catchMiddleware1.handler' },
                'middleware3.handler',
                { catch: 'catchMiddleware2.handler' },
                'someFunc1.handler',
              ],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('_middleware/someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(2);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');
      expect(fs.outputFile.mock.calls[1][0]).toEqual('testPath/_middleware/someFunc2.js');

      const event = {};
      const context = {};
      const err1 = new Error('Error 1.');
      const err2 = new Error('Error 2.');
      const middlewares = {
        preHandler1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        preHandler2: { handler: jest.fn().mockImplementation(() => Promise.reject(err1)) },
        catchPreHandler1: {
          handler: jest.fn().mockImplementation((_, ctx) => {
            expect(ctx.prev).toEqual(err1);
            ctx.end();
            return Promise.resolve();
          }),
        },
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware3: { handler: jest.fn().mockImplementation(() => Promise.reject(err2)) },
        catchMiddleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        catchMiddleware2: {
          handler: jest.fn().mockImplementation(() => {
            expect(context.prev).toEqual(err2);
            return Promise.resolve();
          }),
        },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const someFunc1Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.preHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware1.handler).not.toHaveBeenCalled();
      expect(middlewares.middleware2.handler).not.toHaveBeenCalled();
      expect(middlewares.catchMiddleware1.handler).not.toHaveBeenCalled();
      expect(middlewares.middleware3.handler).not.toHaveBeenCalled();
      expect(middlewares.catchMiddleware2.handler).not.toHaveBeenCalled();
      expect(middlewares.someFunc1.handler).not.toHaveBeenCalled();

      shouldHaveBeenCalledInOrder([
        middlewares.preHandler1.handler,
        middlewares.preHandler2.handler,
        middlewares.catchPreHandler1.handler,
      ]);

      middlewares.preHandler1.handler.mockClear();
      middlewares.preHandler2.handler.mockClear();
      middlewares.catchPreHandler1.handler.mockClear();
      const someFunc2Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[1][1]);
      await someFunc2Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.preHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.preHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchPreHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc2.handler).not.toHaveBeenCalled();

      // Commented because jest doesn't clear invocationCallOrder
      // shouldHaveBeenCalledInOrder([
      //   middlewares.preHandler1.handler,
      //   middlewares.preHandler2.handler,
      //   middlewares.catchPreHandler1.handler,
      //   middlewares.someFunc2.handler,
      // ]);
    });
  });

  describe('with pos-handlers', () => {
    it('should process standard and array handlers and add the pos-handlers', async () => {
      const serverless = getServerlessConfig({
        service: {
          custom: {
            middleware: {
              pos: ['posHandler1.handler', 'posHandler2.handler'],
            },
          },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [{ then: 'middleware1.handler' }, 'middleware2.handler', 'someFunc1.handler'],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('_middleware/someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(2);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');
      expect(fs.outputFile.mock.calls[1][0]).toEqual('testPath/_middleware/someFunc2.js');

      const event = {};
      const context = {};
      const middlewares = {
        posHandler1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        posHandler2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const someFunc1Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledWith(event, context);

      shouldHaveBeenCalledInOrder([
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
        middlewares.someFunc1.handler,
        middlewares.posHandler1.handler,
        middlewares.posHandler2.handler,
      ]);

      middlewares.posHandler1.handler.mockClear();
      middlewares.posHandler2.handler.mockClear();

      const someFunc2Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[1][1]);
      await someFunc2Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.someFunc2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledWith(event, context);

      // Commented because jest doesn't clear invocationCallOrder
      // shouldHaveBeenCalledInOrder([
      //   middlewares.someFunc2.handler,
      //   middlewares.posHandler1.handler,
      //   middlewares.posHandler2.handler,
      // ]);
    });

    it('should process handler and add pos-handlers with catch blocks', async () => {
      const serverless = getServerlessConfig({
        service: {
          custom: {
            middleware: {
              pos: ['posHandler1.handler', { then: 'posHandler2.handler', catch: 'catchPosHandler1.handler' }],
            },
          },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [
                { then: 'middleware1.handler' },
                { then: 'middleware2.handler', catch: 'catchMiddleware1.handler' },
                'middleware3.handler',
                { catch: 'catchMiddleware2.handler' },
                'someFunc1.handler',
              ],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('_middleware/someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(2);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');
      expect(fs.outputFile.mock.calls[1][0]).toEqual('testPath/_middleware/someFunc2.js');

      const event = {};
      const context = {};
      const err1 = new Error('Error 1.');
      const err2 = new Error('Error 2.');
      const middlewares = {
        posHandler1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        posHandler2: { handler: jest.fn().mockImplementation(() => Promise.reject(err1)) },
        catchPosHandler1: {
          handler: jest.fn().mockImplementation(() => {
            expect(context.prev).toEqual(err1);
            return Promise.resolve();
          }),
        },
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware3: { handler: jest.fn().mockImplementation(() => Promise.reject(err2)) },
        catchMiddleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        catchMiddleware2: {
          handler: jest.fn().mockImplementation(() => {
            expect(context.prev).toEqual(err2);
            return Promise.resolve();
          }),
        },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const someFunc1Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware1.handler).not.toHaveBeenCalled();
      expect(middlewares.middleware3.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware3.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchPosHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchPosHandler1.handler).toHaveBeenCalledWith(event, context);

      shouldHaveBeenCalledInOrder([
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
        middlewares.middleware3.handler,
        middlewares.catchMiddleware2.handler,
        middlewares.someFunc1.handler,
        middlewares.posHandler1.handler,
        middlewares.posHandler2.handler,
      ]);

      middlewares.posHandler1.handler.mockClear();
      middlewares.posHandler2.handler.mockClear();
      middlewares.catchPosHandler1.handler.mockClear();
      const someFunc2Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[1][1]);
      await someFunc2Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.someFunc2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchPosHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchPosHandler1.handler).toHaveBeenCalledWith(event, context);

      // Commented because jest doesn't clear invocationCallOrder
      // shouldHaveBeenCalledInOrder([
      //   middlewares.someFunc1.handler,
      //   middlewares.posHandler1.handler,
      //   middlewares.posHandler2.handler,
      //   middlewares.catchPosHandler1.handler,
      // ]);
    });

    it('should process handler and add pos-handlers with catch blocks', async () => {
      const serverless = getServerlessConfig({
        service: {
          custom: {
            middleware: {
              pos: ['posHandler1.handler', { then: 'posHandler2.handler', catch: 'catchPosHandler1.handler' }],
            },
          },
          functions: {
            someFunc1: {
              name: 'someFunc1',
              handler: [
                { then: 'middleware1.handler' },
                { then: 'middleware2.handler', catch: 'catchMiddleware1.handler' },
                'middleware3.handler',
                { catch: 'catchMiddleware2.handler' },
                'someFunc1.handler',
              ],
            },
            someFunc2: {
              name: 'someFunc2',
              handler: 'someFunc2.handler',
            },
          },
        },
      });
      const plugin = new Middleware(serverless, {});

      await plugin.hooks['after:package:initialize']();

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('_middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('_middleware/someFunc2.handler');
      expect(fs.outputFile).toHaveBeenCalledTimes(2);
      expect(fs.outputFile.mock.calls[0][0]).toEqual('testPath/_middleware/someFunc1.js');
      expect(fs.outputFile.mock.calls[1][0]).toEqual('testPath/_middleware/someFunc2.js');

      const event = {};
      const context = {};
      const err1 = new Error('Error 1.');
      const err2 = new Error('Error 2.');
      const middlewares = {
        posHandler1: {
          handler: jest.fn().mockImplementation((_, ctx) => {
            ctx.end();
            return Promise.resolve();
          }),
        },
        posHandler2: { handler: jest.fn().mockImplementation(() => Promise.reject(err1)) },
        catchPosHandler1: { handler: jest.fn().mockImplementation(() => Promise.reject(err1)) },
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware3: { handler: jest.fn().mockImplementation(() => Promise.reject(err2)) },
        catchMiddleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        catchMiddleware2: {
          handler: jest.fn().mockImplementation(() => {
            expect(context.prev).toEqual(err2);
            return Promise.resolve();
          }),
        },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const someFunc1Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[0][1]);
      await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.middleware1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.middleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware1.handler).not.toHaveBeenCalled();
      expect(middlewares.middleware3.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.middleware3.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.catchMiddleware2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler2.handler).not.toHaveBeenCalled();
      expect(middlewares.catchPosHandler1.handler).not.toHaveBeenCalled();

      shouldHaveBeenCalledInOrder([
        middlewares.middleware1.handler,
        middlewares.middleware2.handler,
        middlewares.middleware3.handler,
        middlewares.catchMiddleware2.handler,
        middlewares.someFunc1.handler,
        middlewares.posHandler1.handler,
      ]);

      middlewares.posHandler1.handler.mockClear();
      middlewares.posHandler2.handler.mockClear();
      middlewares.catchPosHandler1.handler.mockClear();
      const someFunc2Tester = new GeneratedFunctionTester(fs.outputFile.mock.calls[1][1]);
      await someFunc2Tester.executeMiddlewareFunction(event, context, middlewares);

      expect(middlewares.someFunc2.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.someFunc2.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledTimes(1);
      expect(middlewares.posHandler1.handler).toHaveBeenCalledWith(event, context);
      expect(middlewares.posHandler2.handler).not.toHaveBeenCalled();
      expect(middlewares.catchPosHandler1.handler).not.toHaveBeenCalled();

      // Commented because jest doesn't clear invocationCallOrder
      // shouldHaveBeenCalledInOrder([
      //   middlewares.someFunc2.handler,
      //   middlewares.posHandler1.handler,
      // ]);
    });
  });
});

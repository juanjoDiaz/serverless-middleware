/* global jest beforeEach describe it expect */

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  promises: {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    rmdir: jest.fn(),
  },
}));

const fs = require('fs');

const fsAsync = fs.promises;
const Middleware = require('../src/index');
const { getServerlessConfig } = require('./utils/configUtils');
const { GeneratedFunctionTester } = require('./utils/generatedFunctionTester');
const { shouldHaveBeenCalledInOrder } = require('./utils/jest');

fs.existsSync.mockImplementation((path) => path.endsWith('.ts'));
fsAsync.mkdir.mockReturnValue(Promise.resolve());
fsAsync.writeFile.mockReturnValue(Promise.resolve());

describe('Serverless middleware after:package:initialize hook', () => {
  beforeEach(() => {
    fsAsync.mkdir.mockClear();
    fsAsync.writeFile.mockClear();
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));

      const event = {};
      const context = {};
      const middlewares = {
        middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
        someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
      };

      const functionTester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));

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

      const functionTester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));

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

      const functionTester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('.middleware/someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(2);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(2, 'testPath/.middleware/someFunc2.ts', expect.any(String));

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

      const someFunc1Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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

      const someFunc2Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[1][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('.middleware/someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(2);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(2, 'testPath/.middleware/someFunc2.ts', expect.any(String));

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

      const someFunc1Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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
      const someFunc2Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[1][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('.middleware/someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(2);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(2, 'testPath/.middleware/someFunc2.ts', expect.any(String));

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

      const someFunc1Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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
      const someFunc2Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[1][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('.middleware/someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(2);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(2, 'testPath/.middleware/someFunc2.ts', expect.any(String));

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

      const someFunc1Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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

      const someFunc2Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[1][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('.middleware/someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(2);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(2, 'testPath/.middleware/someFunc2.ts', expect.any(String));

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

      const someFunc1Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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
      const someFunc2Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[1][1]);
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

      expect(plugin.serverless.service.functions.someFunc1.handler).toEqual('.middleware/someFunc1.handler');
      expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('.middleware/someFunc2.handler');
      expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
      expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, 'testPath/.middleware', { recursive: true });
      expect(fsAsync.writeFile).toHaveBeenCalledTimes(2);
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(1, 'testPath/.middleware/someFunc1.ts', expect.any(String));
      expect(fsAsync.writeFile).toHaveBeenNthCalledWith(2, 'testPath/.middleware/someFunc2.ts', expect.any(String));

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

      const someFunc1Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[0][1]);
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
      const someFunc2Tester = GeneratedFunctionTester
        .fromTypeScript(fsAsync.writeFile.mock.calls[1][1]);
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

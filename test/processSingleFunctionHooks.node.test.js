/* global jest beforeEach describe it expect */

jest.mock('fs', () => ({
	existsSync: jest.fn(),
	realpathSync: jest.fn(),
	promises: {
		mkdir: jest.fn(),
		writeFile: jest.fn(),
		rm: jest.fn(),
	},
}));
const fs = require('fs');
const path = require('path');

const fsAsync = fs.promises;
const Middleware = require('../src/index');
const { getServerlessConfig, getPluginUtils } = require('./utils/configUtils');
const { GeneratedFunctionTester } = require('./utils/generatedFunctionTester');
const { shouldHaveBeenCalledInOrder } = require('./utils/jest');

fsAsync.mkdir.mockReturnValue(Promise.resolve());
fsAsync.writeFile.mockReturnValue(Promise.resolve());

describe.each([
	'before:deploy:function:packageFunction',
	'before:invoke:local:invoke',
])('Serverless middleware %s hook', (hook) => {
	beforeEach(() => {
		fsAsync.mkdir.mockClear();
		fsAsync.writeFile.mockClear();
	});

	describe('error cases', () => {
		beforeEach(() => fs.existsSync.mockImplementation((filePath) => filePath.endsWith('.js')));

		it('should error on unsupported runtimes', async () => {
			const serverless = getServerlessConfig({
				service: {
					provider: { stage: '', region: '', runtime: 'dotnet' },
					functions: {
						someFunc1: {
							name: 'someFunc1',
							middleware: [
								{ then: 'middleware1.handler' },
								'middleware2.handler',
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
			const pluginUtils = getPluginUtils();

			const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

			await expect(plugin.hooks[hook]()).rejects.toThrow(
				'Serverless Middleware doesn\'t support the "dotnet" runtime',
			);
			expect(fsAsync.mkdir).not.toHaveBeenCalled();
			expect(fsAsync.writeFile).not.toHaveBeenCalled();
		});

		it('should error on unsupported node extensions', async () => {
			fs.existsSync.mockImplementation((filePath) => !filePath.startsWith('middleware1'));
			const serverless = getServerlessConfig({
				service: {
					functions: {
						someFunc1: {
							name: 'someFunc1',
							middleware: [
								{ then: 'middleware1.handler' },
								'middleware2.handler',
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
			const pluginUtils = getPluginUtils();

			const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

			await expect(plugin.hooks[hook]()).rejects.toThrow(
				'Unsupported handler extension for module middleware1. Only .js, .jsx, .ts and .tsx are supported.',
			);
			expect(fsAsync.mkdir).not.toHaveBeenCalled();
			expect(fsAsync.writeFile).not.toHaveBeenCalled();
		});

		it('should error on invalid handler', async () => {
			fs.existsSync.mockImplementation((filePath) => !filePath.startsWith('middleware1'));
			const serverless = getServerlessConfig({
				service: {
					functions: {
						someFunc1: {
							name: 'someFunc1',
							middleware: [
								{ wrong_field: 'middleware1.handler' },
								'middleware2.handler',
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
			const pluginUtils = getPluginUtils();

			const plugin = new Middleware(serverless, { function: 'unknownFunction' }, pluginUtils);

			await expect(plugin.hooks[hook]()).rejects.toThrow('Unknown function: unknownFunction');
			expect(fsAsync.mkdir).not.toHaveBeenCalled();
			expect(fsAsync.writeFile).not.toHaveBeenCalled();
		});

		it('should error on unknown function option', async () => {
			fs.existsSync.mockImplementation((filePath) => !filePath.startsWith('middleware1'));
			const serverless = getServerlessConfig({
				service: {
					functions: {
						someFunc1: {
							name: 'someFunc1',
							middleware: [
								{ wrong_field: 'middleware1.handler' },
								'middleware2.handler',
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
			const pluginUtils = getPluginUtils();

			const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

			await expect(plugin.hooks[hook]()).rejects.toThrow(
				'Invalid handler: {"wrong_field":"middleware1.handler"}',
			);
			expect(fsAsync.mkdir).not.toHaveBeenCalled();
			expect(fsAsync.writeFile).not.toHaveBeenCalled();
		});

		it('should error on function mixing handler and array middlewares', async () => {
			fs.existsSync.mockImplementation((filePath) => !filePath.startsWith('middleware1'));
			const serverless = getServerlessConfig({
				service: {
					functions: {
						someFunc1: {
							name: 'someFunc1',
							handler: 'someFunc1.handler',
							middleware: ['middleware1.handler', 'middleware2.handler'],
						},
						someFunc2: {
							name: 'someFunc2',
							handler: 'someFunc2.handler',
						},
					},
				},
			});
			const pluginUtils = getPluginUtils();

			const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

			await expect(plugin.hooks[hook]()).rejects.toThrow(
				'Error in function someFunc1. When defining a handler, only the { pre: ..., pos: ...} configuration is allowed.',
			);
			expect(fsAsync.mkdir).not.toHaveBeenCalled();
			expect(fsAsync.writeFile).not.toHaveBeenCalled();
		});
	});

	describe.each([
		['js', GeneratedFunctionTester.fromJavaScript],
		['ts', GeneratedFunctionTester.fromTypeScript],
	])('Node.js extension: %s', (extension, functionTesterFrom) => {
		beforeEach(() =>
			fs.existsSync.mockImplementation((filePath) => filePath.endsWith(`.${extension}`)),
		);

		describe('without pre/pos', () => {
			it('should process handlers that contain arrays and do nothing with standard handlers', async () => {
				const serverless = getServerlessConfig({
					service: {
						functions: {
							someFunc1: {
								name: 'someFunc1',
								middleware: [
									{ then: 'middleware1.handler' },
									'middleware2.handler',
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

				const event = {};
				const context = {};
				const middlewares = {
					middleware1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
					middleware2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
					someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
				};

				const functionTester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
								middleware: [
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const functionTester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
								middleware: [
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(plugin.serverless.service.functions.someFunc2.handler).toEqual('someFunc2.handler');
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const functionTester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
			it('should process standard handlers and array middlewares and add the global pre-handlers', async () => {
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
								middleware: [
									{ then: 'middleware1.handler' },
									'middleware2.handler',
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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

				// Commented because jest doesn't clear invocationCallOrder
				// shouldHaveBeenCalledInOrder([
				//   middlewares.preHandler1.handler,
				//   middlewares.preHandler2.handler,
				//   middlewares.middleware1.handler,
				//   middlewares.middleware2.handler,
				//   middlewares.someFunc2.handler,
				// ]);
			});

			it('should process middlewares and add pre-handlers with catch blocks', async () => {
				const serverless = getServerlessConfig({
					service: {
						custom: {
							middleware: {
								pre: [
									'preHandler1.handler',
									{ then: 'preHandler2.handler', catch: 'catchPreHandler1.handler' },
								],
							},
						},
						functions: {
							someFunc1: {
								name: 'someFunc1',
								middleware: [
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
			});

			it('should process standard handlers and array middlewares and add the function-specific pre-handlers', async () => {
				const serverless = getServerlessConfig({
					service: {
						functions: {
							someFunc1: {
								name: 'someFunc1',
								handler: 'someFunc1.handler',
								middleware: {
									pre: ['preHandler1.handler', 'preHandler2.handler'],
								},
							},
						},
					},
				});
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, {}, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

				const event = {};
				const context = {};
				const middlewares = {
					preHandler1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
					preHandler2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
					someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
				};

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
				await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

				expect(middlewares.preHandler1.handler).toHaveBeenCalledTimes(1);
				expect(middlewares.preHandler1.handler).toHaveBeenCalledWith(event, context);
				expect(middlewares.preHandler2.handler).toHaveBeenCalledTimes(1);
				expect(middlewares.preHandler2.handler).toHaveBeenCalledWith(event, context);
				expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
				expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);

				shouldHaveBeenCalledInOrder([
					middlewares.preHandler1.handler,
					middlewares.preHandler2.handler,
					middlewares.someFunc1.handler,
				]);

				middlewares.preHandler1.handler.mockClear();
				middlewares.preHandler2.handler.mockClear();

				// Commented because jest doesn't clear invocationCallOrder
				// shouldHaveBeenCalledInOrder([
				//   middlewares.preHandler1.handler,
				//   middlewares.preHandler2.handler,
				//   middlewares.middleware1.handler,
				//   middlewares.middleware2.handler,
				//   middlewares.someFunc2.handler,
				// ]);
			});

			it('should end process if context.end is called', async () => {
				const serverless = getServerlessConfig({
					service: {
						custom: {
							middleware: {
								pre: [
									'preHandler1.handler',
									{ then: 'preHandler2.handler', catch: 'catchPreHandler1.handler' },
								],
							},
						},
						functions: {
							someFunc1: {
								name: 'someFunc1',
								middleware: [
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
			});
		});

		describe('with pos-handlers', () => {
			it('should process standard handlers and array middlewares and add the global pos-handlers', async () => {
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
								middleware: [
									{ then: 'middleware1.handler' },
									'middleware2.handler',
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
			});

			it('should process middlewares and add pos-handlers with catch blocks', async () => {
				const serverless = getServerlessConfig({
					service: {
						custom: {
							middleware: {
								pos: [
									'posHandler1.handler',
									{ then: 'posHandler2.handler', catch: 'catchPosHandler1.handler' },
								],
							},
						},
						functions: {
							someFunc1: {
								name: 'someFunc1',
								middleware: [
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
			});

			it('should process standard handlers and array middlewares and add the function-specific pos-handlers', async () => {
				const serverless = getServerlessConfig({
					service: {
						functions: {
							someFunc1: {
								name: 'someFunc1',
								handler: 'someFunc1.handler',
								middleware: {
									pos: ['posHandler1.handler', 'posHandler2.handler'],
								},
							},
						},
					},
				});
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, {}, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

				const event = {};
				const context = {};
				const middlewares = {
					posHandler1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
					posHandler2: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
					someFunc1: { handler: jest.fn().mockImplementation(() => Promise.resolve()) },
				};

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
				await someFunc1Tester.executeMiddlewareFunction(event, context, middlewares);

				expect(middlewares.posHandler1.handler).toHaveBeenCalledTimes(1);
				expect(middlewares.posHandler1.handler).toHaveBeenCalledWith(event, context);
				expect(middlewares.posHandler2.handler).toHaveBeenCalledTimes(1);
				expect(middlewares.posHandler2.handler).toHaveBeenCalledWith(event, context);
				expect(middlewares.someFunc1.handler).toHaveBeenCalledTimes(1);
				expect(middlewares.someFunc1.handler).toHaveBeenCalledWith(event, context);

				shouldHaveBeenCalledInOrder([
					middlewares.someFunc1.handler,
					middlewares.posHandler1.handler,
					middlewares.posHandler2.handler,
				]);

				middlewares.posHandler1.handler.mockClear();
				middlewares.posHandler2.handler.mockClear();

				// Commented because jest doesn't clear invocationCallOrder
				// shouldHaveBeenCalledInOrder([
				//   middlewares.preHandler1.handler,
				//   middlewares.preHandler2.handler,
				//   middlewares.middleware1.handler,
				//   middlewares.middleware2.handler,
				//   middlewares.someFunc2.handler,
				// ]);
			});

			it('should end process if context.end is called', async () => {
				const serverless = getServerlessConfig({
					service: {
						custom: {
							middleware: {
								pos: [
									'posHandler1.handler',
									{ then: 'posHandler2.handler', catch: 'catchPosHandler1.handler' },
								],
							},
						},
						functions: {
							someFunc1: {
								name: 'someFunc1',
								middleware: [
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
				const pluginUtils = getPluginUtils();

				const plugin = new Middleware(serverless, { function: 'someFunc1' }, pluginUtils);

				await plugin.hooks[hook]();

				expect(plugin.serverless.service.functions.someFunc1.handler).toEqual(
					'.middleware/someFunc1.handler',
				);
				expect(fsAsync.mkdir).toHaveBeenCalledTimes(1);
				expect(fsAsync.mkdir).toHaveBeenNthCalledWith(1, path.join('testPath', '.middleware'), {
					recursive: true,
				});
				expect(fsAsync.writeFile).toHaveBeenCalledTimes(1);
				expect(fsAsync.writeFile).toHaveBeenNthCalledWith(
					1,
					path.join('testPath', '.middleware', `someFunc1.${extension}`),
					expect.any(String),
				);

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

				const someFunc1Tester = functionTesterFrom(fsAsync.writeFile.mock.calls[0][1]);
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
			});
		});
	});
});

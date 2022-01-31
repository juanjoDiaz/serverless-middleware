/**
 * @module serverless-middleware
 *
 * @see {@link https://serverless.com/framework/docs/providers/aws/guide/plugins/}
 *
 * @requires 'fs'
 * @requires 'path'
 * */
const fs = require('fs');
const path = require('path');
const { extendServerlessSchema } = require('./schema');
const createJSMiddlewareHandler = require('./javascript');
const createTSMiddlewareHandler = require('./typescript');
const { parseHandler } = require('./utils');

const fsAsync = fs.promises;

/**
 * @classdesc Easily use handlers as middleware.
 * @class Middleware
 * */
class Middleware {
  /**
   * @description Serverless Middleware
   * @constructor
   *
   * @param {!Object} serverless - Serverless object
   * */
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    extendServerlessSchema(this.serverless);

    this.hooks = {
      'before:package:createDeploymentArtifacts': this.processHandlers.bind(this),
      'after:package:createDeploymentArtifacts': this.clearResources.bind(this),
      'before:deploy:function:packageFunction': this.processHandlers.bind(this),
      'after:deploy:function:deploy': this.clearResources.bind(this),
      'before:invoke:local:invoke': this.processHandlers.bind(this),
      'after:invoke:local:invoke': this.clearResources.bind(this),
      'before:offline:start:init': this.processHandlers.bind(this),
      'before:offline:start:end': this.clearResources.bind(this),
    };

    this.middlewareBuilders = {
      js: createJSMiddlewareHandler,
      ts: createTSMiddlewareHandler,
    };

    // Fix for issues in Serverles
    // https://github.com/serverless/serverless/pull/9307
    this.serviceDir = this.serverless.serviceDir || this.serverless.config.servicePath || '';
  }

  /**
   * @description Configure the plugin based on the context of serverless.yml
   *
   * @return {Object} - Configuration options to be used by the plugin
   * */
  configPlugin(service) {
    const defaultOpts = {
      folderName: '.middleware',
      cleanFolder: true,
      pre: [],
      pos: [],
    };

    const config = (service.custom && service.custom.middleware) || {};
    const folderName = (typeof config.folderName === 'string') ? config.folderName : defaultOpts.folderName;
    const pathFolder = path.join(this.serviceDir, folderName);
    const pathToRoot = path.relative(pathFolder, this.serviceDir);

    return {
      folderName,
      pathFolder,
      pathToRoot,
      cleanFolder: (typeof config.cleanFolder === 'boolean') ? config.cleanFolder : defaultOpts.cleanFolder,
      pre: Array.isArray(config.pre) ? config.pre : defaultOpts.pre,
      pos: Array.isArray(config.pos) ? config.pos : defaultOpts.pos,
    };
  }

  /**
   * @description After package initialize hook. Create middleware functions and update the service.
   *
   * @fulfil {} — Middleware set
   * @reject {Error} Middleware error
   *
   * @return {Promise}
   * */
  async processHandlers() {
    this.middlewareOpts = this.middlewareOpts || this.configPlugin(this.serverless.service);

    const fnNames = this.options.function
      ? [this.options.function]
      : this.serverless.service.getAllFunctions();

    const fns = fnNames
      .map((name) => {
        const fn = this.serverless.service.getFunction(name);

        if (fn === undefined) {
          throw new Error(`Unknown function: ${name}`);
        }

        return fn;
      })
      .filter((fn) => this.middlewareOpts.pre.length
        || this.middlewareOpts.pos.length
        || (fn.custom && fn.custom.middleware))
      .map((fn) => {
        if (!fn.custom || !fn.custom.middleware) {
          return {
            fn,
            handlers: fn.handler ? [fn.handler] : [],
          };
        }

        if (Array.isArray(fn.custom.middleware)) {
          if (fn.handler) {
            throw new Error(`Error in function ${fn.name}. When defining a handler, only the { pre: ..., pos: ...} configuration is allowed.`);
          }

          return {
            fn,
            handlers: fn.custom.middleware,
          };
        }

        return {
          fn,
          handlers: [
            ...(fn.custom.middleware.pre ? fn.custom.middleware.pre : []),
            ...(fn.handler ? [fn.handler] : []),
            ...(fn.custom.middleware.pos ? fn.custom.middleware.pos : []),
          ],
        };
      })
      .map(({ fn, handlers: rawHandlers }) => {
        const handlers = this.preProcessFnHandlers(rawHandlers);
        const extension = this.getLanguageExtension(handlers);
        return { fn, handlers, extension };
      });

    if (fns.length === 0) return;

    await fsAsync.mkdir(this.middlewareOpts.pathFolder, { recursive: true });

    await Promise.all(fns.map(async ({ fn, handlers, extension }) => {
      this.serverless.cli.log(`Middleware: setting ${handlers.length} middlewares for function ${fn.name}`);

      const middlewareBuilder = this.middlewareBuilders[extension];
      const handlerPath = path.join(this.middlewareOpts.pathFolder, `${fn.name}.${extension}`);
      const handler = middlewareBuilder(handlers, this.middlewareOpts.pathToRoot);
      await fsAsync.writeFile(handlerPath, handler);
      // eslint-disable-next-line no-param-reassign
      fn.handler = `${this.middlewareOpts.folderName}/${fn.name}.handler`;
    }));
  }

  /**
   * @description Generate the list of middlewares for a given function.
   *
   * @return {Object[]} List of middleware to include for the function
   * */
  preProcessFnHandlers(handlers) {
    return [
      ...this.middlewareOpts.pre,
      ...handlers,
      ...this.middlewareOpts.pos,
    ].map((handler) => {
      if (handler.then && handler.catch) {
        return {
          then: parseHandler(handler.then),
          catch: parseHandler(handler.catch),
        };
      }
      if (handler.then) return { then: parseHandler(handler.then) };
      if (handler.catch) return { catch: parseHandler(handler.catch) };
      if (typeof handler === 'string') return { then: parseHandler(handler) };

      throw new Error(`Invalid handler: ${JSON.stringify(handler)}`);
    });
  }

  /**
   * @description Determine the extension to use for the middleware handler.
   *
   * @return {string} Extension to use
   * */
  getLanguageExtension(handlers) {
    switch (this.serverless.service.provider.runtime) {
      case 'nodejs10.x':
      case 'nodejs12.x':
      case 'nodejs14.x':
        return Middleware.getNodeExtension(handlers);
      // TODO add other runtimes
      default:
        throw new Error(`Serverless Middleware doesn't support the "${this.serverless.service.provider.runtime}" runtime`);
    }
  }

  /**
   * @description Check the extension of the handlers to find determine
   * whether they are Javascript or TypeScript.
   *
   * @return {string} Extension to use
   * */
  static getNodeExtension(handlers) {
    const getNodeType = (handler) => {
      if (handler === undefined) return false;

      const { module } = handler;

      if (fs.existsSync(`${module}.js`) || fs.existsSync(`${module}.jsx`)) return 'js';
      if (fs.existsSync(`${module}.ts`) || fs.existsSync(`${module}.tsx`)) return 'ts';

      throw new Error(`Unsupported handler extension for module ${module}. Only .js, .jsx, .ts and .tsx are supported.`);
    };

    const isTS = handlers.some((handler) => getNodeType(handler.then) === 'ts' || getNodeType(handler.catch) === 'ts');

    return isTS ? 'ts' : 'js';
  }

  /**
   * @description After create deployment artifacts. Clean prefix folder.
   *
   * @fulfil {} — Optimization finished
   * @reject {Error} Optimization error
   *
   * @return {Promise}
   * */
  async clearResources() {
    try {
      this.middlewareOpts = this.middlewareOpts || this.configPlugin(this.serverless.service);
      if (this.middlewareOpts.cleanFolder) {
        await fsAsync.rm(this.middlewareOpts.pathFolder, { recursive: true });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.serverless.cli.log(`Middleware: Couldn't clean up temporary folder ${this.middlewareOpts.cleanFolder}.`);
      }
    }
  }
}

module.exports = Middleware;

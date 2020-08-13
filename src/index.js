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
  constructor(serverless) {
    this.serverless = serverless;

    this.hooks = {
      'after:package:initialize': this.processHandlers.bind(this),
      'after:package:createDeploymentArtifacts': this.clearResources.bind(this),
      'before:deploy:function:packageFunction': this.processHandlers.bind(this),
      'before:invoke:local:invoke': this.processHandlers.bind(this),
      'after:invoke:local:invoke': this.clearResources.bind(this),
      'before:offline:start:init': this.processHandlers.bind(this),
      'before:offline:start:end': this.clearResources.bind(this),
    };

    this.middlewareBuilders = {
      js: createJSMiddlewareHandler,
      ts: createTSMiddlewareHandler,
    };
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
    const pathFolder = path.join(this.serverless.config.servicePath, folderName);
    const pathToRoot = path.relative(pathFolder, this.serverless.config.servicePath);

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

    const fns = this.serverless.service.getAllFunctions()
      .map((name) => this.serverless.service.getFunction(name))
      .filter((fn) => this.middlewareOpts.pre.length
        || this.middlewareOpts.pos.length
        || Array.isArray(fn.handler))
      .map((fn) => {
        const handlers = this.preProcessFnHandlers(fn);
        const extension = this.getLanguageExtension(handlers);
        return { fn, handlers, extension };
      });

    if (fns.length === 0) return;

    await fsAsync.mkdir(this.middlewareOpts.pathFolder, { recursive: true });

    await Promise.all(fns.map(async ({ fn, handlers, extension }) => {
      this.serverless.cli.log(`Middleware: setting ${handlers.length} middlewares for function ${fn.name}`);

      const middlewareBuilder = this.middlewareBuilders[extension];
      const handlerPath = `${this.middlewareOpts.pathFolder}/${fn.name}.${extension}`;
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
  preProcessFnHandlers(fn) {
    return this.middlewareOpts.pre
      .concat(fn.handler)
      .concat(this.middlewareOpts.pos)
      .map((handler) => {
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
      case 'nodejs8.10':
      case 'nodejs10.x':
      case 'nodejs12.x':
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
    this.middlewareOpts = this.middlewareOpts || this.configPlugin(this.serverless.service);
    if (this.middlewareOpts.cleanFolder) {
      await fsAsync.rmdir(this.middlewareOpts.pathFolder);
    }
  }
}

module.exports = Middleware;

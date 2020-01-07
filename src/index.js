/**
 * @module serverless-middleware
 *
 * @see {@link https://serverless.com/framework/docs/providers/aws/guide/plugins/}
 *
 * @requires 'fs-extra'
 * @requires 'path'
 * */
const fs = require('fs-extra');
const path = require('path');
const createJSMiddlewareHandler = require('./javascript');
const createTSMiddlewareHandler = require('./typescript');
const { parseHandler } = require('./utils');

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
    await Promise.all(
      this.serverless.service.getAllFunctions()
        .map(async (name) => {
          const fn = this.serverless.service.getFunction(name);

          if (!this.middlewareOpts.pre.length
            && !this.middlewareOpts.pos.length
            && !Array.isArray(fn.handler)) {
            return;
          }

          const handlers = this.middlewareOpts.pre
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

          this.serverless.cli.log(`Middleware: setting ${handlers.length} middlewares for function ${name}`);

          const extension = this.getLanguageExtension(handlers);
          const middlewareBuilder = this.middlewareBuilders[extension];
          const handlerPath = `${this.middlewareOpts.pathFolder}/${name}.${extension}`;
          const handler = middlewareBuilder(handlers, this.middlewareOpts.pathToRoot);
          await fs.outputFile(handlerPath, handler);
          fn.handler = `${this.middlewareOpts.folderName}/${name}.handler`;
        }),
    );
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
      await fs.remove(this.middlewareOpts.pathFolder);
    }
  }
}

module.exports = Middleware;

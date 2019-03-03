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
   * @param {!Object} options - Serverless options
   * */
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'after:package:initialize': this.afterPackageInitialize.bind(this),
      'after:package:createDeploymentArtifacts': this.afterCreateDeploymentArtifacts.bind(this),
      'before:offline:start:init': this.afterPackageInitialize.bind(this),
      'before:offline:start:end': this.afterCreateDeploymentArtifacts.bind(this),
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
  async afterPackageInitialize() {
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
            .concat(this.middlewareOpts.pos);
          this.serverless.cli.log(`Middleware: setting ${handlers.length} middlewares ${name}`);
          const handlerPath = `${this.middlewareOpts.pathFolder}/${name}`;
          const handler = Middleware.createMiddlewareHandler(
            handlers,
            this.middlewareOpts.pathToRoot,
          );
          await fs.outputFile(handlerPath, handler);
          fn.handler = `${this.middlewareOpts.folderName}/${name}.handler`;
        }),
    );
  }

  /**
   * @description After create deployment artifacts. Clean prefix folder.
   *
   * @fulfil {} — Optimization finished
   * @reject {Error} Optimization error
   *
   * @return {Promise}
   * */
  async afterCreateDeploymentArtifacts() {
    this.middlewareOpts = this.middlewareOpts || this.configPlugin(this.serverless.service);
    if (this.middlewareOpts.cleanFolder) {
      await fs.remove(this.middlewareOpts.pathFolder);
    }
  }

  /**
   * @description Configure the plugin based on the context of serverless.yml
   *
   * @return {Object} - Configuration options to be used by the plugin
   * */
  configPlugin(service) {
    const defaultOpts = {
      folderName: '_middleware',
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
   * @description Create middleware handler and save it to disk
   *
   * @param {Array<string>} handlers - handlers to be run as middleware
   *
   * @fulfil {} — Middleware handler created
   * @reject {Error} Middleware error
   *
   * @return {Promise}
   * */
  static createMiddlewareHandler(handlers, pathToRoot = '.') {
    return `'use strict';
    
const handlers = ${JSON.stringify(handlers)};
module.exports.handler = async (event, context) => {
  let end = false;
  context.end = () => end = true;

  const wrappedHandler = handler => prev => {
    if (end) return prev;
    context.prev = prev;
    const [module, fn] = handler.split(/\\.(?=[^\\.]+$)/);
    return require(\`${pathToRoot}/\${module}\`)[fn](event, context);
  };

  return handlers
    .reduce((promise, handler) => {
      if (typeof handler === 'object') {
        if (handler.then && handler.catch) {
          return promise
            .then(wrappedHandler(handler.then))
            .catch(wrappedHandler(handler.catch));
        }
        if (handler.then) return promise.then(wrappedHandler(handler.then));
        if (handler.catch) return promise.catch(wrappedHandler(handler.catch));
        throw new Error(\`Unkownw handler: \${JSON.stringify(handler)}\`);
      }

      return promise.then(wrappedHandler(handler));
    }, Promise.resolve());
};`;
  }
}

module.exports = Middleware;

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

const parseHandler = (handler) => {
  const [module, fn] = handler.split(/\.(?=[^.]+$)/);
  return {
    name: module.replace(/\s|\//g, '_'),
    module,
    fn,
  };
};

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
      'after:package:initialize': this.processHandlers.bind(this),
      'after:package:createDeploymentArtifacts': this.clearResources.bind(this),
      'before:offline:start:init': this.processHandlers.bind(this),
      'before:offline:start:end': this.clearResources.bind(this),
    };

    this.middlewareBuilders = {
      js: Middleware.createJSMiddlewareHandler,
      ts: Middleware.createTSMiddlewareHandler,
    };
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
              if (typeof handler === 'string') return { then: handler };
              if (handler.then || handler.catch) return handler;

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

      const { module } = parseHandler(handler);

      if (fs.existsSync(`${module}.js`) || fs.existsSync(`${module}.jsx`)) return 'js';
      if (fs.existsSync(`${module}.ts`) || fs.existsSync(`${module}.tsx`)) return 'ts';

      throw new Error(`Unsupported handler extension for module ${module}. Only .js, .jsx, .ts and .tsx are supported.`);
    };

    const isTS = handlers.some(handler => getNodeType(handler.then) === 'ts' || getNodeType(handler.catch) === 'ts');

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

  /**
   * @description Create TypeScript middleware handler
   *
   * @param {Array<string>} handlers - handlers to be run as middleware
   *
   * @fulfil {} — Middleware handler created
   * @reject {Error} Middleware error
   *
   * @return {Promise}
   * */
  static createTSMiddlewareHandler(handlers, pathToRoot = '.') {
    const handlersInfo = handlers
      .reduce((modules, handler) => {
        if (handler.then && handler.catch) {
          const { name, module } = parseHandler(handler.then);
          const { name: name2, module: module2 } = parseHandler(handler.catch);
          return { ...modules, [module]: name, [module2]: name2 };
        }
        if (handler.then) {
          const { name, module } = parseHandler(handler.then);
          return { ...modules, [module]: name };
        }

        const { name, module } = parseHandler(handler.catch);
        return { ...modules, [module]: name };
      }, {});
    const imports = Object.keys(handlersInfo)
      .map(handler => `import * as ${handlersInfo[handler]} from '${pathToRoot}/${handler}'`).join('\n');

    const wrapHandler = (handler) => {
      const { name, fn } = parseHandler(handler);
      return `prev => {
      if (end) return prev;
      context.prev = prev;
      return ${name}.${fn}(event, context, () => { throw new Error('Callback can\\'t be used in middlewares.'); });
    }`;
    };

    const promiseChain = handlers.map((handler) => {
      if (handler.then && handler.catch) {
        return `    .then(${wrapHandler(handler.then)})\n    .catch(${wrapHandler(handler.catch)})`;
      }

      if (handler.then) return `    .then(${wrapHandler(handler.then)})`;

      return `    .catch(${wrapHandler(handler.catch)})`;
    }).join('\n');

    return `'use strict';
    
${imports}

export async function handler(event, context) {
  let end = false;
  context.end = () => end = true;

  return Promise.resolve()
${promiseChain};
};`;
  }

  /**
   * @description Create Javascript middleware handler
   *
   * @param {Array<string>} handlers - handlers to be run as middleware
   *
   * @fulfil {} — Middleware handler created
   * @reject {Error} Middleware error
   *
   * @return {Promise}
   * */
  static createJSMiddlewareHandler(handlers, pathToRoot = '.') {
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

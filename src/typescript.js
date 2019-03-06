const { parseHandler } = require('./utils');

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
function createTSMiddlewareHandler(handlers, pathToRoot = '.') {
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

module.exports = createTSMiddlewareHandler;

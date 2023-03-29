/**
 * @description Create Javascript middleware handler
 *
 * @param {Array<string>} handlers - handlers to be run as middleware
 *
 * @return {string} Javascript middleware handler
 * */
function createJSMiddlewareHandler(handlers, pathToRoot) {
  const handlersInfo = handlers
    .reduce((modules, handler) => {
      if (handler.then && handler.catch) {
        const { name, module } = handler.then;
        const { name: name2, module: module2 } = handler.catch;
        return { ...modules, [module]: name, [module2]: name2 };
      }
      if (handler.then) {
        const { name, module } = handler.then;
        return { ...modules, [module]: name };
      }

      const { name, module } = handler.catch;
      return { ...modules, [module]: name };
    }, {});

  const imports = Object.keys(handlersInfo)
    .map((handler) => `const ${handlersInfo[handler]} = require('${pathToRoot}/${handler}'.js);`).join('\n');

  const promiseChain = handlers.map((handler) => {
    if (handler.then && handler.catch) {
      const { name, fn } = handler.then;
      const { name: name2, fn: fn2 } = handler.catch;
      return `    .then(wrappedHandler(${name}.${fn}.bind(${name})))
    .catch(wrappedHandler(${name2}.${fn2}.bind(${name2})))`;
    }

    if (handler.then) {
      const { name, fn } = handler.then;
      return `    .then(wrappedHandler(${name}.${fn}.bind(${name})))`;
    }

    const { name, fn } = handler.catch;
    return `    .catch(wrappedHandler(${name}.${fn}.bind(${name})))`;
  }).join('\n');

  return `'use strict';
    
${imports}

module.exports.handler = async (event, context) => {
  let end = false;
  context.end = () => end = true;

  const wrappedHandler = handler => prev => {
    if (end) return prev;
    context.prev = prev;
    return handler(event, context);
  };

  return Promise.resolve()
${promiseChain};
};`;
}

module.exports = createJSMiddlewareHandler;

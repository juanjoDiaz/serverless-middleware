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
function createJSMiddlewareHandler(handlers, pathToRoot = '.') {
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

module.exports = createJSMiddlewareHandler;

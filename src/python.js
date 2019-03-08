/**
 * @description Create a Python middleware handler
 *
 * @param {Array<string>} handlers - handlers to be run as middleware
 *np
 * @return {string} Python Middleware handler
 * */
function createPythonMiddlewareHandler(handlers, pathToRoot) {
  const handlersInfo = handlers
    .reduce((modules, handler) => {
      if (handler.then && handler.catch) {
        const { fn, module } = handler.then;
        const { fn: fn2, module: module2 } = handler.catch;
        return { ...modules, [module]: fn, [module2]: fn2 };
      }
      if (handler.then) {
        const { fn, module } = handler.then;
        return { ...modules, [module]: fn };
      }

      const { fn, module } = handler.catch;
      return { ...modules, [module]: fn };
    }, {});

  const imports = Object.keys(handlersInfo)
    .map(handler => `from '${pathToRoot}/${handler}' import ${handlersInfo[handler]}`).join('\n');

  const pipeline = handlers.reduce(({chain, indent}, handler) => {
    if (handler.then) {
      chain.push(`${indent}context.prev = wrappedHandler(${handler.then.fn})`);
    }

    if (handler.catch) {
      chain = [
        `${indent}try:`,
        ...chain.map(line => `    ${line}`),
        `${indent}except Exception as e:`,
        `${indent}    context.prev = e`,
        `${indent}    context.prev = wrappedHandler(${handler.catch.fn}) # excp`,
      ];
    }

    return { chain, indent };
  }, { chain: [], indent: '    ' }).chain.join('\n');

  return `${imports}

def handler(event, context):
  end = False
  def end_pipeline():
    global end
    end = True

  context.end = end_pipeline

  def wrappedHandler(handler):
    if end == False:
      return handler(event, context)

${pipeline}
  
  return context.prev`;
}

module.exports = createPythonMiddlewareHandler;

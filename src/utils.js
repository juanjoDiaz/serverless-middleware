
function parseHandler(handler) {
  const [module, fn] = handler.split(/\.(?=[^.]+$)/);
  return {
    name: module.replace(/\s|\//g, '_'),
    module,
    fn,
  };
}

module.exports = {
  parseHandler,
};

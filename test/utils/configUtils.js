function getServerlessConfig(serverlessOverrides = {}) {
  const serverless = {
    provider: {},
    config: {},
    service: {},
    ...serverlessOverrides,
  };

  return {
    getProvider: serverless.getProvider || (() => {}),
    config: {
      servicePath: serverless.config.servicePath || 'testPath',
    },
    cli: {
      log: (serverless.config.cli && serverless.config.cli.log) || (() => {}),
    },
    service: {
      provider: serverless.service.provider || { stage: '', region: '', runtime: 'nodejs14.x' },
      defaults: serverless.service.defaults || { stage: '', region: '' },
      service: 'middleware-test',
      custom: serverless.service.custom,
      getAllFunctions() { return Object.keys(this.functions); },
      getFunction(name) { return this.functions[name]; },
      functions: serverless.service.functions || {},
    },
  };
}

module.exports = {
  getServerlessConfig,
};

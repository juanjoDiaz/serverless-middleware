class FakeServerlessError extends Error {}

function getServerlessConfig(serverlessOverrides = {}) {
	const serverless = {
		provider: {},
		config: {},
		service: {},
		...serverlessOverrides,
	};

	return {
		getProvider: serverless.getProvider || (() => {}),
		configSchemaHandler:
			serverless.configSchemaHandler !== undefined
				? serverless.configSchemaHandler
				: {
						defineCustomProperties() {},
						defineFunctionProperties() {},
					},
		serviceDir: serverless.serviceDir !== undefined ? serverless.serviceDir : 'testPath',
		config: {
			servicePath: serverless.config.servicePath,
		},
		service: {
			provider: serverless.service.provider || { stage: '', region: '', runtime: 'nodejs22.x' },
			defaults: serverless.service.defaults || { stage: '', region: '' },
			service: 'middleware-test',
			custom: serverless.service.custom,
			getAllFunctions() {
				return Object.keys(this.functions);
			},
			getFunction(name) {
				return this.functions[name];
			},
			functions: serverless.service.functions || {},
		},
		classes: {
			Error: FakeServerlessError,
		},
	};
}

function getPluginUtils(options = {}) {
	return {
		log: {
			error: () => {},
			warning: () => {},
			notice: () => {},
			info: () => {},
			...options.log,
		},
	};
}

module.exports = {
	getServerlessConfig,
	getPluginUtils,
};

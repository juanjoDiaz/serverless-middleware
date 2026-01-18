function parseHandler(handler) {
	const [module, fn] = handler.split(/\.(?=[^.]+$)/);
	return {
		name: module.replace(/^[^a-zA-Z_$]|[^\w_$]/g, '_'),
		module,
		fn,
	};
}

module.exports = {
	parseHandler,
};

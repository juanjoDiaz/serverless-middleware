class GeneratedFunctionTester {
  constructor(func) {
    this.func = func;
  }

  get middlewareFunction() {
    return new Function('event', 'context', 'dependencies', `
      const require = (dep) => {
        if (!dependencies[dep]) {
          throw new Error(\`Unknow dependency (\${dep})\`);
        }

        return dependencies[dep];
      };
      const module = { exports: {} };
      ${this.func}
      return module.exports.handler(event, context);
    `);
  }

  async executeMiddlewareFunction(event, context, dependencies) {
    await this.middlewareFunction(event, context, dependencies);
  }
} 

module.exports = { GeneratedFunctionTester };
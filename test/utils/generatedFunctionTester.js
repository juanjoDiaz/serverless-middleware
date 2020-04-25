const { transpileModule, ModuleKind } = require('typescript');

class GeneratedFunctionTester {
  constructor(fn) {
    this.fn = fn;
  }

  static fromJavaScript(fn) {
    return new GeneratedFunctionTester(fn);
  }

  static fromTypeScript(fn) {
    return new GeneratedFunctionTester(transpileModule(fn, {
      compilerOptions: { module: ModuleKind.CommonJS },
    }).outputText);
  }

  get middlewareFunction() {
    // eslint-disable-next-line no-new-func
    return new Function('event', 'context', 'dependencies', `
      const require = (dependencyName) => {
        const dependency = dependencies[dependencyName.replace('../', '')];
        if (!dependency) {
          throw new Error(\`Unknow dependency (\${dep})\`);
        }

        return dependency;
      };
      const exports = {};
      const module = { exports };
      ${this.fn}
      return module.exports.handler(event, context);
    `);
  }

  async executeMiddlewareFunction(event, context, dependencies) {
    await this.middlewareFunction(event, context, dependencies);
  }
}

module.exports = { GeneratedFunctionTester };

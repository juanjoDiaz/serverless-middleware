Serverless Middleware
=====================
[![Serverless][serverless-badge]](serverless-badge-url)
[![npm version][npm-version-badge]][npm-version-badge-url]
[![npm monthly downloads][npm-downloads-badge]][npm-version-badge-url]
[![Node.js CI](https://github.com/juanjoDiaz/serverless-middleware/actions/workflows/on-push.yaml/badge.svg)](https://github.com/juanjoDiaz/serverless-middleware/actions/workflows/on-push.yaml)
[![Coverage Status][coveralls-badge]][coveralls-badge-url]
[![license](https://img.shields.io/npm/l/serverless-middleware.svg)](https://raw.githubusercontent.com/juanjoDiaz/serverless-middleware/master/LICENSE)

Serverless plugin to allow middleware handlers configured directly in serverless.yaml

## Requirements:
* Serverless v3
* AWS provider
* Node.js 14+

### Supported runtimes

- [x] nodejs12.x (both Javascript and Typescript)
- [x] nodejs14.x (both Javascript and Typescript)
- [x] nodejs16.x (both Javascript and Typescript)
- [x] nodejs18.x (both Javascript and Typescript)
- [x] nodejs20.x (both Javascript and Typescript)
- [x] nodejs22.x (both Javascript and Typescript)
- [ ] dotnetcore2.1
- [ ] java8
- [ ] java11
- [ ] go1.x
- [ ] python2.7
- [ ] python3.7
- [ ] ruby2.5
- [ ] provided 

## Installation

Install via npm in the root of your Serverless service:

```sh
npm install serverless-middleware --save-dev
```

Add the plugin to the `plugins` array in your Serverless `serverless.yaml`:

```yaml
plugins:
  - serverless-middleware
```

## How it works

Middleware allows you to set up multiple handlers to be executed sequentially including error handlers that will capture any exception in the chain.

Middlewares are just standard AWS lambda handlers that return a promise (or are async).
Handlers using `callback` will NOT work.
```js
const myMiddleware = async (event, context) => { ... };
```

Once `serverless-middleware` is installed you can set the `function.middleware` property to an array and skip the `function.handler` property.
Each middleware handler can be a string (like a standard handler would be) or an object containing the properties `then` and/or `catch`.

For example:

```yaml
provider:
  name: aws
  runtime: nodejs22.x
  
functions:
  myFunction:
    middleware:
      - auth.authenticate
      - auth.authorize
      - then: myFunction.handler # `then:` is unnecessary here.
      - catch: utils.handlerError
      - # or both can be combined
        then: logger.log
        catch: utils.handlerLoggerError
```

will result in an execution like:

```js
Promise.resolve()
  .then(require('./auth').authenticate)
  .then(require('./auth').authorize)
  .then(require('./myFunction').handler)
  .catch(require('./utils').handlerError)
  .then(require('./logger').log)
  .catch(require('./utils').handlerLoggerError);
```

As with standard promises, catch handlers are only executed when there are exceptions.
The resulting lambda will return the result returned by the last middleware handler executed.

The `event` and `context` objects are passed from handler to handler so you can attach new properties to be accessed by subsequent handlers.
`context` always contains the result of the previous handler in the `prev` property.
The user can also stop at any point in the chain by calling the `end` method in the `context` argument. After `context.end()` is called, no more handlers will be executed.

For example:

```js
const myMiddleware = async (event, context) => {
  if (context.prev === undefined) {
    // Previous middleware handler didn't return. End execution.
    context.end();
    return {
      statusCode: 200,
      body: 'No results',
    };
  }

  ...
};
```

You can also add pre/pos- middleware handlers and maintain the `function.handler`. These middleware are just prepended/appended to the main handler.

For example:

```yaml

provider:
  name: aws
  runtime: nodejs22.x
  
functions:
  myFunction:
    events:
      - http:
          path: my-function
          method: get
    handler: myFunction.handler
    middleware:
      pre:
        - auth.authenticate
        - auth.authorize
      pos:
        - catch: utils.handlerError
```

You can also add pre/pos- middleware handlers at the package level using the `custom.middleware` section of `serverless.yaml`. These middleware are just prepended/appended to all the function middleware handlers chain.

For example:

```yaml

provider:
  name: aws
  runtime: nodejs22.x

custom:
  middleware:
    pre:
      - auth.authenticate
    pos:
      - catch: utils.handlerError

functions:
  myAnonymousFunction:
    events:
      - http:
          path: my-anonymous-function
          method: get
    handler: myAnonymousFunction.handler
  myFunction:
    events:
      - http:
          path: my-function
          method: get
    handler: myFunction.handler
    middleware:
      pre:
        - auth.authorize
```

will result in a similar promise chain as above.

## Packaging

In most cases, you shouldn't need to change the default packaging configuration.
For edge cases, Middleware can be configured to use a specific intermediary folder and to not clear it after creating the serverless package.

These settings are also set in the `custom.middleware` section of `serverless.yaml`

```yaml
custom:
  middleware:
    folderName: my_custom_folder  # defaults to '.middleware'
    cleanFolder: false            # defaults to 'true'
```

This might be useful if you are using `sls package` and building your own artifacts.

## Migrations

### v1.0.0 to 2.0.0

#### Use function.middleware instead fo function.custom.middleware

### v0.0.14 to v0.0.15

#### Use function.custom.middleware instead fo function.handler
Passing an array to the handler property is not allowed anymore since Serverless is getting stricter with it's types and it also causes issues with Typescript.

So
```js
functions:
  myFunction:
    handler:
      - auth.authenticate
      - auth.authorize
      - then: myFunction.handler # `then:` is unnecessary here.
      - catch: utils.handlerError
      - # or both can be combined
        then: logger.log
        catch: utils.handlerLoggerError
```
becomes
```js
functions:
  myFunction:
    custom:
      middleware:
        - auth.authenticate
        - auth.authorize
        - then: myFunction.handler # `then:` is unnecessary here.
        - catch: utils.handlerError
        - # or both can be combined
          then: logger.log
          catch: utils.handlerLoggerError
```

## Contribute

Help us to make this plugin better.

* Clone the code
* Install the dependencies with `npm install`
* Create a feature branch `git checkout -b new_feature`
* Add your code and add tests if you implement a new feature
* Validate your changes `npm run lint` and `npm test` (or `npm run test-with-coverage`)

## License

This software is released under the MIT license. See [the license file](LICENSE) for more details.

[serverless-badge]: http://public.serverless.com/badges/v3.svg
[serverless-badge-url]: http://www.serverless.com
[npm-version-badge]: https://badge.fury.io/js/serverless-middleware.svg
[npm-version-badge-url]: https://www.npmjs.com/package/serverless-middleware
[npm-downloads-badge]: https://img.shields.io/npm/dm/serverless-middleware.svg
[coveralls-badge]: https://coveralls.io/repos/juanjoDiaz/serverless-middleware/badge.svg?branch=master
[coveralls-badge-url]: https://coveralls.io/r/juanjoDiaz/serverless-middleware?branch=master
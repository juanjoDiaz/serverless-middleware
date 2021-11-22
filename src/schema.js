/**
 * @description Define the additions to the serverless schema by this plugin.
 * */
function extendServerlessSchema(serverless) {
  if (!serverless.configSchemaHandler) return;

  const middlewareSchema = {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          then: { type: 'string' },
          catch: { type: 'string' },
        },
      },
    ],
  };

  if (typeof serverless.configSchemaHandler.defineCustomProperties === 'function') {
    serverless.configSchemaHandler.defineCustomProperties({
      properties: {
        middleware: {
          type: 'object',
          properties: {
            folderName: { type: 'string' },
            cleanFolder: { type: 'boolean' },
            pre: { type: 'array', items: middlewareSchema },
            pos: { type: 'array', items: middlewareSchema },
          },
          additionalProperties: false,
        },
      },
    });
  }

  if (typeof serverless.configSchemaHandler.defineFunctionProperties === 'function') {
    serverless.configSchemaHandler.defineFunctionProperties('aws', {
      type: 'object',
      properties: {
        middleware: {
          anyOf: [
            { type: 'array', items: middlewareSchema },
            {
              type: 'object',
              items: {
                pre: { type: 'array', items: middlewareSchema },
                pos: { type: 'array', items: middlewareSchema },
              },
            },
          ],
        },
      },
    });
  }
}

module.exports = {
  extendServerlessSchema,
};

local typedefs = require 'kong.db.schema.typedefs'
return {
  name = 'identity-auth',
  fields = {
    { consumer = typedefs.no_consumer },
    { protocols = typedefs.protocols_http },
    { config = {
      type = 'record',
      fields = { { verify_url = { type = 'string', required = true } } },
    } },
  },
}

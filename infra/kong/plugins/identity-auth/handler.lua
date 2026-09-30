local http = require 'resty.http'
local cjson = require 'cjson.safe'
local plugin = { PRIORITY = 900, VERSION = '1.0.0' }
function plugin:access(conf)
  local client = http.new()
  client:set_timeout(3000)
  local res = client:request_uri(conf.verify_url, {
    method = 'POST',
    headers = {
      ['Cookie'] = kong.request.get_header('cookie'),
      ['Authorization'] = kong.request.get_header('authorization'),
      ['Origin'] = kong.request.get_header('origin'),
      ['Content-Type'] = 'application/json',
    },
    body = '{}',
    keepalive = true,
  })
  if not res then return kong.response.exit(503, { error = 'Identity unavailable' }) end
  if res.status == 401 or res.status == 403 then
    return kong.response.exit(res.status, { error = 'Unauthorized' })
  end
  if res.status ~= 200 then return kong.response.exit(503, { error = 'Identity unavailable' }) end
  local data = cjson.decode(res.body)
  if not data or type(data.token) ~= 'string' or data.token == '' then
    return kong.response.exit(503, { error = 'Invalid Identity response' })
  end
  kong.service.request.set_header('Authorization', 'Bearer ' .. data.token)
  -- Services use a signed subject, never a caller-supplied identity header.
  kong.service.request.clear_header('X-User-ID')
  kong.service.request.clear_header('X-User-Role')
  kong.service.request.clear_header('Cookie')
end
return plugin

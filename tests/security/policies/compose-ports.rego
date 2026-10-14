# METADATA
# title: Compose ports must bind to loopback
# description: Local development services must not listen on public host interfaces.
# custom:
#   id: MY-COMPOSE-002
#   severity: HIGH
#   input:
#     selector:
#       - type: yaml
package mercadoya.compose.ports

import rego.v1

deny contains msg if {
    some name, service in input.services
    some port in service.ports
    is_string(port)
    not startswith(port, "127.0.0.1:")
    not startswith(port, "[::1]:")
    msg := sprintf("Service %s exposes a port beyond loopback", [name])
}

deny contains msg if {
    some name, service in input.services
    some port in service.ports
    is_object(port)
    not port.host_ip in {"127.0.0.1", "::1"}
    msg := sprintf("Service %s exposes a port beyond loopback", [name])
}

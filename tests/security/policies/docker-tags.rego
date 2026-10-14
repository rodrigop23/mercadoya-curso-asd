# METADATA
# title: Docker base images require an explicit version
# description: Promote the native latest-tag rule to HIGH for the architecture gate.
# custom:
#   id: MY-DOCKER-001
#   severity: HIGH
#   input:
#     selector:
#       - type: dockerfile
package mercadoya.docker.tags

import rego.v1

# Reutiliza la resolución nativa de ARG y alias de etapas, sin copiar el parser.
deny contains finding if {
    some finding in data.builtin.dockerfile.DS001.deny
}

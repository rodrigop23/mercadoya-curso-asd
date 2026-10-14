# METADATA
# title: Compose must keep container isolation and explicit image versions
# description: Prevent privileged containers, host namespaces, root overrides, unpinned images and the Docker socket.
# custom:
#   id: MY-COMPOSE-001
#   severity: HIGH
#   input:
#     selector:
#       - type: yaml
package mercadoya.compose.isolation

import rego.v1

deny contains msg if {
    some name, service in input.services
    service.privileged == true
    msg := sprintf("Service %s is privileged", [name])
}

deny contains msg if {
    some name, service in input.services
    some key in {"network_mode", "pid", "ipc"}
    service[key] == "host"
    msg := sprintf("Service %s shares a host namespace", [name])
}

deny contains msg if {
    some name, service in input.services
    regex.match("^(root|0)(:|$)", sprintf("%v", [service.user]))
    msg := sprintf("Service %s explicitly runs as root", [name])
}

deny contains msg if {
    some name, service in input.services
    image := service.image
    not contains(image, "@sha256:")
    not regex.match(":[^/:]+$", image)
    msg := sprintf("Service %s has no image tag", [name])
}

deny contains msg if {
    some name, service in input.services
    endswith(service.image, ":latest")
    msg := sprintf("Service %s uses latest", [name])
}

deny contains msg if {
    some name, service in input.services
    some volume in service.volumes
    contains(sprintf("%v", [volume]), "docker.sock")
    msg := sprintf("Service %s mounts the Docker socket", [name])
}

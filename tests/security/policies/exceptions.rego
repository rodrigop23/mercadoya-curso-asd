# METADATA
# title: Security exceptions require scope, justification and an expiry within 90 days
# description: Reject incomplete, expired or overly long security exceptions.
# custom:
#   id: MY-EXCEPTIONS-001
#   severity: HIGH
#   input:
#     selector:
#       - type: yaml
package mercadoya.exceptions

import rego.v1

valid(entry) if {
    is_string(entry.id)
    count(entry.id) > 0
    is_array(entry.paths)
    count(entry.paths) > 0
    is_string(entry.statement)
    count(trim_space(entry.statement)) > 0
    is_string(entry.expired_at)
    expiry := time.parse_rfc3339_ns(entry.expired_at)
    expiry > time.now_ns()
    expiry <= time.now_ns() + 90 * 24 * 60 * 60 * 1000000000
}

deny contains msg if {
    some kind in {"vulnerabilities", "misconfigurations", "secrets"}
    some entry in input[kind]
    not valid(entry)
    msg := sprintf("Invalid or expired exception %s in %s", [object.get(entry, "id", "missing"), kind])
}

"""Print finding metadata without secret matches or source snippets."""

import json
import sys

with open(sys.argv[1]) as report:
    results = json.load(report).get("Results", [])
count = 0
for result in results:
    for kind in ("Vulnerabilities", "Secrets", "Misconfigurations"):
        for finding in result.get(kind, []):
            count += 1
            identifier = finding.get("VulnerabilityID", finding.get("ID", finding.get("RuleID")))
            line = finding.get("StartLine", finding.get("CauseMetadata", {}).get("StartLine", ""))
            print(f"{finding['Severity']} {identifier} {result['Target']}:{line}")
print(f"Security findings: {count}")

from collections import Counter
from typing import Dict, Iterable


def severity_counts(events: Iterable[Dict]) -> Dict[str, int]:
    counter: Counter[str] = Counter()
    for ev in events:
        sev = str(ev.get("severity") or "info")
        counter[sev] += 1
    return dict(counter)



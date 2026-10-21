def unique_records(records, key):
    seen = set()
    result = []
    for record in records:
        val = record.get(key)
        if val is None:
            raise KeyError(f"Key '{key}' not found in record")
        if val not in seen:
            seen.add(val)
            result.append(record)
    return result

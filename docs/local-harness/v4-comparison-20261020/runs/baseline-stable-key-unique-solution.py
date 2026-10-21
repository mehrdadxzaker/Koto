def unique_records(records, key):
    seen = set()
    result = []
    for record in records:
        value = record.get(key)
        if value is None:
            raise KeyError(key)
        if value not in seen:
            seen.add(value)
            result.append(record)
    return result

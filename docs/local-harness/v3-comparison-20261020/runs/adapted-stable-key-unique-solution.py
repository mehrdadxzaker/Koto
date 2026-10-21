def unique_records(records, key):
    seen = set()
    result = []
    for record in records:
        value = record[key]
        # Handle unhashable types by using a tuple of the value's elements
        if isinstance(value, (list, dict)):
            value = tuple(value.items()) if isinstance(value, dict) else tuple(value)
        if value not in seen:
            seen.add(value)
            result.append(record)
    return result

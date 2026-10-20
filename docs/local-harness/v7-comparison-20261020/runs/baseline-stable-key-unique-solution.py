def unique_records(records, key):
    seen = set()
    result = []
    for record in records:
        val = record[key]
        if val not in seen:
            seen.add(val)
            result.append(record)
    return result

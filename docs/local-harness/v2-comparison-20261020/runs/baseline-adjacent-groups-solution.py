def group_runs(values):
    if not values:
        return []
    result = []
    current_run = [values[0]]
    for value in values[1:]:
        if value == current_run[-1]:
            current_run.append(value)
        else:
            result.append(current_run)
            current_run = [value]
    result.append(current_run)
    return result

def group_runs(values):
    if not values:
        return []

    runs = []
    current_run = [values[0]]

    for value in values[1:]:
        if value == current_run[-1]:
            current_run.append(value)
        else:
            runs.append(current_run)
            current_run = [value]

    runs.append(current_run)
    return runs

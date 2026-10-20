def merge_intervals(intervals):
    if not intervals:
        return []

    # Validate intervals
    for start, end in intervals:
        if start > end:
            raise ValueError(f"Invalid interval: ({start}, {end})")

    # Sort intervals by start time
    sorted_intervals = sorted(intervals, key=lambda x: x[0])

    merged = []
    for interval in sorted_intervals:
        if not merged:
            merged.append(interval)
        else:
            last_start, last_end = merged[-1]
            current_start, current_end = interval

            # Check for overlap or touch
            if current_start <= last_end:
                # Merge intervals
                new_start = last_start
                new_end = max(last_end, current_end)
                merged[-1] = (new_start, new_end)
            else:
                merged.append(interval)

    return merged

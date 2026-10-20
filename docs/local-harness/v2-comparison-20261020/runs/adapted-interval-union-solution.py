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

            # Check if intervals overlap or touch
            if current_start <= last_end:
                # Merge intervals
                merged[-1] = (last_start, max(last_end, current_end))
            else:
                merged.append(interval)

    return merged

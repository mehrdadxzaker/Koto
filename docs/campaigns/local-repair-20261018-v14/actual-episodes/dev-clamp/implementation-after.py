def clamp(value, lower, upper):
    if lower > upper:
        raise ValueError("lower cannot exceed upper")
    return max(lower, min(upper, value))

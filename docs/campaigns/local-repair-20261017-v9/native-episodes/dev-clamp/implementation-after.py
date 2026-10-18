def clamp(value, lower, upper):
    if lower > upper:
        raise ValueError("lower bound cannot exceed upper bound")
    return max(lower, min(value, upper))

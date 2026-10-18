def clamp(value, lower, upper):
    if lower > upper:
        raise ValueError("lower exceeds upper")
    return max(min(value, upper), lower)

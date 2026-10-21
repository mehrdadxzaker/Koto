def ceil_div(n, d):
    if d <= 0:
        raise ValueError("Divisor must be positive")
    return (n + d - 1) // d

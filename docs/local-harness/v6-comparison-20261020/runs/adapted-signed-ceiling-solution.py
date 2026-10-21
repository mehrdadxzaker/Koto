def ceil_div(n, d):
    if d <= 0:
        raise ValueError("d must be positive")
    return (n + d - 1) // d if n >= 0 else (n - d + 1) // d

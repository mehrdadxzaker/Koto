def clamp(value, lower, upper):
    if lower > upper:
        raise ValueError("lower bound cannot exceed upper bound")
    return max(lower, min(upper, value))

# Test cases
print("Testing clamp function:")

# Normal cases
print(f"clamp(5, 1, 10) = {clamp(5, 1, 10)}")  # Should return 5
print(f"clamp(0, 1, 10) = {clamp(0, 1, 10)}")  # Should return 1 (lower bound)
print(f"clamp(15, 1, 10) = {clamp(15, 1, 10)}")  # Should return 10 (upper bound)

# Edge cases
print(f"clamp(1, 1, 10) = {clamp(1, 1, 10)}")  # Should return 1
print(f"clamp(10, 1, 10) = {clamp(10, 1, 10)}")  # Should return 10

# Error case
try:
    clamp(5, 10, 1)
    print("ERROR: Should have raised ValueError")
except ValueError as e:
    print(f"clamp(5, 10, 1) correctly raised ValueError: {e}")

print("All tests completed.")
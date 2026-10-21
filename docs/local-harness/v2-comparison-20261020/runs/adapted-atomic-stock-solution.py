def consume_stock(stock, requests):
    # Validate all requests before making any changes
    for item, quantity in requests:
        if item not in stock:
            raise KeyError(f"Unknown item: {item}")
        if quantity < 0:
            raise ValueError(f"Negative quantity: {quantity} for item {item}")
    # Check for sufficient stock for repeated items
    temp_stock = stock.copy()
    for item, quantity in requests:
        if temp_stock[item] < quantity:
            raise ValueError(f"Insufficient stock for item {item}: requested {quantity}, available {temp_stock[item]}")
        temp_stock[item] -= quantity
    # If all validations passed, update the original stock
    for item, quantity in requests:
        stock[item] -= quantity
    return stock

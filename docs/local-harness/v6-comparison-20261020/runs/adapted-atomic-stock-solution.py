def consume_stock(stock, requests):
    # Validate all requests before mutating
    for item, quantity in requests:
        if item not in stock:
            raise KeyError(f"Unknown item: {item}")
        if quantity < 0:
            raise ValueError(f"Negative quantity: {quantity}")
        if stock[item] < quantity:
            raise ValueError(f"Insufficient stock for {item}: requested {quantity}, available {stock[item]}")
    # Deduct all quantities in place
    for item, quantity in requests:
        stock[item] -= quantity
    return stock

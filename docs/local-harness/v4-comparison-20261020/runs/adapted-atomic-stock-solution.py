def consume_stock(stock, requests):
    for item, quantity in requests:
        stock[item] -= quantity
    return stock

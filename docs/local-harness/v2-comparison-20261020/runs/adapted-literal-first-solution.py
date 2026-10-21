def replace_first(text, needle, replacement):
    if not needle:
        raise ValueError("Needle cannot be empty")
    return text.replace(needle, replacement, 1)

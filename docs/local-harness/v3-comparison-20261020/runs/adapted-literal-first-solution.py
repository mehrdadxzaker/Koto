def replace_first(text, needle, replacement):
    if not needle:
        raise ValueError("Needle cannot be empty")
    idx = text.find(needle)
    if idx == -1:
        return text
    return text[:idx] + replacement + text[idx + len(needle):]

def replace_first(text, needle, replacement):
    if not needle:
        raise ValueError("Needle cannot be empty")
    
    index = text.find(needle)
    if index == -1:
        return text
    
    return text[:index] + replacement + text[index + len(needle):]

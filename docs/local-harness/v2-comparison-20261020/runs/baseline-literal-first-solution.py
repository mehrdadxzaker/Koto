def replace_first(text, needle, replacement):
    if not needle:
        raise ValueError("Needle cannot be empty")
    
    # Find the index of the first occurrence of the needle
    index = text.find(needle)
    
    if index == -1:
        return text
    
    # Replace only the first occurrence
    return text[:index] + replacement + text[index + len(needle):]

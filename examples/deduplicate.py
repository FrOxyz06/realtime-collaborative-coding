def unique(values):
    """Keep the first occurrence of each integer, in order."""
    if any(type(value) is not int for value in values):
        raise ValueError("Expected integers")
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result

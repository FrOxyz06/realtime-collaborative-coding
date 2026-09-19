def unique(values):
    """Use a set for membership while keeping the output order."""
    if any(type(value) is not int for value in values):
        raise ValueError("Expected integers")
    seen = set()
    result = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result

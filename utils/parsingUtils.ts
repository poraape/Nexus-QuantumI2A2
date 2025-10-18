// utils/parsingUtils.ts
/**
 * Safely parses a value into a floating-point number.
 * Handles Brazilian currency format (e.g., "R$ 1.234,56").
 * Returns 0 for null, undefined, NaN, or non-numeric strings.
 * @param value The value to parse.
 * @returns The parsed number, or 0 if parsing fails.
 */
export const parseSafeFloat = (value: any): number => {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    if (typeof value === 'string') {
        // Remove currency symbols, thousands separators (.), and then replace comma with a dot for decimal.
        const cleaned = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }
    // For other types, try to convert to string and parse, but it's unlikely to be useful.
    // Defaulting to 0 is safer.
    return 0;
};

export const capitalizeFirstLetter = (text: string): string => {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const obsoleteReverseString = (text: string): string => {
  return text.split('').reverse().join('');
};

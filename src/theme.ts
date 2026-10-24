import { createTheme, type MantineColorsTuple } from '@mantine/core';

const blueprint: MantineColorsTuple = [
  '#edf1fc',
  '#d9e0f3',
  '#b0bfe6',
  '#849cd9',
  '#607fce',
  '#496cc8',
  '#3c62c6',
  '#2e52af',
  '#26489d',
  '#1a3d8b',
];

export const theme = createTheme({
  primaryColor: 'blueprint',
  colors: { blueprint },
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  headings: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  defaultRadius: 'md',
  cursorType: 'pointer',
});
